import { createHash } from 'node:crypto';
import { execFileAsync } from './shared';
import type { RepositoryContext } from '../../../domain/core/repositories/repository';
import { parseGitFileDiff, type GitDiffHunk } from '../../../domain/core/diffs/gitDiffHunk';

const MAX_BYTES = 8 * 1024 * 1024;
/** Immutable first-parent commit diffs. Renames are represented as deletion/addition. */
export async function captureGitHunks(root: string, context: RepositoryContext): Promise<GitDiffHunk[]> {
  const git = async (...args: string[]) => (await execFileAsync('git', ['--literal-pathspecs', '-C', root, ...args], {
    encoding: 'utf8', maxBuffer: MAX_BYTES, timeout: 15000, env: { ...process.env, LC_ALL: 'C', GIT_NO_REPLACE_OBJECTS: '1' }
  })).stdout;
  const hunks: GitDiffHunk[] = [];
  let bytes = 0;
  for (const commit of context.commits) {
    // Read the actual object: rev-list treats a shallow boundary as a root.
    const object = await git('cat-file', 'commit', commit);
    const headers = object.split('\n\n', 1)[0];
    const parent = headers.match(/^parent ([a-f0-9]+)$/m)?.[1] ?? null;
    const base = parent ?? createHash(commit.length === 64 ? 'sha256' : 'sha1').update('tree 0\0').digest('hex');
    const entries = (await git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', base, commit, '--')).split('\0');
    entries.pop();
    for (let index = 0; index < entries.length; index += 2) {
      const status = entries[index], file = entries[index + 1];
      if (!file || !['A', 'M', 'D', 'T'].includes(status)) throw Error('Unsupported Git diff entry');
      const patch = await git('-c', 'core.quotePath=true', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color',
        '--full-index', '--diff-algorithm=myers', '--no-indent-heuristic', '--unified=3', '--inter-hunk-context=0', '--src-prefix=a/', '--dst-prefix=b/', base, commit, '--', file);
      bytes += Buffer.byteLength(patch);
      if (bytes > MAX_BYTES) throw Error('Diff exceeds 8 MiB; select fewer commits');
      hunks.push(...parseGitFileDiff({ repositoryId: context.repositoryId, commit, parent, path: file, status: status as GitDiffHunk['status'] }, patch));
      if (hunks.length > 2000) throw Error('Diff exceeds 2000 hunks; select fewer commits');
    }
  }
  return hunks;
}
