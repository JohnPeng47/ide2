import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../agent-chat/agentChat';
import { parseGeneratedSnippets, referenceGenerationMessage, referenceGenerationRounds, referenceSources, referenceSourcesConfirmation, referenceSourcesMessage, referenceSourcesStatus, type ReferenceSources } from '../referenceGeneration';

const user = (id: string, prompt: string): ChatItem => ({ id, kind: 'user', status: 'completed', text: referenceGenerationMessage({ excerpt: 'A\n`-- B', prompt, count: 2 }) });
const answer = (id: string, text: string, status = 'completed', phase?: ChatItem['phase']): ChatItem => ({ id, kind: 'assistant', status, text, ...(phase ? { phase } : {}) });

describe('parseGeneratedSnippets', () => {
  it('takes each fenced block and ignores the text around them', () => {
    expect(parseGeneratedSnippets('Here you go:\n```text\nX\n`-- Y\n```\nand\n```\nZ\n```\nDone.')).toEqual({ snippets: ['X\n`-- Y', 'Z'], partial: undefined });
  });
  it('reports the block still being written, and nothing while its opening fence is the last line', () => {
    expect(parseGeneratedSnippets('```text\nX\n```\n```text\nY\n|-- ')).toEqual({ snippets: ['X'], partial: 'Y\n|--' });
    expect(parseGeneratedSnippets('```text')).toEqual({ snippets: [], partial: undefined });
  });
  it('gives generated snippets the same shape as a captured selection', () => {
    expect(parseGeneratedSnippets('```text\n|   `-- X\n|       `-- Y\n```').snippets).toEqual(['X\n`-- Y']);
  });
  it('skips empty blocks', () => {
    expect(parseGeneratedSnippets('```text\n\n```').snippets).toEqual([]);
  });
});

describe('referenceGenerationRounds', () => {
  it('separates turns of the shared conversation, recovering each request', () => {
    const rounds = referenceGenerationRounds({ status: 'idle', items: [user('1', 'first'), answer('a', '```text\nP\n```'), user('2', 'second\n\nWrite well'), answer('b', '```text\nQ\n```\n```text\nR\n```')] });
    expect(rounds.map(round => [round.prompt, round.excerpt, round.snippets])).toEqual([['first', 'A\n`-- B', ['P']], ['second\n\nWrite well', 'A\n`-- B', ['Q', 'R']]]);
  });
  it('streams only the latest round, and drops an unfinished block once the turn ends', () => {
    const items = [user('1', 'p'), answer('a', '```text\nP\n```\n```text\nunfini', 'inProgress')];
    expect(referenceGenerationRounds({ status: 'running', items })[0]).toMatchObject({ snippets: ['P'], partial: 'unfini', running: true });
    expect(referenceGenerationRounds({ status: 'interrupted', items: [items[0], { ...items[1], status: 'interrupted' }] })[0]).toMatchObject({ snippets: ['P'], partial: undefined, running: false });
  });
  it('ignores commentary, so a block quoted while working is not a result', () => {
    const [round] = referenceGenerationRounds({ status: 'idle', items: [user('1', 'p'), answer('c', '```text\nthinking\n```', 'completed', 'commentary'), answer('a', '```text\nP\n```', 'completed', 'final_answer')] });
    expect(round.snippets).toEqual(['P']);
  });
  it('keeps the reply when it holds no snippets, and tolerates a message from elsewhere', () => {
    const [round] = referenceGenerationRounds({ status: 'idle', items: [{ id: '1', kind: 'user', status: 'completed', text: 'plain' }, answer('a', 'I cannot do that.')] });
    expect(round).toMatchObject({ message: 'plain', snippets: [], reply: 'I cannot do that.' });
    expect(round.prompt).toBeUndefined();
  });
});

describe('referenceSources', () => {
  const range = (path: string, startLine: number, endLine: number) => ({ id: `${path}${startLine}`, path, startLine, endLine, originalLines: [] });
  const evidence = { a: { sourceRanges: [range('b.ts', 9, 12), range('a.ts', 1, 2)] }, b: { sourceRanges: [range('b.ts', 3, 4), range('b.ts', 9, 12)] } };
  const binding = { sourceId: 's', repositoryIdentity: '/repo/.git', domainProfileId: 'source-code', corpus: { kind: 'git-worktree', root: '/gone', revision: 'abc123' } };
  it('lists each mapped file once, with its distinct ranges in order', () => {
    expect(referenceSources({ contentHash: '', mappings: [], evidence, binding } as never)).toEqual({ repository: '/repo/.git', root: '/gone', revision: 'abc123',
      files: [{ path: 'a.ts', ranges: [[1, 2]] }, { path: 'b.ts', ranges: [[3, 4], [9, 12]] }] });
  });
  it('reads a pinned revision from the repository, since the checkout may be gone', () => {
    const message = referenceSourcesMessage(referenceSources({ contentHash: '', mappings: [], evidence, binding } as never), REQUEST);
    expect(message).toContain('git --git-dir=/repo/.git show abc123:<path>');
    expect(message).toContain('- b.ts (this diagram maps to lines 3-4, 9-12)');
    expect(message.split('\n')).toContain(referenceSourcesConfirmation(REQUEST));
  });
});

