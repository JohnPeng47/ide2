import type { SpatialProgressState } from "../agent-work/agentWork";
import type { HighlightRecordV2 } from "../highlights/highlights";
import type { RepresentationGraphRecord } from "../representations/representationGraph";

export const SCHEMA_VERSION = 1 as const;
export const GLOBAL_IMPORTS_DIAGRAM_SET_ID = "global-imports";

export type CodeEntityCategory = "state" | "interface-data-struct" | "operation";
export type SourceCompactionLevel = "low" | "medium" | "high";
export type DiagramSetReadiness = "collecting" | "ready" | "failed";
export type GenerationOutputKind = "diagram" | "diagram-component";
export type DiagramViewKind = "diagram" | "call-graph" | "dir-view";
export type GenerationTargetKind = DiagramViewKind | "diagram-component";
export type CodeEntityPromptKind = "code-entity-identification" | "code-entity-compaction";
export const DEFAULT_GENERATION_COUNT = 3;
export const DIAGRAM_MODELS = [
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }
] as const;
export type DiagramModelId = typeof DIAGRAM_MODELS[number]["id"];
export const DEFAULT_DIAGRAM_MODEL_ID: DiagramModelId = "gpt-5.6-sol";

export type GenerationPromptProfileId = string;
export const DEFAULT_GENERATION_PROMPT_PROFILE_ID: GenerationPromptProfileId = "default";
export type CodeEntityPromptProfileId = string;
export const DEFAULT_CODE_ENTITY_PROMPT_PROFILE_ID: CodeEntityPromptProfileId = "default-code-entities";

export function isDiagramModelId(value: unknown): value is DiagramModelId {
  return DIAGRAM_MODELS.some((model) => model.id === value);
}

export function isGenerationPromptProfileId(value: unknown): value is GenerationPromptProfileId {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

export function isDiagramViewKind(value: unknown): value is DiagramViewKind {
  return value === "diagram" || value === "call-graph" || value === "dir-view";
}

export function isGenerationTargetKind(value: unknown): value is GenerationTargetKind {
  return isDiagramViewKind(value) || value === "diagram-component";
}

export function outputKindForTarget(targetKind: GenerationTargetKind): GenerationOutputKind {
  return targetKind === "diagram-component" ? "diagram-component" : "diagram";
}
export type AgentRunKind =
  | "collect-entities"
  | "generate-one-diagram"
  | "generate-one-diagram-component"
  | "map-code-entities"
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

export interface CodeEntitiesSetRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  revision: number;
  status: "collecting" | "finalized" | "failed";
  entities: CodeEntityRecord[];
  /** Immutable prompt snapshot used to collect this set. Absent on legacy records. */
  promptConfigId?: string;
  finalizedAt?: string;
  error?: string;
}

export interface ProjectRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  defaultDomainProfileId?: import("../profiles/domainProfile").BuiltInDomainProfileId;
  diagramSetIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DiagramSetRecord {
  source?: import("../diagrams/diagram").DiagramSourceBinding;
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  projectId: string;
  name: string;
  initialPrompt: string;
  sourceCheckoutRoot: string;
  gitRevision?: string;
  codeEntitiesSetId: string;
  /** The preferred candidate for each full-diagram view category. */
  featuredViewIds: Partial<Record<DiagramViewKind, string>>;
  diagramIds: string[];
  diagramComponentIds: string[];
  generationBatchIds: string[];
  agentRunIds: string[];
  editSessionIds: string[];
  readiness: DiagramSetReadiness;
  /** How the initial evidence and diagrams entered this set. Missing legacy values mean generated. */
  creationMode?: "generate" | "materialized";
  createdAt: string;
  updatedAt: string;
  error?: string;
}

/** Compatibility name while persisted DiagramSet records are reinterpreted as generation sessions. */
export type GenerationSessionRecord = DiagramSetRecord;

/** One immediate child of a live repository directory. */
export interface RepositoryEntry {
  path: string;
  name: string;
  kind: "directory" | "file";
}

/** A lazy, DiagramSet-scoped view of one live repository directory. */
export interface RepositoryDirectoryListing {
  directory: string;
  entries: RepositoryEntry[];
}

export interface ImportedArtifactLibraryRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  diagramIds: string[];
  diagramComponentIds: string[];
  /** Dependency records imported with mapped artifact bundles. */
  codeEntityIds?: string[];
  /** Artifact ids whose original mapping is stored in the import library. */
  codeEntityMapArtifactIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export type ReferenceKind = "code-entity" | "diagram" | "diagram-component";

export interface ReferenceIdentity {
  kind: ReferenceKind;
  targetId: string;
  /** Origin is persisted on new references so legacy handle-derived ids remain unambiguous. */
  origin?: CodeEntityOrigin | ArtifactOrigin;
  sourceRangeId?: string;
  /** Legacy range address. New references use sourceRangeId. */
  sourceRangeIndex?: number;
}

export interface PromptReference extends ReferenceIdentity {
  token: string;
  handle: string;
}

export interface GenerationPromptReference extends PromptReference {
  /** Exact PromptRepresentation supplied to the generation agent. */
  promptRepresentation: string;
}

export interface GenerationReferenceSelection extends PromptReference {
  included: boolean;
}

export interface GenerationDerivationRecord {
  sourceArtifactKind: GenerationOutputKind;
  sourceArtifactId: string;
  sourceArtifactOrigin?: ArtifactOrigin;
  /** Only the new correction entered after the inherited prompt history. */
  promptCorrection: string;
}

export interface GenerationPromptConfigRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  /** Domain used to render evidence terminology. Missing legacy values mean source-code. */
  domainProfileId?: "source-code" | "document";
  outputKind: GenerationOutputKind;
  /** Required for full diagrams and omitted for DiagramComponents. */
  viewKind?: DiagramViewKind;
  modelId: DiagramModelId;
  instruction: string;
  selectedCodeEntityIds: string[];
  references: GenerationPromptReference[];
  /** Mentioned references intentionally left out of the agent context. */
  omittedReferences?: PromptReference[];
  /** Optional second user turn that restyles the first submitted artifact. */
  referencePrompt?: {
    templateVersion: 1;
    /** Name of the persisted template selected for this workflow turn. */
    promptName?: string;
    instruction: string;
    references: GenerationPromptReference[];
    /** Mentioned follow-up references intentionally left out of model context. */
    omittedReferences?: PromptReference[];
    rendered: string;
  };
  /** Mandatory final user turn that maps the final submitted artifact. */
  mappingPrompt: {
    templateVersion: 1;
    /** Name of the persisted template selected for this workflow turn. */
    promptName?: string;
    template: string;
  };
  derivation?: GenerationDerivationRecord;
  contextPrompt: {
    templateVersion: 1;
    rendered: string;
  };
  systemPrompt: {
    templateId: "artifact-generation";
    templateVersion: 1;
    profileId: GenerationPromptProfileId;
    profileVersion: number;
    /** Name of the persisted template selected for this workflow turn. */
    promptName?: string;
    /** Artifact references declared by the selected system-prompt template. */
    references?: GenerationPromptReference[];
    rendered: string;
  };
  createdAt: string;
}

export interface PromptTemplateRecord<TPromptName extends string, TProfileId extends string = string> {
  schemaVersion: typeof SCHEMA_VERSION;
  id: TProfileId;
  label: string;
  description: string;
  builtIn: boolean;
  version: number;
  prompts: Record<TPromptName, string>;
  createdAt: string;
  updatedAt: string;
}

export interface NamedPromptTemplate {
  template: string;
  description?: string;
}

/** A global, versioned dictionary of named prompts used by prompt workflows. */
export interface PromptTemplateSetRecord<TProfileId extends string = string> {
  schemaVersion: typeof SCHEMA_VERSION;
  id: TProfileId;
  label: string;
  description: string;
  builtIn: boolean;
  version: number;
  prompts: Record<string, NamedPromptTemplate>;
  createdAt: string;
  updatedAt: string;
}

export type SystemPromptTemplateRecord = PromptTemplateSetRecord<GenerationPromptProfileId>;

export type CodeEntityPromptTemplateRecord = PromptTemplateRecord<
  CodeEntityPromptKind,
  CodeEntityPromptProfileId
>;

export interface CodeEntityPromptConfigRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  template: {
    profileId: CodeEntityPromptProfileId;
    profileVersion: number;
  };
  identificationCriteria: {
    rendered: string;
  };
  compactionCriteria: {
    rendered: string;
  };
  contextPrompt: {
    templateVersion: 1;
    rendered: string;
  };
  createdAt: string;
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
  /** Original owner; differs from diagramSetId for globally imported artifacts. */
  recordOrigin?: ArtifactOrigin;
  diagramSetId: string;
  handle: string;
  name: string;
  ascii: string;
  /** Presentation semantics. Optional only on legacy records. */
  representationKind?: "tree" | "diagram";
  codeEntityIds: string[];
  origin: "selection" | "generated" | "imported" | "edited" | "materialized";
  sourceDiagramId?: string;
  sourceDiagramComponentId?: string;
  selectionBounds?: DiagramSelectionBounds;
  producedByRunId?: string;
  generationPromptConfigId?: string;
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
  /** Original owner; differs from diagramSetId for globally imported artifacts. */
  recordOrigin?: ArtifactOrigin;
  diagramSetId: string;
  viewKind: DiagramViewKind;
  /** Main diagram that supplied mandatory context for an auxiliary view. */
  basedOnDiagramId?: string;
  handle: string;
  name: string;
  ascii: string;
  /** Presentation semantics. Optional only on legacy records. */
  representationKind?: "tree" | "diagram";
  codeEntityIds: string[];
  origin: "generated" | "imported" | "edited" | "materialized";
  producedByRunId?: string;
  generationPromptConfigId?: string;
  editSessionId?: string;
  derivedFromDiagramIds: string[];
  createdAt: string;
  archivedAt?: string;
}

export function isDiagramArchived(diagram: DiagramRecord): boolean {
  return diagram.archivedAt !== undefined;
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

export interface DiagramCodeEntityMapRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  diagramSetId: string;
  artifactKind: GenerationOutputKind;
  artifactId: string;
  asciiSha256: string;
  mappings: DiagramElementMapping[];
  /** Present for agent-produced maps; materialized maps have no synthetic AgentRun. */
  producedByRunId?: string;
  /** Missing legacy values mean agent-produced. */
  origin?: "agent" | "materialized";
  createdAt: string;
}

export interface DiagramHighlightLineageNode {
  graphLine: number;
  text: string;
}

export interface DiagramHighlightTranscript {
  path: string;
  startLine: number;
  endLine: number;
  lines: string[];
}

/** Persistent snapshot created from one mapped node in an ASCII tree. */
export interface DiagramHighlightRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  projectId: string;
  diagramSetId: string;
  artifactKind: GenerationOutputKind;
  artifactId: string;
  artifactName: string;
  mappingId: string;
  entityId: string;
  sourceRangeId?: string;
  sourceRangeIndex: number;
  graphLine: number;
  nodeText: string;
  lineage: DiagramHighlightLineageNode[];
  transcript: DiagramHighlightTranscript;
  createdAt: string;
}

export interface CodeEntityMappingTarget {
  artifactKind: GenerationOutputKind;
  artifactId: string;
}

export interface CodeEntityMappingResult extends CodeEntityMappingTarget {
  status: "complete" | "failed";
  mappingCount?: number;
  error?: string;
}

export interface GenerationBatchRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  requestedCount: number;
  promptConfigId: string;
  codeEntitiesRevision: number;
  childRunIds: string[];
  outputDiagramIds: string[];
  outputDiagramComponentIds: string[];
  /** Evaluation container created for successful diagram outputs. */
  diagramCandidateBatchId?: string;
  status: GenerationBatchStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface DiagramCandidateBatchRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  diagramSetId: string;
  generationBatchId: string;
  /** Immutable candidate membership in generation output order, including archived diagrams. */
  diagramIds: string[];
  /** One current rank per candidate. Empty until feedback is submitted. Lower is better. */
  rankings: Record<string, number>;
  createdAt: string;
  updatedAt: string;
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
  modelId?: DiagramModelId;
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

export type PlanStatus = "draft" | "active" | "complete";

export interface PlanAffectedCodeEntity {
  id: string;
  sourceRanges: string[];
}

export interface PlanDiagramCandidate {
  diagramId: string;
  decision: "include" | "exclude";
  reason: string;
}

export interface PlanDiagramSelection {
  availability: "recorded" | "unavailable";
  affectedCodeEntities: PlanAffectedCodeEntity[];
  diagramCandidates: PlanDiagramCandidate[];
  selectedDiagramIds: string[];
}

