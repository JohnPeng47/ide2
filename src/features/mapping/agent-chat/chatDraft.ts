import type { ChatReference } from '../../../../domain/mapping/agent-chat/agentChat';
import { normalizePromptBody, promptText, serializePromptBody, type PromptBodyBlock } from '../prompt-composer/promptBody';

export type ChatDraft = readonly (PromptBodyBlock<ChatReference> & { selectionKey?: string })[];
export const emptyChatDraft = (): ChatDraft => [promptText()];
export const serializeChatDraft = (draft: ChatDraft) => serializePromptBody(draft);
export const draftLength = (draft: ChatDraft) => draft.reduce((size, block) => size + (block.kind === 'text' ? block.text.length : 1), 0);

/** Offsets count a complete reference as one character, including when a text selection crosses it. */
export function sliceChatDraft(draft: ChatDraft, start: number, end = draftLength(draft)): ChatDraft {
  let offset = 0;
  return draft.flatMap(block => {
    const length = block.kind === 'text' ? block.text.length : 1;
    const from = Math.max(0, start - offset), to = Math.min(length, end - offset);
    offset += length;
    if (from >= to) return [];
    return [block.kind === 'text' ? { ...block, text: block.text.slice(from, to) } : block];
  });
}
export function replaceChatDraft(draft: ChatDraft, start: number, end: number, inserted: ChatDraft): ChatDraft {
  // New identities also make pasted copies independent of their originals.
  return normalizePromptBody([...sliceChatDraft(draft, 0, start), ...inserted, ...sliceChatDraft(draft, end)]
    .map(block => ({ ...block, id: crypto.randomUUID() })));
}

/** Reconcile automatic attachments by selection identity, independently of DOM clicks.
 * Missing chips stay dismissed until their selection leaves and re-enters the queue.
 * Pasted/manual references have no selectionKey and remain pinned snapshots. */
export function syncChatDraftSelections(draft: ChatDraft, entries: readonly { key: string; value: ChatReference }[],
  seen: ReadonlySet<string>, cursor: { anchor: number; focus: number }) {
  const desired = new Map(entries.map(entry => [entry.key, entry.value]));
  const present = new Set<string>();
  const removed: number[] = [];
  let offset = 0, changed = false;
  const body = draft.flatMap(block => {
    const position = offset;
    offset += block.kind === 'text' ? block.text.length : 1;
    if (block.kind !== 'reference' || !block.selectionKey) return [block];
    const reference = desired.get(block.selectionKey);
    if (!reference) { removed.push(position); changed = true; return []; }
    present.add(block.selectionKey);
    if (JSON.stringify(reference) === JSON.stringify(block.reference)) return [block];
    changed = true;
    return [{ ...block, reference: structuredClone(reference) }];
  });
  const remap = (position: number) => Math.max(0, Math.min(offset, position) - removed.filter(at => at < position).length);
  let selection = { anchor: remap(cursor.anchor), focus: remap(cursor.focus) };
  let next: ChatDraft = changed ? normalizePromptBody(body) : draft;
  const added: ChatDraft = entries.filter(entry => !seen.has(entry.key) && !present.has(entry.key))
    .map(entry => ({ kind: 'reference', id: crypto.randomUUID(), selectionKey: entry.key, reference: structuredClone(entry.value) }));
  if (added.length) {
    // Insert at the caret without replacing selected prompt text.
    next = replaceChatDraft(next, selection.focus, selection.focus, added);
    selection = { anchor: selection.focus + added.length, focus: selection.focus + added.length };
  }
  return { draft: next, selection, seen: new Set(desired.keys()) };
}
