import type { CodeRepoService } from '../../../domain/core/source/codeRepoService';
import { fetchProjectDirectory, fetchSourceDefinitions } from './api';
import { sourceFilesClient } from '../source/sourceFilesClient';
const unsupported = async (): Promise<never> => { throw new Error('This repository operation is not supported yet'); };
export function createHttpCodeRepoService(): CodeRepoService {
  return {
    available: true,
    ...sourceFilesClient(),
    async listDirectory(repo, path, options) {
      return (await fetchProjectDirectory(repo.projectId, path, options?.signal, repo.sourceId || undefined)).entries;
    },
    definitions: (repo, anchor, options) => fetchSourceDefinitions(repo.projectId, anchor.path, anchor.position,
      anchor.sourceSha256, options?.signal, repo.sourceId || undefined),
    search: unsupported,
    git: { resolveCommit: unsupported, listCommits: unsupported, changedFiles: unsupported, diff: unsupported, readFileAt: unsupported },
  };
}