export interface PlanGenerationMetadata {
  availability: "recorded" | "unavailable";
  prompt?: string;
  contextDiagramIds: string[];
  agentRunId?: string;
}

export interface PlanMigrationMetadata {
  sourceFormat: "legacy-inline-plan";
  migratedAt: string;
  missingMetadata: Array<"diagram-selection" | "generation-prompt" | "generation-context">;
}

export interface PlanModifiedDiagramChange {
  id: string;
  kind: "diagram-modified";
  mode: "partial" | "complete";
  diagramSetId: string;
  diagramId: string;
  label: string;
  /** Immutable diagram snapshot used to render this proposal without consulting canonical state. */
  baseDiagram: DiagramRecord;
  baseAsciiSha256: string;
  patch: TextPatch;
  /** Fully materialized proposal output. */
  outputAscii: string;
  semanticDiff?: import("../diagrams/partialDiff").PartialDiffDefinition;
  generation?: PlanGenerationMetadata;
}

export interface PlanAddedDiagramDraft {
  diagramSetId: string;
  viewKind: DiagramViewKind;
  representationKind: "tree" | "diagram";
  handle: string;
  name: string;
  ascii: string;
  codeEntityIds: string[];
}

export interface PlanAddedDiagramChange {
  id: string;
  kind: "diagram-added";
  label: string;
  draft: PlanAddedDiagramDraft;
  generation?: PlanGenerationMetadata;
}

export interface PlanCodeEntityCompactionChange {
  id: string;
  kind: "code-entity-compaction";
  diagramSetId: string;
  codeEntityId: string;
  sourceRangeId: string;
  label: string;
  /** Immutable entity snapshot used to render this proposal without canonical entity state. */
  baseEntity: CodeEntityRecord;
  baseCompactedSource?: CompactedSource;
  compactedSource: CompactedSource;
}

export type PlanChange =
  | PlanModifiedDiagramChange
  | PlanAddedDiagramChange
  | PlanCodeEntityCompactionChange;

/** A proposal container. Its changes are projected for display and never canonical records. */
export interface PlanRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  projectId: string;
  title: string;
  status: PlanStatus;
  markdown: string;
  selection: PlanDiagramSelection;
  changes: PlanChange[];
  migration?: PlanMigrationMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSnapshot {
  project: ProjectRecord | null;
  /** Project-scoped corpus presentation shared by every generation session. */
  corpusCompactions?: import("../representations/projectCatalog").ProjectCorpusCompactionCatalogRecord;
  /** Settled Project representations, independent from their source generation sessions. */
  representationCatalog?: import("../representations/projectCatalog").ProjectRepresentationCatalogRecord;
  diagramSets: DiagramSetRecord[];
  globalImports: ImportedArtifactLibraryRecord;
  codeEntitySets: Record<string, CodeEntitiesSetRecord>;
  /** Immutable CodeEntity dependencies carried by imported mapped artifacts. */
  importedCodeEntities: Record<string, CodeEntityRecord>;
  diagrams: Record<string, DiagramRecord>;
  diagramComponents: Record<string, DiagramComponentRecord>;
  codeEntityPromptConfigs: Record<string, CodeEntityPromptConfigRecord>;
  codeEntityPromptTemplates: Record<string, CodeEntityPromptTemplateRecord>;
  generationPromptConfigs: Record<string, GenerationPromptConfigRecord>;
  systemPromptTemplates: Record<string, SystemPromptTemplateRecord>;
  generationBatches: Record<string, GenerationBatchRecord>;
  diagramCandidateBatches: Record<string, DiagramCandidateBatchRecord>;
  agentRuns: Record<string, AgentRunRecord>;
  /** Spatial progress keyed by the AgentRun that owns the work scope. */
  spatialProgress?: Record<string, SpatialProgressState>;
  /** User-refined visual layers keyed by DiagramSet. */
  representationGraphs?: Record<string, RepresentationGraphRecord>;
  editSessions: Record<string, EditSessionRecord>;
  codeEntityMaps: Record<string, DiagramCodeEntityMapRecord>;
  /** Optional for compatibility with workspaces persisted before highlights existed. */
  highlights?: Array<DiagramHighlightRecord | HighlightRecordV2>;
  /** Project-side proposals; absent in workspaces persisted before Plans existed. */
  plans?: PlanRecord[];
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
  /** Required on the final mapping-turn submission. */
  mappings?: DiagramElementMappingDraft[];
}

