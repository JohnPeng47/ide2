import { deepFreeze } from '../../../../domain/core/immutability';
import { canvasDisplayNodes, findBox } from '../../../../domain/mapping/workspace/canvasDisplayNode';
import { equalEndpointBounds, type EndpointBounds } from '../../../../domain/mapping/workspace/endpointGeometry';
import type { ChangeDocumentState } from '../../../../domain/mapping/changes/diagramChangeSession';
import type { MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';

/** Viewer-local folds and measurements. A preview never opens an editing context. */
export class ChangePreviewState {
  private snapshot: ChangeDocumentState & { cell?: { width: number; height: number }; endpointBounds?: EndpointBounds };
  private listeners = new Set<() => void>();
  constructor(state: ChangeDocumentState, private readonly version: number) { this.snapshot = structuredClone(state); deepFreeze(this.snapshot.document); }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  nodes() { return canvasDisplayNodes(this.snapshot.document, this.snapshot.canvas, this.version, this.snapshot.cell, this.snapshot.endpointBounds); }
  updateCanvas(update: (canvas: MappingCanvasState) => MappingCanvasState) {
    const canvas = update(this.snapshot.canvas);
    if (canvas === this.snapshot.canvas) return;
    this.snapshot = { ...this.snapshot, canvas }; this.listeners.forEach(listener => listener());
  }
  configureEndpointBounds(endpointBounds: EndpointBounds) {
    if (equalEndpointBounds(this.snapshot.endpointBounds, endpointBounds)) return;
    this.snapshot = { ...this.snapshot, endpointBounds }; this.listeners.forEach(listener => listener());
  }
  collapse(nodeId: string, contentNodeId: string, collapsed: boolean) {
    const box = findBox(this.snapshot.document.scene.root, nodeId.replace(/^grid:/, ''));
    if (box?.kind !== 'diagram') throw Error('Expected diagram');
    const content = this.snapshot.document.scene.contents[box.contentId].content;
    if (content.structure.kind !== 'tree' || !content.structure.nodes[contentNodeId]) throw Error('STALE_CONTENT_NODE');
    this.updateCanvas(canvas => {
      const ids = new Set(canvas.diagramViews?.[nodeId]?.collapsedContentNodeIds ?? []);
      if (collapsed) ids.add(contentNodeId); else ids.delete(contentNodeId);
      return { ...canvas, diagramViews: { ...canvas.diagramViews, [nodeId]: { contentRevisionId: content.revisionId, collapsedContentNodeIds: [...ids] } } };
    });
  }
}
