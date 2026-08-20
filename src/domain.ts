export const SCHEMA_VERSION = 1 as const;

export type CodeEntityCategory = "state" | "interface-data-struct" | "operation";
export type SourceCompactionLevel = "low" | "medium" | "high";
export type DiagramSetReadiness = "collecting" | "awaiting-approval" | "ready" | "failed";
export type GenerationOutputKind = "diagram" | "diagram-component";
export const EDIT_MODELS = [
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }
] as const;
export type EditModelId = typeof EDIT_MODELS[number]["id"];
export const DEFAULT_EDIT_MODEL_ID: EditModelId = "gpt-5.6-terra";

export function isEditModelId(value: unknown): value is EditModelId {
  return EDIT_MODELS.some((model) => model.id === value);
}
export type AgentRunKind =
  | "collect-entities"
  | "generate-one-diagram"
  | "generate-one-diagram-component"
  | "edit-artifact";
export type AgentRunStatus =
  | "queued"
  | "reading-context"
  | "generating"
  | "validating"
  | "complete"
  | "failed"
  | "interrupted";
export type GenerationBatchStatus = "queued" | "running" | "validating" | "complete" | "failed";

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
    };

export interface CompactedSource {
  level: SourceCompactionLevel;
  sections: CompactedSourceSection[];
}

export interface SourceRange {
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
  handle: string;
  label: string;
  category: CodeEntityCategory;
  summary: string;
  sourceRanges: SourceRange[];
}

export interface CodeEntitiesSetRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  revision: number;
  status: "collecting" | "awaiting-approval" | "finalized" | "failed";
  entities: CodeEntityRecord[];
  finalizedAt?: string;
  finalizedBy?: string;
  error?: string;
}

export interface ProjectRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  repositoryIdentity: string;
  canonicalRepoRoot: string;
  diagramSetIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DiagramSetRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  projectId: string;
  name: string;
  initialPrompt: string;
  sourceCheckoutRoot: string;
  gitRevision?: string;
  codeEntitiesSetId: string;
  diagramIds: string[];
  diagramComponentIds: string[];
  generationBatchIds: string[];
  agentRunIds: string[];
  editSessionIds: string[];
  readiness: DiagramSetReadiness;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface PromptReference {
  kind: "code-entity" | "diagram" | "diagram-component";
  targetId: string;
  token: string;
  handle: string;
}

export interface DiagramSelectionBounds {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

export interface DiagramComponentRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  handle: string;
  name: string;
  ascii: string;
  codeEntityIds: string[];
  promptReferences: PromptReference[];
  origin: "selection" | "generated" | "imported" | "edited";
  sourceDiagramId?: string;
  sourceDiagramComponentId?: string;
  selectionBounds?: DiagramSelectionBounds;
  producedByRunId?: string;
  editSessionId?: string;
  derivedFromDiagramIds: string[];
  derivedFromDiagramComponentIds: string[];
  createdAt: string;
  archivedAt?: string;
}

export function isDiagramComponentArchived(component: DiagramComponentRecord): boolean {
  return component.archivedAt !== undefined;
}

export interface DiagramRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  handle: string;
  name: string;
  ascii: string;
  codeEntityIds: string[];
  promptReferences: PromptReference[];
  origin: "generated" | "imported" | "edited";
  producedByRunId?: string;
  editSessionId?: string;
  derivedFromDiagramIds: string[];
  createdAt: string;
  archivedAt?: string;
}

export function isDiagramArchived(diagram: DiagramRecord): boolean {
  return diagram.archivedAt !== undefined;
}

export interface GenerationBatchRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  requestedCount: number;
  outputKind: GenerationOutputKind;
  userPrompt: string;
  selectedCodeEntityIds: string[];
  promptReferences: PromptReference[];
  resolvedPrompt: string;
  codeEntitiesRevision: number;
  childRunIds: string[];
  outputDiagramIds: string[];
  outputDiagramComponentIds: string[];
  status: GenerationBatchStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface AgentRunRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  statusMessage: string;
  model?: string;
  sessionId?: string;
  generationBatchId?: string;
  outputSlot?: number;
  codeEntitiesRevision: number;
  outputCodeEntityIds: string[];
  outputDiagramId?: string;
  outputDiagramComponentId?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface TextPatch {
  start: number;
  deletedText: string;
  insertedText: string;
}

