import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chatReferenceSchema } from '../../../../domain/mapping/agent-chat/agentChat';
import { normalizePromptBody, promptText } from '../prompt-composer/promptBody';
import { draftLength, replaceChatDraft, serializeChatDraft, sliceChatDraft, syncChatDraftSelections, type ChatDraft } from './chatDraft';
import { placeDraftSelection, readDraftDom, readDraftSelection, renderDraftDom, type DraftSelection } from './chatDraftDom';
import type { captureChatReferences } from './ChatReferences';

const clipboardType = 'application/x-agent-chat-draft+json';
type Snapshot = { draft: ChatDraft; selection: DraftSelection };
type History = { undo: Snapshot[]; redo: Snapshot[]; selection: DraftSelection };
const endOf = (draft: ChatDraft): DraftSelection => ({ anchor: draftLength(draft), focus: draftLength(draft) });
const bounds = (selection: DraftSelection) => [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)] as const;

export function ChatPromptEditor({ value, draftKey, selectedReferences, open, disabled, onChange, onSend }: {
  value: ChatDraft; draftKey: string; selectedReferences: ReturnType<typeof captureChatReferences>;
  open: boolean; disabled: boolean; onChange: (draft: ChatDraft) => void; onSend: () => void;
}) {
  const root = useRef<HTMLDivElement>(null), rendered = useRef<ChatDraft | undefined>(undefined);
  const histories = useRef(new Map<string, History>()), seen = useRef(new Set<string>());
  const [compositionActive, setCompositionActive] = useState(false);
  const composing = useRef(false), beforeComposition = useRef<Snapshot | undefined>(undefined);
  const previousKey = useRef<string | undefined>(undefined), wasOpen = useRef(false);
  if (!histories.current.has(draftKey)) histories.current.set(draftKey, { undo: [], redo: [], selection: endOf(value) });
  const history = histories.current.get(draftKey)!;
  const current = useRef({ value, history, disabled, onChange });
  current.current = { value, history, disabled, onChange };
  const remember = () => {
    const selection = root.current && readDraftSelection(root.current, current.current.value);
    if (selection) current.current.history.selection = selection;
    return current.current.history.selection;
  };
  const paint = (draft: ChatDraft, selection: DraftSelection, focus: boolean) => {
    if (!root.current) return;
    renderDraftDom(root.current, draft); rendered.current = draft;
    if (focus) placeDraftSelection(root.current, selection);
  };
  const commit = (draft: ChatDraft, selection: DraftSelection, focus = true, before?: Snapshot) => {
    const state = current.current;
    state.history.undo.push(before ?? { draft: state.value, selection: state.history.selection });
    if (state.history.undo.length > 100) state.history.undo.shift();
    state.history.redo = []; state.history.selection = selection;
    paint(draft, selection, focus); state.onChange(draft);
  };
  const replace = (inserted: ChatDraft, selection = remember(), focus = true) => {
    const [start, end] = bounds(selection), offset = start + draftLength(inserted);
    commit(replaceChatDraft(current.current.value, start, end, inserted), { anchor: offset, focus: offset }, focus);
  };
  const undo = (redo = false) => {
    const { value, history, onChange } = current.current;
    const entry = (redo ? history.redo : history.undo).pop();
    if (!entry) return;
    (redo ? history.undo : history.redo).push({ draft: value, selection: remember() });
    history.selection = entry.selection; paint(entry.draft, entry.selection, true); onChange(entry.draft);
  };
  const deleteReference = (backward: boolean) => {
    const selection = remember(); const [start, end] = bounds(selection);
    const from = start === end && backward ? start - 1 : start;
    const to = start === end && !backward ? end + 1 : end;
    if (!sliceChatDraft(current.current.value, from, to).some(block => block.kind === 'reference')) return false;
    replace([], { anchor: Math.max(0, from), focus: to }); return true;
  };
  const input = () => {
    if (composing.current || !root.current) return;
    const state = current.current, draft = readDraftDom(root.current, state.value);
    const selection = readDraftSelection(root.current, state.value) ?? endOf(draft);
    if (draft.length === state.value.length && draft.every((block, index) => {
      const previous = state.value[index];
      return block.kind === 'text' ? previous.kind === 'text' && previous.text === block.text : previous.kind === 'reference' && previous.id === block.id;
    })) return;
    commit(draft, selection);
  };

  useLayoutEffect(() => {
    const switched = previousKey.current !== draftKey;
    const opening = open && !wasOpen.current;
    const focused = document.activeElement === root.current;
    if (switched && !draftLength(value)) { history.undo = []; history.redo = []; history.selection = endOf(value); }
    if (rendered.current !== value && !composing.current) {
      // Sending clears the draft and its undo stack; undo must not resurrect an already sent message.
      if (!draftLength(value) && rendered.current && draftLength(rendered.current) && !switched) {
        history.undo = []; history.redo = []; history.selection = endOf(value);
      }
      paint(value, history.selection, open && (focused || switched || opening) && !disabled);
    } else if (open && (switched || opening) && !disabled && root.current) placeDraftSelection(root.current, history.selection);
    previousKey.current = draftKey; wasOpen.current = open;
  });
  useEffect(() => {
    const listener = () => { if (!composing.current) remember(); };
    document.addEventListener('selectionchange', listener);
    return () => document.removeEventListener('selectionchange', listener);
  }, []);
  useEffect(() => {
    // Native beforeinput covers mobile deletion and browser Edit > Undo in addition to keyboard shortcuts.
    const editor = root.current!;
    const listener = (event: InputEvent) => {
      if (current.current.disabled || composing.current || event.isComposing) return;
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); undo(event.inputType === 'historyRedo'); }
      else if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') { event.preventDefault(); replace([promptText('\n')]); }
      else if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && deleteReference(event.inputType === 'deleteContentBackward')) event.preventDefault();
      else remember();
    };
    editor.addEventListener('beforeinput', listener);
    return () => editor.removeEventListener('beforeinput', listener);
  }, []);
  useEffect(() => {
    if (!open || disabled || composing.current) return;
    const state = current.current;
    const next = syncChatDraftSelections(state.value, selectedReferences, seen.current, state.history.selection);
    seen.current = next.seen;
    if (next.draft !== state.value) commit(next.draft, next.selection, document.activeElement === root.current);
  }, [selectedReferences, draftKey, open, disabled, compositionActive]);

  return <div ref={root} className="agent-chat-prompt" role="textbox" aria-label="Message Codex" aria-multiline="true" aria-disabled={disabled}
    contentEditable={!disabled} suppressContentEditableWarning data-placeholder="Ask Codex to do anything…" data-empty={!draftLength(value)}
    title="Enter to send · Shift+Enter for a newline" onInput={input} onBlur={remember} onMouseUp={remember} onKeyUp={remember}
    onCompositionStart={() => { composing.current = true; setCompositionActive(true); beforeComposition.current = { draft: value, selection: remember() }; }}
    onCompositionEnd={() => {
      composing.current = false; setCompositionActive(false);
      const draft = readDraftDom(root.current!, value), selection = readDraftSelection(root.current!, value) ?? endOf(draft);
      commit(draft, selection, true, beforeComposition.current); beforeComposition.current = undefined;
    }}
    onKeyDown={event => {
      if (disabled || event.nativeEvent.isComposing || composing.current) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        event.preventDefault(); undo(event.shiftKey || event.key.toLowerCase() === 'y'); return;
      }
      if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) replace([promptText('\n')]); else onSend(); }
      else if ((event.key === 'Backspace' || event.key === 'Delete') && deleteReference(event.key === 'Backspace')) event.preventDefault();
      else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !modifier && !event.altKey) {
        const selection = remember(), direction = event.key === 'ArrowLeft' ? -1 : 1;
        const [start, end] = bounds(selection), focus = selection.focus;
        if ((start === end || event.shiftKey) && sliceChatDraft(value, direction < 0 ? focus - 1 : focus, direction < 0 ? focus : focus + 1).some(block => block.kind === 'reference')) {
          event.preventDefault(); const next = { anchor: event.shiftKey ? selection.anchor : focus + direction, focus: focus + direction };
          history.selection = next; placeDraftSelection(root.current!, next);
        }
      }
    }}
    onMouseDown={event => { if ((event.target as Element).closest('[data-reference-id] button')) event.preventDefault(); }}
    onClick={event => {
      const button = (event.target as Element).closest('[data-reference-id] button');
      if (!button || disabled) return;
      const id = (button.parentElement as HTMLElement).dataset.referenceId;
      let offset = 0;
      for (const block of value) {
        if (block.id === id) { replace([], { anchor: offset, focus: offset + 1 }); break; }
        offset += block.kind === 'text' ? block.text.length : 1;
      }
    }}
    onCopy={event => {
      const [start, end] = bounds(remember()); if (start === end) return;
      const selected = sliceChatDraft(value, start, end);
      event.preventDefault(); event.clipboardData.setData('text/plain', serializeChatDraft(selected).prompt);
      event.clipboardData.setData(clipboardType, JSON.stringify(selected.map(block => block.kind === 'text' ? block.text : block.reference)));
    }}
    onCut={event => {
      if (disabled) return;
      const selection = remember(), [start, end] = bounds(selection); if (start === end) return;
      const selected = sliceChatDraft(value, start, end);
      event.preventDefault(); event.clipboardData.setData('text/plain', serializeChatDraft(selected).prompt);
      event.clipboardData.setData(clipboardType, JSON.stringify(selected.map(block => block.kind === 'text' ? block.text : block.reference)));
      replace([], selection);
    }}
    onPaste={event => {
      event.preventDefault(); if (disabled) return;
      let pasted: ChatDraft = [promptText(event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'))];
      try {
        const parts: unknown = JSON.parse(event.clipboardData.getData(clipboardType));
        if (Array.isArray(parts) && parts.length <= 1000) pasted = normalizePromptBody(parts.map(part => typeof part === 'string'
          ? promptText(part) : { kind: 'reference', id: crypto.randomUUID(), reference: chatReferenceSchema.parse(part) }));
      } catch { /* External or malformed clipboard data is pasted as plain text. */ }
      replace(pasted);
    }}
    onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()} />;
}
