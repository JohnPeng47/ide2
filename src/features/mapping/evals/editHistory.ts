/** Undo history for multi-field text editing. Pure, so typing coalescing and selection restore are testable. */
export interface TextSelection { start: number; end: number }
export type EditKind = 'type' | 'command';
export interface HistoryEntry<T> { value: T; scope: string; before: TextSelection; after: TextSelection; kind: EditKind; time: number }
export interface EditHistory<T> { entries: HistoryEntry<T>[]; index: number }
export interface HistoryStep<T> { history: EditHistory<T>; value: T; scope: string; selection: TextSelection }

const COALESCE_MS = 1000, LIMIT = 200;
const caret = { start: 0, end: 0 };
export const createHistory = <T>(value: T, scope: string): EditHistory<T> =>
  ({ entries: [{ value, scope, before: caret, after: caret, kind: 'command', time: 0 }], index: 0 });

/** Consecutive typing in one field within a second is one undo step, like code editors. */
export function record<T>(history: EditHistory<T>, change: Omit<HistoryEntry<T>, 'time'>, now = Date.now()): EditHistory<T> {
  const top = history.entries[history.index], base = history.entries.slice(0, history.index + 1);
  const atTip = history.index === history.entries.length - 1;
  if (atTip && history.index > 0 && change.kind === 'type' && top.kind === 'type' && top.scope === change.scope && now - top.time < COALESCE_MS)
    return { entries: [...base.slice(0, -1), { ...change, before: top.before, time: now }], index: history.index };
  const entries = [...base, { ...change, time: now }].slice(-LIMIT);
  return { entries, index: entries.length - 1 };
}
export const canUndo = <T>(history: EditHistory<T>) => history.index > 0;
export const canRedo = <T>(history: EditHistory<T>) => history.index < history.entries.length - 1;
/** Restores the previous value and puts the caret where the undone change began. */
export function undo<T>(history: EditHistory<T>): HistoryStep<T> | undefined {
  if (!canUndo(history)) return;
  const undone = history.entries[history.index];
  return { history: { ...history, index: history.index - 1 }, value: history.entries[history.index - 1].value, scope: undone.scope, selection: undone.before };
}
export function redo<T>(history: EditHistory<T>): HistoryStep<T> | undefined {
  if (!canRedo(history)) return;
  const next = history.entries[history.index + 1];
  return { history: { ...history, index: history.index + 1 }, value: next.value, scope: next.scope, selection: next.after };
}
