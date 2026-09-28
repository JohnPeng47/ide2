import { useStore } from 'zustand';
import type { CanvasSession } from '../workspace/canvasSession';
import type { diagramProjection } from '../../../../domain/mapping/workspace/diagramViewState';

/** The only React subscriber to pointer-rate selection previews. */
export function SelectionPreviewOverlay({ session, boxId, projection, cell }: {
  session: CanvasSession; boxId: string; projection: ReturnType<typeof diagramProjection>;
  cell: { width: number; height: number };
}) {
  const selection = useStore(session.interaction, state => state.selection);
  const rect = selection?.boxId === boxId ? projection.rect(selection.rect) : undefined;
  return rect && cell.width > 0 && cell.height > 0 ? <span className="mapping-poc-selection-rect is-ready" data-selection-preview aria-hidden="true"
    style={{ left: (rect.startColumn - 1) * cell.width, top: (rect.startLine - 1) * cell.height,
      width: (rect.endColumn - rect.startColumn + 1) * cell.width, height: (rect.endLine - rect.startLine + 1) * cell.height }} /> : null;
}
