import { createStore } from 'zustand/vanilla';
import { normalizePastedDiagram } from '../../../../domain/mapping/agent/pasteDiagram';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { GridPoint } from '../../../../domain/core/diagrams/lineGrid';

/** Session-local clipboard. Staging/canceling never creates a history checkpoint. */
export class CanvasCursorCopy {
  private state = createStore(() => ({ ascii: undefined as string | undefined }));
  readonly store = { getState: this.state.getState, getInitialState: this.state.getInitialState, subscribe: this.state.subscribe };
  stage(ascii: string) { this.state.setState({ ascii: normalizePastedDiagram(ascii) }); }
  clear() { if (this.state.getState().ascii !== undefined) this.state.setState({ ascii: undefined }); }
  paste(controller: MappingDocumentController, position: GridPoint) {
    const ascii = this.state.getState().ascii;
    if (ascii === undefined) return;
    // Each deliberate paste is a new diagram. Keep the buffer until Escape.
    return controller.applyUpdate(controller.getSnapshot().version, [{ method: 'diagram-create',
      id: `diagram-${crypto.randomUUID()}`, ascii, position }]);
  }
}
