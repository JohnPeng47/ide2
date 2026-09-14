import { createHash } from "node:crypto";
import {
  createBuiltInSystemPromptTemplates,
  generationPromptBindings,
  promptTemplate,
  renderArtifactSystemPrompt
} from "../../../domain/core/prompts/prompt";
import {
  CodeEntity,
  DEFAULT_DIAGRAM_MODEL_ID,
  Diagram,
  DiagramComponent,
  SCHEMA_VERSION,
  createCodeEntityPromptAliases,
  isDiagramModelId,
  type AgentRunRecord,
  type CodeEntityPromptConfigRecord,
  type DiagramCandidateBatchRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type GenerationBatchRecord,
  type GenerationOutputKind,
  type GenerationPromptConfigRecord,
  type GenerationTargetKind,
  type PromptReference
} from "../../../domain/core/records/domain";
import { loadCodeEntities, loadDiagram, loadDiagramComponent, saveCodeEntityMap, saveDiagramComponent } from './artifacts';
import type { PersistenceContext } from './context';
import { batchPath, codeEntityPromptConfigPath, diagramCandidateBatchPath, diagramComponentPath, diagramPath, promptConfigPath, setPath } from './paths';
import { loadDiagramSet } from './projects';
import { saveRun } from './runs';
import { nowIso, readJson, readJsonIfExists, stableScopedId, writeJsonAtomic } from './shared';

export async function loadGenerationPromptConfig(context: PersistenceContext, setId: string, promptConfigId: string): Promise<GenerationPromptConfigRecord> {
  const filePath = promptConfigPath(context, setId, promptConfigId);
  const stored = await readJson<GenerationPromptConfigRecord>(filePath);
  if (stored.outputKind !== "diagram" || stored.viewKind) return stored;
  const normalized = { ...stored, viewKind: "diagram" as const };
  await writeJsonAtomic(filePath, normalized);
  return normalized;
}

export async function loadCodeEntityPromptConfig(context: PersistenceContext, setId: string, promptConfigId: string): Promise<CodeEntityPromptConfigRecord> {
  return readJson<CodeEntityPromptConfigRecord>(
    codeEntityPromptConfigPath(context, setId, promptConfigId)
  );
}

export async function saveCodeEntityPromptConfig(context: PersistenceContext, config: CodeEntityPromptConfigRecord): Promise<void> {
  const filePath = codeEntityPromptConfigPath(context, config.diagramSetId, config.id);
  const existing = await readJsonIfExists<CodeEntityPromptConfigRecord>(filePath);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(config)) {
      throw new Error(`CodeEntityPromptConfig is immutable: ${config.id}`);
    }
    return;
  }
  await writeJsonAtomic(filePath, config);
}

export async function saveGenerationPromptConfig(context: PersistenceContext, config: GenerationPromptConfigRecord): Promise<void> {
  const filePath = promptConfigPath(context, config.diagramSetId, config.id);
  const existing = await readJsonIfExists<GenerationPromptConfigRecord>(filePath);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(config)) {
      throw new Error(`GenerationPromptConfig is immutable: ${config.id}`);
    }
    return;
  }
  await writeJsonAtomic(filePath, config);
}

