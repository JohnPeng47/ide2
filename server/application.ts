import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  CodeEntity,
  DEFAULT_CODE_ENTITY_PROMPT_PROFILE_ID,
  DEFAULT_DIAGRAM_MODEL_ID,
  DEFAULT_GENERATION_PROMPT_PROFILE_ID,
  DEFAULT_GENERATION_COUNT,
  GLOBAL_IMPORTS_DIAGRAM_SET_ID,
  SCHEMA_VERSION,
  assertSevenBitAscii,
  assertSourceRange,
  isDiagramComponentArchived,
  isDiagramArchived,
  isDiagramModelId,
  isDiagramViewKind,
  normalizeAscii,
  slugify,
  type AgentProgress,
  type AgentRunRecord,
  type ArtifactImportInput,
  type CodeEntityDraft,
  type CodeEntityPromptTemplateRecord,
  type CodeEntityRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSelectionBounds,
  type DiagramSetRecord,
  type DiagramViewKind,
  type EditOperationRecord,
  type EditSessionRecord,
  type GeneratedArtifactDraft,
  type GenerationDerivationRecord,
  type GenerationOutputKind,
  type GenerationReferenceSelection,
  type GenerationBatchRecord,
  type MappedArtifactBundle,
  type SystemPromptTemplateRecord,
  type WorkspaceSnapshot
} from "../src/domain";
import {
  createBuiltInCodeEntityPromptTemplates,
  createBuiltInSystemPromptTemplates,
  createGenerationPromptConfig,
  renderSystemPromptTemplate
} from "../src/prompt";
import {
  CALL_GRAPH_FOCUS_VERSION,
  focusIdentityKey,
  type CallGraphFocusRequest,
  type CallGraphFocusResult,
  type CodeEntityFocusIdentity
} from "../src/callGraphFocus";
import type { DiagramAgentRuntime } from "./agentRuntime";
import { filterCallGraphTree, parseCallGraphTree } from "./callGraphTree";
import { createCodeEntityPromptConfig } from "./codeEntityPrompt";
import { validateDiagramMappings } from "./diagramMapping";
import { DiagramStore, discoverRepository } from "./store";

const MAX_GENERATION_COUNT = 12;
const MAX_ATTEMPTS = 3;
const MARKER_CHARACTERS = ["`", "~", "^", "{", "}"] as const;

export interface ServiceEvent {
  type: "progress" | "workspace";
  message: string;
  workspace?: WorkspaceSnapshot;
}

function timestamp(): string {
  return new Date().toISOString();
}

function textPatch(before: string, after: string): EditOperationRecord["patch"] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    start,
    deletedText: before.slice(start, beforeEnd),
    insertedText: after.slice(start, afterEnd)
  };
}

function applyPatch(value: string, patch: EditOperationRecord["patch"], reverse = false): string {
  const deletedText = reverse ? patch.insertedText : patch.deletedText;
  const insertedText = reverse ? patch.deletedText : patch.insertedText;
  if (value.slice(patch.start, patch.start + deletedText.length) !== deletedText) {
    throw new Error("edit operation no longer matches the working copy");
  }
  return `${value.slice(0, patch.start)}${insertedText}${value.slice(patch.start + deletedText.length)}`;
}

function characterOffset(ascii: string, line: number, column: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
    throw new Error("marker coordinates must be positive integers");
  }
  const lines = ascii.split("\n");
  if (line > lines.length || column > lines[line - 1].length) {
    throw new Error("marker location exceeds the artifact bounds");
  }
  return lines.slice(0, line - 1).reduce((total, row) => total + row.length + 1, 0) + column - 1;
}

