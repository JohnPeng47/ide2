import { CanvasApiProjection } from './apiProjection';
import { shortCanvasContext } from '../../../domain/mapping/agent/shortContext';
import { AgentContextService } from './agentContextService';
import { randomUUID } from 'node:crypto';
import { selectionDelta } from '../../../domain/mapping/agent/liveCanvasStatus';
import { livePasteSchema, type LivePaste, type LivePasteCommand, type LivePasteReply } from '../../../domain/mapping/agent/liveCanvasStatus';
import { normalizePastedDiagram } from '../../../domain/mapping/agent/pasteDiagram';
import { liveCopySchema, type LiveCopy, type LiveCopyCommand, type LiveCopyReply } from '../../../domain/mapping/agent/liveCanvasStatus';
import type { CanvasDescriptor } from '../../../domain/mapping/agent/contracts';
import type { BoundSelection, LiveCanvasContext, LiveCanvasEvent, LiveSelection, LiveSelectionDelta } from '../../../domain/mapping/agent/liveCanvasStatus';

export class LiveCanvasError extends Error {
  constructor(readonly code: string, readonly status: number, message = code) { super(message); }
}
type Snapshot = LiveSelection & { receivedAt: string };
type Binding = { workspaceInstanceId: string; documentId: string; canvasEpoch: string;
  unavailable?: 'canvas.disconnected' | 'canvas.closed' | 'canvas.replaced'; notify: (event: LiveCanvasEvent) => void };
type PasteReceipt = { workspaceInstanceId: string; signature: string; command: LivePasteCommand;
  result?: LivePasteReply['result']; pending?: { promise: Promise<LivePasteReply['result']>;
    resolve: (result: LivePasteReply['result']) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } };
type CopyReceipt = { workspaceInstanceId: string; signature: string; command: LiveCopyCommand;
  result?: LiveCopyReply['result']; pending?: { promise: Promise<LiveCopyReply['result']>;
    resolve: (result: LiveCopyReply['result']) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } };

