import {
  type AgentRunRecord,
  type CodeEntitiesSetRecord,
  type CodeEntityPromptConfigRecord,
  type CodeEntityRecord,
  type DiagramCandidateBatchRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type EditSessionRecord,
  type GenerationBatchRecord,
  type GenerationPromptConfigRecord,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import { type RepresentationGraphRecord } from "../../../domain/core/representations/representationGraph";
import type { DiagramRepository } from '../ports/diagramRepository';

/** Assemble the shared workspace independently of its persistence format. */
export async function loadWorkspace(store: DiagramRepository): Promise<WorkspaceSnapshot> {
  const project = await store.loadProject();
  let globalImports = await store.loadImportedArtifactLibrary();
  if (!project) {
    const importedDiagrams = await Promise.all(
      globalImports.diagramIds.map((id) => store.loadImportedDiagram(id))
    );
    const importedComponents = await Promise.all(
      globalImports.diagramComponentIds.map((id) => store.loadImportedDiagramComponent(id))
    );
    const importedCodeEntities = await Promise.all(
      (globalImports.codeEntityIds ?? []).map((id) => store.loadImportedCodeEntity(id))
    );
    return {
      project: null,
      diagramSets: [],
      globalImports,
      codeEntitySets: {},
      importedCodeEntities: Object.fromEntries(
        importedCodeEntities.map((entity) => [entity.id, entity])
      ),
      diagrams: Object.fromEntries(importedDiagrams.map((diagram) => [diagram.id, diagram])),
      diagramComponents: Object.fromEntries(
        importedComponents.map((component) => [component.id, component])
      ),
      codeEntityPromptConfigs: {},
      codeEntityPromptTemplates: {},
      generationPromptConfigs: {},
      systemPromptTemplates: {},
      generationBatches: {},
      diagramCandidateBatches: {},
      agentRuns: {},
      editSessions: {},
      codeEntityMaps: {},
      highlights: [],
      plans: []
    };
  }
  let diagramSets = await Promise.all(project.diagramSetIds.map((id) => store.loadDiagramSet(id)));
  globalImports = await store.migrateLegacyImports(diagramSets, globalImports);
  diagramSets = await Promise.all(project.diagramSetIds.map((id) => store.loadDiagramSet(id)));
  const codeEntitySets: Record<string, CodeEntitiesSetRecord> = {};
  const importedCodeEntities: Record<string, CodeEntityRecord> = {};
  const diagrams: Record<string, DiagramRecord> = {};
  const diagramComponents: Record<string, DiagramComponentRecord> = {};
  const codeEntityPromptConfigs: Record<string, CodeEntityPromptConfigRecord> = {};
  const codeEntityPromptTemplates = Object.fromEntries(
    (await store.loadCodeEntityPromptTemplates(project.domainProfileId === "document"
      ? "document"
      : "source-code")).map((template) => [template.id, template])
  );
  const generationPromptConfigs: Record<string, GenerationPromptConfigRecord> = {};
  const systemPromptTemplates = Object.fromEntries(
    (await store.loadSystemPromptTemplates()).map((template) => [template.id, template])
  );
  const generationBatches: Record<string, GenerationBatchRecord> = {};
  const diagramCandidateBatches: Record<string, DiagramCandidateBatchRecord> = {};
  const agentRuns: Record<string, AgentRunRecord> = {};
  const editSessions: Record<string, EditSessionRecord> = {};
  const codeEntityMaps: Record<string, DiagramCodeEntityMapRecord> = {};
  const representationGraphs: Record<string, RepresentationGraphRecord> = {};
  for (const id of globalImports.codeEntityIds ?? []) {
    importedCodeEntities[id] = await store.loadImportedCodeEntity(id);
  }
  for (const id of globalImports.diagramIds) {
    diagrams[id] = await store.loadImportedDiagram(id);
  }
  for (const id of globalImports.diagramComponentIds) {
    diagramComponents[id] = await store.loadImportedDiagramComponent(id);
  }
  for (const id of globalImports.codeEntityMapArtifactIds ?? []) {
    const mapping = await store.loadImportedCodeEntityMap(id);
    if (mapping) codeEntityMaps[id] = mapping;
  }
  for (const set of diagramSets) {
    const representationGraph = await store.loadRepresentationGraph(set.id);
    if (representationGraph) representationGraphs[set.id] = representationGraph;
    const codeEntities = await store.loadCodeEntities(set.id);
    codeEntitySets[set.codeEntitiesSetId] = codeEntities;
    if (codeEntities.promptConfigId) {
      codeEntityPromptConfigs[codeEntities.promptConfigId] = await store.loadCodeEntityPromptConfig(
        set.id,
        codeEntities.promptConfigId
      );
    }
    for (const id of set.generationBatchIds) {
      const batch = await store.loadGenerationBatch(set.id, id);
      generationBatches[id] = batch;
      if (batch.diagramCandidateBatchId) {
        diagramCandidateBatches[batch.diagramCandidateBatchId]
          = await store.loadDiagramCandidateBatch(set.id, batch.diagramCandidateBatchId);
      }
      generationPromptConfigs[batch.promptConfigId] = await store.loadGenerationPromptConfig(
        set.id,
        batch.promptConfigId
      );
    }
    for (const id of set.diagramIds) {
      diagrams[id] = await store.loadDiagram(set.id, id);
      const mapping = await store.loadCodeEntityMap(set.id, id);
      if (mapping) codeEntityMaps[id] = mapping;
    }
    for (const id of set.diagramComponentIds) {
      diagramComponents[id] = await store.loadDiagramComponent(set.id, id);
      const mapping = await store.loadCodeEntityMap(set.id, id);
      if (mapping) codeEntityMaps[id] = mapping;
    }
    for (const id of [...globalImports.diagramIds, ...globalImports.diagramComponentIds]) {
      const mapping = await store.loadCodeEntityMap(set.id, id);
      if (mapping) codeEntityMaps[`${set.id}:${id}`] = mapping;
    }
    for (const id of set.agentRunIds) {
      agentRuns[id] = await store.loadRun(set.id, id);
    }
    for (const id of set.editSessionIds) {
      editSessions[id] = await store.loadEditSession(set.id, id);
    }
  }
  return {
    project,
    corpusCompactions: await store.projectCatalogs.loadCompactionCatalog(project.id),
    representationCatalog: await store.projectCatalogs.loadRepresentationCatalog(project.id),
    diagramSets,
    globalImports,
    codeEntitySets,
    importedCodeEntities,
    diagrams,
    diagramComponents,
    codeEntityPromptConfigs,
    codeEntityPromptTemplates,
    generationPromptConfigs,
    systemPromptTemplates,
    generationBatches,
    diagramCandidateBatches,
    agentRuns,
    spatialProgress: await store.loadSpatialProgress(),
    representationGraphs,
    editSessions,
    codeEntityMaps,
    highlights: await store.loadHighlights(),
    plans: await store.loadPlans()
  };
}
