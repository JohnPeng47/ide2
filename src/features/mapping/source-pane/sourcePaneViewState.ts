import type { DisplayState } from '../../../../domain/mapping/workspace/displayModel';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import type { ScrollPosition, SourceScrollState } from '../../../shared/source/sourceScrollState';
interface Entry {
  sourceFile: string;
  position: ScrollPosition;
  read?: () => ScrollPosition | undefined;
  owner?: symbol;
}

/** Live viewport state is sampled at snapshot time, never published into the React display tree. */
export class SourcePaneViewState {
  private readonly entries = new Map<string, Map<string, Entry>>();
  private readonly cameras = new Map<string, CanvasTransform>();

  bind(documentId: string, paneId: string, sourceFile: string, fallback?: ScrollPosition): SourceScrollState {
    const owner = Symbol();
    const current = () => {
      const entry = this.entries.get(documentId)?.get(paneId);
      return entry?.sourceFile === sourceFile ? entry : undefined;
    };
    return {
      read: () => current()?.position ?? fallback,
      connect: read => {
        let panes = this.entries.get(documentId);
        if (!panes) this.entries.set(documentId, panes = new Map());
        const entry: Entry = { sourceFile, position: read() ?? current()?.position ?? fallback ?? { top: 0, left: 0 }, read, owner };
        panes.set(paneId, entry);
        return () => {
          // A reset or a newly mounted viewer takes ownership before an old cleanup may run.
          if (current() !== entry) return;
          entry.position = read() ?? entry.position;
          delete entry.read;
          delete entry.owner;
        };
      },
      write: position => {
        const entry = current();
        if (entry?.owner === owner) entry.position = position;
      }
    };
  }

  resetPane(documentId: string, paneId: string) {
    this.entries.get(documentId)?.delete(paneId);
  }

  prune(documentId: string, display: DisplayState) {
    const panes = this.entries.get(documentId);
    if (!panes) return;
    for (const [id, entry] of panes) {
      const node = display.nodes[id];
      if (node?.kind !== 'projection' || node.content.kind !== 'source-code' || node.content.sourceFile !== entry.sourceFile) panes.delete(id);
    }
  }

  captureDisplay(documentId: string, display: DisplayState): DisplayState {
    const panes = this.entries.get(documentId);
    if (!panes?.size) return display;
    const nodes = { ...display.nodes };
    for (const [id, entry] of panes) {
      const node = nodes[id];
      if (node?.kind !== 'projection' || node.content.kind !== 'source-code' || node.content.sourceFile !== entry.sourceFile) continue;
      const scroll = entry.read?.() ?? entry.position;
      nodes[id] = { ...node, content: { ...node.content, scroll: { ...scroll } } };
    }
    return { ...display, nodes };
  }

  setCamera(documentId: string, camera: CanvasTransform) { this.cameras.set(documentId, camera); }
  captureCamera(documentId: string, fallback?: CanvasTransform) { return this.cameras.get(documentId) ?? fallback; }
}