/** A readable, prompt-only identifier that resolves to a persisted CodeEntity id. */
export interface CodeEntityPromptAlias {
  id: string;
  alias: string;
}

export interface ArtifactEditDraft {
  ascii: string;
}

export interface DiagramElementMappingDraft {
  entityId: string;
  sourceRangeIndex: number;
  line: number;
  startColumn: number;
  endColumn: number;
}

/** Request-local source range supplied during materialized DiagramSet creation. */
export interface MaterializedSourceRangeInput extends Omit<SourceRange, "id" | "originalLines"> {
  key: string;
}

/** Request-local CodeEntity supplied during materialized DiagramSet creation. */
export interface MaterializedCodeEntityInput {
  key: string;
  handle: string;
  label: string;
  category: CodeEntityCategory;
  summary: string;
  sourceRanges: MaterializedSourceRangeInput[];
}

/** Request-local mapping; keys resolve to server-owned persisted identities. */
export interface MaterializedDiagramMappingInput {
  entityKey: string;
  sourceRangeKey: string;
  line: number;
  startColumn: number;
  endColumn: number;
}

/** Fully composed ASCII Diagram supplied without invoking a generation agent. */
export interface MaterializedDiagramInput {
  key: string;
  handle?: string;
  name: string;
  ascii: string;
  viewKind?: DiagramViewKind;
  representationKind?: "tree" | "diagram";
  /** Required and non-empty in materialized mode. */
  codeEntityKeys: string[];
  mappings?: MaterializedDiagramMappingInput[];
}

export interface MaterializedDiagramSetInput {
  creationMode: "materialized";
  path: string;
  name: string;
  domainProfileId?: import("../profiles/domainProfile").BuiltInDomainProfileId;
  description?: string;
  /** Required and non-empty in materialized mode. */
  codeEntities: MaterializedCodeEntityInput[];
  /** Required and non-empty; every Diagram must include one or more CodeEntities. */
  diagrams: MaterializedDiagramInput[];
  /** Values are request-local Diagram keys. */
  featuredViews?: Partial<Record<DiagramViewKind, string>>;
}

export interface MaterializedDiagramSetResult {
  diagramSetId: string;
  codeEntityIdsByKey: Record<string, string>;
  diagramIdsByKey: Record<string, string>;
  workspace: WorkspaceSnapshot;
}

export interface ArtifactImportInput {
  artifactKind: GenerationOutputKind;
  name: string;
  ascii: string;
  /** Present when importing a self-contained mapped artifact bundle. */
  bundle?: MappedArtifactBundle;
}

export interface MappedArtifactBundle {
  bundleVersion: 1;
  artifactKind: GenerationOutputKind;
  artifact: DiagramRecord | DiagramComponentRecord;
  codeEntities: CodeEntityRecord[];
  codeEntityMap?: DiagramCodeEntityMapRecord;
}

export interface AgentProgress {
  status: Extract<AgentRunStatus, "reading-context" | "generating" | "validating">;
  message: string;
  model?: string;
  sessionId?: string;
}

export interface SelectableText {
  getSelectionText(reference: ReferenceIdentity): string | undefined;
}

export class CodeEntity implements SelectableText {
  constructor(readonly record: CodeEntityRecord) {}

  getSelectionText(reference: ReferenceIdentity): string | undefined {
    if (reference.kind !== "code-entity" || reference.targetId !== this.record.id) {
      return undefined;
    }
    const rangeIndex = reference.sourceRangeId
      ? this.record.sourceRanges.findIndex((range) => range.id === reference.sourceRangeId)
      : reference.sourceRangeIndex ?? 0;
    return this.record.sourceRanges[rangeIndex]?.path;
  }

