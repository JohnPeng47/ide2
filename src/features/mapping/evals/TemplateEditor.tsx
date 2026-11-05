import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { tokenizeTemplate } from '../../../../domain/mapping/evals/promptTemplate';
import type { EditKind, TextSelection } from './editHistory';
import { duplicateLines, indent, moveLines, outdent, type TextEdit } from './textEdits';

export interface TemplateEditorHandle { insert(text: string): void; focusRange(start: number, end: number): void }
export interface TemplateChange { value: string; before: TextSelection; after: TextSelection; kind: EditKind }
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = (event: { ctrlKey: boolean; metaKey: boolean }) => isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

/** A plain textarea over a highlighted mirror, so variables read as tokens while editing stays native.
 * Undo is owned by the caller: a controlled textarea's native undo stack breaks on programmatic edits. */
export const TemplateEditor = forwardRef<TemplateEditorHandle, {
  value: string; onChange: (change: TemplateChange) => void; onUndo: () => void; onRedo: () => void;
  known: Set<string>; label: string; readOnly?: boolean;
}>(function TemplateEditor({ value, onChange, onUndo, onRedo, known, label, readOnly }, ref) {
  const area = useRef<HTMLTextAreaElement>(null), mirror = useRef<HTMLPreElement>(null);
  const before = useRef<TextSelection>({ start: 0, end: 0 }), pending = useRef<TextSelection>(undefined);
  // After Escape, Tab leaves the editor instead of indenting (keyboard users must not be trapped).
  const tabReleased = useRef(false);
  const selection = (): TextSelection => ({ start: area.current!.selectionStart, end: area.current!.selectionEnd });
  useLayoutEffect(() => {
    if (pending.current && area.current) { area.current.setSelectionRange(pending.current.start, pending.current.end); pending.current = undefined; }
  });
  const apply = (edit: TextEdit | undefined) => {
    if (!edit || readOnly) return;
    const start = selection();
    pending.current = edit.selection;
    onChange({ value: edit.value, before: start, after: edit.selection, kind: 'command' });
  };
  useImperativeHandle(ref, () => ({
    insert(text) {
      const element = area.current; if (!element || readOnly) return;
      const { start, end } = selection(), at = start + text.length;
      element.focus();
      apply({ value: value.slice(0, start) + text + value.slice(end), selection: { start: at, end: at } });
    },
    focusRange(start, end) { const element = area.current; if (element) { element.focus(); element.setSelectionRange(start, end); } }
  }), [value, readOnly, onChange]);
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = event.key.toLowerCase(), mod = modKey(event);
    if (event.key === 'Escape') { tabReleased.current = true; return; }
    const released = tabReleased.current; tabReleased.current = false;
    if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) onRedo(); else onUndo(); return; }
    if (mod && key === 'y' && !isMac) { event.preventDefault(); onRedo(); return; }
    if (readOnly) return;
    if (event.key === 'Tab' && !mod && !event.altKey && !released) {
      event.preventDefault(); apply((event.shiftKey ? outdent : indent)(value, selection())); return;
    }
    if (event.altKey && !mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      apply(event.shiftKey ? duplicateLines(value, selection(), direction) : moveLines(value, selection(), direction));
      return;
    }
    before.current = selection();
  };
  const sync = () => { if (mirror.current && area.current) { mirror.current.scrollTop = area.current.scrollTop; mirror.current.scrollLeft = area.current.scrollLeft; } };
  return <div className="template-editor" data-readonly={readOnly || undefined}>
    <pre ref={mirror} aria-hidden="true">{tokenizeTemplate(value).map(token => token.kind === 'text' ? token.text.split(/(<\/?[a-zA-Z][^<>\n]*>)/g).map((part, index) => part.startsWith('<') ? <span className="prompt-tag" key={`${token.start}:${index}`}>{part}</span> : part)
      : <mark key={token.start} className={known.has(token.name!) ? 'template-token' : 'template-token is-unknown'}>{token.text}</mark>)}{'\n'}</pre>
    <textarea ref={area} aria-label={label} spellCheck={false} value={value} readOnly={readOnly}
      aria-keyshortcuts={`${isMac ? 'Meta' : 'Control'}+Z ${isMac ? 'Meta+Shift' : 'Control+Shift'}+Z Tab Shift+Tab Alt+ArrowUp Alt+ArrowDown`}
      onKeyDown={keyDown} onBeforeInput={() => { before.current = selection(); }}
      onChange={event => onChange({ value: event.target.value, before: before.current, after: selection(), kind: 'type' })} onScroll={sync} />
  </div>;
});
