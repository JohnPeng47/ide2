export const SCHEMA_VERSION = 1 as const;

export type CodeEntityCategory = "state" | "interface-data-struct" | "operation";
export type SourceCompactionLevel = "low" | "medium" | "high";
export type DiagramViewKind = "diagram" | "call-graph" | "dir-view";
export const DIAGRAM_MODELS = [
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }
] as const;
export type DiagramModelId = typeof DIAGRAM_MODELS[number]["id"];
export const DEFAULT_DIAGRAM_MODEL_ID: DiagramModelId = "gpt-5.6-sol";


/** Stable provenance for a record, independent from where an imported copy is stored. */
export interface ArtifactOrigin {
  projectId: string;
  diagramSetId: string;
}

export interface CodeEntityOrigin extends ArtifactOrigin {
  codeEntitiesSetId: string;
}

export type CompactedSourceSection =
  | {
      kind: "source";
      startLine: number;
      endLine: number;
    }
  | {
      kind: "collapsed-comment";
      startLine: number;
      endLine: number;
      comment: string;
      /** One-based graph-body line to source-block mappings. Optional for legacy records. */
      nodes?: CompactedSourceNode[];
    };

export interface CompactedSourceNode {
  graphLine: number;
  startLine: number;
  endLine: number;
}

export interface CompactedSource {
  level: SourceCompactionLevel;
  sections: CompactedSourceSection[];
}

export interface SourceRange {
  /** Globally unique on new records. Optional only while reading legacy records. */
  id?: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  /** Immutable source snapshot captured when this CodeEntity was collected. */
  originalLines?: string[];
  /** Optional presentation map; absent ranges render as their complete source. */
  compactedSource?: CompactedSource;
}

export interface CodeEntityRecord {
  id: string;
  /** Exact immutable collection that owns this entity. Optional on legacy records. */
  origin?: CodeEntityOrigin;
  handle: string;
  label: string;
  category: CodeEntityCategory;
  summary: string;
  sourceRanges: SourceRange[];
}

export interface ProjectRecord {
  repositories?: import("../repositories/repository").Repository[];
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  defaultDomainProfileId?: import("../profiles/domainProfile").BuiltInDomainProfileId;
  /** Registered source bindings; legacy set bindings are migrated on load. */
  sources?: import("../diagrams/diagram").DiagramSourceBinding[];
  createdAt: string;
  updatedAt: string;
}

/** One immediate child of a live repository directory. */
export interface RepositoryEntry {
  path: string;
  name: string;
  kind: "directory" | "file";
}

/** A lazy view of one directory in a diagram-bound source corpus. */
export interface RepositoryDirectoryListing {
  directory: string;
  entries: RepositoryEntry[];
}

export interface DiagramSelectionBounds {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

export interface DiagramElementMapping {
  id: string;
  entityId: string;
  /** Stable range identity; sourceRangeIndex remains for agent prompting and legacy maps. */
  sourceRangeId?: string;
  sourceRangeIndex: number;
  line: number;
  startColumn: number;
  endColumn: number;
}

/** Mapping coordinates anchored to one immutable diagram revision. */
export interface DiagramMappingSnapshot {
  artifactId: string;
  asciiSha256: string;
  mappings: DiagramElementMapping[];
}

export interface AgentProgress {
  status: "reading-context" | "generating" | "validating";
  message: string;
  model?: string;
  sessionId?: string;
}

export function assertSafeId(value: string, label = "id"): void {
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(value)) {
    throw new Error(`${label} is invalid: ${value}`);
  }
}

export function assertSourceRange(range: SourceRange): void {
  if (!range.path || range.path.startsWith("/") || range.path.split(/[\\/]/).includes("..")) {
    throw new Error(`source path must be repo-relative: ${range.path}`);
  }
  if (!Number.isInteger(range.startLine) || !Number.isInteger(range.endLine)) {
    throw new Error(`source lines must be integers for ${range.path}`);
  }
  if (range.startLine < 1 || range.endLine < range.startLine) {
    throw new Error(`invalid source range for ${range.path}`);
  }
  if (range.originalLines !== undefined && !Array.isArray(range.originalLines)) {
    throw new Error(`original source lines must be an array for ${range.path}`);
  }
  if (range.compactedSource !== undefined) {
    if (!(["low", "medium", "high"] as const).includes(range.compactedSource.level)) {
      throw new Error(`invalid source compaction level for ${range.path}`);
    }
    if (!Array.isArray(range.compactedSource.sections)) {
      throw new Error(`compacted source sections must be an array for ${range.path}`);
    }
    for (const section of range.compactedSource.sections) {
      if (section.kind !== "source" && section.kind !== "collapsed-comment") {
        throw new Error(`invalid compacted source section for ${range.path}`);
      }
      if (!Number.isInteger(section.startLine) || !Number.isInteger(section.endLine)) {
        throw new Error(`compacted source lines must be integers for ${range.path}`);
      }
      if (section.kind === "collapsed-comment" && !section.comment.trim()) {
        throw new Error(`collapsed source comment cannot be blank for ${range.path}`);
      }
      if (section.kind === "collapsed-comment" && !/^[\t\n\r\x20-\x7E]*$/.test(section.comment)) {
        throw new Error(`collapsed source call graph must contain only 7-bit ASCII for ${range.path}`);
      }
      if (section.kind === "collapsed-comment" && section.nodes !== undefined) {
        if (!Array.isArray(section.nodes) || section.nodes.length === 0) {
          throw new Error(`collapsed source call graph nodes cannot be empty for ${range.path}`);
        }
        const graphLineCount = section.comment.replace(/\r\n?/g, "\n").split("\n").length;
        const mappedGraphLines = new Set<number>();
        for (const node of section.nodes) {
          if (!Number.isInteger(node.graphLine) || node.graphLine < 1 || node.graphLine > graphLineCount) {
            throw new Error(`collapsed source node graph line is invalid for ${range.path}`);
          }
          if (mappedGraphLines.has(node.graphLine)) {
            throw new Error(`collapsed source node graph line is duplicated for ${range.path}`);
          }
          mappedGraphLines.add(node.graphLine);
          if (!Number.isInteger(node.startLine) || !Number.isInteger(node.endLine)
            || node.startLine < section.startLine || node.endLine > section.endLine
            || node.endLine < node.startLine) {
            throw new Error(`collapsed source node range is invalid for ${range.path}`);
          }
        }
      }
    }
  }
}
