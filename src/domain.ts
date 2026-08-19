export const SCHEMA_VERSION = 1 as const;

export type CodeEntityCategory = "state" | "interface-data-struct" | "operation";
export type DiagramSetReadiness = "collecting" | "awaiting-approval" | "ready" | "failed";
export type AgentRunKind = "collect-entities" | "generate-one-diagram";
export type AgentRunStatus =
  | "queued"
  | "reading-context"
  | "generating"
  | "validating"
  | "complete"
  | "failed"
  | "interrupted";
export type GenerationBatchStatus = "queued" | "running" | "validating" | "complete" | "failed";

export interface SourceRange {
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
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
  generationBatchIds: string[];
  agentRunIds: string[];
  readiness: DiagramSetReadiness;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface PromptReference {
  kind: "code-entity" | "diagram";
  targetId: string;
  token: string;
  handle: string;
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
  producedByRunId: string;
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
  userPrompt: string;
  selectedCodeEntityIds: string[];
  promptReferences: PromptReference[];
  resolvedPrompt: string;
  codeEntitiesRevision: number;
  childRunIds: string[];
  outputDiagramIds: string[];
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
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface WorkspaceSnapshot {
  project: ProjectRecord | null;
  diagramSets: DiagramSetRecord[];
  codeEntitySets: Record<string, CodeEntitiesSetRecord>;
  diagrams: Record<string, DiagramRecord>;
  generationBatches: Record<string, GenerationBatchRecord>;
  agentRuns: Record<string, AgentRunRecord>;
}

export interface CodeEntityDraft {
  handle: string;
  label: string;
  category: CodeEntityCategory;
  summary: string;
  sourceRanges: SourceRange[];
}

export interface DiagramDraft {
  name: string;
  ascii: string;
  codeEntityIds: string[];
  derivedFromDiagramIds: string[];
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
        return `- ${range.path}:${range.startLine}-${range.endLine}${symbol}`;
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
}
