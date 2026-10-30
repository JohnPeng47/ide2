import type { TextSelection } from './editHistory';

/** Line-oriented editor commands over a textarea value. Each returns the new value and selection. */
export interface TextEdit { value: string; selection: TextSelection }
export const INDENT = '  ';

/** Whole lines touched by the selection; a selection ending at a line start excludes that line. */
function lineBlock(value: string, { start, end }: TextSelection) {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const newline = value.indexOf('\n', last), to = newline < 0 ? value.length : newline;
  return { from, to };
}
function mapLines(value: string, selection: TextSelection, map: (line: string) => string): TextEdit {
  const { from, to } = lineBlock(value, selection);
  const before = value.slice(from, to).split('\n'), after = before.map(map);
  const deltas = after.map((line, i) => line.length - before[i].length), total = deltas.reduce((sum, d) => sum + d, 0);
  const lastLine = from + after.slice(0, -1).reduce((sum, line) => sum + line.length + 1, 0);
  // Edges move with their line's change but never before that line's start.
  const start = Math.max(from, selection.start + deltas[0]);
  const end = selection.end > to ? selection.end + total : Math.max(lastLine, selection.end + total);
  return { value: value.slice(0, from) + after.join('\n') + value.slice(to), selection: { start: Math.min(start, end), end } };
}

/** Tab: insert an indent at the caret, or indent every selected line. */
export function indent(value: string, selection: TextSelection): TextEdit {
  if (selection.start === selection.end)
    return { value: value.slice(0, selection.start) + INDENT + value.slice(selection.end), selection: { start: selection.start + INDENT.length, end: selection.start + INDENT.length } };
  return mapLines(value, selection, line => INDENT + line);
}
/** Shift+Tab: remove one indent level (two spaces or a tab) from every touched line. */
export function outdent(value: string, selection: TextSelection): TextEdit {
  return mapLines(value, selection, line => line.startsWith('\t') ? line.slice(1) : line.replace(/^ {1,2}/, ''));
}
/** Alt+↑/↓: swap the selected lines with the neighbouring line. */
export function moveLines(value: string, selection: TextSelection, direction: -1 | 1): TextEdit | undefined {
  const { from, to } = lineBlock(value, selection), block = value.slice(from, to);
  if (direction < 0) {
    if (from === 0) return;
    const above = value.lastIndexOf('\n', from - 2) + 1, line = value.slice(above, from - 1);
    return { value: value.slice(0, above) + block + '\n' + line + value.slice(to), selection: { start: selection.start - line.length - 1, end: selection.end - line.length - 1 } };
  }
  if (to === value.length) return;
  const next = value.indexOf('\n', to + 1), below = next < 0 ? value.length : next, line = value.slice(to + 1, below);
  return { value: value.slice(0, from) + line + '\n' + block + value.slice(below), selection: { start: selection.start + line.length + 1, end: selection.end + line.length + 1 } };
}
/** Shift+Alt+↑/↓: copy the selected lines; the selection follows the copy below, or stays on the copy above. */
export function duplicateLines(value: string, selection: TextSelection, direction: -1 | 1): TextEdit {
  const { from, to } = lineBlock(value, selection), block = value.slice(from, to);
  const shift = direction > 0 ? block.length + 1 : 0;
  return { value: value.slice(0, to) + '\n' + block + value.slice(to), selection: { start: selection.start + shift, end: selection.end + shift } };
}