const REQUEST = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
describe('referenceSourcesStatus', () => {
  const sources: ReferenceSources = { files: [{ path: 'a.ts', ranges: [[1, 2]] }] };
  const load = (requestId = REQUEST): ChatItem => ({ id: requestId, kind: 'user', status: 'completed', text: referenceSourcesMessage(sources, requestId) });
  const read: ChatItem = { id: 'tool', kind: 'tool', status: 'completed', text: 'contents' };
  const confirmed = (requestId = REQUEST) => answer('reply', `Read a.ts.\n${referenceSourcesConfirmation(requestId)}`, 'completed', 'final_answer');

  it('starts with nothing loaded, and is loading from the message until the turn ends', () => {
    expect(referenceSourcesStatus({ status: 'idle', items: [] }).state).toBe('none');
    expect(referenceSourcesStatus({ status: 'running', items: [load(), read] })).toMatchObject({ state: 'loading', reads: 1 });
  });
  it('is loaded once the turn ended with the confirmation this attempt asked for', () => {
    expect(referenceSourcesStatus({ status: 'idle', items: [load(), read, confirmed()] })).toMatchObject({ state: 'loaded', reply: 'Read a.ts.' });
  });
  it('waits for the turn to end, even when the confirmation has already arrived', () => {
    expect(referenceSourcesStatus({ status: 'running', items: [load(), read, confirmed()] }).state).toBe('loading');
  });
  it.each<[string, ChatItem[], 'idle' | 'interrupted' | 'failed']>([
    ['a reply without the confirmation', [load(), read, answer('r', 'Could not read a.ts.', 'completed', 'final_answer')], 'idle'],
    ['the confirmation of an earlier attempt', [load(), read, confirmed(OTHER)], 'idle'],
    ['the confirmation in the middle of a reply', [load(), read, answer('r', `${referenceSourcesConfirmation(REQUEST)}\nbut a.ts failed`, 'completed', 'final_answer')], 'idle'],
    ['the confirmation in commentary', [load(), read, answer('r', referenceSourcesConfirmation(REQUEST), 'completed', 'commentary')], 'idle'],
    ['a confirmation with nothing read', [load(), confirmed()], 'idle'],
    ['a turn that was stopped', [load(), read, confirmed()], 'interrupted'],
    ['a turn that failed', [load(), read, confirmed()], 'failed'],
  ])('does not accept %s', (_name, items, status) => {
    expect(referenceSourcesStatus({ status, items }).state).toBe('unconfirmed');
  });
  it('stays loaded through later generations, and a retry can succeed after a failure', () => {
    expect(referenceSourcesStatus({ status: 'running', items: [load(), read, confirmed(), user('g', 'p')] }).state).toBe('loaded');
    expect(referenceSourcesStatus({ status: 'idle', items: [load(), read, answer('r', 'Failed.'), load(OTHER), read, confirmed(OTHER)] }).state).toBe('loaded');
  });
  it('stops counting loaded sources once the conversation is compacted', () => {
    const compaction: ChatItem = { id: 'c', kind: 'notice', status: 'completed', text: '', sourceType: 'contextCompaction' };
    expect(referenceSourcesStatus({ status: 'idle', items: [load(), read, confirmed(), compaction] })).toMatchObject({ state: 'none', compacted: true });
    expect(referenceSourcesStatus({ status: 'idle', items: [compaction] }).compacted).toBeUndefined();
    expect(referenceSourcesStatus({ status: 'idle', items: [load(), read, confirmed(), compaction, load(OTHER), read, confirmed(OTHER)] }).state).toBe('loaded');
  });
  it('is not fooled by a generation prompt quoting a confirmation', () => {
    expect(referenceSourcesStatus({ status: 'idle', items: [user('g', referenceSourcesConfirmation(REQUEST)), read, confirmed()] }).state).toBe('none');
  });
  it('keeps load turns out of the generation rounds', () => {
    const rounds = referenceGenerationRounds({ status: 'running', items: [user('1', 'first'), answer('a', '```text\nP\n```'), load(), read, answer('b', '```text\nnot a snippet\n```')] });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ snippets: ['P'], running: false });
  });
});
