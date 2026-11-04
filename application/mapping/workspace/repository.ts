import type { WorkspaceBatch, WorkspaceRecordState } from '../../../domain/mapping/workspace/workspaceRecords';
import type { MappingWorkspaceSnapshot } from '../../../domain/mapping/workspace/mappingWorkspace';

export interface MappingWorkspaceRepository {
  loadViewHeaders?(projectId: string): Promise<import('../../../domain/mapping/workspace/workspaceRecords').WorkspaceViewHeader[] | undefined>;
  loadRecords(projectId: string, historyValidation?: import('../../../domain/core/diagrams/canvasHistory').HistoryValidation): Promise<WorkspaceRecordState>;
  applyBatch(projectId: string, batch: WorkspaceBatch): Promise<{ revision: number }>;
  load(projectId: string): Promise<MappingWorkspaceSnapshot | null>;
  save(projectId: string, input: unknown): Promise<void>;
}
