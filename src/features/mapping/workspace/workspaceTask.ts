import type { CanvasHistoryRecord } from '../../../../domain/core/diagrams/canvasHistory';
import { prepareCanvasTransfer, type TransferInput, type PreparedCanvasTransfer } from '../../../../domain/core/diagrams/canvasTransfer';
import type { MappingWorkspaceSnapshot } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { serializeWorkspace } from '../../../../domain/mapping/workspace/mappingWorkspaceCodec';

export type WorkspaceTask = { type: 'serialize'; snapshot: MappingWorkspaceSnapshot }
  | { type: 'transfer'; source: CanvasHistoryRecord; input: TransferInput; destination?: CanvasHistoryRecord };
export type WorkspaceTaskResult<T extends WorkspaceTask> = T extends { type: 'serialize' } ? string : PreparedCanvasTransfer;
export function executeWorkspaceTask(task: WorkspaceTask): string | PreparedCanvasTransfer {
  return task.type === 'serialize' ? serializeWorkspace(task.snapshot, false)
    : prepareCanvasTransfer(task.source, task.input, task.destination);
}
