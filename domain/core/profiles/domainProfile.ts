import type { CodeEntityRecord, DiagramViewKind, SourceRange } from "../records/domain";

/** Built-in application domains. Missing persisted values resolve to source-code. */
export type BuiltInDomainProfileId = "source-code" | "document";
export type DomainProfileId = BuiltInDomainProfileId | (string & {});

export type CorpusBinding =
  | { kind: "git-worktree"; root: string; revision?: string }
  | { kind: "filesystem-documents"; root: string };

export interface CorpusEntry {
  path: string;
  name: string;
  kind: "directory" | "file";
}

export interface CorpusDirectoryListing {
  directory: string;
  entries: CorpusEntry[];
}

export interface CorpusProvider {
  readonly kind: CorpusBinding["kind"];
  listDirectory(binding: CorpusBinding, directory: string): Promise<CorpusDirectoryListing>;
  readLines(binding: CorpusBinding, range: SourceRange): Promise<string[]>;
}

/** Domain-neutral evidence view over today's persisted CodeEntity records. */
export interface EvidenceEntity {
  id: string;
  handle: string;
  label: string;
  kind: string;
  summary: string;
  anchors: SourceRange[];
}

export interface EvidenceSchema {
  id: string;
  label: string;
  entityNoun: string;
  collectionNoun: string;
  fromCodeEntity(record: CodeEntityRecord): EvidenceEntity;
}

export type ExplorerSurfaceId =
  | "files"
  | "representations"
  | "markdown-sections"
  | "highlights"
  | "plans";

export interface WorkspaceSurfaceContribution {
  id: ExplorerSurfaceId;
  label: string;
  domId: string;
}

export interface WorkspaceSurfaceProfile {
  explorerTabs: readonly WorkspaceSurfaceContribution[];
  diagramViews: readonly DiagramViewKind[];
}

export interface ContentPresentation {
  syntaxHighlighting: "code" | "plain";
  markdownRendering: "source" | "terminal";
  wrap: boolean;
  sourceCompaction: boolean;
}

export type ElementCommandId =
  | "reveal-evidence"
  | "collapse-subtree"
  | "toggle-highlight"
  | "buffer-reference";

export interface ElementCommandContribution {
  id: ElementCommandId;
  representationKinds: readonly ("tree" | "diagram")[];
  requiresEvidence?: boolean;
}

export interface DomainProfile {
  id: DomainProfileId;
  label: string;
  corpusKind: CorpusBinding["kind"];
  evidenceSchema: EvidenceSchema;
  workspace: WorkspaceSurfaceProfile;
  content: ContentPresentation;
  commands: readonly ElementCommandContribution[];
}
