import { expect, it } from 'vitest';
import { diffHunkRows } from '../diffHunkRows';
import type { GitDiffHunk } from '../../../../../domain/core/diffs/gitDiffHunk';
const hunk: GitDiffHunk = { id: 'h', repositoryId: 'r', commit: 'c', parent: 'p', path: 'code.ts', status: 'M', kind: 'text',
  oldStart: 12, oldLines: 3, newStart: 20, newLines: 4,
  patch: '@@ -12,3 +20,4 @@\n context\n-old\n+new\n+extra\n last\n\\ No newline at end of file\n' };
it('keeps independent old/new coordinates and syntax streams through an unequal replacement', () => {
  const { rows, before, after } = diffHunkRows(hunk);
  expect(rows.map(({ kind, oldLine, newLine }) => [kind, oldLine, newLine])).toEqual([
    ['context', 12, 20], ['delete', 13, undefined], ['add', undefined, 21], ['add', undefined, 22], ['context', 14, 23]
  ]);
  expect(before).toEqual(['context', 'old', 'last']); expect(after).toEqual(['context', 'new', 'extra', 'last']);
  for (const row of rows) {
    if (row.oldIndex !== undefined) expect(before[row.oldIndex]).toBe(row.text);
    if (row.newIndex !== undefined) expect(after[row.newIndex]).toBe(row.text);
  }
  expect(rows.at(-1)?.noNewline).toBe(true);
});
it('handles empty sides, blank lines, literal markup, and no-newline markers on both sides', () => {
  const parsed = diffHunkRows({ ...hunk, oldStart: 1, newStart: 1, patch: '@@ -1 +1,2 @@\n-<old>\n\\ No newline at end of file\n+\n+<new>\n\\ No newline at end of file\n' });
  expect(parsed.before).toEqual(['<old>']); expect(parsed.after).toEqual(['', '<new>']);
  expect(parsed.rows.map(r => r.noNewline ?? false)).toEqual([true, false, true]);
  expect(diffHunkRows({ ...hunk, oldStart: 0, newStart: 1, patch: '@@ -0,0 +1 @@\n+first\n' }).rows[0]).toMatchObject({ kind: 'add', newLine: 1, newIndex: 0 });
  expect(diffHunkRows({ ...hunk, newStart: 0, patch: '@@ -12 +0,0 @@\n-last\n' }).after).toEqual([]);
});
it('does not interpret binary or metadata records as code', () => {
  expect(diffHunkRows({ ...hunk, kind: 'binary' })).toEqual({ rows: [], before: [], after: [] });
  expect(diffHunkRows({ ...hunk, kind: 'metadata' })).toEqual({ rows: [], before: [], after: [] });
});
