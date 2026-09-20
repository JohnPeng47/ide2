import { createHash } from "node:crypto";
import path from "node:path";
import { validateDiagramMappings } from "../../../domain/core/diagrams/diagramMapping";
import { isBuiltInDomainProfileId, resolveDomainProfile } from "../../../domain/core/profiles/domainProfiles";
import {
  CodeEntity,
  SCHEMA_VERSION,
  assertSevenBitAscii,
  assertSourceRange,
  isDiagramViewKind,
  normalizeAscii,
  slugify,
  type AgentProgress,
  type AgentRunRecord,
  type CodeEntityDraft,
  type CodeEntityRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type DiagramViewKind,
  type MaterializedDiagramSetInput,
  type MaterializedDiagramSetResult,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import type { RepositoryLocation } from "../../core/corpus/location";
import { promoteProjectRepresentation } from '../candidates/service';
import type { StudioContext } from '../context';
import { createCodeEntityPromptConfig } from "../generation/codeEntityPrompt";
import { resolveCodeEntityPromptTemplate } from '../prompt-settings/service';
import { ServiceEvent, assertMaterializedKey, timestamp } from '../shared';

export async function createDiagramSet(context: StudioContext, input: {
  path: string;
  name: string;
  prompt: string;
  domainProfileId?: unknown;
}): Promise<DiagramSetRecord> {
  if (!input.name.trim()) throw new Error("DiagramSet name is required");
  const location = await validateDiagramSetTarget(context, input.path, input.domainProfileId);
  const project = await context.store.ensureProject(location);
  const created = await context.store.createDiagramSet({
    project,
    name: input.name,
    initialPrompt: input.prompt,
    location,
    creationMode: "generate"
  });
  return created.diagramSet;
}

export async function createMaterializedDiagramSet(context: StudioContext, input: MaterializedDiagramSetInput): Promise<MaterializedDiagramSetResult> {
  if (!input || input.creationMode !== "materialized") {
    throw new Error("materialized DiagramSet creation requires creationMode=materialized");
  }
  if (typeof input.path !== "string" || !input.path) throw new Error("corpus path is required");
  if (typeof input.name !== "string" || !input.name.trim()) throw new Error("DiagramSet name is required");
  if (input.name.trim().length > 120) throw new Error("DiagramSet name cannot exceed 120 characters");
  if (!Array.isArray(input.codeEntities) || input.codeEntities.length === 0) {
    throw new Error("materialized DiagramSet creation requires at least one CodeEntity");
  }
  if (!Array.isArray(input.diagrams) || input.diagrams.length === 0) {
    throw new Error("materialized DiagramSet creation requires at least one ASCII Diagram");
  }
  if (input.codeEntities.length > 500) throw new Error("a materialized DiagramSet cannot exceed 500 CodeEntities");
  if (input.diagrams.length > 100) throw new Error("a materialized DiagramSet cannot exceed 100 Diagrams");

  const entityKeys = new Set<string>();
  for (const [entityIndex, entity] of input.codeEntities.entries()) {
    if (!entity || typeof entity !== "object") throw new Error(`CodeEntity ${entityIndex + 1} is invalid`);
    assertMaterializedKey(entity.key, `CodeEntity ${entityIndex + 1} key`);
    if (entityKeys.has(entity.key)) throw new Error(`duplicate CodeEntity key: ${entity.key}`);
    entityKeys.add(entity.key);
    if (!Array.isArray(entity.sourceRanges) || entity.sourceRanges.length === 0) {
      throw new Error(`CodeEntity ${entity.key} must include at least one source range`);
    }
    const rangeKeys = new Set<string>();
    for (const [rangeIndex, range] of entity.sourceRanges.entries()) {
      if (!range || typeof range !== "object") {
        throw new Error(`CodeEntity ${entity.key} source range ${rangeIndex + 1} is invalid`);
      }
      assertMaterializedKey(range.key, `CodeEntity ${entity.key} source range key`);
      if (rangeKeys.has(range.key)) {
        throw new Error(`duplicate source range key for CodeEntity ${entity.key}: ${range.key}`);
      }
      rangeKeys.add(range.key);
    }
  }

  const diagramKeys = new Set<string>();
  for (const [diagramIndex, diagram] of input.diagrams.entries()) {
    if (!diagram || typeof diagram !== "object") throw new Error(`Diagram ${diagramIndex + 1} is invalid`);
    assertMaterializedKey(diagram.key, `Diagram ${diagramIndex + 1} key`);
    if (diagramKeys.has(diagram.key)) throw new Error(`duplicate Diagram key: ${diagram.key}`);
    diagramKeys.add(diagram.key);
    if (!Array.isArray(diagram.codeEntityKeys) || diagram.codeEntityKeys.length === 0) {
      throw new Error(`materialized Diagram ${diagram.key} must include at least one CodeEntity`);
    }
    for (const entityKey of diagram.codeEntityKeys) {
      if (typeof entityKey !== "string" || !entityKeys.has(entityKey)) {
        throw new Error(`Diagram ${diagram.key} references unknown CodeEntity key: ${String(entityKey)}`);
      }
    }
    if (diagram.mappings !== undefined && !Array.isArray(diagram.mappings)) {
      throw new Error(`Diagram ${diagram.key} mappings must be an array`);
    }
  }

  const location = await validateDiagramSetTarget(context, input.path, input.domainProfileId);
  const project = await context.store.ensureProject(location);
  const { diagramSet } = await context.store.createDiagramSet({
    project,
    name: input.name,
    initialPrompt: typeof input.description === "string" ? input.description : "",
    location,
    creationMode: "materialized"
  });

  try {
    const entityDrafts: CodeEntityDraft[] = input.codeEntities.map((entity) => ({
      handle: entity.handle,
      label: entity.label,
      category: entity.category,
      summary: entity.summary,
      sourceRanges: entity.sourceRanges.map(({ key: _key, ...range }) => range)
    }));
    const entities = await validateEntityDrafts(context, diagramSet, entityDrafts);
    const entityByKey = new Map(input.codeEntities.map((entity, index) => [entity.key, entities[index]]));
    const codeEntityIdsByKey = Object.fromEntries(
      [...entityByKey].map(([key, entity]) => [key, entity.id])
    );
    const profile = resolveDomainProfile(diagramSet.source?.domainProfileId ?? "source-code");
    const diagramHandles = new Set<string>();
    const createdAt = timestamp();
    const diagrams: DiagramRecord[] = [];
    const maps: DiagramCodeEntityMapRecord[] = [];
    const diagramIdsByKey: Record<string, string> = {};

    for (const [index, supplied] of input.diagrams.entries()) {
      if (typeof supplied.name !== "string" || !supplied.name.trim()) {
        throw new Error(`Diagram ${supplied.key} name is required`);
      }
      if (supplied.name.trim().length > 120) {
        throw new Error(`Diagram ${supplied.key} name cannot exceed 120 characters`);
      }
      if (typeof supplied.ascii !== "string" || !supplied.ascii.trim()) {
        throw new Error(`Diagram ${supplied.key} ASCII is required`);
      }
      const ascii = normalizeAscii(supplied.ascii);
      assertSevenBitAscii(ascii);
      if (ascii.length > 20000) throw new Error(`Diagram ${supplied.key} ASCII cannot exceed 20,000 characters`);
      const viewKind = supplied.viewKind ?? "diagram";
      if (!isDiagramViewKind(viewKind) || !profile.workspace.diagramViews.includes(viewKind)) {
        throw new Error(`Diagram ${supplied.key} view kind is unavailable in the ${profile.id} domain`);
      }
      if (supplied.representationKind !== undefined
        && supplied.representationKind !== "tree"
        && supplied.representationKind !== "diagram") {
        throw new Error(`Diagram ${supplied.key} representation kind is invalid`);
      }
      const representationKind = supplied.representationKind
        ?? (viewKind === "diagram" ? "diagram" : "tree");
      const selectedEntities = [...new Set(supplied.codeEntityKeys)].map((key) => entityByKey.get(key)!);
      let handle = slugify(supplied.handle || supplied.name, `diagram-${index + 1}`);
      const baseHandle = handle;
      let suffix = 2;
      while (diagramHandles.has(handle)) handle = `${baseHandle}-${suffix++}`;
      diagramHandles.add(handle);
      const id = context.store.ids.diagram();
      diagramIdsByKey[supplied.key] = id;
      const diagram: DiagramRecord = {
        schemaVersion: SCHEMA_VERSION,
        id,
        recordOrigin: { projectId: project.id, diagramSetId: diagramSet.id },
        diagramSetId: diagramSet.id,
        viewKind,
        handle,
        name: supplied.name.trim(),
        ascii,
        representationKind,
        codeEntityIds: selectedEntities.map((entity) => entity.id),
        origin: "materialized",
        derivedFromDiagramIds: [],
        createdAt
      };
      diagrams.push(diagram);

      if (supplied.mappings !== undefined) {
        const selectedKeys = new Set(supplied.codeEntityKeys);
        const drafts = supplied.mappings.map((mapping, mappingIndex) => {
          if (!mapping || typeof mapping !== "object") {
            throw new Error(`Diagram ${supplied.key} mapping ${mappingIndex + 1} is invalid`);
          }
          if (!selectedKeys.has(mapping.entityKey)) {
            throw new Error(
              `Diagram ${supplied.key} mapping references a CodeEntity not included by the Diagram: ${mapping.entityKey}`
            );
          }
          const sourceEntity = input.codeEntities.find((entity) => entity.key === mapping.entityKey)!;
          const sourceRangeIndex = sourceEntity.sourceRanges.findIndex(
            (range) => range.key === mapping.sourceRangeKey
          );
          if (sourceRangeIndex < 0) {
            throw new Error(
              `Diagram ${supplied.key} mapping references unknown source range ${mapping.sourceRangeKey} for ${mapping.entityKey}`
            );
          }
          return {
            entityId: entityByKey.get(mapping.entityKey)!.id,
            sourceRangeIndex,
            line: mapping.line,
            startColumn: mapping.startColumn,
            endColumn: mapping.endColumn
          };
        });
        maps.push({
          schemaVersion: SCHEMA_VERSION,
          diagramSetId: diagramSet.id,
          artifactKind: "diagram",
          artifactId: diagram.id,
          asciiSha256: createHash("sha256").update(diagram.ascii).digest("hex"),
          mappings: validateDiagramMappings(diagram.ascii, drafts, selectedEntities),
          origin: "materialized",
          createdAt
        });
      }
    }

    const featuredViewIds: Partial<Record<DiagramViewKind, string>> = {};
    if (input.featuredViews !== undefined) {
      if (!input.featuredViews || typeof input.featuredViews !== "object") {
        throw new Error("featuredViews must be an object");
      }
      for (const [kind, key] of Object.entries(input.featuredViews)) {
        if (!isDiagramViewKind(kind) || typeof key !== "string") {
          throw new Error("featuredViews contains an invalid view kind or Diagram key");
        }
        const id = diagramIdsByKey[key];
        const diagram = diagrams.find((candidate) => candidate.id === id);
        if (!diagram || diagram.viewKind !== kind) {
          throw new Error(`featured ${kind} view references an unavailable Diagram: ${key}`);
        }
        featuredViewIds[kind] = id;
      }
    }

    await context.store.completeCollection(diagramSet.id, entities);
    for (const diagram of diagrams) await context.store.addDiagram(diagram);
    for (const mapping of maps) await context.store.saveCodeEntityMap(mapping);
    for (const id of Object.values(featuredViewIds)) {
      await promoteProjectRepresentation(context, {
        diagramSetId: diagramSet.id,
        diagramId: id,
        makeActive: true
      });
    }
    return {
      diagramSetId: diagramSet.id,
      codeEntityIdsByKey,
      diagramIdsByKey,
      workspace: await context.core.workspace()
    };
  } catch (error) {
    await context.store.moveDiagramSetToTrash(diagramSet.id).catch(() => undefined);
    throw error;
  }
}

export async function validateDiagramSetTarget(context: StudioContext, inputPath: string, requestedDomainValue?: unknown): Promise<RepositoryLocation> {
  const existingProject = await context.store.loadProject();
  const requestedDomain = requestedDomainValue
    ?? existingProject?.defaultDomainProfileId
    ?? context.defaultDomainProfileId;
  if (!isBuiltInDomainProfileId(requestedDomain)) {
    throw new Error(`unsupported domain profile: ${String(requestedDomain)}`);
  }
  const location = await context.core.corpus.discover(inputPath, requestedDomain);
  return location;
}

export async function collectCodeEntities(context: StudioContext, setId: string, input: { promptTemplateId?: unknown } = {}, onEvent?: (event: ServiceEvent) => void): Promise<void> {
  const set = await context.store.loadDiagramSet(setId);
  const { domainProfileId, corpus } = await context.core.projectCorpus(set);
  const entitySet = await context.store.loadCodeEntities(setId);
  if (entitySet.status === "finalized") throw new Error("CodeEntitiesSet is immutable after finalization");
  const template = await resolveCodeEntityPromptTemplate(context, input.promptTemplateId);
  const promptConfig = createCodeEntityPromptConfig({
    id: context.store.ids.promptConfig(),
    diagramSet: set,
    template,
    domainProfileId,
    createdAt: timestamp()
  });
  await context.store.beginCodeEntityCollection(promptConfig);
  const runId = context.store.ids.run();
  let run: AgentRunRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: runId,
    diagramSetId: setId,
    kind: "collect-entities",
    status: "queued",
    statusMessage: domainProfileId === "document"
      ? "opening document evidence collector"
      : "opening code-entity collector",
    codeEntitiesRevision: entitySet.revision,
    outputCodeEntityIds: [],
    startedAt: timestamp(),
    updatedAt: timestamp()
  };
  await context.store.saveRun(run);
  await context.store.attachRun(setId, run.id);
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
    progressWrites = progressWrites.then(() => context.store.saveRun(snapshot));
    onEvent?.({ type: "progress", message: update.message });
  };
  try {
    const drafts = await context.agents.collectEntities({
      sourceRoot: set.sourceCheckoutRoot,
      domainProfileId,
      corpus,
      diagramSetName: set.name,
      promptConfig
    }, progress);
    await progressWrites;
    const entities = await validateEntityDrafts(context, set, drafts);
    await context.store.completeCollection(setId, entities);
    run = {
      ...run,
      status: "complete",
      statusMessage: domainProfileId === "document"
        ? `collected ${entities.length} evidence entities`
        : `collected ${entities.length} code entities`,
      outputCodeEntityIds: entities.map((entity) => entity.id),
      updatedAt: timestamp(),
      completedAt: timestamp()
    };
    await context.store.saveRun(run);
    onEvent?.({ type: "workspace", message: run.statusMessage, workspace: await context.core.workspace() });
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
    await context.store.saveRun(run);
    await context.store.failCollection(setId, message);
    throw error;
  }
}

