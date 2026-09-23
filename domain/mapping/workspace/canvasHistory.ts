import { CanvasHistory as CoreCanvasHistory } from '../../core/diagrams/canvasHistory';
import type { CanvasHistoryRecord, ResolvedCanvasDocument, StoredCanvasSnapshot } from '../../core/diagrams/canvasHistory';
import type { MappingCanvasState } from './mappingWorkspace';
export { documentFromHistory, validateCanvasHistory } from '../../core/diagrams/canvasHistory';
export type { CanvasHistoryRecord, CanvasDocument, StoredCanvasSnapshot } from '../../core/diagrams/canvasHistory';
/** Mapping owns the personal view-state type; core history treats it as opaque. */
export class CanvasHistory extends CoreCanvasHistory {
  constructor(document: ResolvedCanvasDocument, view: MappingCanvasState, history?: CanvasHistoryRecord) {
    const normalized = history && structuredClone(history);
    if (normalized) for (const snapshot of Object.values(normalized.snapshots)) {
      if (!snapshot.view || typeof snapshot.view !== 'object' || !('display' in snapshot.view)) snapshot.view = structuredClone(view);
    }
    super(document, view, normalized);
  }
  override get head() { return super.head as StoredCanvasSnapshot & {view: MappingCanvasState}; }
  override navigate(redo = false) { return super.navigate(redo) as (StoredCanvasSnapshot & {view: MappingCanvasState}) | undefined; }
  override reset(view?: MappingCanvasState) { return super.reset(view) as StoredCanvasSnapshot & {view: MappingCanvasState}; }
}
