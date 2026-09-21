import type { SourceRange } from '../records/domain';

/** Built-in corpus profiles. Missing persisted values resolve to source-code. */
export type BuiltInDomainProfileId = 'source-code' | 'document';
export type DomainProfileId = BuiltInDomainProfileId | (string & {});
export type CorpusBinding =
  | { kind: 'git-worktree'; root: string; revision?: string }
  | { kind: 'filesystem-documents'; root: string };
export interface CorpusEntry { path: string; name: string; kind: 'directory' | 'file' }
export interface CorpusDirectoryListing { directory: string; entries: CorpusEntry[] }
export interface CorpusProvider {
  readonly kind: CorpusBinding['kind'];
  listDirectory(binding: CorpusBinding, directory: string): Promise<CorpusDirectoryListing>;
  readLines(binding: CorpusBinding, range: SourceRange): Promise<string[]>;
}

/** Shared source-pane rendering options. */
export interface ContentPresentation {
  syntaxHighlighting: 'code' | 'plain';
  markdownRendering: 'source' | 'terminal';
  wrap: boolean;
  sourceCompaction: boolean;
}