export async function legacyPromptRepresentation(context: PersistenceContext, setId: string, reference: PromptReference): Promise<string> {
  try {
    const entities = await loadCodeEntities(context, setId);
    const aliases = new Map(createCodeEntityPromptAliases(entities.entities)
      .map(({ id, alias }) => [id, alias]));
    if (reference.kind === "code-entity") {
      const entity = entities.entities.find((candidate) => candidate.id === reference.targetId);
      if (entity) return new CodeEntity(entity).prompt_str();
    } else if (reference.kind === "diagram") {
      return new Diagram(await loadDiagram(context, setId, reference.targetId)).prompt_str(aliases);
    } else {
      return new DiagramComponent(
        await loadDiagramComponent(context, setId, reference.targetId)
      ).prompt_str(aliases);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return `Unavailable historical reference: ${reference.token}`;
}

export async function loadGenerationBatch(context: PersistenceContext, setId: string, batchId: string): Promise<GenerationBatchRecord> {
  type LegacyGenerationBatch = Omit<GenerationBatchRecord, "promptConfigId"> & {
    promptConfigId?: string;
    outputKind?: GenerationOutputKind;
    modelId?: unknown;
    userPrompt?: string;
    selectedCodeEntityIds?: string[];
    promptReferences?: PromptReference[];
    resolvedPrompt?: string;
    outputDiagramComponentIds?: string[];
  };
  const stored = await readJson<LegacyGenerationBatch>(batchPath(context, setId, batchId));
  if (stored.promptConfigId) {
    const {
      outputKind: _outputKind,
      modelId: _modelId,
      userPrompt: _userPrompt,
      selectedCodeEntityIds: _selectedCodeEntityIds,
      promptReferences: _promptReferences,
      resolvedPrompt: _resolvedPrompt,
      ...batchFields
    } = stored;
    const normalized: GenerationBatchRecord = {
      ...batchFields,
      promptConfigId: stored.promptConfigId,
      outputDiagramComponentIds: stored.outputDiagramComponentIds ?? []
    };
    const withCandidateBatch = await ensureDiagramCandidateBatch(context, normalized);
    if (!Array.isArray(stored.outputDiagramComponentIds)
      || _outputKind !== undefined
      || _modelId !== undefined
      || _userPrompt !== undefined
      || _selectedCodeEntityIds !== undefined
      || _promptReferences !== undefined
      || _resolvedPrompt !== undefined
      || withCandidateBatch.diagramCandidateBatchId !== stored.diagramCandidateBatchId) {
      await writeJsonAtomic(batchPath(context, setId, batchId), withCandidateBatch);
    }
    return withCandidateBatch;
  }

  const outputKind = stored.outputKind ?? "diagram";
  const modelId = isDiagramModelId(stored.modelId)
    ? stored.modelId
    : DEFAULT_DIAGRAM_MODEL_ID;
  const references = await Promise.all((stored.promptReferences ?? []).map(async (reference) => ({
    ...reference,
    promptRepresentation: await legacyPromptRepresentation(context, setId, reference)
  })));
  const promptConfigId = `prompt-${createHash("sha256").update(stored.id).digest("hex").slice(0, 16)}`;
  const legacyTargetKind: GenerationTargetKind = outputKind === "diagram-component"
    ? "diagram-component"
    : "diagram";
  const legacyTemplate = createBuiltInSystemPromptTemplates(stored.createdAt)[0];
  const legacyBindings = generationPromptBindings(legacyTargetKind);
  const config: GenerationPromptConfigRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: promptConfigId,
    diagramSetId: setId,
    outputKind,
    ...(outputKind === "diagram" ? { viewKind: "diagram" as const } : {}),
    modelId,
    instruction: stored.userPrompt ?? "",
    selectedCodeEntityIds: stored.selectedCodeEntityIds ?? [],
    references,
    mappingPrompt: {
      templateVersion: 1,
      promptName: legacyBindings.mapping,
      template: promptTemplate(legacyTemplate, legacyBindings.mapping)
    },
    contextPrompt: {
      templateVersion: 1,
      rendered: stored.resolvedPrompt ?? ""
    },
    systemPrompt: {
      templateId: "artifact-generation",
      templateVersion: 1,
      profileId: "default",
      profileVersion: 1,
      promptName: legacyBindings.system,
      rendered: renderArtifactSystemPrompt({
        outputKind,
        ...(outputKind === "diagram" ? { viewKind: "diagram" as const } : {}),
        template: legacyTemplate
      })
    },
    createdAt: stored.createdAt
  };
  await saveGenerationPromptConfig(context, config);

  for (const diagramId of stored.outputDiagramIds) {
    const diagram = await readJsonIfExists<DiagramRecord>(diagramPath(context, setId, diagramId));
    if (diagram && diagram.generationPromptConfigId !== promptConfigId) {
      await writeJsonAtomic(diagramPath(context, setId, diagramId), {
        ...diagram,
        generationPromptConfigId: promptConfigId
      });
    }
  }
  for (const componentId of stored.outputDiagramComponentIds ?? []) {
    const component = await readJsonIfExists<DiagramComponentRecord>(
      diagramComponentPath(context, setId, componentId)
    );
    if (component && component.generationPromptConfigId !== promptConfigId) {
      await writeJsonAtomic(diagramComponentPath(context, setId, componentId), {
        ...component,
        generationPromptConfigId: promptConfigId
      });
    }
  }

  const {
    outputKind: _outputKind,
    modelId: _modelId,
    userPrompt: _userPrompt,
    selectedCodeEntityIds: _selectedCodeEntityIds,
    promptReferences: _promptReferences,
    resolvedPrompt: _resolvedPrompt,
    ...batchFields
  } = stored;
  const normalized: GenerationBatchRecord = {
    ...batchFields,
    promptConfigId,
    outputDiagramComponentIds: stored.outputDiagramComponentIds ?? []
  };
  const withCandidateBatch = await ensureDiagramCandidateBatch(context, normalized);
  await writeJsonAtomic(batchPath(context, setId, batchId), withCandidateBatch);
  return withCandidateBatch;
}

export async function ensureDiagramCandidateBatch(context: PersistenceContext, batch: GenerationBatchRecord): Promise<GenerationBatchRecord> {
  if (batch.status !== "complete" || batch.outputDiagramIds.length === 0) return batch;
  const candidateBatchId = batch.diagramCandidateBatchId
    ?? stableScopedId("candidate-batch", batch.diagramSetId, batch.id);
  const filePath = diagramCandidateBatchPath(context, batch.diagramSetId, candidateBatchId);
  const existing = await readJsonIfExists<DiagramCandidateBatchRecord>(filePath);
  if (existing) {
    if (existing.diagramSetId !== batch.diagramSetId
      || existing.generationBatchId !== batch.id
      || JSON.stringify(existing.diagramIds) !== JSON.stringify(batch.outputDiagramIds)) {
      throw new Error(`DiagramCandidateBatch membership does not match generation batch: ${batch.id}`);
    }
  } else {
    const createdAt = batch.updatedAt;
    await writeJsonAtomic(filePath, {
      schemaVersion: SCHEMA_VERSION,
      id: candidateBatchId,
      diagramSetId: batch.diagramSetId,
      generationBatchId: batch.id,
      diagramIds: [...batch.outputDiagramIds],
      rankings: {},
      createdAt,
      updatedAt: createdAt
    } satisfies DiagramCandidateBatchRecord);
  }
  return batch.diagramCandidateBatchId === candidateBatchId
    ? batch
    : { ...batch, diagramCandidateBatchId: candidateBatchId };
}

export async function loadDiagramCandidateBatch(context: PersistenceContext, setId: string, candidateBatchId: string): Promise<DiagramCandidateBatchRecord> {
  return readJson<DiagramCandidateBatchRecord>(
    diagramCandidateBatchPath(context, setId, candidateBatchId)
  );
}

export async function saveBatch(context: PersistenceContext, batch: GenerationBatchRecord): Promise<void> {
  await writeJsonAtomic(batchPath(context, batch.diagramSetId, batch.id), batch);
}

export async function beginBatch(context: PersistenceContext, promptConfig: GenerationPromptConfigRecord, batch: GenerationBatchRecord, runs: AgentRunRecord[]): Promise<void> {
  const entities = await loadCodeEntities(context, batch.diagramSetId);
  if (entities.status !== "finalized" || entities.revision !== batch.codeEntitiesRevision) {
    throw new Error("generation batch is not pinned to the finalized CodeEntitiesSet");
  }
  if (promptConfig.id !== batch.promptConfigId
    || promptConfig.diagramSetId !== batch.diagramSetId) {
    throw new Error("generation batch does not reference its prompt config");
  }
  await saveGenerationPromptConfig(context, promptConfig);
  for (const run of runs) await saveRun(context, run);
  await saveBatch(context, await ensureDiagramCandidateBatch(context, batch));
  const set = await loadDiagramSet(context, batch.diagramSetId);
  await writeJsonAtomic(setPath(context, batch.diagramSetId), {
    ...set,
    generationBatchIds: [...set.generationBatchIds, batch.id],
    agentRunIds: [...set.agentRunIds, ...runs.map((run) => run.id)],
    updatedAt: nowIso()
  });
}

export async function completeBatch(context: PersistenceContext, batch: GenerationBatchRecord, runs: AgentRunRecord[], diagrams: DiagramRecord[], components: DiagramComponentRecord[], codeEntityMaps: DiagramCodeEntityMapRecord[] = []): Promise<void> {
  const entities = await loadCodeEntities(context, batch.diagramSetId);
  if (entities.status !== "finalized" || entities.revision !== batch.codeEntitiesRevision) {
    throw new Error("CodeEntitiesSet changed before the generation batch committed");
  }
  for (const diagram of diagrams) {
    await writeJsonAtomic(diagramPath(context, diagram.diagramSetId, diagram.id), diagram);
  }
  for (const component of components) await saveDiagramComponent(context, component);
  for (const mapping of codeEntityMaps) await saveCodeEntityMap(context, mapping);
  for (const run of runs) await saveRun(context, run);
  await saveBatch(context, await ensureDiagramCandidateBatch(context, batch));
  const set = await loadDiagramSet(context, batch.diagramSetId);
  await writeJsonAtomic(setPath(context, batch.diagramSetId), {
    ...set,
    diagramIds: [...set.diagramIds, ...diagrams.map((diagram) => diagram.id)],
    diagramComponentIds: [
      ...set.diagramComponentIds,
      ...components.map((component) => component.id)
    ],
    updatedAt: nowIso()
  });
}
