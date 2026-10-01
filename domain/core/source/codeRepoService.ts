import type { SourcePosition, SourceDefinitions } from './sourceNavigation';

export interface CodeRepoReference { projectId: string; sourceId: string }
export interface CodeRepoRequest { signal?: AbortSignal }
export interface CodeRepoFile { path: string; text: string; sha256: string; lspEnabled?: boolean }
export interface CodeRepoEntry { path: string; kind: 'file' | 'directory' }
export interface CodeRepoCommit { id: string; parents: string[]; author: string; date: string; message: string }
export interface CodeRepoFileChange {
  oldPath?: string; newPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  additions?: number; deletions?: number; binary: boolean;
}
export interface CodeRepoSearchMatch { path: string; start: SourcePosition; end: SourcePosition; lineText: string }
export interface CodeRepoSearchQuery { text: string; paths: readonly string[]; caseSensitive?: boolean; regex?: boolean; limit?: number }
export interface CodeRepoDiffHunk { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] }
export interface CodeRepoFileDiff extends CodeRepoFileChange { hunks: CodeRepoDiffHunk[] }
export interface CodeRepoGitService {
  resolveCommit(repo: CodeRepoReference, ref: string, options?: CodeRepoRequest): Promise<CodeRepoCommit>;
  listCommits(repo: CodeRepoReference, options?: CodeRepoRequest & { path?: string; limit?: number }): Promise<CodeRepoCommit[]>;
  changedFiles(repo: CodeRepoReference, base: string, head: string, options?: CodeRepoRequest): Promise<CodeRepoFileChange[]>;
  diff(repo: CodeRepoReference, base: string, head: string, options?: CodeRepoRequest & { paths?: readonly string[] }): Promise<CodeRepoFileDiff[]>;
  readFileAt(repo: CodeRepoReference, commit: string, path: string, options?: CodeRepoRequest): Promise<CodeRepoFile>;
}
/** Browser-facing contract. Repo identity is explicit because one canvas can span repositories.
 * Implementations may delegate to HTTP, filesystem, search and language adapters.
 * All positions use zero-based UTF-16; diff hunk line numbers follow Git's one-based convention.
 */
export interface CodeRepoService {
  readonly available: boolean;
  readFile(repo: CodeRepoReference, path: string, options?: CodeRepoRequest): Promise<CodeRepoFile>;
  listDirectory(repo: CodeRepoReference, path: string, options?: CodeRepoRequest): Promise<CodeRepoEntry[]>;
  search(repo: CodeRepoReference, query: CodeRepoSearchQuery, options?: CodeRepoRequest): Promise<{ matches: CodeRepoSearchMatch[]; truncated: boolean }>;
  definitions(repo: CodeRepoReference, anchor: { path: string; position: SourcePosition; sourceSha256: string }, options?: CodeRepoRequest): Promise<SourceDefinitions>;
  readonly git: CodeRepoGitService;
}