export async function validateEntityDrafts(context: StudioContext, set: DiagramSetRecord, drafts: CodeEntityDraft[]): Promise<CodeEntityRecord[]> {
  if (drafts.length === 0) throw new Error("collector submitted no CodeEntities");
  const handles = new Set<string>();
  const { corpus } = await context.core.projectCorpus(set);
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
      const sourceLines = await context.core.corpus.readDocumentLines(corpus, range.path).catch(() => null);
      if (!sourceLines) throw new Error(`evidence range escapes or does not exist: ${range.path}`);
      const lineCount = sourceLines.length;
      if (range.startLine > lineCount) {
        throw new Error(`source range starts beyond ${range.path} (${lineCount} lines)`);
      }
      const endLine = Math.min(range.endLine, lineCount);
      sourceRanges.push({
        ...range,
        id: context.store.ids.sourceRange(),
        endLine,
        originalLines: sourceLines.slice(range.startLine - 1, endLine)
      });
    }
    const record: CodeEntityRecord = {
      id: context.store.ids.codeEntity(),
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

export async function deleteDiagramSet(context: StudioContext, setId: string): Promise<WorkspaceSnapshot> {
  const set = await context.store.loadDiagramSet(setId);
  if (set.readiness === "collecting") {
    throw new Error("a Diagram Set cannot be deleted while collection is running");
  }
  if (context.activeBatches.has(setId)
    || [...context.activeMappings].some((key) => key.startsWith(`${setId}:`))) {
    throw new Error("a Diagram Set cannot be deleted while an agent is running");
  }
  const workspace = await context.core.workspace();
  const hasActiveRun = Object.values(workspace.agentRuns).some((run) => (
    run.diagramSetId === setId
    && ["queued", "reading-context", "generating", "validating"].includes(run.status)
  ));
  if (hasActiveRun) throw new Error("a Diagram Set cannot be deleted while an agent is running");
  await context.store.moveDiagramSetToTrash(setId);
  return context.core.workspace();
}
