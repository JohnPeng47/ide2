import type {
  CodeEntityCategory,
  CompactedSource,
  DiagramViewKind,
  SourceRange
} from "../records/domain";

export interface ProjectCompactionProvenance {
  diagramSetId?: string;
  codeEntitiesSetId?: string;
  codeEntityId?: string;
  sourceRangeId?: string;
}

/** One immutable full-file or ranged compaction shared by every generation session in a Project. */
export interface ProjectFileCompactionRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sourceId?: string;
  path: string;
  sourceRevision?: string;
  sourceSha256: string;
  startLine: number;
  endLine: number;
  originalLines: string[];
  compactedSource: CompactedSource;
  profile: {
    id: string;
    version: number;
  };
  provenance?: ProjectCompactionProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCorpusCompactionCatalogRecord {
  schemaVersion: 1;
  projectId: string;
  /** The current compaction for a live corpus path; historical source revisions remain addressable. */
  activeByPath: Record<string, string>;
  compactions: Record<string, ProjectFileCompactionRecord>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileCompactionInput {
  sourceId?: string;
  path: string;
  sourceRevision?: string;
  startLine: number;
  endLine: number;
  originalLines: string[];
  compactedSource: CompactedSource;
  profile?: {
    id: string;
    version: number;
  };
  provenance?: ProjectCompactionProvenance;
  makeActive?: boolean;
}

export interface ProjectRepresentationEvidenceRange {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  originalLines: string[];
  /** Resolves presentation through the Project corpus catalog rather than a generation session. */
  compactionId?: string;
}

export interface ProjectRepresentationEvidenceRecord {
  sourceId?: string;
  id: string;
  handle: string;
  label: string;
  category: CodeEntityCategory;
  summary: string;
  sourceRanges: ProjectRepresentationEvidenceRange[];
}

export interface ProjectRepresentationMappingRecord {
  id: string;
  evidenceId: string;
  sourceRangeId: string;
  line: number;
  startColumn: number;
  endColumn: number;
}

export interface ProjectRepresentationRevisionRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  representationId: string;
  revision: number;
  ascii: string;
  asciiSha256: string;
  /** Absent legacy content is a single ASCII diagram. */
  content?: import("../diagrams/projectDiagramCanvas").ProjectDiagramContent;
  representationKind: "tree" | "diagram";
  source?: import("../diagrams/diagram").DiagramSourceBinding;
  evidence: Record<string, ProjectRepresentationEvidenceRecord>;
  mappings: ProjectRepresentationMappingRecord[];
  provenance?: {
    diagramSetId: string;
    artifactId: string;
  };
  createdAt: string;
}

export interface ProjectRepresentationRecord {
  repositoryId?: string;
  schemaVersion: 1;
  id: string;
  projectId: string;
  handle: string;
  name: string;
  viewKind: DiagramViewKind;
  representationKind: "tree" | "diagram";
  status: "settled" | "archived";
  currentRevisionId: string;
  revisionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRepresentationCatalogRecord {
  repositoryOwnershipVersion?: 1;
  schemaVersion: 1;
  projectId: string;
  activeByKind: Partial<Record<DiagramViewKind, string>>;
  representations: Record<string, ProjectRepresentationRecord>;
  revisions: Record<string, ProjectRepresentationRevisionRecord>;
  /** Committed atomically with every canvas affected by an accepted proposal. */
  changeSessionAcceptances?: Record<string, import('./changeAcceptance').ChangeSessionAcceptance>;
  /** Revision-pinned correspondences to complementary project diagrams. */
  projections?: Record<string, import("../diagrams/diagramProjection").ProjectProjectionRecord>;
  createdAt: string;
  updatedAt: string;
}

export interface PromoteProjectRepresentationInput {
  diagramSetId: string;
  diagramId: string;
  representationId?: string;
  expectedRevisionId?: string;
  makeActive?: boolean;
}

export function sourceRangeFromProjectEvidence(
  range: ProjectRepresentationEvidenceRange,
  compaction?: ProjectFileCompactionRecord
): SourceRange {
  return {
    id: range.id,
    path: range.path,
    startLine: range.startLine,
    endLine: range.endLine,
    ...(range.symbol ? { symbol: range.symbol } : {}),
    originalLines: [...range.originalLines],
    ...(compaction ? { compactedSource: compaction.compactedSource } : {})
  };
}
