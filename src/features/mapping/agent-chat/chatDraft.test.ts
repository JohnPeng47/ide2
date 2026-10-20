import { expect, it } from 'vitest';
import type { ChatReference } from '../../../../domain/mapping/agent-chat/agentChat';
import { promptText } from '../prompt-composer/promptBody';
import { draftLength, replaceChatDraft, serializeChatDraft, sliceChatDraft, type ChatDraft } from './chatDraft';

const reference = (label: string): ChatReference => ({ canvas: { workspaceInstanceId: 'workspace', documentId: 'doc' }, canvasName: 'Canvas', displayNodeId: 'grid:overview',
  reference: { kind: 'diagram', label, diagramId: label, revisionId: 'pinned-revision' }, ascii: `${label}\n  Child` });
const chip = (label: string): ChatDraft[number] => ({ kind: 'reference', id: label, reference: reference(label) });

it('keeps marker positions and independently captured reference data in the same order', () => {
  const draft = [promptText('Explain '), chip('Service'), promptText(' to '), chip('Bridge'), promptText('\nwithout changing selection.')];
  const result = serializeChatDraft(draft);
  expect(result.prompt).toBe('Explain [ref 1] to [ref 2]\nwithout changing selection.');
  expect(result.references.map(ref => ref.reference.label)).toEqual(['Service', 'Bridge']);
  result.references[0].ascii = 'Changed externally';
  expect(serializeChatDraft(draft).references[0].ascii).toBe('Service\n  Child');
});

it('inserts at a text cursor and removes an entire chip at a one-character boundary', () => {
  const draft = replaceChatDraft([promptText('Explain  now')], 8, 8, [chip('Service')]);
  expect(serializeChatDraft(draft).prompt).toBe('Explain [ref 1] now');
  expect(draftLength(draft)).toBe('Explain  now'.length + 1);
  const removed = replaceChatDraft(draft, 8, 9, []);
  expect(serializeChatDraft(removed)).toEqual({ prompt: 'Explain  now', references: [] });
});

it('handles selections crossing text and references, renumbering surviving attachments', () => {
  const draft = [promptText('a'), chip('First'), promptText('bc'), chip('Second'), promptText('d')];
  expect(serializeChatDraft(sliceChatDraft(draft, 1, 5)).prompt).toBe('[ref 1]bc[ref 2]');
  const replaced = replaceChatDraft(draft, 0, 4, [promptText('Only ')]);
  expect(serializeChatDraft(replaced)).toEqual({ prompt: 'Only [ref 1]d', references: [reference('Second')] });
  const duplicate = replaceChatDraft(draft, 6, 6, sliceChatDraft(draft, 1, 2));
  expect(new Set(duplicate.map(block => block.id)).size).toBe(duplicate.length);
  expect(serializeChatDraft(duplicate).references.map(ref => ref.reference.label)).toEqual(['First', 'Second', 'First']);
});

it('does not infer attachments from manually typed marker text', () => {
  expect(serializeChatDraft([promptText('Literal [ref 1]')])).toEqual({ prompt: 'Literal [ref 1]', references: [] });
});
