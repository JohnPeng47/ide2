import {
  type SpatialProgressState
} from "../../domain/core/agent-work/agentWork";
import type { BuiltInDomainProfileId } from "../../domain/core/profiles/domainProfile";
import {
  DEFAULT_DIAGRAM_MODEL_ID,
  type CodeEntityMappingResult,
  type CodeEntityMappingTarget,
  type CodeEntityPromptTemplateRecord,
  type DiagramSelectionBounds,
  type DiagramSetRecord,
  type DiagramViewKind,
  type GenerationDerivationRecord,
  type GenerationOutputKind,
  type GenerationReferenceSelection,
  type MaterializedDiagramSetInput,
  type MaterializedDiagramSetResult,
  type SystemPromptTemplateRecord,
  type WorkspaceSnapshot
} from "../../domain/core/records/domain";
import type { PromoteProjectRepresentationInput } from "../../domain/core/representations/projectCatalog";
import {
  type RepresentationFeedbackTarget,
  type RepresentationGraphRecord
} from "../../domain/core/representations/representationGraph";
import { CoreApplication } from "../core/application";
import type { RepositoryLocation } from "../core/corpus/location";
import type { DiagramRepository } from "../core/ports/diagramRepository";
import * as candidatesOperations from './candidates/service';
import * as collectionOperations from './collection/service';
import type { StudioContext } from './context';
import * as editingOperations from './editing/service';
import * as evidenceMappingOperations from './evidence-mapping/service';
import type { DiagramAgentRuntime } from "./generation/agent";
import * as generationOperations from './generation/service';
import * as lifecycleOperations from './lifecycle/service';
import * as promptSettingsOperations from './prompt-settings/service';
import * as representationsOperations from './representations/service';
import { ServiceEvent } from './shared';
export type { ServiceEvent } from './shared';

/** Compatibility facade; operations live in capability services. */
export class StudioApplication {
  private readonly context: StudioContext;
  constructor(
    readonly store: DiagramRepository,
    private readonly core: CoreApplication,
    agents: DiagramAgentRuntime,
    defaultDomainProfileId: BuiltInDomainProfileId = 'source-code'
  ) { this.context = { store, core, agents, defaultDomainProfileId, activeBatches: new Set(), activeMappings: new Set() }; }
  representationGraph(setId: string) { return this.store.loadRepresentationGraph(setId); }
  workspace(): Promise<WorkspaceSnapshot> { return this.core.workspace(); }

  async promoteProjectRepresentation(input: PromoteProjectRepresentationInput): Promise<WorkspaceSnapshot> {
    return candidatesOperations.promoteProjectRepresentation(this.context, input);
  }

  async renameDiagram(setId: string, diagramId: string, name: string): Promise<WorkspaceSnapshot> {
    return candidatesOperations.renameDiagram(this.context, setId, diagramId, name);
  }

  async setStarredDiagram(setId: string, diagramId: string, starred: boolean): Promise<WorkspaceSnapshot> {
    return candidatesOperations.setStarredDiagram(this.context, setId, diagramId, starred);
  }

  async rankDiagramCandidates(setId: string, candidateBatchId: string, rankings: Array<{ diagramId: string; rank: number }>): Promise<WorkspaceSnapshot> {
    return candidatesOperations.rankDiagramCandidates(this.context, setId, candidateBatchId, rankings);
  }

  async archiveDiagram(setId: string, diagramId: string): Promise<WorkspaceSnapshot> {
    return candidatesOperations.archiveDiagram(this.context, setId, diagramId);
  }

  async archiveDiagramComponent(setId: string, componentId: string): Promise<WorkspaceSnapshot> {
    return candidatesOperations.archiveDiagramComponent(this.context, setId, componentId);
  }

  async systemPromptTemplates(): Promise<SystemPromptTemplateRecord[]> {
    return promptSettingsOperations.systemPromptTemplates(this.context);
  }

  async codeEntityPromptTemplates(): Promise<CodeEntityPromptTemplateRecord[]> {
    return promptSettingsOperations.codeEntityPromptTemplates(this.context);
  }

  async resolveCodeEntityPromptTemplate(id?: unknown, requestedDomain?: BuiltInDomainProfileId): Promise<CodeEntityPromptTemplateRecord> {
    return promptSettingsOperations.resolveCodeEntityPromptTemplate(this.context, id, requestedDomain);
  }

  async resolveSystemPromptTemplate(id?: unknown): Promise<SystemPromptTemplateRecord> {
    return promptSettingsOperations.resolveSystemPromptTemplate(this.context, id);
  }

  async saveSystemPromptTemplate(input: {
    id?: unknown;
    label: unknown;
    description: unknown;
    prompts: unknown;
  }): Promise<WorkspaceSnapshot> {
    return promptSettingsOperations.saveSystemPromptTemplate(this.context, input);
  }

