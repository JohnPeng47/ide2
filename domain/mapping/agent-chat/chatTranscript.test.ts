import { describe, expect, it } from 'vitest';
import { MAX_TOOL_TEXT, reduceChatEvent, type ChatItem, type ChatSession } from './agentChat';
import { failedItem, TranscriptProjector, workingStatus } from './chatTranscript';

const item = (id: string, kind: ChatItem['kind'], extra: Partial<ChatItem> = {}): ChatItem => ({ id, kind, text: id, turnId: 't1', status: 'completed', ...extra });
const read = (id: string, extra: Partial<ChatItem> = {}) => item(id, 'tool', { command: { command: `cat ${id}`, actions: [{ type: 'read', name: id }] }, ...extra });
const session = (items: ChatItem[]): ChatSession => ({ id: 's', threadId: 'th', title: 'Test', cwd: '/tmp', createdAt: '', updatedAt: '', settings: { model: '', effort: '', sandbox: 'read-only' }, status: 'running', turnId: 't1', items, pending: [], requestIds: [] });

describe('Codex transcript projection', () => {
  it('groups exploration through hidden summaries, but stops at visible content and turn boundaries', () => {
    const items = [read('a'), item('r', 'reasoning'), read('b'), item('speech', 'assistant'), read('c'), read('d', { turnId: 't2' })];
    const blocks = new TranscriptProjector().project(items);
    expect(blocks.map(block => block.items.map(item => item.id))).toEqual([['a', 'r', 'b'], ['speech'], ['c'], ['d']]);
  });
  it('retains completed block identities during a large history stream and produces the same replay', () => {
    const history = Array.from({ length: 4000 }, (_, i) => item(`message-${i}`, 'assistant', { turnId: 'old' }));
    let state = session([...history, read('first'), item('summary', 'reasoning'), read('live', { status: 'inProgress' })]);
    const projector = new TranscriptProjector(), initial = projector.project(state.items);
    for (let i = 0; i < 50; i++) {
      state = reduceChatEvent(state, { type: 'delta', id: 'live', kind: 'tool', text: '\noutput' });
      const next = projector.project(state.items);
      expect(next[0]).toBe(initial[0]);
      expect(next[3998]).toBe(initial[3998]);
      expect(next.at(-1)?.id).toBe('first');
    }
    expect(projector.project(state.items)).toEqual(new TranscriptProjector().project(JSON.parse(JSON.stringify(state.items))));
  });
  it('regroups when a late classification arrives or empty assistant text becomes visible', () => {
    let state = session([read('a'), item('empty', 'assistant', { text: '', status: 'inProgress' }), read('b')]);
    const projector = new TranscriptProjector();
    expect(projector.project(state.items)).toHaveLength(1);
    state = reduceChatEvent(state, { type: 'delta', id: 'empty', kind: 'assistant', text: 'Commentary' });
    expect(projector.project(state.items).map(block => block.id)).toEqual(['a', 'empty', 'b']);
  });
  it('keeps the latest supplied summary through tools and suppresses redundant streaming/final status', () => {
    const summary = item('r', 'reasoning', { text: '**Inspecting the parser**' });
    expect(workingStatus(session([summary, read('a')]))).toBe('Inspecting the parser');
    expect(workingStatus(session([summary, item('a', 'assistant', { status: 'inProgress', phase: 'commentary' })]))).toBeNull();
    expect(workingStatus(session([summary, item('a', 'assistant', { phase: 'commentary' })]))).toBe('Inspecting the parser');
    expect(workingStatus(session([summary, item('a', 'assistant', { phase: 'final_answer' })]))).toBeNull();
    expect(workingStatus(session([summary, item('a', 'assistant')]))).toBeNull();
    expect(workingStatus(session([summary, item('u', 'user')]))).toBe('Working…');
  });
  it('bounds tool text with honest omission counts and treats final text as canonical', () => {
    let state = session([]);
    state = reduceChatEvent(state, { type: 'batch', events: [
      { type: 'delta', id: 'log', kind: 'tool', text: 'x'.repeat(MAX_TOOL_TEXT + 100) },
      { type: 'delta', id: 'log', kind: 'tool', text: 'END' },
      { type: 'delta', id: 'a', kind: 'assistant', text: 'partial' }
    ] });
    expect(state.items[0].text).toHaveLength(MAX_TOOL_TEXT);
    expect(state.items[0].text.endsWith('END')).toBe(true);
    expect(state.items[0].omittedChars).toBe(103);
    state = reduceChatEvent(state, { type: 'item', item: item('a', 'assistant', { text: 'Complete canonical answer' }) });
    expect(state.items[1].text).toBe('Complete canonical answer');
  });
  it('updates a large exploration group without mutating earlier snapshots or losing cached counts', () => {
    let state = session(Array.from({ length: 4000 }, (_, i) => read(`file-${i}`)));
    const projector = new TranscriptProjector(), previous = projector.project(state.items);
    state = reduceChatEvent(state, { type: 'item', item: read('next', { status: 'inProgress' }) });
    let blocks = projector.project(state.items);
    expect(previous[0].items).toHaveLength(4000);
    expect(blocks[0]).toMatchObject({ commandCount: 4001, failureCount: 0, activeCount: 1 });
    state = reduceChatEvent(state, { type: 'item', item: read('next', { status: 'failed' }) });
    blocks = projector.project(state.items);
    expect(blocks[0]).toMatchObject({ commandCount: 4001, failureCount: 1, activeCount: 0 });
    expect(blocks).toEqual(new TranscriptProjector().project(structuredClone(state.items)));
  });
  it('does not label search no-match exit as failure', () => {
    expect(failedItem(item('s', 'tool', { command: { command: 'rg x', exitCode: 1, actions: [{ type: 'search' }] } }))).toBe(false);
    expect(failedItem(read('a', { command: { command: 'cat missing', exitCode: 1, actions: [{ type: 'read' }] } }))).toBe(true);
  });
});