export interface EditOperationRecord {
  id: string;
  kind: "manual" | "llm";
  subtype?: "marker";
  label: string;
  patch: TextPatch;
  instruction?: string;
  modelId?: EditModelId;
  markerChar?: string;
  markerToken?: string;
  replacedChar?: string;
  line?: number;
  column?: number;
  agentRunId?: string;
  createdAt: string;
}

export interface EditSessionRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  sourceArtifactKind: GenerationOutputKind;
  sourceArtifactId: string;
  sourceHandle: string;
  sourceName: string;
  baseAscii: string;
  workingAscii: string;
  codeEntityIds: string[];
  operations: EditOperationRecord[];
  /** Number of operations currently applied. Operations after this cursor are redoable. */
  operationCursor: number;
  revision: number;
  status: "active" | "committed" | "discarded";
  outputArtifactId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSnapshot {
  project: ProjectRecord | null;
  diagramSets: DiagramSetRecord[];
  codeEntitySets: Record<string, CodeEntitiesSetRecord>;
  diagrams: Record<string, DiagramRecord>;
  diagramComponents: Record<string, DiagramComponentRecord>;
  generationBatches: Record<string, GenerationBatchRecord>;
  agentRuns: Record<string, AgentRunRecord>;
  editSessions: Record<string, EditSessionRecord>;
}

export interface CodeEntityDraft {
  handle: string;
  label: string;
  category: CodeEntityCategory;
  summary: string;
  sourceRanges: SourceRange[];
}

export interface GeneratedArtifactDraft {
  name: string;
  ascii: string;
  codeEntityIds: string[];
}

export interface ArtifactEditDraft {
  ascii: string;
}

export interface ArtifactImportInput {
  diagramSetId: string;
  artifactKind: GenerationOutputKind;
  name: string;
  ascii: string;
  codeEntityIds?: string[];
}

export interface AgentProgress {
  status: Extract<AgentRunStatus, "reading-context" | "generating" | "validating">;
  message: string;
  model?: string;
  sessionId?: string;
}

export class CodeEntity {
  constructor(readonly record: CodeEntityRecord) {}

  prompt_str(): string {
    const ranges = this.record.sourceRanges
      .map((range) => {
        const symbol = range.symbol ? ` (${range.symbol})` : "";
        const sections = range.compactedSource?.sections
          .map((section) => section.kind === "source"
            ? `  - retain lines ${section.startLine}-${section.endLine}`
            : `  - collapse lines ${section.startLine}-${section.endLine}: ${section.comment}`)
          .join("\n");
        const compaction = range.compactedSource
          ? `\n  Compaction: ${range.compactedSource.level}\n${sections}`
          : "";
        return `- ${range.path}:${range.startLine}-${range.endLine}${symbol}${compaction}`;
      })
      .join("\n");
    return `CodeEntity @entity/${this.record.handle}\nLabel: ${this.record.label}\nCategory: ${this.record.category}\nSummary: ${this.record.summary}\nSource ranges:\n${ranges}`;
  }
}

export class Diagram {
  constructor(readonly record: DiagramRecord) {}

  prompt_str(): string {
    const derived = this.record.derivedFromDiagramIds.length
      ? this.record.derivedFromDiagramIds.join(", ")
      : "none";
    return `Diagram @diagram/${this.record.handle}\nName: ${this.record.name}\nCodeEntity ids: ${this.record.codeEntityIds.join(", ") || "none"}\nDerived from: ${derived}\nASCII:\n${this.record.ascii}`;
  }
}

export class DiagramComponent {
  constructor(readonly record: DiagramComponentRecord) {}

  prompt_str(): string {
    const diagrams = this.record.derivedFromDiagramIds.join(", ") || "none";
    const components = this.record.derivedFromDiagramComponentIds.join(", ") || "none";
    return `DiagramComponent @component/${this.record.handle}\nName: ${this.record.name}\nCodeEntity ids: ${this.record.codeEntityIds.join(", ") || "none"}\nDerived from Diagrams: ${diagrams}\nDerived from DiagramComponents: ${components}\nASCII:\n${this.record.ascii}`;
  }
}

export function assertSevenBitAscii(value: string): void {
  if (!value.trim()) throw new Error("diagram ASCII cannot be blank");
  if (!/^[\x00-\x7F]*$/.test(value)) {
    throw new Error("diagram output must contain only 7-bit ASCII characters");
  }
}

export function normalizeAscii(value: string): string {
  return value.replace(/\r\n?/g, "\n").trimEnd();
}

export function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
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
    }
  }
}