  async resetSystemPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
    return promptSettingsOperations.resetSystemPromptTemplate(this.context, id);
  }

  async deleteSystemPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
    return promptSettingsOperations.deleteSystemPromptTemplate(this.context, id);
  }

  async saveCodeEntityPromptTemplate(input: {
    id?: unknown;
    label: unknown;
    description: unknown;
    prompts: unknown;
  }): Promise<WorkspaceSnapshot> {
    return promptSettingsOperations.saveCodeEntityPromptTemplate(this.context, input);
  }

  async resetCodeEntityPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
    return promptSettingsOperations.resetCodeEntityPromptTemplate(this.context, id);
  }

  async deleteCodeEntityPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
    return promptSettingsOperations.deleteCodeEntityPromptTemplate(this.context, id);
  }

  async saveRepresentationGraph(setId: string, input: RepresentationGraphRecord): Promise<WorkspaceSnapshot> {
    return representationsOperations.saveRepresentationGraph(this.context, setId, input);
  }

  async addRepresentationFeedback(setId: string, input: { target: RepresentationFeedbackTarget; comment: string }): Promise<WorkspaceSnapshot> {
    return representationsOperations.addRepresentationFeedback(this.context, setId, input);
  }

  async saveAgentSpatialProgress(setId: string, runId: string, state: SpatialProgressState): Promise<WorkspaceSnapshot> {
    return representationsOperations.saveAgentSpatialProgress(this.context, setId, runId, state);
  }

  async createDiagramSet(input: {
    path: string;
    name: string;
    prompt: string;
    domainProfileId?: unknown;
  }): Promise<DiagramSetRecord> {
    return collectionOperations.createDiagramSet(this.context, input);
  }

  async createMaterializedDiagramSet(input: MaterializedDiagramSetInput): Promise<MaterializedDiagramSetResult> {
    return collectionOperations.createMaterializedDiagramSet(this.context, input);
  }

  async validateDiagramSetTarget(inputPath: string, requestedDomainValue?: unknown): Promise<RepositoryLocation> {
    return collectionOperations.validateDiagramSetTarget(this.context, inputPath, requestedDomainValue);
  }

  async collectCodeEntities(setId: string, input: { promptTemplateId?: unknown } = {}, onEvent?: (event: ServiceEvent) => void): Promise<void> {
    return collectionOperations.collectCodeEntities(this.context, setId, input, onEvent);
  }

  async deleteDiagramSet(setId: string): Promise<WorkspaceSnapshot> {
    return collectionOperations.deleteDiagramSet(this.context, setId);
  }

  async generateInitialDiagrams(setId: string, input: {
    promptTemplateId?: unknown;
    runReferencePrompt?: boolean;
    referencePrompt?: string;
  } = {}, onEvent?: (event: ServiceEvent) => void): Promise<WorkspaceSnapshot> {
    return generationOperations.generateInitialDiagrams(this.context, setId, input, onEvent);
  }

  async generate(setId: string, input: {
    prompt: string;
    runReferencePrompt?: boolean;
    referencePrompt?: string;
    selectedCodeEntityIds: string[];
    count: number;
    outputKind: GenerationOutputKind;
    viewKind?: DiagramViewKind;
    modelId?: unknown;
    promptProfileId?: unknown;
    referenceSelections?: GenerationReferenceSelection[];
    referencePromptSelections?: GenerationReferenceSelection[];
    derivation?: GenerationDerivationRecord;
  }, onEvent?: (event: ServiceEvent) => void): Promise<WorkspaceSnapshot> {
    return generationOperations.generate(this.context, setId, input, onEvent);
  }

  async mapCodeEntities(setId: string, artifactKind: GenerationOutputKind, artifactId: string, onEvent?: (event: ServiceEvent) => void): Promise<WorkspaceSnapshot> {
    return evidenceMappingOperations.mapCodeEntities(this.context, setId, artifactKind, artifactId, onEvent);
  }

  async mapCodeEntitiesBatch(setId: string, targets: CodeEntityMappingTarget[], concurrency = 3, onEvent?: (event: ServiceEvent) => void): Promise<{ workspace: WorkspaceSnapshot; results: CodeEntityMappingResult[] }> {
    return evidenceMappingOperations.mapCodeEntitiesBatch(this.context, setId, targets, concurrency, onEvent);
  }

  async captureDiagramComponent(setId: string, diagramId: string, bounds: DiagramSelectionBounds): Promise<WorkspaceSnapshot> {
    return editingOperations.captureDiagramComponent(this.context, setId, diagramId, bounds);
  }

  async createEditSession(setId: string, artifactKind: GenerationOutputKind, artifactId: string): Promise<WorkspaceSnapshot> {
    return editingOperations.createEditSession(this.context, setId, artifactKind, artifactId);
  }

  async manualEdit(setId: string, sessionId: string, ascii: string): Promise<WorkspaceSnapshot> {
    return editingOperations.manualEdit(this.context, setId, sessionId, ascii);
  }

  async placeEditMarker(setId: string, sessionId: string, line: number, column: number): Promise<{ workspace: WorkspaceSnapshot; markerToken: string }> {
    return editingOperations.placeEditMarker(this.context, setId, sessionId, line, column);
  }

  async undoEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    return editingOperations.undoEdit(this.context, setId, sessionId);
  }

  async redoEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    return editingOperations.redoEdit(this.context, setId, sessionId);
  }

  async llmEdit(setId: string, sessionId: string, instruction: string, modelId: unknown = DEFAULT_DIAGRAM_MODEL_ID, onEvent?: (event: ServiceEvent) => void): Promise<WorkspaceSnapshot> {
    return editingOperations.llmEdit(this.context, setId, sessionId, instruction, modelId, onEvent);
  }

  async finishEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    return editingOperations.finishEdit(this.context, setId, sessionId);
  }

  async discardEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    return editingOperations.discardEdit(this.context, setId, sessionId);
  }

  async captureNestedDiagramComponent(setId: string, componentId: string, bounds: DiagramSelectionBounds): Promise<WorkspaceSnapshot> {
    return editingOperations.captureNestedDiagramComponent(this.context, setId, componentId, bounds);
  }

  async recoverInterruptedRuns(): Promise<void> {
    return lifecycleOperations.recoverInterruptedRuns(this.context);
  }

  dispose(): void {
    return lifecycleOperations.dispose(this.context);
  }
}
