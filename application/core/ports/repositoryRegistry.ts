import type { Repository, RepositoryContext } from '../../../domain/core/repositories/repository';
export interface RepositoryRegistry {
  list(): Promise<Repository[]>;
  register(input: { path: string; name?: string }): Promise<Repository>;
  captureHunks?(context: RepositoryContext): Promise<import('../../../domain/core/diffs/gitDiffHunk').GitDiffHunk[]>;
  resolveContext(input: { repositoryId?: string; commits?: string[]; head?: string }): Promise<RepositoryContext>;
}
