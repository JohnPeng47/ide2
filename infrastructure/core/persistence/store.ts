import path from "node:path";
import type { RepositoryLocation } from "../../../application/core/corpus/location";
import { loadWorkspace } from '../../../application/core/workspace/loadWorkspace';
import type { SpatialProgressState } from "../../../domain/core/agent-work/agentWork";
import type { BuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfile";
import {
  type AgentRunRecord,
  type CodeEntitiesSetRecord,
  type CodeEntityPromptConfigRecord,
  type CodeEntityPromptTemplateRecord,
  type CodeEntityRecord,
  type DiagramCandidateBatchRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type DiagramViewKind,
  type EditSessionRecord,
  type GenerationBatchRecord,
  type GenerationPromptConfigRecord,
  type ImportedArtifactLibraryRecord,
  type PlanRecord,
  type ProjectRecord,
  type SystemPromptTemplateRecord,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import { type RepresentationGraphRecord } from "../../../domain/core/representations/representationGraph";
import * as artifactsStore from './artifacts';
import type { PersistenceContext } from './context';
import * as generationStore from './generation';
import * as highlightsStore from './highlights';
import * as importsStore from './imports';
import * as plansStore from './plans';
import { ProjectCatalogStore } from "./projectCatalogStore";
import * as projectsStore from './projects';
import * as runsStore from './runs';
import { makeId, type PersistedHighlight } from './shared';
import * as templatesStore from './templates';
export type { RepositoryLocation } from '../../../application/core/corpus/location';
export { discoverDocumentCorpus, discoverDomainCorpus, discoverRepository, projectIdFor } from './shared';

/** Filesystem repository facade; storage operations are grouped by capability. */
export class DiagramStore {
  readonly checkoutRoot: string;
  readonly storeRoot: string;
  readonly projectCatalogs: ProjectCatalogStore;
  ids = {
    set: () => makeId("set"),
    run: () => makeId("run"),
    batch: () => makeId("batch"),
    promptConfig: () => makeId("prompt"),
    diagram: () => makeId("diagram"),
    diagramComponent: () => makeId("component"),
    codeEntity: () => makeId("entity"),
    sourceRange: () => makeId("range"),
    editSession: () => makeId("edit"),
    editOperation: () => makeId("operation"),
    highlight: () => makeId("highlight"),
    representationFeedback: () => makeId("feedback"),
    plan: () => makeId("plan")
  };
  private readonly context: PersistenceContext;
  constructor(checkoutRoot: string, diagramsDirectory = ".diagrams") {
    this.checkoutRoot = path.resolve(checkoutRoot);
    this.storeRoot = path.resolve(this.checkoutRoot, diagramsDirectory);
    this.projectCatalogs = new ProjectCatalogStore(this.storeRoot);
    this.context = { checkoutRoot: this.checkoutRoot, storeRoot: this.storeRoot, projectCatalogs: this.projectCatalogs, ids: this.ids };
  }
  async loadWorkspace(): Promise<WorkspaceSnapshot> { return loadWorkspace(this); }
  async ensureProject(location: RepositoryLocation): Promise<ProjectRecord> { return projectsStore.ensureProject(this.context, location); }

  async createDiagramSet(input: {
    project: ProjectRecord;
    name: string;
    initialPrompt: string;
    location: RepositoryLocation;
    creationMode?: "generate" | "materialized";
  }): Promise<{ diagramSet: DiagramSetRecord; codeEntities: CodeEntitiesSetRecord }> { return projectsStore.createDiagramSet(this.context, input); }

  async moveDiagramSetToTrash(setId: string): Promise<string> { return projectsStore.moveDiagramSetToTrash(this.context, setId); }

  async loadProject(): Promise<ProjectRecord | null> { return projectsStore.loadProject(this.context); }

  async loadDiagramSet(setId: string): Promise<DiagramSetRecord> { return projectsStore.loadDiagramSet(this.context, setId); }

  async loadImportedArtifactLibrary(): Promise<ImportedArtifactLibraryRecord> { return importsStore.loadImportedArtifactLibrary(this.context); }

  async loadImportedDiagram(diagramId: string): Promise<DiagramRecord> { return importsStore.loadImportedDiagram(this.context, diagramId); }

  async loadImportedDiagramComponent(componentId: string): Promise<DiagramComponentRecord> { return importsStore.loadImportedDiagramComponent(this.context, componentId); }

  async loadImportedCodeEntity(entityId: string): Promise<CodeEntityRecord> { return importsStore.loadImportedCodeEntity(this.context, entityId); }

  async loadImportedCodeEntityMap(artifactId: string): Promise<DiagramCodeEntityMapRecord | null> { return importsStore.loadImportedCodeEntityMap(this.context, artifactId); }

  async addImportedCodeEntity(entity: CodeEntityRecord): Promise<void> { return importsStore.addImportedCodeEntity(this.context, entity); }

  async addImportedCodeEntityMap(mapping: DiagramCodeEntityMapRecord): Promise<void> { return importsStore.addImportedCodeEntityMap(this.context, mapping); }

  async addImportedDiagram(diagram: DiagramRecord): Promise<void> { return importsStore.addImportedDiagram(this.context, diagram); }

  async addImportedDiagramComponent(component: DiagramComponentRecord): Promise<void> { return importsStore.addImportedDiagramComponent(this.context, component); }

  async renameImportedDiagram(diagramId: string, name: string): Promise<DiagramRecord> { return importsStore.renameImportedDiagram(this.context, diagramId, name); }

  async archiveImportedDiagram(diagramId: string): Promise<DiagramRecord> { return importsStore.archiveImportedDiagram(this.context, diagramId); }

  async archiveImportedDiagramComponent(componentId: string): Promise<DiagramComponentRecord> { return importsStore.archiveImportedDiagramComponent(this.context, componentId); }

  async migrateLegacyImports(diagramSets: DiagramSetRecord[], initialLibrary: ImportedArtifactLibraryRecord): Promise<ImportedArtifactLibraryRecord> { return importsStore.migrateLegacyImports(this.context, diagramSets, initialLibrary); }

  async loadSystemPromptTemplates(): Promise<SystemPromptTemplateRecord[]> { return templatesStore.loadSystemPromptTemplates(this.context); }

  async saveSystemPromptTemplates(templates: SystemPromptTemplateRecord[]): Promise<void> { return templatesStore.saveSystemPromptTemplates(this.context, templates); }

  async loadCodeEntityPromptTemplates(domainProfileId: BuiltInDomainProfileId = "source-code"): Promise<CodeEntityPromptTemplateRecord[]> { return templatesStore.loadCodeEntityPromptTemplates(this.context, domainProfileId); }

  async saveCodeEntityPromptTemplates(templates: CodeEntityPromptTemplateRecord[]): Promise<void> { return templatesStore.saveCodeEntityPromptTemplates(this.context, templates); }

  async setFeaturedView(setId: string, viewKind: DiagramViewKind, diagramId?: string): Promise<DiagramSetRecord> { return artifactsStore.setFeaturedView(this.context, setId, viewKind, diagramId); }

  async clearFeaturedViewReferences(diagramId: string): Promise<void> { return artifactsStore.clearFeaturedViewReferences(this.context, diagramId); }

  async loadCodeEntities(setId: string): Promise<CodeEntitiesSetRecord> { return artifactsStore.loadCodeEntities(this.context, setId); }

  async loadDiagram(setId: string, diagramId: string): Promise<DiagramRecord> { return artifactsStore.loadDiagram(this.context, setId, diagramId); }

  async loadDiagramComponent(setId: string, componentId: string): Promise<DiagramComponentRecord> { return artifactsStore.loadDiagramComponent(this.context, setId, componentId); }

  async saveDiagramCandidateRankings(setId: string, candidateBatchId: string, rankings: Array<{ diagramId: string; rank: number }>): Promise<DiagramCandidateBatchRecord> { return artifactsStore.saveDiagramCandidateRankings(this.context, setId, candidateBatchId, rankings); }

  async saveDiagramComponent(component: DiagramComponentRecord): Promise<void> { return artifactsStore.saveDiagramComponent(this.context, component); }

  async addDiagram(diagram: DiagramRecord): Promise<void> { return artifactsStore.addDiagram(this.context, diagram); }

  async addDiagramComponent(component: DiagramComponentRecord): Promise<void> { return artifactsStore.addDiagramComponent(this.context, component); }

  async renameDiagram(setId: string, diagramId: string, name: string): Promise<DiagramRecord> { return artifactsStore.renameDiagram(this.context, setId, diagramId, name); }

  async archiveDiagram(setId: string, diagramId: string): Promise<DiagramRecord> { return artifactsStore.archiveDiagram(this.context, setId, diagramId); }

  async archiveDiagramComponent(setId: string, componentId: string): Promise<DiagramComponentRecord> { return artifactsStore.archiveDiagramComponent(this.context, setId, componentId); }

  async loadEditSession(setId: string, sessionId: string): Promise<EditSessionRecord> { return artifactsStore.loadEditSession(this.context, setId, sessionId); }

  async saveEditSession(session: EditSessionRecord): Promise<void> { return artifactsStore.saveEditSession(this.context, session); }

  async loadCodeEntityMap(setId: string, artifactId: string): Promise<DiagramCodeEntityMapRecord | null> { return artifactsStore.loadCodeEntityMap(this.context, setId, artifactId); }

  async saveCodeEntityMap(mapping: DiagramCodeEntityMapRecord): Promise<void> { return artifactsStore.saveCodeEntityMap(this.context, mapping); }

  async loadRepresentationGraph(setId: string): Promise<RepresentationGraphRecord | null> { return artifactsStore.loadRepresentationGraph(this.context, setId); }

  async saveRepresentationGraph(graph: RepresentationGraphRecord): Promise<void> { return artifactsStore.saveRepresentationGraph(this.context, graph); }

  async addEditSession(session: EditSessionRecord): Promise<void> { return artifactsStore.addEditSession(this.context, session); }

  async loadGenerationPromptConfig(setId: string, promptConfigId: string): Promise<GenerationPromptConfigRecord> { return generationStore.loadGenerationPromptConfig(this.context, setId, promptConfigId); }

  async loadCodeEntityPromptConfig(setId: string, promptConfigId: string): Promise<CodeEntityPromptConfigRecord> { return generationStore.loadCodeEntityPromptConfig(this.context, setId, promptConfigId); }

  async saveCodeEntityPromptConfig(config: CodeEntityPromptConfigRecord): Promise<void> { return generationStore.saveCodeEntityPromptConfig(this.context, config); }

  async saveGenerationPromptConfig(config: GenerationPromptConfigRecord): Promise<void> { return generationStore.saveGenerationPromptConfig(this.context, config); }

  async loadGenerationBatch(setId: string, batchId: string): Promise<GenerationBatchRecord> { return generationStore.loadGenerationBatch(this.context, setId, batchId); }

  async loadDiagramCandidateBatch(setId: string, candidateBatchId: string): Promise<DiagramCandidateBatchRecord> { return generationStore.loadDiagramCandidateBatch(this.context, setId, candidateBatchId); }

  async saveBatch(batch: GenerationBatchRecord): Promise<void> { return generationStore.saveBatch(this.context, batch); }

  async beginBatch(promptConfig: GenerationPromptConfigRecord, batch: GenerationBatchRecord, runs: AgentRunRecord[]): Promise<void> { return generationStore.beginBatch(this.context, promptConfig, batch, runs); }

  async completeBatch(batch: GenerationBatchRecord, runs: AgentRunRecord[], diagrams: DiagramRecord[], components: DiagramComponentRecord[], codeEntityMaps: DiagramCodeEntityMapRecord[] = []): Promise<void> { return generationStore.completeBatch(this.context, batch, runs, diagrams, components, codeEntityMaps); }

  async saveRun(run: AgentRunRecord): Promise<void> { return runsStore.saveRun(this.context, run); }

  async loadRun(setId: string, runId: string): Promise<AgentRunRecord> { return runsStore.loadRun(this.context, setId, runId); }

  async attachRuns(setId: string, runIds: string[]): Promise<DiagramSetRecord> { return runsStore.attachRuns(this.context, setId, runIds); }

  async attachRun(setId: string, runId: string): Promise<DiagramSetRecord> { return runsStore.attachRun(this.context, setId, runId); }

  async beginCodeEntityCollection(config: CodeEntityPromptConfigRecord): Promise<void> { return runsStore.beginCodeEntityCollection(this.context, config); }

  async completeCollection(setId: string, entities: CodeEntityRecord[]): Promise<void> { return runsStore.completeCollection(this.context, setId, entities); }

  async failCollection(setId: string, message: string): Promise<void> { return runsStore.failCollection(this.context, setId, message); }

  async loadHighlights(): Promise<PersistedHighlight[]> { return highlightsStore.loadHighlights(this.context); }

  async loadSpatialProgress(): Promise<Record<string, SpatialProgressState>> { return highlightsStore.loadSpatialProgress(this.context); }

  async saveSpatialProgress(runId: string, state: SpatialProgressState): Promise<void> { return highlightsStore.saveSpatialProgress(this.context, runId, state); }

  async saveHighlight(highlight: PersistedHighlight): Promise<void> { return highlightsStore.saveHighlight(this.context, highlight); }

  async deleteHighlight(highlightId: string): Promise<void> { return highlightsStore.deleteHighlight(this.context, highlightId); }

  async loadPlan(planId: string): Promise<PlanRecord> { return plansStore.loadPlan(this.context, planId); }

  async loadPlans(): Promise<PlanRecord[]> { return plansStore.loadPlans(this.context); }

  async savePlan(input: PlanRecord): Promise<PlanRecord> { return plansStore.savePlan(this.context, input); }
}
