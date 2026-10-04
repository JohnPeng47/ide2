import type { GitDiffHunk } from '../../../../domain/core/diffs/gitDiffHunk';
export interface DiffHunkRow { kind: 'context' | 'add' | 'delete'; text: string; oldLine?: number; newLine?: number; oldIndex?: number; newIndex?: number; noNewline?: boolean }
/** Separate old/new streams preserve syntax state and both sides' line coordinates. */
export function diffHunkRows(hunk: GitDiffHunk) {
  const rows: DiffHunkRow[] = [], before: string[] = [], after: string[] = [];
  if (hunk.kind !== 'text') return { rows, before, after };
  let oldLine = hunk.oldStart, newLine = hunk.newStart;
  for (const line of hunk.patch.split('\n').slice(1)) {
    if (line.startsWith('\\ No newline')) { if (rows.length) rows[rows.length - 1].noNewline = true; continue; }
    if (![' ', '+', '-'].includes(line[0])) continue;
    const row: DiffHunkRow = { kind: line[0] === '+' ? 'add' : line[0] === '-' ? 'delete' : 'context', text: line.slice(1) };
    if (row.kind !== 'add') { row.oldLine = oldLine++; row.oldIndex = before.length; before.push(row.text); }
    if (row.kind !== 'delete') { row.newLine = newLine++; row.newIndex = after.length; after.push(row.text); }
    rows.push(row);
  }
  return { rows, before, after };
}
