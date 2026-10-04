import { z } from 'zod';
import { sha256 } from '../sha256';

const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const gitDiffHunkSchema = z.object({
  id: z.string().regex(/^hunk-[a-f0-9]{64}$/), repositoryId: z.string().min(1), commit: sha, parent: sha.nullable(),
  path: z.string().min(1), status: z.enum(['A', 'M', 'D', 'T']), kind: z.enum(['text', 'binary', 'metadata']),
  oldStart: z.number().int().nonnegative(), oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(), newLines: z.number().int().nonnegative(), patch: z.string().max(2_000_000)
}).strict();
export type GitDiffHunk = z.infer<typeof gitDiffHunkSchema>;
export function identifyHunk(input: Omit<GitDiffHunk, 'id'>): GitDiffHunk {
  return { id: `hunk-${sha256(JSON.stringify(input))}`, ...input };
}
/** Preserve Git's exact hunk text, including no-newline markers and CR characters. */
export function parseGitFileDiff(input: Pick<GitDiffHunk, 'repositoryId' | 'commit' | 'parent' | 'path' | 'status'>, patch: string): GitDiffHunk[] {
  const starts = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n/gm)];
  if (!starts.length) return [identifyHunk({ ...input, kind: /^Binary files /m.test(patch) ? 'binary' : 'metadata',
    oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, patch })];
  return starts.map((match, index) => identifyHunk({ ...input, kind: 'text',
    oldStart: Number(match[1]), oldLines: Number(match[2] ?? 1), newStart: Number(match[3]), newLines: Number(match[4] ?? 1),
    patch: patch.slice(match.index, starts[index + 1]?.index ?? patch.length).split(/^diff --git /m)[0] }));
}