function cropAsciiSelection(ascii: string, bounds: DiagramSelectionBounds): {
  ascii: string;
  selection: DiagramSelectionBounds;
} {
  const values = [bounds.startLine, bounds.endLine, bounds.startColumn, bounds.endColumn];
  if (!values.every((value) => Number.isInteger(value) && value >= 1)) {
    throw new Error("component selection coordinates must be positive integers");
  }
  const selection: DiagramSelectionBounds = {
    startLine: Math.min(bounds.startLine, bounds.endLine),
    endLine: Math.max(bounds.startLine, bounds.endLine),
    startColumn: Math.min(bounds.startColumn, bounds.endColumn),
    endColumn: Math.max(bounds.startColumn, bounds.endColumn)
  };
  const lines = normalizeAscii(ascii).split("\n");
  const width = Math.max(...lines.map((line) => line.length));
  if (selection.endLine > lines.length || selection.endColumn > width) {
    throw new Error("component selection exceeds the artifact bounds");
  }
  let rows = lines.slice(selection.startLine - 1, selection.endLine)
    .map((line) => line.padEnd(selection.endColumn, " ").slice(
      selection.startColumn - 1,
      selection.endColumn
    ));
  while (rows.length && !rows[0].trim()) rows = rows.slice(1);
  while (rows.length && !rows.at(-1)?.trim()) rows = rows.slice(0, -1);
  if (!rows.length) throw new Error("component selection cannot be blank");
  const occupiedColumns = rows.flatMap((row) => [...row].flatMap(
    (character, index) => character === " " ? [] : [index]
  ));
  const left = Math.min(...occupiedColumns);
  const right = Math.max(...occupiedColumns);
  const cropped = normalizeAscii(rows.map((row) => row.slice(left, right + 1)).join("\n"));
  assertSevenBitAscii(cropped);
  return { ascii: cropped, selection };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function parseArtifactOrigin(value: unknown, label: string): { projectId: string; diagramSetId: string } {
  if (!isRecord(value)) throw new Error(`${label} is missing provenance`);
  return {
    projectId: requiredString(value.projectId, `${label} projectId`),
    diagramSetId: requiredString(value.diagramSetId, `${label} diagramSetId`)
  };
}

function parseCallGraphFocusRequest(value: unknown): CallGraphFocusRequest {
  if (!isRecord(value)) throw new Error("call-graph focus request must be an object");
  if (value.version !== CALL_GRAPH_FOCUS_VERSION) {
    throw new Error(`unsupported call-graph focus request version: ${String(value.version)}`);
  }
  if (!isRecord(value.sourceDiagram) || value.sourceDiagram.kind !== "diagram") {
    throw new Error("call-graph focus request requires a qualified source Diagram");
  }
  if (!Array.isArray(value.selectedCodeEntities) || value.selectedCodeEntities.length === 0) {
    throw new Error("call-graph focus request requires at least one selected CodeEntity");
  }
  const sourceOrigin = parseArtifactOrigin(value.sourceDiagram.origin, "source Diagram");
  const selectedCodeEntities: CodeEntityFocusIdentity[] = value.selectedCodeEntities.map(
    (candidate, index) => {
      if (!isRecord(candidate) || candidate.kind !== "code-entity") {
        throw new Error(`selected CodeEntity ${index + 1} is invalid`);
      }
      const origin = parseArtifactOrigin(candidate.origin, `selected CodeEntity ${index + 1}`);
      if (!isRecord(candidate.origin)) throw new Error(`selected CodeEntity ${index + 1} is missing provenance`);
      return {
        kind: "code-entity",
        targetId: requiredString(candidate.targetId, `selected CodeEntity ${index + 1} targetId`),
        origin: {
          ...origin,
          codeEntitiesSetId: requiredString(
            candidate.origin.codeEntitiesSetId,
            `selected CodeEntity ${index + 1} codeEntitiesSetId`
          )
        }
      };
    }
  );
  return {
    version: CALL_GRAPH_FOCUS_VERSION,
    diagramSetId: requiredString(value.diagramSetId, "diagramSetId"),
    sourceDiagram: {
      kind: "diagram",
      targetId: requiredString(value.sourceDiagram.targetId, "source Diagram targetId"),
      origin: sourceOrigin
    },
    selectedCodeEntities
  };
}

function sameArtifactOrigin(
  left: { projectId: string; diagramSetId: string },
  right: { projectId: string; diagramSetId: string }
): boolean {
  return left.projectId === right.projectId && left.diagramSetId === right.diagramSetId;
}

function identityForRecord(entity: CodeEntityRecord): CodeEntityFocusIdentity {
  if (!entity.origin) throw new Error(`CodeEntity ${entity.id} is missing provenance`);
  return { kind: "code-entity", targetId: entity.id, origin: entity.origin };
}

export class DiagramApplication {
  private readonly activeBatches = new Set<string>();
  private readonly activeMappings = new Set<string>();

  constructor(readonly store: DiagramStore, private readonly agents: DiagramAgentRuntime) {}

  private async artifactForDiagramSet(
    setId: string,
    artifactKind: GenerationOutputKind,
    artifactId: string
  ): Promise<{
    artifact: DiagramRecord | DiagramComponentRecord;
    global: boolean;
  }> {
    const set = await this.store.loadDiagramSet(setId);
    const local = artifactKind === "diagram"
      ? set.diagramIds.includes(artifactId)
      : set.diagramComponentIds.includes(artifactId);
    if (local) {
      return {
        artifact: artifactKind === "diagram"
          ? await this.store.loadDiagram(setId, artifactId)
          : await this.store.loadDiagramComponent(setId, artifactId),
        global: false
      };
    }
    const library = await this.store.loadImportedArtifactLibrary();
    const global = artifactKind === "diagram"
      ? library.diagramIds.includes(artifactId)
      : library.diagramComponentIds.includes(artifactId);
    if (!global) throw new Error(`unknown ${artifactKind}: ${artifactId}`);
    return {
      artifact: artifactKind === "diagram"
        ? await this.store.loadImportedDiagram(artifactId)
        : await this.store.loadImportedDiagramComponent(artifactId),
      global: true
    };
  }

  async mappedArtifactBundle(
    setId: string,
    artifactKind: GenerationOutputKind,
    artifactId: string
  ): Promise<MappedArtifactBundle> {
    const { artifact, global } = await this.artifactForDiagramSet(setId, artifactKind, artifactId);
    const localSet = await this.store.loadCodeEntities(setId);
    const library = await this.store.loadImportedArtifactLibrary();
    const imported = await Promise.all(
      (library.codeEntityIds ?? []).map((id) => this.store.loadImportedCodeEntity(id))
    );
    const available = new Map(
      [...localSet.entities, ...imported].map((entity) => [entity.id, entity])
    );
    const codeEntities = artifact.codeEntityIds.map((id) => available.get(id)).filter(
      (entity): entity is CodeEntityRecord => Boolean(entity)
    );
    if (codeEntities.length !== new Set(artifact.codeEntityIds).size) {
      throw new Error("artifact has unresolved CodeEntity dependencies");
    }
    const codeEntityMap = global
      ? await this.store.loadImportedCodeEntityMap(artifactId)
        ?? await this.store.loadCodeEntityMap(setId, artifactId)
      : await this.store.loadCodeEntityMap(setId, artifactId);
    return {
      bundleVersion: 1,
      artifactKind,
      artifact,
      codeEntities,
      ...(codeEntityMap ? { codeEntityMap } : {})
    };
  }

  async callGraphFocus(input: unknown): Promise<CallGraphFocusResult> {
    const request = parseCallGraphFocusRequest(input);
    const set = await this.store.loadDiagramSet(request.diagramSetId);
    const { artifact: sourceArtifact } = await this.artifactForDiagramSet(
      set.id,
      "diagram",
      request.sourceDiagram.targetId
    );
    const sourceDiagram = sourceArtifact as DiagramRecord;
    if (sourceDiagram.viewKind !== "diagram") {
      throw new Error("source Diagram must have diagram viewKind");
    }
    if (!sourceDiagram.recordOrigin
      || !sameArtifactOrigin(sourceDiagram.recordOrigin, request.sourceDiagram.origin)) {
      throw new Error("source Diagram provenance does not match the requested identity");
    }

    const callGraphId = set.featuredViewIds["call-graph"];
    if (!callGraphId) throw new Error("DiagramSet has no featured call graph");
    const { artifact: callGraphArtifact } = await this.artifactForDiagramSet(
      set.id,
      "diagram",
      callGraphId
    );
    const callGraph = callGraphArtifact as DiagramRecord;
    if (callGraph.viewKind !== "call-graph") {
      throw new Error("featured call graph does not have call-graph viewKind");
    }
    if (callGraph.basedOnDiagramId !== sourceDiagram.id) {
      throw new Error("featured call graph is based on another Diagram");
    }
    if (!callGraph.recordOrigin) throw new Error("featured call graph is missing provenance");

    const local = await this.store.loadCodeEntities(set.id);
    const library = await this.store.loadImportedArtifactLibrary();
    const imported = await Promise.all(
      (library.codeEntityIds ?? []).map((id) => this.store.loadImportedCodeEntity(id))
    );
    const available = new Map(
      [...local.entities, ...imported].map((entity) => [entity.id, entity])
    );
    const declaredEntities = callGraph.codeEntityIds.map((id) => available.get(id));
    const missingDependency = callGraph.codeEntityIds.find((_, index) => !declaredEntities[index]);
    if (missingDependency) {
      throw new Error(`featured call graph has unresolved CodeEntity dependency: ${missingDependency}`);
    }

    const selected = new Map<string, CodeEntityFocusIdentity>();
    for (const identity of request.selectedCodeEntities) {
      const entity = available.get(identity.targetId);
      if (!entity) throw new Error(`unknown selected CodeEntity: ${identity.targetId}`);
      if (!entity.origin || focusIdentityKey(identity) !== focusIdentityKey(identityForRecord(entity))) {
        throw new Error(`selected CodeEntity provenance does not match: ${identity.targetId}`);
      }
      if (!sourceDiagram.codeEntityIds.includes(identity.targetId)) {
        throw new Error(`selected CodeEntity is not declared by the source Diagram: ${identity.targetId}`);
      }
      if (!callGraph.codeEntityIds.includes(identity.targetId)) {
        throw new Error(`selected CodeEntity is not declared by the featured call graph: ${identity.targetId}`);
      }
      selected.set(focusIdentityKey(identity), identity);
    }

    const roots = parseCallGraphTree(
      callGraph.ascii,
      declaredEntities.filter((entity): entity is CodeEntityRecord => Boolean(entity))
    );
    const filteredRoots = filterCallGraphTree(roots, new Set(selected.keys()));
    if (filteredRoots.length === 0) {
      throw new Error("featured call graph contains no nodes for the selected CodeEntities");
    }
    return {
      version: CALL_GRAPH_FOCUS_VERSION,
      diagramSetId: set.id,
      sourceDiagram: request.sourceDiagram,
      callGraph: {
        kind: "diagram",
        targetId: callGraph.id,
        origin: callGraph.recordOrigin
      },
      callGraphName: callGraph.name,
      roots: filteredRoots
    };
  }

  async systemPromptTemplates(): Promise<SystemPromptTemplateRecord[]> {
    return this.store.loadSystemPromptTemplates();
  }

  async codeEntityPromptTemplates(): Promise<CodeEntityPromptTemplateRecord[]> {
    return this.store.loadCodeEntityPromptTemplates();
  }

  async resolveCodeEntityPromptTemplate(id?: unknown): Promise<CodeEntityPromptTemplateRecord> {
    const useDefault = id === undefined || id === null;
    const requestedId = useDefault ? DEFAULT_CODE_ENTITY_PROMPT_PROFILE_ID : id;
    if (typeof requestedId !== "string") {
      throw new Error(`unsupported CodeEntity prompt template: ${String(requestedId)}`);
    }
    const templates = await this.store.loadCodeEntityPromptTemplates();
    const template = templates.find((candidate) => candidate.id === requestedId)
      ?? (useDefault ? templates[0] : undefined);
    if (!template) {
      const available = templates.map((candidate) => candidate.id).join(", ");
      throw new Error(
        `unsupported CodeEntity prompt template: ${requestedId}; available templates: ${available}`
      );
    }
    return template;
  }

  async resolveSystemPromptTemplate(id?: unknown): Promise<SystemPromptTemplateRecord> {
    const useDefault = id === undefined || id === null;
    const requestedId = useDefault ? DEFAULT_GENERATION_PROMPT_PROFILE_ID : id;
    if (typeof requestedId !== "string") {
      throw new Error(`unsupported generation prompt template: ${String(requestedId)}`);
    }
    const legacyIds: Record<string, string> = {
      structureFirst: "structure-first",
      flowFirst: "flow-first"
    };
    const normalizedId = legacyIds[requestedId] ?? requestedId;
    const templates = await this.store.loadSystemPromptTemplates();
    const template = templates.find((candidate) => candidate.id === normalizedId)
      ?? (useDefault ? templates[0] : undefined);
    if (!template) {
      const available = templates.map((candidate) => candidate.id).join(", ");
      throw new Error(
        `unsupported generation prompt template: ${requestedId}; available templates: ${available}`
      );
    }
    return template;
  }

  async createDiagramSet(input: { path: string; name: string; prompt: string }): Promise<DiagramSetRecord> {
    if (!input.name.trim()) throw new Error("DiagramSet name is required");
    const location = await discoverRepository(input.path);
    if (path.resolve(location.checkoutRoot) !== this.store.checkoutRoot) {
      throw new Error(`application store is rooted at ${this.store.checkoutRoot}, not ${location.checkoutRoot}`);
    }
    const project = await this.store.ensureProject(location);
    const created = await this.store.createDiagramSet({
      project,
      name: input.name,
      initialPrompt: input.prompt,
      location
    });
    return created.diagramSet;
  }

  async collectCodeEntities(
    setId: string,
    input: { promptTemplateId?: unknown } = {},
    onEvent?: (event: ServiceEvent) => void
  ): Promise<void> {
    const set = await this.store.loadDiagramSet(setId);
    const entitySet = await this.store.loadCodeEntities(setId);
    if (entitySet.status === "finalized") throw new Error("CodeEntitiesSet is immutable after finalization");
    const template = await this.resolveCodeEntityPromptTemplate(input.promptTemplateId);
    const promptConfig = createCodeEntityPromptConfig({
      id: this.store.ids.promptConfig(),
      diagramSet: set,
      template,
      createdAt: timestamp()
    });
    await this.store.beginCodeEntityCollection(promptConfig);
    const runId = this.store.ids.run();
    let run: AgentRunRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: runId,
      diagramSetId: setId,
      kind: "collect-entities",
      status: "queued",
      statusMessage: "opening code-entity collector",
      codeEntitiesRevision: entitySet.revision,
      outputCodeEntityIds: [],
      startedAt: timestamp(),
      updatedAt: timestamp()
    };
    await this.store.saveRun(run);
    await this.store.attachRun(setId, run.id);
    let progressWrites = Promise.resolve();
    const progress = (update: AgentProgress) => {
      run = {
        ...run,
        status: update.status,
        statusMessage: update.message,
        model: update.model ?? run.model,
        sessionId: update.sessionId ?? run.sessionId,
        updatedAt: timestamp()
      };
      const snapshot = run;
      progressWrites = progressWrites.then(() => this.store.saveRun(snapshot));
      onEvent?.({ type: "progress", message: update.message });
    };
    try {
      const drafts = await this.agents.collectEntities({
        sourceRoot: set.sourceCheckoutRoot,
        diagramSetName: set.name,
        promptConfig
      }, progress);
      await progressWrites;
      const entities = await this.validateEntityDrafts(set, drafts);
      await this.store.completeCollection(setId, entities);
      run = {
        ...run,
        status: "complete",
        statusMessage: `collected ${entities.length} code entities`,
        outputCodeEntityIds: entities.map((entity) => entity.id),
        updatedAt: timestamp(),
        completedAt: timestamp()
      };
      await this.store.saveRun(run);
      onEvent?.({ type: "workspace", message: run.statusMessage, workspace: await this.workspace() });
    } catch (error) {
      await progressWrites.catch(() => undefined);
      const message = error instanceof Error ? error.message : "code-entity collection failed";
      run = {
        ...run,
        status: "failed",
        statusMessage: message,
        error: message,
        updatedAt: timestamp(),
        completedAt: timestamp()
      };
      await this.store.saveRun(run);
      await this.store.failCollection(setId, message);
      throw error;
    }
  }

  async generateInitialDiagrams(
    setId: string,
    input: { promptTemplateId?: unknown } = {},
    onEvent?: (event: ServiceEvent) => void
  ): Promise<WorkspaceSnapshot> {
    const entities = await this.store.loadCodeEntities(setId);
    return this.generate(setId, {
      prompt: "",
      selectedCodeEntityIds: entities.entities.map((entity) => entity.id),
      count: DEFAULT_GENERATION_COUNT,
      outputKind: "diagram",
      promptProfileId: input.promptTemplateId
    }, onEvent);
  }

  private async validateEntityDrafts(
    set: DiagramSetRecord,
    drafts: CodeEntityDraft[]
  ): Promise<CodeEntityRecord[]> {
    if (drafts.length === 0) throw new Error("collector submitted no CodeEntities");
    const handles = new Set<string>();
    const sourceRoot = await realpath(set.sourceCheckoutRoot);
    const entities: CodeEntityRecord[] = [];
    for (const [index, draft] of drafts.entries()) {
      const baseHandle = slugify(draft.handle || draft.label, `entity-${index + 1}`);
      let handle = baseHandle;
      let suffix = 2;
      while (handles.has(handle)) {
        handle = `${baseHandle}-${suffix}`;
        suffix += 1;
      }
      handles.add(handle);
      if (!draft.label.trim() || !draft.summary.trim()) throw new Error("CodeEntity label and summary are required");
      if (!(["state", "interface-data-struct", "operation"] as const).includes(draft.category)) {
        throw new Error(`invalid CodeEntity category: ${draft.category}`);
      }
      if (draft.sourceRanges.length === 0) throw new Error(`CodeEntity ${handle} has no source ranges`);
      const sourceRanges: CodeEntityRecord["sourceRanges"] = [];
      for (const range of draft.sourceRanges) {
        assertSourceRange(range);
        const absolute = await realpath(path.resolve(sourceRoot, range.path)).catch(() => null);
        if (!absolute || (absolute !== sourceRoot && !absolute.startsWith(`${sourceRoot}${path.sep}`))) {
          throw new Error(`source range escapes or does not exist: ${range.path}`);
        }
        const info = await stat(absolute);
        if (!info.isFile()) throw new Error(`source range is not a file: ${range.path}`);
        const sourceLines = (await readFile(absolute, "utf8")).split(/\r?\n/);
        const lineCount = sourceLines.length;
        if (range.endLine > lineCount) {
          throw new Error(`source range exceeds ${range.path} (${lineCount} lines)`);
        }
        sourceRanges.push({
          ...range,
          id: this.store.ids.sourceRange(),
          originalLines: sourceLines.slice(range.startLine - 1, range.endLine)
        });
      }
      const record: CodeEntityRecord = {
        id: this.store.ids.codeEntity(),
        origin: {
          projectId: set.projectId,
          diagramSetId: set.id,
          codeEntitiesSetId: set.codeEntitiesSetId
        },
        handle,
        label: draft.label.trim(),
        category: draft.category,
        summary: draft.summary.trim(),
        sourceRanges
      };
      new CodeEntity(record).prompt_str();
      entities.push(record);
    }
    return entities;
  }

  async importArtifact(input: ArtifactImportInput): Promise<WorkspaceSnapshot> {
    if (input.artifactKind !== "diagram" && input.artifactKind !== "diagram-component") {
      throw new Error("artifact kind must be diagram or diagram-component");
    }
    const name = input.name.trim();
    if (!name) throw new Error("artifact name is required");
    if (name.length > 120) throw new Error("artifact name cannot exceed 120 characters");
    const ascii = normalizeAscii(input.ascii);
    assertSevenBitAscii(ascii);
    if (ascii.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");

    const workspace = await this.workspace();
    const bundle = input.bundle;
    if (bundle) {
      if (bundle.bundleVersion !== 1 || bundle.artifactKind !== input.artifactKind) {
        throw new Error("mapped artifact bundle kind or version is invalid");
      }
      if (bundle.artifact.ascii !== input.ascii) {
        throw new Error("mapped artifact bundle ASCII cannot be edited during import");
      }
      if (!bundle.artifact.recordOrigin) {
        throw new Error("mapped artifact bundle is missing artifact provenance");
      }
      const dependencies = new Map(bundle.codeEntities.map((entity) => [entity.id, entity]));
      for (const id of bundle.artifact.codeEntityIds) {
        if (!dependencies.has(id)) throw new Error(`mapped artifact bundle is missing CodeEntity: ${id}`);
      }
      for (const entity of bundle.codeEntities) {
        if (!entity.origin) throw new Error(`CodeEntity ${entity.id} is missing provenance`);
        if (entity.sourceRanges.some((range) => !range.id)) {
          throw new Error(`CodeEntity ${entity.id} has a source range without an id`);
        }
        await this.store.addImportedCodeEntity(entity);
      }
      if (bundle.codeEntityMap) {
        if (bundle.codeEntityMap.artifactId !== bundle.artifact.id
          || bundle.codeEntityMap.artifactKind !== input.artifactKind) {
          throw new Error("mapped artifact bundle has a mismatched CodeEntity map");
        }
        for (const mapping of bundle.codeEntityMap.mappings) {
          const entity = dependencies.get(mapping.entityId);
          if (!entity || !bundle.artifact.codeEntityIds.includes(mapping.entityId)) {
            throw new Error(`CodeEntity map references an unavailable dependency: ${mapping.entityId}`);
          }
          if (!Number.isInteger(mapping.sourceRangeIndex)
            || !entity.sourceRanges[mapping.sourceRangeIndex]) {
            throw new Error(`CodeEntity map references an unavailable source range: ${mapping.entityId}`);
          }
          if (mapping.sourceRangeId
            && entity.sourceRanges[mapping.sourceRangeIndex].id !== mapping.sourceRangeId) {
            throw new Error(`CodeEntity map has a mismatched source range identity: ${mapping.entityId}`);
          }
        }
      }
    }
    const existing = input.artifactKind === "diagram"
      ? Object.values(workspace.diagrams)
      : Object.values(workspace.diagramComponents);
    const handles = new Set(existing.map((artifact) => artifact.handle));
    const fallback = input.artifactKind === "diagram" ? "imported-diagram" : "imported-component";
    const baseHandle = slugify(name, fallback);
    let handle = baseHandle;
    let suffix = 2;
    while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;

    if (input.artifactKind === "diagram") {
      const diagram: DiagramRecord = {
        ...(bundle?.artifact as DiagramRecord | undefined),
        schemaVersion: SCHEMA_VERSION,
        id: bundle?.artifact.id ?? this.store.ids.diagram(),
        recordOrigin: bundle?.artifact.recordOrigin ?? {
          projectId: workspace.project?.id ?? "unowned",
          diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID
        },
        diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID,
        viewKind: bundle && "viewKind" in bundle.artifact ? bundle.artifact.viewKind : "diagram",
        handle,
        name,
        ascii,
        codeEntityIds: bundle?.artifact.codeEntityIds ?? [],
        origin: "imported",
        derivedFromDiagramIds: bundle && "derivedFromDiagramIds" in bundle.artifact
          ? bundle.artifact.derivedFromDiagramIds
          : [],
        createdAt: timestamp()
      };
      await this.store.addImportedDiagram(diagram);
      if (bundle?.codeEntityMap) await this.store.addImportedCodeEntityMap(bundle.codeEntityMap);
    } else {
      const component: DiagramComponentRecord = {
        ...(bundle?.artifact as DiagramComponentRecord | undefined),
        schemaVersion: SCHEMA_VERSION,
        id: bundle?.artifact.id ?? this.store.ids.diagramComponent(),
        recordOrigin: bundle?.artifact.recordOrigin ?? {
          projectId: workspace.project?.id ?? "unowned",
          diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID
        },
        diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID,
        handle,
        name,
        ascii,
        codeEntityIds: bundle?.artifact.codeEntityIds ?? [],
        origin: "imported",
        derivedFromDiagramIds: bundle?.artifact.derivedFromDiagramIds ?? [],
        derivedFromDiagramComponentIds: bundle && "derivedFromDiagramComponentIds" in bundle.artifact
          ? bundle.artifact.derivedFromDiagramComponentIds
          : [],
        createdAt: timestamp()
      };
      await this.store.addImportedDiagramComponent(component);
      if (bundle?.codeEntityMap) await this.store.addImportedCodeEntityMap(bundle.codeEntityMap);
    }
    return this.workspace();
  }

  async deleteDiagramSet(setId: string): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    if (set.readiness === "collecting") {
      throw new Error("a Diagram Set cannot be deleted while collection is running");
    }
    if (this.activeBatches.has(setId)
      || [...this.activeMappings].some((key) => key.startsWith(`${setId}:`))) {
      throw new Error("a Diagram Set cannot be deleted while an agent is running");
    }
    const workspace = await this.workspace();
    const hasActiveRun = Object.values(workspace.agentRuns).some((run) => (
      run.diagramSetId === setId
      && ["queued", "reading-context", "generating", "validating"].includes(run.status)
    ));
    if (hasActiveRun) throw new Error("a Diagram Set cannot be deleted while an agent is running");
    await this.store.moveDiagramSetToTrash(setId);
    return this.workspace();
  }

  async renameDiagram(setId: string, diagramId: string, name: string): Promise<WorkspaceSnapshot> {
    const normalized = name.trim();
    if (!normalized) throw new Error("Diagram name is required");
    if (normalized.length > 120) throw new Error("Diagram name cannot exceed 120 characters");
    const set = await this.store.loadDiagramSet(setId);
    if (!set.diagramIds.includes(diagramId)) throw new Error(`unknown Diagram: ${diagramId}`);
    const diagram = await this.store.loadDiagram(setId, diagramId);
    if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be renamed");
    await this.store.renameDiagram(setId, diagramId, normalized);
    return this.workspace();
  }

  async setStarredDiagram(
    setId: string,
    diagramId: string,
    starred: boolean
  ): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    const { artifact } = await this.artifactForDiagramSet(setId, "diagram", diagramId);
    const diagram = artifact as DiagramRecord;
    if (starred) {
      if (isDiagramArchived(diagram)) {
        throw new Error("archived diagrams cannot be starred");
      }
      await this.store.setFeaturedView(setId, diagram.viewKind, diagramId);
    } else if (set.featuredViewIds[diagram.viewKind] === diagramId) {
      await this.store.setFeaturedView(setId, diagram.viewKind);
    }
    return this.workspace();
  }

  async archiveDiagram(setId: string, diagramId: string): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    if (!set.diagramIds.includes(diagramId)) throw new Error(`unknown Diagram: ${diagramId}`);
    await this.store.archiveDiagram(setId, diagramId);
    return this.workspace();
  }

  async archiveDiagramComponent(setId: string, componentId: string): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    if (!set.diagramComponentIds.includes(componentId)) {
      throw new Error(`unknown DiagramComponent: ${componentId}`);
    }
    await this.store.archiveDiagramComponent(setId, componentId);
    return this.workspace();
  }

  async renameImportedDiagram(diagramId: string, name: string): Promise<WorkspaceSnapshot> {
    const normalized = name.trim();
    if (!normalized) throw new Error("Diagram name is required");
    if (normalized.length > 120) throw new Error("Diagram name cannot exceed 120 characters");
    const diagram = await this.store.loadImportedDiagram(diagramId);
    if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be renamed");
    await this.store.renameImportedDiagram(diagramId, normalized);
    return this.workspace();
  }

  async archiveImportedDiagram(diagramId: string): Promise<WorkspaceSnapshot> {
    await this.store.archiveImportedDiagram(diagramId);
    await this.store.clearFeaturedViewReferences(diagramId);
    return this.workspace();
  }

  async archiveImportedDiagramComponent(componentId: string): Promise<WorkspaceSnapshot> {
    await this.store.archiveImportedDiagramComponent(componentId);
    return this.workspace();
  }

  async mapCodeEntities(
    setId: string,
    artifactKind: GenerationOutputKind,
    artifactId: string,
    onEvent?: (event: ServiceEvent) => void
  ): Promise<WorkspaceSnapshot> {
    const mappingKey = `${setId}:${artifactId}`;
    if (this.activeMappings.has(mappingKey)) {
      throw new Error("a code-entity mapping is already running for this artifact");
    }
    const set = await this.store.loadDiagramSet(setId);
    const { artifact, global } = await this.artifactForDiagramSet(setId, artifactKind, artifactId);
    if (artifact.archivedAt) {
      throw new Error("archived artifacts cannot be mapped");
    }
    const entitySet = await this.store.loadCodeEntities(setId);
    if (entitySet.status !== "finalized") {
      throw new Error("CodeEntitiesSet must be finalized before mapping");
    }
    const artifactEntityIds = new Set(artifact.codeEntityIds);
    const entities = global
      ? entitySet.entities
      : entitySet.entities.filter((entity) => artifactEntityIds.has(entity.id));
    if (entities.length === 0) throw new Error("artifact has no CodeEntities to map");

    this.activeMappings.add(mappingKey);
    const runId = this.store.ids.run();
    let run: AgentRunRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: runId,
      diagramSetId: setId,
      kind: "map-code-entities",
      status: "queued",
      statusMessage: "opening diagram mapping agent",
      codeEntitiesRevision: entitySet.revision,
      outputCodeEntityIds: entities.map((entity) => entity.id),
      ...(artifactKind === "diagram"
        ? { outputDiagramId: artifactId }
        : { outputDiagramComponentId: artifactId }),
      startedAt: timestamp(),
      updatedAt: timestamp()
    };
    await this.store.saveRun(run);
    await this.store.attachRun(setId, run.id);
    let progressWrites = Promise.resolve();
    const progress = (update: AgentProgress) => {
      run = {
        ...run,
        status: update.status,
        statusMessage: update.message,
        model: update.model ?? run.model,
        sessionId: update.sessionId ?? run.sessionId,
        updatedAt: timestamp()
      };
      const snapshot = run;
      progressWrites = progressWrites.then(() => this.store.saveRun(snapshot));
      onEvent?.({ type: "progress", message: update.message });
    };
    try {
      const drafts = await this.agents.mapArtifactEntities({
        sourceRoot: set.sourceCheckoutRoot,
        diagramSetName: set.name,
        artifactKind,
        artifactName: artifact.name,
        artifactHandle: artifact.handle,
        ascii: artifact.ascii,
        codeEntities: entities
      }, progress);
      await progressWrites;
      const mappings = validateDiagramMappings(artifact.ascii, drafts, entities);
      const record: DiagramCodeEntityMapRecord = {
        schemaVersion: SCHEMA_VERSION,
        diagramSetId: setId,
        artifactKind,
        artifactId,
        asciiSha256: createHash("sha256").update(artifact.ascii).digest("hex"),
        mappings,
        producedByRunId: runId,
        createdAt: timestamp()
      };
      await this.store.saveCodeEntityMap(record);
      run = {
        ...run,
        status: "complete",
        statusMessage: `mapped ${mappings.length} diagram elements`,
        updatedAt: timestamp(),
        completedAt: timestamp()
      };
      await this.store.saveRun(run);
      const workspace = await this.workspace();
      onEvent?.({ type: "workspace", message: run.statusMessage, workspace });
      return workspace;
    } catch (error) {
      await progressWrites.catch(() => undefined);
      const message = error instanceof Error ? error.message : "code-entity mapping failed";
      run = {
        ...run,
        status: "failed",
        statusMessage: message,
        error: message,
        updatedAt: timestamp(),
        completedAt: timestamp()
      };
      await this.store.saveRun(run);
      throw error;
    } finally {
      this.activeMappings.delete(mappingKey);
    }
  }

  async captureDiagramComponent(
    setId: string,
    diagramId: string,
    bounds: DiagramSelectionBounds
  ): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    const { artifact } = await this.artifactForDiagramSet(setId, "diagram", diagramId);
    const diagram = artifact as DiagramRecord;
    if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be captured");
    return this.captureComponentSelection(set, { kind: "diagram", artifact: diagram }, bounds);
  }

  async createEditSession(
    setId: string,
    artifactKind: GenerationOutputKind,
    artifactId: string
  ): Promise<WorkspaceSnapshot> {
    const { artifact } = await this.artifactForDiagramSet(setId, artifactKind, artifactId);
    if (artifact.archivedAt) throw new Error("archived artifacts cannot be edited");
    const createdAt = timestamp();
    const session: EditSessionRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: this.store.ids.editSession(),
      diagramSetId: setId,
      sourceArtifactKind: artifactKind,
      sourceArtifactId: artifact.id,
      sourceHandle: artifact.handle,
      sourceName: artifact.name,
      baseAscii: artifact.ascii,
      workingAscii: artifact.ascii,
      codeEntityIds: [...artifact.codeEntityIds],
      operations: [],
      operationCursor: 0,
      revision: 0,
      status: "active",
      createdAt,
      updatedAt: createdAt
    };
    await this.store.addEditSession(session);
    return this.workspace();
  }

  private async activeEditSession(setId: string, sessionId: string): Promise<EditSessionRecord> {
    const set = await this.store.loadDiagramSet(setId);
    if (!set.editSessionIds.includes(sessionId)) throw new Error(`unknown EditSession: ${sessionId}`);
    const session = await this.store.loadEditSession(setId, sessionId);
    if (session.status !== "active") throw new Error(`EditSession is ${session.status}`);
    return session;
  }

  private async appendEditOperation(
    session: EditSessionRecord,
    operation: Omit<EditOperationRecord, "id" | "createdAt">
  ): Promise<EditSessionRecord> {
    const createdAt = timestamp();
    const nextOperation: EditOperationRecord = {
      ...operation,
      id: this.store.ids.editOperation(),
      createdAt
    };
    const next: EditSessionRecord = {
      ...session,
      workingAscii: applyPatch(session.workingAscii, nextOperation.patch),
      operations: [...session.operations.slice(0, session.operationCursor), nextOperation],
      operationCursor: session.operationCursor + 1,
      revision: session.revision + 1,
      updatedAt: createdAt
    };
    assertSevenBitAscii(next.workingAscii);
    if (next.workingAscii.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");
    await this.store.saveEditSession(next);
    return next;
  }

  async manualEdit(setId: string, sessionId: string, ascii: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    const normalized = normalizeAscii(ascii);
    assertSevenBitAscii(normalized);
    if (normalized === session.workingAscii) return this.workspace();
    const patch = textPatch(session.workingAscii, normalized);
    const changed = Math.max(patch.deletedText.length, patch.insertedText.length);
    await this.appendEditOperation(session, {
      kind: "manual",
      label: `Manual edit · ${changed} character${changed === 1 ? "" : "s"}`,
      patch
    });
    return this.workspace();
  }

  async placeEditMarker(
    setId: string,
    sessionId: string,
    line: number,
    column: number
  ): Promise<{ workspace: WorkspaceSnapshot; markerToken: string }> {
    const session = await this.activeEditSession(setId, sessionId);
    const markerChar = MARKER_CHARACTERS.find((candidate) => !session.workingAscii.includes(candidate));
    if (!markerChar) throw new Error("no unused marker characters remain in this artifact");
    const offset = characterOffset(session.workingAscii, line, column);
    const replacedChar = session.workingAscii[offset];
    const markerToken = `@${markerChar}`;
    await this.appendEditOperation(session, {
      kind: "manual",
      subtype: "marker",
      label: `Marker ${markerToken} · L${line}:C${column}`,
      patch: { start: offset, deletedText: replacedChar, insertedText: markerChar },
      markerChar,
      markerToken,
      replacedChar,
      line,
      column
    });
    return { workspace: await this.workspace(), markerToken };
  }

  async undoEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    if (session.operationCursor === 0) return this.workspace();
    const operation = session.operations[session.operationCursor - 1];
    const updated: EditSessionRecord = {
      ...session,
      workingAscii: applyPatch(session.workingAscii, operation.patch, true),
      operationCursor: session.operationCursor - 1,
      revision: session.revision + 1,
      updatedAt: timestamp()
    };
    await this.store.saveEditSession(updated);
    return this.workspace();
  }

  async redoEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    if (session.operationCursor === session.operations.length) return this.workspace();
    const operation = session.operations[session.operationCursor];
    const updated: EditSessionRecord = {
      ...session,
      workingAscii: applyPatch(session.workingAscii, operation.patch),
      operationCursor: session.operationCursor + 1,
      revision: session.revision + 1,
      updatedAt: timestamp()
    };
    await this.store.saveEditSession(updated);
    return this.workspace();
  }

  async llmEdit(
    setId: string,
    sessionId: string,
    instruction: string,
    modelId: unknown = DEFAULT_DIAGRAM_MODEL_ID,
    onEvent?: (event: ServiceEvent) => void
  ): Promise<WorkspaceSnapshot> {
    if (!instruction.trim()) throw new Error("edit instruction is required");
    if (!isDiagramModelId(modelId)) throw new Error(`unsupported edit model: ${String(modelId)}`);
    const session = await this.activeEditSession(setId, sessionId);
    const set = await this.store.loadDiagramSet(setId);
    const runId = this.store.ids.run();
    const createdAt = timestamp();
    let run: AgentRunRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: runId,
      diagramSetId: setId,
      kind: "edit-artifact",
      status: "queued",
      statusMessage: "queued artifact edit",
      codeEntitiesRevision: (await this.store.loadCodeEntities(setId)).revision,
      outputCodeEntityIds: [...session.codeEntityIds],
      startedAt: createdAt,
      updatedAt: createdAt
    };
    await this.store.saveRun(run);
    await this.store.attachRun(setId, run.id);
    const appliedOperations = session.operations.slice(0, session.operationCursor);
    const markers = appliedOperations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation, index }) => operation.subtype === "marker" && operation.markerChar
        && session.workingAscii.includes(operation.markerChar)
        && !appliedOperations.slice(index + 1).some((candidate) => candidate.kind === "llm"))
      .map(({ operation }) => ({
        token: operation.markerToken!,
        character: operation.markerChar!,
        originalCharacter: operation.replacedChar ?? " "
      }));
    try {
      const draft = await this.agents.editArtifact({
        sourceRoot: set.sourceCheckoutRoot,
        diagramSetName: set.name,
        artifactKind: session.sourceArtifactKind,
        artifactName: session.sourceName,
        artifactHandle: session.sourceHandle,
        currentAscii: session.workingAscii,
        instruction: instruction.trim(),
        modelId,
        markers
      }, (progress) => {
        run = {
          ...run,
          status: progress.status,
          statusMessage: progress.message,
          model: progress.model ?? run.model,
          sessionId: progress.sessionId ?? run.sessionId,
          updatedAt: timestamp()
        };
        void this.store.saveRun(run);
        onEvent?.({ type: "progress", message: progress.message });
      });
      const normalized = normalizeAscii(draft.ascii);
      assertSevenBitAscii(normalized);
      if (normalized.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");
      const patch = textPatch(session.workingAscii, normalized);
      const updated = await this.appendEditOperation(session, {
        kind: "llm",
        label: `LLM edit · ${instruction.trim().slice(0, 72)}`,
        patch,
        instruction: instruction.trim(),
        modelId,
        agentRunId: run.id
      });
      run = {
        ...run,
        status: "complete",
        statusMessage: "artifact edit applied",
        updatedAt: timestamp(),
        completedAt: timestamp()
      };
      await this.store.saveRun(run);
      const workspace = await this.workspace();
      onEvent?.({ type: "workspace", message: updated.operations.at(-1)?.label ?? "edit applied", workspace });
      return workspace;
    } catch (error) {
      const message = error instanceof Error ? error.message : "artifact edit failed";
      await this.store.saveRun({
        ...run,
        status: "failed",
        statusMessage: message,
        error: message,
        updatedAt: timestamp(),
        completedAt: timestamp()
      });
      throw error;
    }
  }

  async finishEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    if (session.operationCursor === 0) throw new Error("make at least one edit before saving a copy");
    const appliedOperations = session.operations.slice(0, session.operationCursor);
    const unresolvedMarker = appliedOperations.find((operation, index) => (
      operation.markerChar
      && session.workingAscii.includes(operation.markerChar)
      && !appliedOperations.slice(index + 1).some((candidate) => candidate.kind === "llm")
    ));
    if (unresolvedMarker) throw new Error(`resolve ${unresolvedMarker.markerToken} before saving`);
    const set = await this.store.loadDiagramSet(setId);
    const { artifact: source } = await this.artifactForDiagramSet(
      setId,
      session.sourceArtifactKind,
      session.sourceArtifactId
    );
    const name = `${source.name} Edit`.slice(0, 120);
    const existing = session.sourceArtifactKind === "diagram"
      ? await Promise.all(set.diagramIds.map((id) => this.store.loadDiagram(setId, id)))
      : await Promise.all(set.diagramComponentIds.map((id) => this.store.loadDiagramComponent(setId, id)));
    const library = await this.store.loadImportedArtifactLibrary();
    const imported = session.sourceArtifactKind === "diagram"
      ? await Promise.all(library.diagramIds.map((id) => this.store.loadImportedDiagram(id)))
      : await Promise.all(
        library.diagramComponentIds.map((id) => this.store.loadImportedDiagramComponent(id))
      );
    const handles = new Set([...existing, ...imported].map((artifact) => artifact.handle));
    const baseHandle = slugify(name, session.sourceArtifactKind === "diagram" ? "diagram-edit" : "component-edit");
    let handle = baseHandle;
    let suffix = 2;
    while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;
    let outputArtifactId: string;
    if (session.sourceArtifactKind === "diagram") {
      outputArtifactId = this.store.ids.diagram();
      await this.store.addDiagram({
        schemaVersion: SCHEMA_VERSION,
        id: outputArtifactId,
        recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
        diagramSetId: setId,
        viewKind: (source as DiagramRecord).viewKind,
        ...((source as DiagramRecord).basedOnDiagramId
          ? { basedOnDiagramId: (source as DiagramRecord).basedOnDiagramId }
          : {}),
        handle,
        name,
        ascii: session.workingAscii,
        codeEntityIds: [...session.codeEntityIds],
        origin: "edited",
        generationPromptConfigId: source.generationPromptConfigId,
        editSessionId: session.id,
        derivedFromDiagramIds: [source.id],
        createdAt: timestamp()
      });
    } else {
      const component = source as DiagramComponentRecord;
      outputArtifactId = this.store.ids.diagramComponent();
      await this.store.addDiagramComponent({
        schemaVersion: SCHEMA_VERSION,
        id: outputArtifactId,
        recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
        diagramSetId: setId,
        handle,
        name,
        ascii: session.workingAscii,
        codeEntityIds: [...session.codeEntityIds],
        origin: "edited",
        generationPromptConfigId: component.generationPromptConfigId,
        sourceDiagramId: component.sourceDiagramId,
        sourceDiagramComponentId: component.id,
        editSessionId: session.id,
        derivedFromDiagramIds: [...component.derivedFromDiagramIds],
        derivedFromDiagramComponentIds: [component.id],
        createdAt: timestamp()
      });
    }
    await this.store.saveEditSession({
      ...session,
      status: "committed",
      outputArtifactId,
      revision: session.revision + 1,
      updatedAt: timestamp()
    });
    return this.workspace();
  }

  async discardEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    await this.store.saveEditSession({
      ...session,
      status: "discarded",
      revision: session.revision + 1,
      updatedAt: timestamp()
    });
    return this.workspace();
  }

  async captureNestedDiagramComponent(
    setId: string,
    componentId: string,
    bounds: DiagramSelectionBounds
  ): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    const { artifact } = await this.artifactForDiagramSet(
      setId,
      "diagram-component",
      componentId
    );
    const component = artifact as DiagramComponentRecord;
    if (isDiagramComponentArchived(component)) {
      throw new Error("archived DiagramComponents cannot be captured");
    }
    return this.captureComponentSelection(set, { kind: "diagram-component", artifact: component }, bounds);
  }

  private async captureComponentSelection(
    set: DiagramSetRecord,
    source:
      | { kind: "diagram"; artifact: DiagramRecord }
      | { kind: "diagram-component"; artifact: DiagramComponentRecord },
    bounds: DiagramSelectionBounds
  ): Promise<WorkspaceSnapshot> {
    const { ascii, selection } = cropAsciiSelection(source.artifact.ascii, bounds);
    const existing = await Promise.all(
      set.diagramComponentIds.map((id) => this.store.loadDiagramComponent(set.id, id))
    );
    const sequence = existing.length + 1;
    const library = await this.store.loadImportedArtifactLibrary();
    const imported = await Promise.all(
      library.diagramComponentIds.map((id) => this.store.loadImportedDiagramComponent(id))
    );
    const handles = new Set([...existing, ...imported].map((component) => component.handle));
    const baseHandle = slugify(
      `${source.artifact.handle}-component-${sequence}`,
      `component-${sequence}`
    );
    let handle = baseHandle;
    let suffix = 2;
    while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;
    const component: DiagramComponentRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: this.store.ids.diagramComponent(),
      recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
      diagramSetId: set.id,
      handle,
      name: `${source.artifact.name} - Component ${sequence}`,
      ascii,
      codeEntityIds: [...source.artifact.codeEntityIds],
      origin: "selection",
      ...(source.kind === "diagram"
        ? { sourceDiagramId: source.artifact.id }
        : {
          sourceDiagramId: source.artifact.sourceDiagramId,
          sourceDiagramComponentId: source.artifact.id
        }),
      selectionBounds: selection,
      derivedFromDiagramIds: source.kind === "diagram"
        ? [source.artifact.id]
        : [...source.artifact.derivedFromDiagramIds],
      derivedFromDiagramComponentIds: source.kind === "diagram-component"
        ? [source.artifact.id]
        : [],
      createdAt: timestamp()
    };
    await this.store.addDiagramComponent(component);
    return this.workspace();
  }

  async generate(
    setId: string,
    input: {
      prompt: string;
      selectedCodeEntityIds: string[];
      count: number;
      outputKind: GenerationOutputKind;
      viewKind?: DiagramViewKind;
      modelId?: unknown;
      promptProfileId?: unknown;
      referenceSelections?: GenerationReferenceSelection[];
      derivation?: GenerationDerivationRecord;
    },
    onEvent?: (event: ServiceEvent) => void
  ): Promise<WorkspaceSnapshot> {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_GENERATION_COUNT) {
      throw new Error(`output count must be between 1 and ${MAX_GENERATION_COUNT}`);
    }
    if (input.outputKind !== "diagram" && input.outputKind !== "diagram-component") {
      throw new Error("output kind must be diagram or diagram-component");
    }
    if (input.outputKind === "diagram" && !isDiagramViewKind(input.viewKind ?? "diagram")) {
      throw new Error("view kind must be diagram, call-graph, or dir-view");
    }
    if (input.outputKind === "diagram-component" && input.viewKind !== undefined) {
      throw new Error("DiagramComponents do not have a view kind");
    }
    const modelId = input.modelId ?? DEFAULT_DIAGRAM_MODEL_ID;
    if (!isDiagramModelId(modelId)) throw new Error(`unsupported generation model: ${String(modelId)}`);
    if (this.activeBatches.has(setId)) throw new Error("a generation batch is already active for this DiagramSet");
    this.activeBatches.add(setId);
    try {
      const set = await this.store.loadDiagramSet(setId);
      const entities = await this.store.loadCodeEntities(setId);
      const promptProfile = await this.resolveSystemPromptTemplate(input.promptProfileId);
      if (entities.status !== "finalized" || set.readiness !== "ready") {
        throw new Error("CodeEntitiesSet must be finalized before generation");
      }
      const storedDiagrams = await Promise.all(set.diagramIds.map((id) => this.store.loadDiagram(setId, id)));
      const library = await this.store.loadImportedArtifactLibrary();
      const importedCodeEntities = await Promise.all(
        (library.codeEntityIds ?? []).map((id) => this.store.loadImportedCodeEntity(id))
      );
      const importedDiagrams = await Promise.all(
        library.diagramIds.map((id) => this.store.loadImportedDiagram(id))
      );
      const existingDiagrams = [...storedDiagrams, ...importedDiagrams]
        .filter((diagram) => !isDiagramArchived(diagram));
      const storedComponents = await Promise.all(
        set.diagramComponentIds.map((id) => this.store.loadDiagramComponent(setId, id))
      );
      const importedComponents = await Promise.all(
        library.diagramComponentIds.map((id) => this.store.loadImportedDiagramComponent(id))
      );
      const existingComponents = [...storedComponents, ...importedComponents].filter(
        (component) => !isDiagramComponentArchived(component)
      );
      const createdAt = timestamp();
      const promptBuild = createGenerationPromptConfig({
        id: this.store.ids.promptConfig(),
        diagramSet: set,
        codeEntities: {
          ...entities,
          entities: [...entities.entities, ...importedCodeEntities]
        },
        diagrams: [...storedDiagrams, ...importedDiagrams],
        components: [...storedComponents, ...importedComponents],
        outputKind: input.outputKind,
        viewKind: input.viewKind,
        modelId,
        profile: promptProfile,
        instruction: input.prompt,
        selectedCodeEntityIds: input.selectedCodeEntityIds,
        referenceSelections: input.referenceSelections,
        derivation: input.derivation,
        createdAt
      });
      const promptConfig = promptBuild.config;
      const batchId = this.store.ids.batch();
      let batch: GenerationBatchRecord = {
        schemaVersion: SCHEMA_VERSION,
        id: batchId,
        diagramSetId: setId,
        requestedCount: input.count,
        promptConfigId: promptConfig.id,
        codeEntitiesRevision: entities.revision,
        childRunIds: [],
        outputDiagramIds: [],
        outputDiagramComponentIds: [],
        status: "queued",
        createdAt,
        updatedAt: createdAt
      };
      let runs: AgentRunRecord[] = Array.from({ length: input.count }, (_, index) => ({
        schemaVersion: SCHEMA_VERSION,
        id: this.store.ids.run(),
        diagramSetId: setId,
        kind: input.outputKind === "diagram"
          ? "generate-one-diagram"
          : "generate-one-diagram-component",
        status: "queued",
        statusMessage: `queued parallel slot ${index + 1}`,
        generationBatchId: batchId,
        outputSlot: index + 1,
        codeEntitiesRevision: entities.revision,
        outputCodeEntityIds: [],
        startedAt: createdAt,
        updatedAt: createdAt
      }));
      batch = { ...batch, childRunIds: runs.map((run) => run.id) };
      await this.store.beginBatch(promptConfig, batch, runs);
      const persistedPromptConfig = await this.store.loadGenerationPromptConfig(
        setId,
        promptConfig.id
      );
      batch = { ...batch, status: "running", updatedAt: timestamp() };
      await this.store.saveBatch(batch);
      const outputViewKind = input.outputKind === "diagram" ? input.viewKind ?? "diagram" : undefined;
      const outputLabel = input.outputKind === "diagram-component"
        ? "component"
        : outputViewKind === "call-graph"
          ? "call graph"
          : outputViewKind === "dir-view"
            ? "directory view"
            : "diagram";
      onEvent?.({ type: "progress", message: `started ${input.count} parallel ${outputLabel} agents` });

      const accepted = new Map<number, GeneratedArtifactDraft>();
      let pending = runs.map((_, index) => index);
      let lastErrors = new Map<number, string>();
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt += 1) {
        const results: Array<{ index: number; draft: GeneratedArtifactDraft } | { index: number; error: string }> = await Promise.all(pending.map(async (index) => {
          const run = runs[index];
          const setRun = (update: Partial<AgentRunRecord>) => {
            runs[index] = { ...runs[index], ...update, updatedAt: timestamp() };
            void this.store.saveRun(runs[index]);
          };
          try {
            const draft = await this.agents.generateArtifact({
              sourceRoot: set.sourceCheckoutRoot,
              diagramSetName: set.name,
              promptConfig: persistedPromptConfig,
              allowedCodeEntityIds: promptBuild.allowedCodeEntityIds,
              allowedDiagramIds: promptBuild.allowedDiagramIds,
              allowedDiagramComponentIds: promptBuild.allowedDiagramComponentIds,
              slot: index + 1,
              total: input.count
            }, (progress) => {
              setRun({
                status: progress.status,
                statusMessage: progress.message,
                model: progress.model ?? run.model,
                sessionId: progress.sessionId ?? run.sessionId
              });
              onEvent?.({ type: "progress", message: `slot ${index + 1}: ${progress.message}` });
            });
            this.validateGeneratedArtifactDraft(draft, promptBuild.allowedCodeEntityIds);
            return { index, draft };
          } catch (error) {
            return { index, error: error instanceof Error ? error.message : "diagram generation failed" };
          }
        }));

        const usedAscii = new Set([...accepted.values()].map((draft) => normalizeAscii(draft.ascii)));
        const retry: number[] = [];
        lastErrors = new Map();
        for (const result of results) {
          if ("error" in result) {
            retry.push(result.index);
            lastErrors.set(result.index, result.error);
            continue;
          }
          const normalized = normalizeAscii(result.draft.ascii);
          if (usedAscii.has(normalized)) {
            retry.push(result.index);
            lastErrors.set(result.index, "duplicate normalized ASCII output");
            continue;
          }
          usedAscii.add(normalized);
          accepted.set(result.index, { ...result.draft, ascii: normalized });
        }
        pending = retry;
        for (const index of pending) {
          runs[index] = {
            ...runs[index],
            status: attempt === MAX_ATTEMPTS ? "failed" : "queued",
            statusMessage: lastErrors.get(index) ?? "invalid diagram result",
            error: lastErrors.get(index),
            updatedAt: timestamp(),
            ...(attempt === MAX_ATTEMPTS ? { completedAt: timestamp() } : {})
          };
          await this.store.saveRun(runs[index]);
        }
      }

      if (accepted.size !== input.count) {
        const message = [...lastErrors.entries()]
          .map(([index, error]) => `slot ${index + 1}: ${error}`)
          .join("; ") || "one or more diagram agents failed";
        batch = { ...batch, status: "failed", error: message, updatedAt: timestamp() };
        await this.store.saveBatch(batch);
        throw new Error(message);
      }

      batch = { ...batch, status: "validating", updatedAt: timestamp() };
      await this.store.saveBatch(batch);
      onEvent?.({ type: "progress", message: "validating complete parallel batch" });
      const derivedFromDiagramIds = promptConfig.references
        .filter((reference) => reference.kind === "diagram")
        .map((reference) => reference.targetId);
      const sameViewDerivedFromDiagramIds = input.outputKind === "diagram"
        ? derivedFromDiagramIds.filter((id) => existingDiagrams.find(
          (diagram) => diagram.id === id && diagram.viewKind === outputViewKind
        ))
        : derivedFromDiagramIds;
      const derivedFromDiagramComponentIds = promptConfig.references
        .filter((reference) => reference.kind === "diagram-component")
        .map((reference) => reference.targetId);
      const handles = new Set((input.outputKind === "diagram" ? existingDiagrams : existingComponents)
        .map((artifact) => artifact.handle));
      const generated = runs.map((run, index) => {
        const draft = accepted.get(index)!;
        const sequence = input.outputKind === "diagram"
          ? set.diagramIds.length + index + 1
          : set.diagramComponentIds.length + index + 1;
        const base = slugify(draft.name, `${outputLabel}-${sequence}`);
        let handle = base;
        let suffix = 2;
        while (handles.has(handle)) {
          handle = `${base}-${suffix}`;
          suffix += 1;
        }
        handles.add(handle);
        return { run, draft, handle };
      });
      const diagrams: DiagramRecord[] = input.outputKind === "diagram"
        ? generated.map(({ run, draft, handle }) => ({
          schemaVersion: SCHEMA_VERSION,
          id: this.store.ids.diagram(),
          recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
          diagramSetId: setId,
          viewKind: outputViewKind!,
          ...(outputViewKind !== "diagram" && set.featuredViewIds.diagram
            ? { basedOnDiagramId: set.featuredViewIds.diagram }
            : {}),
          handle,
          name: draft.name.trim(),
          ascii: normalizeAscii(draft.ascii),
          codeEntityIds: [...new Set(draft.codeEntityIds)],
          origin: "generated",
          producedByRunId: run.id,
          generationPromptConfigId: promptConfig.id,
          derivedFromDiagramIds: [...new Set(sameViewDerivedFromDiagramIds)],
          createdAt: timestamp()
        }))
        : [];
      const components: DiagramComponentRecord[] = input.outputKind === "diagram-component"
        ? generated.map(({ run, draft, handle }) => ({
          schemaVersion: SCHEMA_VERSION,
          id: this.store.ids.diagramComponent(),
          recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
          diagramSetId: setId,
          handle,
          name: draft.name.trim(),
          ascii: normalizeAscii(draft.ascii),
          codeEntityIds: [...new Set(draft.codeEntityIds)],
          origin: "generated",
          producedByRunId: run.id,
          generationPromptConfigId: promptConfig.id,
          derivedFromDiagramIds: [...new Set(derivedFromDiagramIds)],
          derivedFromDiagramComponentIds: [...new Set(derivedFromDiagramComponentIds)],
          createdAt: timestamp()
        }))
        : [];
      runs = runs.map((run, index) => ({
        ...run,
        status: "complete",
        statusMessage: `${outputLabel} committed`,
        outputCodeEntityIds: (diagrams[index] ?? components[index]).codeEntityIds,
        ...(input.outputKind === "diagram"
          ? { outputDiagramId: diagrams[index].id }
          : { outputDiagramComponentId: components[index].id }),
        error: undefined,
        updatedAt: timestamp(),
        completedAt: timestamp()
      }));
      batch = {
        ...batch,
        status: "complete",
        outputDiagramIds: diagrams.map((diagram) => diagram.id),
        outputDiagramComponentIds: components.map((component) => component.id),
        error: undefined,
        updatedAt: timestamp()
      };
      await this.store.completeBatch(batch, runs, diagrams, components);
      const workspace = await this.workspace();
      onEvent?.({
        type: "workspace",
        message: `generated ${input.count} ${outputLabel}${input.count === 1 ? "" : "s"}`,
        workspace
      });
      return workspace;
    } finally {
      this.activeBatches.delete(setId);
    }
  }

  async saveSystemPromptTemplate(input: {
    id?: unknown;
    label: unknown;
    description: unknown;
    prompts: unknown;
  }): Promise<WorkspaceSnapshot> {
    const label = typeof input.label === "string" ? input.label.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const prompts = input.prompts && typeof input.prompts === "object"
      ? input.prompts as Record<string, unknown>
      : {};
    const diagramPrompt = typeof prompts.diagram === "string" ? prompts.diagram.trim() : "";
    const callGraphPrompt = typeof prompts["call-graph"] === "string"
      ? prompts["call-graph"].trim()
      : "";
    const dirViewPrompt = typeof prompts["dir-view"] === "string"
      ? prompts["dir-view"].trim()
      : "";
    const componentPrompt = typeof prompts["diagram-component"] === "string"
      ? prompts["diagram-component"].trim()
      : "";
    if (!label) throw new Error("template name is required");
    if (label.length > 80) throw new Error("template name cannot exceed 80 characters");
    if (description.length > 240) throw new Error("template description cannot exceed 240 characters");
    if (!diagramPrompt || !callGraphPrompt || !dirViewPrompt || !componentPrompt) {
      throw new Error("all generation system prompts are required");
    }
    if ([diagramPrompt, callGraphPrompt, dirViewPrompt, componentPrompt]
      .some((prompt) => prompt.length > 32000)) {
      throw new Error("system prompts cannot exceed 32,000 characters");
    }
    renderSystemPromptTemplate(diagramPrompt, "diagram");
    renderSystemPromptTemplate(callGraphPrompt, "call-graph");
    renderSystemPromptTemplate(dirViewPrompt, "dir-view");
    renderSystemPromptTemplate(componentPrompt, "diagram-component");

    const templates = await this.store.loadSystemPromptTemplates();
    const requestedId = typeof input.id === "string" ? input.id : undefined;
    const existing = requestedId ? templates.find((template) => template.id === requestedId) : undefined;
    if (requestedId && !existing) throw new Error(`unknown system prompt template: ${requestedId}`);
    const timestampValue = timestamp();
    let id = existing?.id ?? slugify(label, "custom-prompt");
    if (!existing) {
      const ids = new Set(templates.map((template) => template.id));
      const baseId = id;
      let suffix = 2;
      while (ids.has(id)) id = `${baseId}-${suffix++}`;
    }
    const template: SystemPromptTemplateRecord = {
      schemaVersion: SCHEMA_VERSION,
      id,
      label,
      description,
      builtIn: existing?.builtIn ?? false,
      version: (existing?.version ?? 0) + 1,
      prompts: {
        diagram: diagramPrompt,
        "call-graph": callGraphPrompt,
        "dir-view": dirViewPrompt,
        "diagram-component": componentPrompt
      },
      createdAt: existing?.createdAt ?? timestampValue,
      updatedAt: timestampValue
    };
    await this.store.saveSystemPromptTemplates(existing
      ? templates.map((candidate) => candidate.id === id ? template : candidate)
      : [...templates, template]);
    return this.workspace();
  }

  async resetSystemPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
    const templates = await this.store.loadSystemPromptTemplates();
    const existing = templates.find((template) => template.id === id);
    if (!existing?.builtIn) throw new Error(`built-in system prompt template not found: ${id}`);
    const original = createBuiltInSystemPromptTemplates(existing.createdAt)
      .find((template) => template.id === id);
    if (!original) throw new Error(`built-in system prompt template not found: ${id}`);
    const reset: SystemPromptTemplateRecord = {
      ...original,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: timestamp()
    };
    await this.store.saveSystemPromptTemplates(
      templates.map((template) => template.id === id ? reset : template)
    );
    return this.workspace();
  }

  async deleteSystemPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
    const templates = await this.store.loadSystemPromptTemplates();
    const existing = templates.find((template) => template.id === id);
    if (!existing) throw new Error(`unknown system prompt template: ${id}`);
    if (templates.length === 1) throw new Error("at least one system prompt template is required");
    await this.store.saveSystemPromptTemplates(
      templates.filter((template) => template.id !== id)
    );
    return this.workspace();
  }

  async saveCodeEntityPromptTemplate(input: {
    id?: unknown;
    label: unknown;
    description: unknown;
    prompts: unknown;
  }): Promise<WorkspaceSnapshot> {
    const label = typeof input.label === "string" ? input.label.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const prompts = input.prompts && typeof input.prompts === "object"
      ? input.prompts as Record<string, unknown>
      : {};
    const identificationCriteria = typeof prompts["code-entity-identification"] === "string"
      ? prompts["code-entity-identification"].trim()
      : "";
    const compactionCriteria = typeof prompts["code-entity-compaction"] === "string"
      ? prompts["code-entity-compaction"].trim()
      : "";
    if (!label) throw new Error("template name is required");
    if (label.length > 80) throw new Error("template name cannot exceed 80 characters");
    if (description.length > 240) throw new Error("template description cannot exceed 240 characters");
    if (!identificationCriteria || !compactionCriteria) {
      throw new Error("identification and compaction criteria are required");
    }
    if (identificationCriteria.length > 32000 || compactionCriteria.length > 32000) {
      throw new Error("CodeEntity criteria cannot exceed 32,000 characters");
    }

    const templates = await this.store.loadCodeEntityPromptTemplates();
    const requestedId = typeof input.id === "string" ? input.id : undefined;
    const existing = requestedId ? templates.find((template) => template.id === requestedId) : undefined;
    if (requestedId && !existing) throw new Error(`unknown CodeEntity prompt template: ${requestedId}`);
    const timestampValue = timestamp();
    let id = existing?.id ?? slugify(label, "custom-code-entities");
    if (!existing) {
      const ids = new Set(templates.map((template) => template.id));
      const baseId = id;
      let suffix = 2;
      while (ids.has(id)) id = `${baseId}-${suffix++}`;
    }
    const template: CodeEntityPromptTemplateRecord = {
      schemaVersion: SCHEMA_VERSION,
      id,
      label,
      description,
      builtIn: existing?.builtIn ?? false,
      version: (existing?.version ?? 0) + 1,
      prompts: {
        "code-entity-identification": identificationCriteria,
        "code-entity-compaction": compactionCriteria
      },
      createdAt: existing?.createdAt ?? timestampValue,
      updatedAt: timestampValue
    };
    await this.store.saveCodeEntityPromptTemplates(existing
      ? templates.map((candidate) => candidate.id === id ? template : candidate)
      : [...templates, template]);
    return this.workspace();
  }

  async resetCodeEntityPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
    const templates = await this.store.loadCodeEntityPromptTemplates();
    const existing = templates.find((template) => template.id === id);
    if (!existing?.builtIn) throw new Error(`built-in CodeEntity prompt template not found: ${id}`);
    const original = createBuiltInCodeEntityPromptTemplates(existing.createdAt)
      .find((template) => template.id === id);
    if (!original) throw new Error(`built-in CodeEntity prompt template not found: ${id}`);
    const reset: CodeEntityPromptTemplateRecord = {
      ...original,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: timestamp()
    };
    await this.store.saveCodeEntityPromptTemplates(
      templates.map((template) => template.id === id ? reset : template)
    );
    return this.workspace();
  }

  async deleteCodeEntityPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
    const templates = await this.store.loadCodeEntityPromptTemplates();
    const existing = templates.find((template) => template.id === id);
    if (!existing) throw new Error(`unknown CodeEntity prompt template: ${id}`);
    if (templates.length === 1) throw new Error("at least one CodeEntity prompt template is required");
    await this.store.saveCodeEntityPromptTemplates(
      templates.filter((template) => template.id !== id)
    );
    return this.workspace();
  }

  private validateGeneratedArtifactDraft(
    draft: GeneratedArtifactDraft,
    allowedCodeEntityIds: string[]
  ): void {
    if (!draft.name.trim()) throw new Error("generated artifact name cannot be blank");
    assertSevenBitAscii(draft.ascii);
    const allowedEntities = new Set(allowedCodeEntityIds);
    for (const id of draft.codeEntityIds) {
      if (!allowedEntities.has(id)) throw new Error(`artifact references unavailable CodeEntity: ${id}`);
    }
  }

  async sourceSnippet(setId: string, entityId: string, rangeIndex: number): Promise<{
    path: string;
    startLine: number;
    lines: string[];
  }> {
    const set = await this.store.loadDiagramSet(setId);
    const entities = await this.store.loadCodeEntities(setId);
    const entity = entities.entities.find((candidate) => candidate.id === entityId);
    if (!entity) throw new Error(`unknown CodeEntity: ${entityId}`);
    const range = entity.sourceRanges[rangeIndex];
    if (!range) throw new Error("unknown source range");
    assertSourceRange(range);
    const root = await realpath(set.sourceCheckoutRoot);
    const absolute = await realpath(path.resolve(root, range.path));
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error("source range escapes repository root");
    }
    const lines = (await readFile(absolute, "utf8")).split(/\r?\n/);
    if (range.originalLines) {
      const start = range.startLine - 1;
      while (lines.length < start) lines.push("");
      lines.splice(start, range.endLine - range.startLine + 1, ...range.originalLines);
    }
    return {
      path: range.path,
      startLine: 1,
      lines
    };
  }

  workspace(): Promise<WorkspaceSnapshot> {
    return this.store.loadWorkspace();
  }

  async recoverInterruptedRuns(): Promise<void> {
    const workspace = await this.workspace();
    for (const run of Object.values(workspace.agentRuns)) {
      if (["queued", "reading-context", "generating", "validating"].includes(run.status)) {
        await this.store.saveRun({
          ...run,
          status: "interrupted",
          statusMessage: "server restarted before the run completed",
          error: "interrupted by server restart",
          updatedAt: timestamp(),
          completedAt: timestamp()
        });
      }
    }
    for (const batch of Object.values(workspace.generationBatches)) {
      if (["queued", "running", "validating"].includes(batch.status)) {
        await this.store.saveBatch({
          ...batch,
          status: "failed",
          error: "interrupted by server restart",
          updatedAt: timestamp()
        });
      }
    }
  }

  dispose(): void {
    this.agents.dispose();
  }
}