  prompt_str(): string {
    const ranges = this.record.sourceRanges
      .map((range) => {
        const symbol = range.symbol ? ` (${range.symbol})` : "";
        const sections = range.compactedSource?.sections
          .map((section) => section.kind === "source"
            ? `  - retain lines ${section.startLine}-${section.endLine}`
            : `  - collapse lines ${section.startLine}-${section.endLine} as call graph:\n${section.comment
              .replace(/\r\n?/g, "\n")
              .split("\n")
              .map((line) => `      ${line}`)
              .join("\n")}${section.nodes?.length
              ? `\n    Node source mappings:\n${section.nodes
                .map((node) => `      graph line ${node.graphLine} -> source lines ${node.startLine}-${node.endLine}`)
                .join("\n")}`
              : ""}`)
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

function promptAliasHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function qualifiedCodeEntityPromptAlias(entity: CodeEntityRecord): string {
  const identity = entity.origin
    ? `${entity.origin.projectId}/${entity.origin.diagramSetId}/${entity.origin.codeEntitiesSetId}/${entity.id}`
    : entity.id;
  return `entity-${entity.handle}--${promptAliasHash(identity)}`;
}

/**
 * Recreates legacy handle-derived ids for prompt text. Only colliding handles
 * receive a short deterministic qualifier; persisted ids never enter the text.
 */
export function createCodeEntityPromptAliases(
  entities: readonly CodeEntityRecord[]
): CodeEntityPromptAlias[] {
  const uniqueEntities = [...new Map(entities.map((entity) => [entity.id, entity])).values()];
  const handleCounts = new Map<string, number>();
  for (const entity of uniqueEntities) {
    const handle = entity.handle.toLowerCase();
    handleCounts.set(handle, (handleCounts.get(handle) ?? 0) + 1);
  }
  return uniqueEntities.map((entity) => ({
    id: entity.id,
    alias: handleCounts.get(entity.handle.toLowerCase()) === 1
      ? `entity-${entity.handle}`
      : qualifiedCodeEntityPromptAlias(entity)
  }));
}

export function resolveCodeEntityPromptAliases(
  aliases: readonly string[],
  allowed: readonly CodeEntityPromptAlias[]
): string[] {
  const idsByAlias = new Map<string, string>();
  for (const entry of allowed) {
    if (idsByAlias.has(entry.alias)) {
      throw new Error(`ambiguous CodeEntity alias: ${entry.alias}`);
    }
    idsByAlias.set(entry.alias, entry.id);
  }
  return aliases.map((alias) => {
    const id = idsByAlias.get(alias);
    if (!id) throw new Error(`artifact references unavailable CodeEntity alias: ${alias}`);
    return id;
  });
}

function renderCodeEntityPromptAliases(
  ids: readonly string[],
  aliases: ReadonlyMap<string, string>
): string {
  return ids.map((id, index) => aliases.get(id) ?? `entity-reference-${index + 1}`).join(", ") || "none";
}

function renderArtifactPromptAscii(
  ascii: string,
  ids: readonly string[],
  aliases: ReadonlyMap<string, string>
): string {
  const declaredIds = new Set(ids);
  return ascii.replace(/\[([^\]]+)\]/g, (annotation, value: string) => {
    const compact = value.replace(/\s+/g, "");
    if (!declaredIds.has(compact)) return annotation;
    const alias = aliases.get(compact);
    return alias ? `[${alias}]` : annotation;
  });
}

export class Diagram {
  constructor(readonly record: DiagramRecord) {}

  prompt_str(codeEntityAliases: ReadonlyMap<string, string>): string {
    const derived = this.record.derivedFromDiagramIds.length
      ? this.record.derivedFromDiagramIds.join(", ")
      : "none";
    return `Diagram @diagram/${this.record.handle}\nName: ${this.record.name}\nView: ${this.record.viewKind}\nCodeEntity ids: ${renderCodeEntityPromptAliases(this.record.codeEntityIds, codeEntityAliases)}\nDerived from: ${derived}\nASCII:\n${renderArtifactPromptAscii(this.record.ascii, this.record.codeEntityIds, codeEntityAliases)}`;
  }
}

export class DiagramComponent {
  constructor(readonly record: DiagramComponentRecord) {}

  prompt_str(codeEntityAliases: ReadonlyMap<string, string>): string {
    const diagrams = this.record.derivedFromDiagramIds.join(", ") || "none";
    const components = this.record.derivedFromDiagramComponentIds.join(", ") || "none";
    return `DiagramComponent @component/${this.record.handle}\nName: ${this.record.name}\nCodeEntity ids: ${renderCodeEntityPromptAliases(this.record.codeEntityIds, codeEntityAliases)}\nDerived from Diagrams: ${diagrams}\nDerived from DiagramComponents: ${components}\nASCII:\n${renderArtifactPromptAscii(this.record.ascii, this.record.codeEntityIds, codeEntityAliases)}`;
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
