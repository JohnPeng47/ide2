import { CanvasApiProjection } from './apiProjection';
import { shortCanvasContext } from '../../../domain/mapping/agent/shortContext';
import { AgentContextService } from './agentContextService';
import { randomUUID } from 'node:crypto';
import { selectionDelta } from '../../../domain/mapping/agent/liveCanvasStatus';
import type { CanvasDescriptor } from '../../../domain/mapping/agent/contracts';
import type { BoundSelection, LiveCanvasContext, LiveCanvasEvent, LiveSelection, LiveSelectionDelta } from '../../../domain/mapping/agent/liveCanvasStatus';

export class LiveCanvasError extends Error {
  constructor(readonly code: string, readonly status: number, message = code) { super(message); }
}
type Snapshot = LiveSelection & { receivedAt: string };
type Binding = { workspaceInstanceId: string; documentId: string; canvasEpoch: string;
  unavailable?: 'canvas.disconnected' | 'canvas.closed' | 'canvas.replaced'; notify: (event: LiveCanvasEvent) => void };

/** Ephemeral selection mirror. Never hydrates a document, exports history or writes storage. */
export class LiveCanvasService {
  private publishers = new Map<string, { owner: object; selections: Map<string, Snapshot>; notify: (event: LiveCanvasEvent) => void }>();
  private bindings = new Map<string, Binding>();
  constructor(private readonly listCanvases: () => CanvasDescriptor[],
    private readonly loadContext?: (workspaceInstanceId: string, documentId: string) => Promise<LiveCanvasContext>,
    private readonly agentContexts = new AgentContextService(), private readonly projection = new CanvasApiProjection()) {}
  uploadAgentContext(connectionId: string, requestId: string, trajectory: unknown) {
    const binding = this.read(connectionId);
    return this.agentContexts.upload(binding, requestId, trajectory);
  }
  async contextForCanvas(workspaceInstanceId: string, documentId: string) {
    return (await this.loadCanvasContext(workspaceInstanceId, documentId)).context;
  }
  async shortContextForCanvas(workspaceInstanceId: string, documentId: string) {
    const { context, canvasEpoch } = await this.loadCanvasContext(workspaceInstanceId, documentId);
    return { workspaceInstanceId, documentId, canvasEpoch, ...shortCanvasContext(context) };
  }
  private async loadCanvasContext(workspaceInstanceId: string, documentId: string) {
    const publisher = this.publishers.get(workspaceInstanceId);
    const canvases = this.listCanvases();
    if (!publisher && canvases.length && !canvases.some(canvas => canvas.canvasId === workspaceInstanceId))
      throw new LiveCanvasError('CANVAS_INSTANCE_GONE', 410, 'The browser workspace instance is no longer available. Discover the current canvas ID and reconnect.');
    const selection = publisher?.selections.get(documentId);
    if (!selection) throw new LiveCanvasError('CANVAS_NOT_READY', 503, 'Canvas has not published a selection snapshot; retry attach');
    if (!this.loadContext) throw new LiveCanvasError('CONTEXT_UNAVAILABLE', 503, 'Canvas context is unavailable on this server');
    const context = await this.loadContext(workspaceInstanceId, documentId);
    if (this.publishers.get(workspaceInstanceId) !== publisher
      || publisher?.selections.get(documentId)?.canvasEpoch !== selection.canvasEpoch)
      throw new LiveCanvasError('CANVAS_REPLACED', 409, 'Canvas changed identity while reading context; reconnect');
    return { canvasEpoch: selection.canvasEpoch,
      context: { ...this.projection.result(context), edges: context.edges.map(edge => this.projection.edge(edge)) } };
  }
  async context(connectionId: string) {
    const before = this.read(connectionId);
    const context = await this.contextForCanvas(before.workspaceInstanceId, before.documentId);
    this.read(connectionId); // A close or replacement while awaiting the browser invalidates this response.
    return { connectionId, workspaceInstanceId: before.workspaceInstanceId, documentId: before.documentId, canvasEpoch: before.canvasEpoch, context };
  }
  publish(owner: object, workspaceInstanceId: string, notify: (event: LiveCanvasEvent) => void = () => {}) {
    if (!this.listCanvases().some(c => c.canvasId === workspaceInstanceId)) throw new LiveCanvasError('CANVAS_UNAVAILABLE', 503);
    if (this.publishers.has(workspaceInstanceId)) throw new LiveCanvasError('PUBLISHER_EXISTS', 409);
    this.publishers.set(workspaceInstanceId, { owner, selections: new Map(), notify });
  }
  update(owner: object, workspaceInstanceId: string, update: LiveSelection | LiveSelectionDelta) {
    const publisher = this.publisher(owner, workspaceInstanceId);
    const previous = publisher.selections.get(update.documentId);
    if (previous?.canvasEpoch === update.canvasEpoch && update.sequence <= previous.sequence) return;
    if (!previous && publisher.selections.size >= 100) throw new LiveCanvasError('DOCUMENT_LIMIT', 400);
    let selection: LiveSelection;
    if ('regions' in update) selection = update;
    else {
      if (!previous || previous.canvasEpoch !== update.canvasEpoch || previous.sequence !== update.baseSequence)
        throw new LiveCanvasError('SELECTION_OUT_OF_SYNC', 409, 'Reconnect and publish a fresh snapshot');
      if (new Set(update.upserted.map(region => region.id)).size !== update.upserted.length
        || new Set(update.removed).size !== update.removed.length
        || update.upserted.some(region => update.removed.includes(region.id)))
        throw new LiveCanvasError('INVALID_REGIONS', 400);
      const regions = new Map(previous.regions.map(region => [region.id, region]));
      update.removed.forEach(id => regions.delete(id));
      update.upserted.forEach(region => regions.set(region.id, region));
      selection = { documentId: update.documentId, canvasEpoch: update.canvasEpoch, sequence: update.sequence,
        documentVersion: update.documentVersion, regions: [...regions.values()], diagramIds: update.diagramIds ?? previous.diagramIds ?? [] };
    }
    const diagramIds = selection.diagramIds ?? [];
    if (diagramIds.length > 1000 || new Set(diagramIds).size !== diagramIds.length
      || diagramIds.some(id => !id.startsWith('grid:'))
      || selection.regions.some(region => diagramIds.includes(`grid:${region.sourceBoxId}`)))
      throw new LiveCanvasError('INVALID_REGIONS', 400, 'Whole diagrams replace their regions and must have unique grid IDs');
    if (selection.regions.length > 1000 || new Set(selection.regions.map(region => region.id)).size !== selection.regions.length
      || selection.regions.reduce((size, region) => size + region.text.length, 0) > 2_000_000)
      throw new LiveCanvasError('INVALID_REGIONS', 400, 'Regions must have unique IDs and fit the canvas payload limit');
    if (previous && previous.canvasEpoch !== selection.canvasEpoch) this.invalidate(workspaceInstanceId, selection.documentId, 'canvas.replaced');
    const receivedAt = new Date().toISOString();
    publisher.selections.set(selection.documentId, { ...selection, receivedAt });
    if (previous && previous.canvasEpoch === selection.canvasEpoch) {
      const delta = selectionDelta(previous, selection);
      for (const [connectionId, binding] of this.bindings) if (!binding.unavailable && binding.workspaceInstanceId === workspaceInstanceId
        && binding.documentId === selection.documentId) binding.notify({ type: 'selection.delta', ...delta, connectionId, workspaceInstanceId, receivedAt });
    }
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
    this.notifyAgents(workspaceInstanceId);
    return this.read(connectionId);
  }
  read(connectionId: string): BoundSelection {
    const binding = this.bindings.get(connectionId);
    if (!binding) throw new LiveCanvasError('CONNECTION_NOT_FOUND', 404);
    if (binding.unavailable) throw new LiveCanvasError(binding.unavailable, binding.unavailable === 'canvas.disconnected' ? 503 : 410);
    const selection = this.publishers.get(binding.workspaceInstanceId)?.selections.get(binding.documentId);
    if (!selection || selection.canvasEpoch !== binding.canvasEpoch) throw new LiveCanvasError('CANVAS_UNAVAILABLE', 503);
    return { ...selection, protocolVersion: 2, connectionId, workspaceInstanceId: binding.workspaceInstanceId };
  }
  detach(connectionId: string) {
    const binding = this.bindings.get(connectionId);
    if (!binding) return;
    this.bindings.delete(connectionId);
    if (!binding.unavailable) this.notifyAgents(binding.workspaceInstanceId);
  }
  private notifyAgents(workspaceInstanceId: string) {
    const count = [...this.bindings.values()].filter(binding => binding.workspaceInstanceId === workspaceInstanceId && !binding.unavailable).length;
    this.publishers.get(workspaceInstanceId)?.notify({ type: 'agents.changed', count });
  }
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
    let changed = false;
    for (const [connectionId, binding] of this.bindings) if (!binding.unavailable && binding.workspaceInstanceId === workspaceInstanceId
      && (!documentId || binding.documentId === documentId)) {
      changed = true;
      binding.unavailable = reason;
      binding.notify({ type: reason, connectionId, canvasEpoch: binding.canvasEpoch });
    }
    if (changed) this.notifyAgents(workspaceInstanceId);
  }
}