/** Live bindings and selection mirror; paste commands execute in the owning browser. */
export class LiveCanvasService {
  private publishers = new Map<string, { owner: object; capabilities: ReadonlySet<string>; selections: Map<string, Snapshot>; notify: (event: LiveCanvasEvent) => void }>();
  private bindings = new Map<string, Binding>();
  // Never evict receipts: an ambiguous retry must not become a second insertion.
  private pastes = new Map<string, PasteReceipt>();
  private pasteCommands = new Map<string, PasteReceipt>();
  private copies = new Map<string, CopyReceipt>();
  private copyCommands = new Map<string, CopyReceipt>();
  constructor(private readonly listCanvases: () => CanvasDescriptor[],
    private readonly loadContext?: (workspaceInstanceId: string, documentId: string) => Promise<LiveCanvasContext>,
    private readonly agentContexts = new AgentContextService(), private readonly projection = new CanvasApiProjection()) {}
  async copy(connectionId: string, raw: LiveCopy) {
    const input = liveCopySchema.parse(raw), binding = this.read(connectionId);
    const key = JSON.stringify([binding.workspaceInstanceId, binding.documentId, binding.canvasEpoch, input.requestId]);
    const signature = JSON.stringify(input);
    let receipt = this.copies.get(key);
    if (receipt && receipt.signature !== signature) throw new LiveCanvasError('REQUEST_ID_REUSED', 409);
    // A v2 selection publisher can predate copy support. Never send a command it
    // will silently ignore; completed receipts remain safe to read on a retry.
    if (!receipt?.result && !this.publishers.get(binding.workspaceInstanceId)!.capabilities.has('diagram.copy'))
      throw new LiveCanvasError('COPY_UNSUPPORTED', 409, 'The connected canvas tab does not support diagram copy. Reload the canvas tab, then reconnect this thread.');
    if (!receipt) {
      if (this.copies.size >= 2000) throw new LiveCanvasError('COPY_HISTORY_FULL', 503, 'Copy receipt capacity reached; restart the backend');
      let ascii: string;
      try { ascii = normalizePastedDiagram(input.text); }
      catch (error) { throw new LiveCanvasError('INVALID_DIAGRAM', 400, error instanceof Error ? error.message : String(error)); }
      const command: LiveCopyCommand = { type: 'diagram.copy.command', commandId: randomUUID(),
        documentId: binding.documentId, canvasEpoch: binding.canvasEpoch, ascii };
      receipt = { workspaceInstanceId: binding.workspaceInstanceId, signature, command };
      this.copies.set(key, receipt); this.copyCommands.set(command.commandId, receipt);
    }
    if (!receipt.result && !receipt.pending) {
      if ([...this.copies.values()].filter(value => value.pending).length >= 100) throw new LiveCanvasError('COPY_BUSY', 503);
      const target = receipt;
      let resolve!: (result: LiveCopyReply['result']) => void, reject!: (error: Error) => void;
      const promise = new Promise<LiveCopyReply['result']>((yes, no) => { resolve = yes; reject = no; });
      const timer = setTimeout(() => {
        target.pending = undefined;
        reject(new LiveCanvasError('CANVAS_TIMEOUT', 504, 'Outcome may be unknown; retry identical arguments with the same requestId'));
      }, 25000);
      timer.unref(); target.pending = { promise, resolve, reject, timer };
      this.publishers.get(binding.workspaceInstanceId)!.notify(target.command);
    }
    const result = receipt.result ?? await receipt.pending!.promise;
    this.read(connectionId);
    if (!result.ok) throw new LiveCanvasError(result.code, 409, result.error);
    return { type: 'diagram.copied' as const, requestId: input.requestId, connectionId,
      workspaceInstanceId: binding.workspaceInstanceId, documentId: binding.documentId, canvasEpoch: binding.canvasEpoch };
  }
  copyReply(owner: object, workspaceInstanceId: string, reply: LiveCopyReply) {
    this.publisher(owner, workspaceInstanceId);
    const receipt = this.copyCommands.get(reply.commandId);
    if (!receipt || receipt.workspaceInstanceId !== workspaceInstanceId) throw new LiveCanvasError('UNKNOWN_COPY', 404);
    if (receipt.result) return;
    receipt.result = reply.result;
    if (receipt.pending) { clearTimeout(receipt.pending.timer); receipt.pending.resolve(reply.result); receipt.pending = undefined; }
  }
  async paste(connectionId: string, raw: LivePaste) {
    const input = livePasteSchema.parse(raw), binding = this.read(connectionId);
    const key = JSON.stringify([binding.workspaceInstanceId, binding.documentId, binding.canvasEpoch, input.requestId]);
    const signature = JSON.stringify(input);
    let receipt = this.pastes.get(key);
    if (receipt && receipt.signature !== signature) throw new LiveCanvasError('REQUEST_ID_REUSED', 409, 'Use a new requestId for changed paste arguments');
    if (!receipt) {
      if (this.pastes.size >= 2000) throw new LiveCanvasError('PASTE_HISTORY_FULL', 503, 'Paste receipt capacity reached; restart the backend');
      let ascii: string;
      try { ascii = normalizePastedDiagram(input.text); }
      catch (error) { throw new LiveCanvasError('INVALID_DIAGRAM', 400, String(error instanceof Error ? error.message : error)); }
      const command: LivePasteCommand = { type: 'diagram.paste.command', commandId: randomUUID(),
        documentId: binding.documentId, canvasEpoch: binding.canvasEpoch, expectedVersion: input.expectedVersion,
        nodeId: `grid:diagram-${randomUUID()}`, ascii, position: input.position };
      receipt = { workspaceInstanceId: binding.workspaceInstanceId, signature, command };
      this.pastes.set(key, receipt); this.pasteCommands.set(command.commandId, receipt);
    }
    if (!receipt.result && !receipt.pending) {
      if ([...this.pastes.values()].filter(value => value.pending).length >= 100)
        throw new LiveCanvasError('PASTE_BUSY', 503, 'Too many pending pastes; retry the same request');
      const target = receipt;
      let resolve!: (result: LivePasteReply['result']) => void, reject!: (error: Error) => void;
      const promise = new Promise<LivePasteReply['result']>((yes, no) => { resolve = yes; reject = no; });
      const timer = setTimeout(() => {
        target.pending = undefined;
        reject(new LiveCanvasError('CANVAS_TIMEOUT', 504, 'Outcome may be unknown; retry identical arguments with the same requestId'));
      }, 25000);
      timer.unref();
      target.pending = { promise, resolve, reject, timer };
      this.publishers.get(binding.workspaceInstanceId)!.notify(target.command);
    }
    const result = receipt.result ?? await receipt.pending!.promise;
    this.read(connectionId);
    if (!result.ok) throw new LiveCanvasError(result.code, 409, result.error);
    return { type: 'diagram.pasted' as const, requestId: input.requestId, connectionId,
      workspaceInstanceId: binding.workspaceInstanceId, documentId: binding.documentId, canvasEpoch: binding.canvasEpoch,
      nodeId: result.nodeId, version: result.version };
  }
  pasteReply(owner: object, workspaceInstanceId: string, reply: LivePasteReply) {
    this.publisher(owner, workspaceInstanceId);
    const receipt = this.pasteCommands.get(reply.commandId);
    if (!receipt || receipt.workspaceInstanceId !== workspaceInstanceId) throw new LiveCanvasError('UNKNOWN_PASTE', 404);
    if (reply.result.ok && (reply.result.nodeId !== receipt.command.nodeId || reply.result.version !== receipt.command.expectedVersion + 1))
      throw new LiveCanvasError('INVALID_PASTE_REPLY', 400);
    if (receipt.result) return;
    receipt.result = reply.result;
    if (receipt.pending) { clearTimeout(receipt.pending.timer); receipt.pending.resolve(reply.result); receipt.pending = undefined; }
  }
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
  publish(owner: object, workspaceInstanceId: string, notify: (event: LiveCanvasEvent) => void = () => {}, capabilities: readonly string[] = []) {
    if (!this.listCanvases().some(c => c.canvasId === workspaceInstanceId)) throw new LiveCanvasError('CANVAS_UNAVAILABLE', 503);
    if (this.publishers.has(workspaceInstanceId)) throw new LiveCanvasError('PUBLISHER_EXISTS', 409);
    this.publishers.set(workspaceInstanceId, { owner, capabilities: new Set(capabilities), selections: new Map(), notify });
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
    for (const receipt of this.copies.values()) if (receipt.workspaceInstanceId === workspaceInstanceId
      && (!documentId || receipt.command.documentId === documentId) && receipt.pending) {
      clearTimeout(receipt.pending.timer); receipt.pending.reject(new LiveCanvasError(reason, 410)); receipt.pending = undefined;
    }
    for (const receipt of this.pastes.values()) if (receipt.workspaceInstanceId === workspaceInstanceId
      && (!documentId || receipt.command.documentId === documentId) && receipt.pending) {
      clearTimeout(receipt.pending.timer);
      receipt.pending.reject(new LiveCanvasError(reason, 410, `${reason}: outcome may be unknown; rediscover before retrying`));
      receipt.pending = undefined;
    }
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
