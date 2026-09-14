import type { BuiltInDomainProfileId, CorpusBinding } from "../../domain/core/profiles/domainProfile";
import {
  type ArtifactImportInput,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type DiagramViewKind,
  type GenerationOutputKind,
  type MappedArtifactBundle,
  type RepositoryDirectoryListing,
  type WorkspaceSnapshot
} from "../../domain/core/records/domain";
import type { ProjectFileCompactionInput } from "../../domain/core/representations/projectCatalog";
import {
  type CallGraphFocusResult
} from "../../domain/core/source/callGraphFocus";
import type { CoreContext } from './context';
import type { CorpusAccess } from "./corpus/corpusAccess";
import * as highlightsOperations from './highlights/service';
import * as importsOperations from './imports/service';
import { DiagramRepository } from "./ports/diagramRepository";
import * as representationsOperations from './representations/service';
import * as sourceOperations from './source/service';
import * as workspaceOperations from './workspace/service';

/** Compatibility facade; operations live in capability services. */
export class CoreApplication {
  private readonly context: CoreContext;
  constructor(readonly store: DiagramRepository, readonly corpus: CorpusAccess) { this.context = { store, corpus }; }

  async projectRepresentations() {
    return representationsOperations.projectRepresentations(this.context);
  }

  async settledViewIdsForSession(set: DiagramSetRecord): Promise<Partial<Record<DiagramViewKind, string>>> {
    return representationsOperations.settledViewIdsForSession(this.context, set);
  }

  async upsertProjectFileCompaction(input: ProjectFileCompactionInput): Promise<WorkspaceSnapshot> {
    return representationsOperations.upsertProjectFileCompaction(this.context, input);
  }

  async projectCorpus(set?: DiagramSetRecord): Promise<{
    domainProfileId: BuiltInDomainProfileId;
    corpus: CorpusBinding;
  }> {
    return sourceOperations.projectCorpus(this.context, set);
  }

  async callGraphFocus(input: unknown): Promise<CallGraphFocusResult> {
    return sourceOperations.callGraphFocus(this.context, input);
  }

  async sourceSnippet(setId: string, entityId: string, rangeIndex: number): Promise<{
    path: string;
    startLine: number;
    lines: string[];
  }> {
    return sourceOperations.sourceSnippet(this.context, setId, entityId, rangeIndex);
  }

  async listRepositoryDirectory(setId: string, relativeDirectory: string): Promise<RepositoryDirectoryListing> {
    return sourceOperations.listRepositoryDirectory(this.context, setId, relativeDirectory);
  }

  async artifactForDiagramSet(setId: string, artifactKind: GenerationOutputKind, artifactId: string): Promise<{
    artifact: DiagramRecord | DiagramComponentRecord;
    global: boolean;
  }> {
    return importsOperations.artifactForDiagramSet(this.context, setId, artifactKind, artifactId);
  }

  async mappedArtifactBundle(setId: string, artifactKind: GenerationOutputKind, artifactId: string): Promise<MappedArtifactBundle> {
    return importsOperations.mappedArtifactBundle(this.context, setId, artifactKind, artifactId);
  }

  async importArtifact(input: ArtifactImportInput): Promise<WorkspaceSnapshot> {
    return importsOperations.importArtifact(this.context, input);
  }

  async renameImportedDiagram(diagramId: string, name: string): Promise<WorkspaceSnapshot> {
    return importsOperations.renameImportedDiagram(this.context, diagramId, name);
  }

  async archiveImportedDiagram(diagramId: string): Promise<WorkspaceSnapshot> {
    return importsOperations.archiveImportedDiagram(this.context, diagramId);
  }

  async archiveImportedDiagramComponent(componentId: string): Promise<WorkspaceSnapshot> {
    return importsOperations.archiveImportedDiagramComponent(this.context, componentId);
  }

  async addHighlight(input: {
    diagramSetId: unknown;
    artifactKind: unknown;
    artifactId: unknown;
    mappingId: unknown;
  }): Promise<WorkspaceSnapshot> {
    return highlightsOperations.addHighlight(this.context, input);
  }

  async deleteHighlight(highlightId: string): Promise<WorkspaceSnapshot> {
    return highlightsOperations.deleteHighlight(this.context, highlightId);
  }

  workspace(): Promise<WorkspaceSnapshot> {
    return workspaceOperations.workspace(this.context);
  }
}
