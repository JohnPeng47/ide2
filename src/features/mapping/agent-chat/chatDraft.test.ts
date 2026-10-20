import { expect, it } from 'vitest';
import type { ChatReference } from '../../../../domain/mapping/agent-chat/agentChat';
import { promptText } from '../prompt-composer/promptBody';
import { draftLength, replaceChatDraft, serializeChatDraft, sliceChatDraft, syncChatDraftSelections, type ChatDraft } from './chatDraft';

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

it('updates queue references in place and removes deselected ones while keeping text and manual references', () => {
  const initial = syncChatDraftSelections([promptText('Explain '), chip('Manual')], [{ key: 'selection', value: reference('Branch') }],
    new Set(), { anchor: 8, focus: 8 });
  const id = initial.draft.find(block => block.selectionKey === 'selection')!.id;
  const updated = syncChatDraftSelections(initial.draft, [{ key: 'selection', value: reference('Reduced') }], initial.seen, initial.selection);
  expect(updated.draft.find(block => block.selectionKey === 'selection')!.id).toBe(id);
  expect(serializeChatDraft(updated.draft).references.map(ref => ref.reference.label)).toEqual(['Reduced', 'Manual']);
  const removed = syncChatDraftSelections(updated.draft, [], updated.seen, updated.selection);
  expect(serializeChatDraft(removed.draft)).toEqual({ prompt: 'Explain [ref 1]', references: [reference('Manual')] });
  expect(removed.selection).toEqual({ anchor: 8, focus: 8 });
});

it('reconciles a single-click reference into only the final double-click subtree reference', () => {
  const single = syncChatDraftSelections([promptText('Explain')], [{ key: 'single', value: reference('Node') }],
    new Set(), { anchor: 0, focus: 7 });
  const subtree = syncChatDraftSelections(single.draft, [{ key: 'subtree', value: reference('Subtree') }], single.seen, single.selection);
  expect(serializeChatDraft(subtree.draft)).toEqual({ prompt: 'Explain[ref 1]', references: [reference('Subtree')] });
  expect(subtree.selection).toEqual({ anchor: 8, focus: 8 });
});

it('does not resurrect dismissed or sent references until their selection is removed and re-added', () => {
  const entries = [{ key: 'selection', value: reference('Branch') }];
  const first = syncChatDraftSelections([promptText()], entries, new Set(), { anchor: 0, focus: 0 });
  const dismissed = syncChatDraftSelections([promptText('Keep typing')], entries, first.seen, { anchor: 11, focus: 11 });
  expect(serializeChatDraft(dismissed.draft).references).toEqual([]);
  const cleared = syncChatDraftSelections(dismissed.draft, [], dismissed.seen, dismissed.selection);
  const reselected = syncChatDraftSelections(cleared.draft, entries, cleared.seen, cleared.selection);
  expect(serializeChatDraft(reselected.draft).references).toHaveLength(1);
});
