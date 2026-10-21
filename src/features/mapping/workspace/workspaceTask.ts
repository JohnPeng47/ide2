import type { CanvasHistoryRecord } from '../../../../domain/core/diagrams/canvasHistory';
import { prepareCanvasTransfer, type TransferInput, type PreparedCanvasTransfer } from '../../../../domain/core/diagrams/canvasTransfer';
import type { MappingWorkspaceSnapshot } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { serializeWorkspace } from '../../../../domain/mapping/workspace/mappingWorkspaceCodec';
import { prepareHighlightProjection, calculateProjectionPositions, type ProjectionGeometry, type ProjectionPosition, type ProjectionLayout, type ProjectionSettings } from '../../../../domain/core/diagrams/highlightProjection';

export type WorkspaceTask = { type: 'serialize'; snapshot: MappingWorkspaceSnapshot }
  | { type: 'project-highlights'; source: CanvasHistoryRecord; input: Omit<TransferInput, 'mode' | 'selectedIds'>; cell?: { width: number; height: number } }
  | { type: 'projection-layout'; geometry: ProjectionGeometry; projection: ProjectionLayout; settings: ProjectionSettings }
  | { type: 'transfer'; source: CanvasHistoryRecord; input: TransferInput; destination?: CanvasHistoryRecord };
export type WorkspaceTaskResult<T extends WorkspaceTask> = T extends { type: 'serialize' } ? string : T extends { type: 'projection-layout' } ? ProjectionPosition[] : PreparedCanvasTransfer;
export function executeWorkspaceTask(task: WorkspaceTask): string | PreparedCanvasTransfer | ProjectionPosition[] {
  if (task.type === 'serialize') return serializeWorkspace(task.snapshot, false);
  if (task.type === 'project-highlights') return prepareHighlightProjection(task.source, task.input, task.cell);
  if (task.type === 'projection-layout') return calculateProjectionPositions(task.geometry, task.projection, task.settings);
  return prepareCanvasTransfer(task.source, task.input, task.destination);
}
