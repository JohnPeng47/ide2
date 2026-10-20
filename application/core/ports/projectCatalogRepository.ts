import { type ProjectProjectionRecord } from "../../../domain/core/diagrams/diagramProjection";
import { type SaveProjectDiagramInput } from "../../../domain/core/diagrams/projectDiagramCanvas";
import type { SaveProjectedTreeInput } from '../../../domain/core/representations/catalogCommands';
import type { ProjectCorpusCompactionCatalogRecord, ProjectFileCompactionInput, ProjectFileCompactionRecord, ProjectRepresentationCatalogRecord, ProjectRepresentationRecord } from "../../../domain/core/representations/projectCatalog";
export interface ProjectCatalogRepository {
  publishCheckpoint?(projectId: string, input: import('../../../domain/core/diagrams/checkpointPublication').CheckpointPublication, capture: () => Promise<import('../../../domain/core/diagrams/checkpointPublication').CapturedCheckpoint>): Promise<import('../../../domain/core/diagrams/checkpointPublication').CheckpointReceipt>;
  acceptCanvasChanges(projectId: string, input: import('../../../domain/core/representations/changeAcceptance').AcceptCanvasChangesInput): Promise<import('../../../domain/core/representations/changeAcceptance').ChangeSessionAcceptance>;
  readonly storeRoot: string;
  saveProjection(projectId: string, projection: ProjectProjectionRecord): Promise<{
    catalog: ProjectRepresentationCatalogRecord;
    projection: ProjectProjectionRecord;
  }>;
  saveProjectedTree(projectId: string, input: SaveProjectedTreeInput): Promise<{
    catalog: ProjectRepresentationCatalogRecord;
    representation: ProjectRepresentationRecord;
    projection: ProjectProjectionRecord;
  }>;
  saveMappingDiagram(projectId: string, input: SaveProjectDiagramInput): Promise<{
    catalog: ProjectRepresentationCatalogRecord;
    representation: ProjectRepresentationRecord;
  }>;
  loadCompactionCatalog(projectId: string): Promise<ProjectCorpusCompactionCatalogRecord>;
  saveCompactionCatalog(catalog: ProjectCorpusCompactionCatalogRecord): Promise<void>;
  upsertFileCompaction(projectId: string, input: ProjectFileCompactionInput): Promise<{
    catalog: ProjectCorpusCompactionCatalogRecord;
    compaction: ProjectFileCompactionRecord;
  }>;
  loadCurrentRepresentationCatalog?(projectId: string, revisionIds?: string[]): Promise<ProjectRepresentationCatalogRecord>;
  loadRepresentationCatalog(projectId: string, historyValidation?: import('../../../domain/core/diagrams/canvasHistory').HistoryValidation): Promise<ProjectRepresentationCatalogRecord>;
  loadDiagramSourceBindings(projectId: string): Promise<import('../../../domain/core/diagrams/diagram').DiagramSourceBinding[]>;
  loadChangeSessionAcceptances(projectId: string): Promise<NonNullable<ProjectRepresentationCatalogRecord['changeSessionAcceptances']>>;
  saveRepresentationCatalog(catalog: ProjectRepresentationCatalogRecord): Promise<void>;
  archiveRepresentation(projectId: string, representationId: string): Promise<ProjectRepresentationCatalogRecord>;
}
