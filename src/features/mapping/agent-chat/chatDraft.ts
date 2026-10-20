import type { ChatReference } from '../../../../domain/mapping/agent-chat/agentChat';
import { normalizePromptBody, promptText, serializePromptBody, type PromptBodyBlock } from '../prompt-composer/promptBody';

export type ChatDraft = readonly PromptBodyBlock<ChatReference>[];
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
