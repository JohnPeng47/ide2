import { randomUUID } from 'node:crypto';
import type { CanvasDescriptor } from '../../../domain/mapping/agent/contracts';
import type { BoundSelection, LiveCanvasEvent, LiveSelection } from '../../../domain/mapping/agent/liveCanvasStatus';

export class LiveCanvasError extends Error {
  constructor(readonly code: string, readonly status: number, message = code) { super(message); }
}
type Snapshot = LiveSelection & { receivedAt: string };
type Binding = { workspaceInstanceId: string; documentId: string; canvasEpoch: string;
  unavailable?: 'canvas.disconnected' | 'canvas.closed' | 'canvas.replaced'; notify: (event: LiveCanvasEvent) => void };

/** Ephemeral selection mirror. Never hydrates a document, exports history or writes storage. */
export class LiveCanvasService {
  private publishers = new Map<string, { owner: object; selections: Map<string, Snapshot> }>();
  private bindings = new Map<string, Binding>();
  constructor(private readonly listCanvases: () => CanvasDescriptor[]) {}
  publish(owner: object, workspaceInstanceId: string) {
    if (!this.listCanvases().some(c => c.canvasId === workspaceInstanceId)) throw new LiveCanvasError('CANVAS_UNAVAILABLE', 503);
    if (this.publishers.has(workspaceInstanceId)) throw new LiveCanvasError('PUBLISHER_EXISTS', 409);
    this.publishers.set(workspaceInstanceId, { owner, selections: new Map() });
  }
  update(owner: object, workspaceInstanceId: string, selection: LiveSelection) {
    const publisher = this.publisher(owner, workspaceInstanceId);
    // A newly opened document can publish before the legacy HTTP registration refresh.
    // The registered browser publisher is authoritative for its current documents.
    if (!publisher.selections.has(selection.documentId) && publisher.selections.size >= 100)
      throw new LiveCanvasError('DOCUMENT_LIMIT', 400);
    const previous = publisher.selections.get(selection.documentId);
    if (previous?.canvasEpoch === selection.canvasEpoch && selection.sequence <= previous.sequence) return;
    if (previous && previous.canvasEpoch !== selection.canvasEpoch) this.invalidate(workspaceInstanceId, selection.documentId, 'canvas.replaced');
    publisher.selections.set(selection.documentId, { ...selection, receivedAt: new Date().toISOString() });
    for (const [id, binding] of this.bindings) if (!binding.unavailable && binding.workspaceInstanceId === workspaceInstanceId
      && binding.documentId === selection.documentId) binding.notify({ type: 'selection.changed', ...this.read(id) });
  }
  remove(owner: object, workspaceInstanceId: string, documentId: string, canvasEpoch: string) {
    const publisher = this.publisher(owner, workspaceInstanceId);
    if (publisher.selections.get(documentId)?.canvasEpoch !== canvasEpoch) return;
    publisher.selections.delete(documentId);
    this.invalidate(workspaceInstanceId, documentId, 'canvas.closed');
  }
  attach(workspaceInstanceId: string, documentId: string, notify: Binding['notify']): BoundSelection {
    const selection = this.publishers.get(workspaceInstanceId)?.selections.get(documentId);
    if (!selection) throw new LiveCanvasError('CANVAS_NOT_READY', 503, 'Canvas has not published a selection snapshot; retry attach');
    const connectionId = randomUUID();
    this.bindings.set(connectionId, { workspaceInstanceId, documentId, canvasEpoch: selection.canvasEpoch, notify });
    return this.read(connectionId);
  }
  read(connectionId: string): BoundSelection {
    const binding = this.bindings.get(connectionId);
    if (!binding) throw new LiveCanvasError('CONNECTION_NOT_FOUND', 404);
    if (binding.unavailable) throw new LiveCanvasError(binding.unavailable, binding.unavailable === 'canvas.disconnected' ? 503 : 410);
    const selection = this.publishers.get(binding.workspaceInstanceId)?.selections.get(binding.documentId);
    if (!selection || selection.canvasEpoch !== binding.canvasEpoch) throw new LiveCanvasError('CANVAS_UNAVAILABLE', 503);
    return { ...selection, connectionId, workspaceInstanceId: binding.workspaceInstanceId };
  }
  detach(connectionId: string) { this.bindings.delete(connectionId); }
  disconnect(owner: object, workspaceInstanceId: string) {
    if (this.publishers.get(workspaceInstanceId)?.owner !== owner) return;
    this.publishers.delete(workspaceInstanceId);
    this.invalidate(workspaceInstanceId, undefined, 'canvas.disconnected');
  }
  private publisher(owner: object, id: string) {
    const publisher = this.publishers.get(id);
    if (!publisher || publisher.owner !== owner) throw new LiveCanvasError('PUBLISHER_UNAVAILABLE', 503);
    return publisher;
  }
  private invalidate(workspaceInstanceId: string, documentId: string | undefined, reason: NonNullable<Binding['unavailable']>) {
    for (const [connectionId, binding] of this.bindings) if (!binding.unavailable && binding.workspaceInstanceId === workspaceInstanceId
      && (!documentId || binding.documentId === documentId)) {
      binding.unavailable = reason;
      binding.notify({ type: reason, connectionId, canvasEpoch: binding.canvasEpoch });
    }
  }
}
