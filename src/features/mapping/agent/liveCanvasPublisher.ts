import { selectedDiagramIds } from '../../../../domain/mapping/selection/selectionState';
import { selectionClipboardText } from '../../../../domain/mapping/workspace/selectionClipboard';
import { asciiForSelection } from '../../../../domain/core/diagrams/diagramSelection';
import { formatAsciiWithCodeReferences } from '../../../../domain/core/diagrams/diagramClipboard';
import type { Diagram, GridBox } from '../../../../domain/core/diagrams/lineGrid';
import { sameDiagramSelection, sameRegion, selectionDelta, type LiveRegion, type LiveSelection } from '../../../../domain/mapping/agent/liveCanvasStatus';
import type { MappingPocGridRect } from '../../../../domain/mapping/selection/mappingPoc';
import type { CanvasWorkspace } from '../workspace/canvasWorkspace';
import type { CanvasSession } from '../workspace/canvasSession';
import { LiveCanvasPasteReceiver } from './liveCanvasPaste';
import { LiveCanvasCopyReceiver } from './liveCanvasCopy';

/** Read completed regions only; pointer previews, pane geometry and history are not published. */
export function observeCanvasSelection(session: CanvasSession, documentId: string, changed: (snapshot: LiveSelection) => void) {
  const canvasEpoch = crypto.randomUUID();
  let sequence = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let previous: LiveSelection | undefined;
  const cache = new Map<string, { diagram?: Diagram; rectKey: string; ids: readonly string[]; contentNodeIds?: readonly string[]; sourceAscii?: string; region: LiveRegion }>();
  const rectKey = (boxId: string, rect: MappingPocGridRect) => JSON.stringify([boxId, rect.startLine, rect.endLine, rect.startColumn, rect.endColumn]);
  const sample = () => {
    timer = undefined;
    if (stopped) return;
    const snapshot = session.controller.getSnapshot(), { selection } = snapshot.canvas;
    const boxes = new Map<string, string>();
    const visit = (box: GridBox) => {
      if (box.kind === 'container') box.children.forEach(visit);
      else boxes.set(box.id, box.contentId);
    };
    visit(snapshot.document.scene.root);
    const diagramIds = selectedDiagramIds(selection);
    const regions: LiveRegion[] = [];
    const add = (id: string, sourceBoxId: string, sourceContentId: string, rect: MappingPocGridRect,
      ids: readonly string[], sourceAscii?: string, contentNodeIds?: readonly string[]) => {
      const diagram = snapshot.document.scene.contents[sourceContentId];
      const stale = sourceAscii !== undefined && (!diagram || diagram.content.ascii !== sourceAscii || boxes.get(sourceBoxId) !== sourceContentId);
      const key = rectKey(sourceBoxId, rect), cached = cache.get(id);
      if (cached && cached.diagram === diagram && cached.rectKey === key && cached.ids === ids && cached.contentNodeIds === contentNodeIds
        && cached.sourceAscii === sourceAscii && cached.region.stale === stale && cached.region.sourceContentId === sourceContentId) {
        regions.push(cached.region); return;
      }
      const text = stale ? cached?.sourceAscii === sourceAscii ? cached.region.text : formatAsciiWithCodeReferences([asciiForSelection(sourceAscii!, rect)], [])
        : diagram ? selectionClipboardText(diagram, rect, ids, contentNodeIds)! : '';
      const region = { id, sourceBoxId, sourceContentId, rect, text, stale };
      cache.set(id, { diagram, rectKey: key, ids, contentNodeIds, sourceAscii, region }); regions.push(region);
    };
    for (const item of selection.items) if (item.region) {
      const { sourceContentId, sourceAscii, rect, selectedIds, contentNodeIds } = item.region;
      add(item.id, item.displayNodeId.slice(5), sourceContentId, rect, selectedIds, sourceAscii, contentNodeIds);
    }
    const liveIds = new Set(regions.map(region => region.id));
    for (const id of cache.keys()) if (!liveIds.has(id)) cache.delete(id);
    const before = new Map(previous?.regions.map(region => [region.id, region]));
    if (previous && sameDiagramSelection(previous.diagramIds, diagramIds) && before.size === regions.length && regions.every(region => before.has(region.id) && sameRegion(before.get(region.id)!, region))) return;
    previous = { documentId, canvasEpoch, sequence: sequence++, documentVersion: snapshot.version, regions, diagramIds };
    changed(previous);
  };
  const unsubscribe = session.controller.subscribe(() => { timer ??= setTimeout(sample, 0); });
  sample();
  return { canvasEpoch, dispose() { stopped = true; clearTimeout(timer); unsubscribe(); } };
}

export interface LiveAgentStatus { connected: boolean; count: number }

/** One publisher socket per browser workspace; reconnects with current, bounded snapshots. */
export function publishLiveCanvasSelections(workspace: CanvasWorkspace, workspaceInstanceId: string, endpoint: string, onAgentStatus?: (status: LiveAgentStatus) => void, canMutate: () => boolean = () => true) {
  let socket: WebSocket | undefined, ready = false, disposed = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined, drainTimer: ReturnType<typeof setTimeout> | undefined;
  const entries = new Map<string, { session: CanvasSession; observer: ReturnType<typeof observeCanvasSelection> }>();
  const latest = new Map<string, LiveSelection>();
  const sent = new Map<string, LiveSelection>();
  const pending = new Map<string, LiveSelection | { documentId: string; canvasEpoch: string }>();
  const paste = new LiveCanvasPasteReceiver();
  const copy = new LiveCanvasCopyReceiver();
  const drain = () => {
    clearTimeout(drainTimer);
    drainTimer = undefined;
    if (!ready || socket?.readyState !== WebSocket.OPEN) return;
    for (const [id, value] of pending) {
      if (socket.bufferedAmount > 64 * 1024) { drainTimer = setTimeout(drain, 20); return; }
      if ('regions' in value) {
        const previous = sent.get(id);
        socket.send(JSON.stringify(previous?.canvasEpoch === value.canvasEpoch
          ? { type: 'selection.delta', ...selectionDelta(previous, value) }
          : { type: 'selection.snapshot', ...value }));
        sent.set(id, value);
      } else { socket.send(JSON.stringify({ type: 'remove', ...value })); sent.delete(id); }
      pending.delete(id);
    }
  };
  const refresh = () => {
    const drafts = workspace.store.getState().drafts;
    for (const [id, entry] of entries) if (!drafts[id] || drafts[id].hidden || drafts[id].session !== entry.session) {
      entry.session.cursorCopy.clear();
      entry.observer.dispose(); entries.delete(id); latest.delete(id);
      pending.set(id, { documentId: id, canvasEpoch: entry.observer.canvasEpoch });
    }
    for (const [id, draft] of Object.entries(drafts)) if (!draft.hidden && !entries.has(id)) {
      const observer = observeCanvasSelection(draft.session, id, value => {
        latest.set(id, value); pending.set(id, value); drain();
      });
      entries.set(id, { session: draft.session, observer });
    }
    drain();
  };
  const unsubscribe = workspace.store.subscribe(refresh);
  refresh();
  const connect = () => {
    if (disposed) return;
    const ws = socket = new WebSocket(endpoint);
    ready = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'publish', protocolVersion: 2, workspaceInstanceId, capabilities: ['diagram.copy'] }));
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'publisher.ready') {
        onAgentStatus?.({ connected: true, count: 0 });
        ready = true; sent.clear(); pending.clear(); latest.forEach((value, id) => pending.set(id, value)); drain();
      } else if (message.type === 'agents.changed') {
        onAgentStatus?.({ connected: true, count: message.count });
      } else if (message.type === 'diagram.copy.command' && ready) {
        const draft = workspace.store.getState().drafts[message.documentId];
        const entry = entries.get(message.documentId);
        const epoch = entry?.session === draft?.session ? entry?.observer.canvasEpoch : undefined;
        ws.send(JSON.stringify(copy.apply(message, draft, epoch, canMutate())));
      } else if (message.type === 'diagram.paste.command' && ready) {
        const draft = workspace.store.getState().drafts[message.documentId];
        const entry = entries.get(message.documentId);
        const epoch = entry?.session === draft?.session ? entry?.observer.canvasEpoch : undefined;
        ws.send(JSON.stringify(paste.apply(message, draft, epoch, canMutate())));
      } else if (message.type === 'error') ws.close(); // Registration may be racing this connection; retry with fresh state.
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      entries.forEach(entry => entry.session.cursorCopy.clear());
      ready = false; clearTimeout(drainTimer);
      if (!disposed) onAgentStatus?.({ connected: false, count: 0 });
      if (!disposed) reconnect = setTimeout(connect, 1000);
    };
  };
  connect();
  return () => {
    entries.forEach(entry => entry.session.cursorCopy.clear());
    disposed = true; ready = false; clearTimeout(reconnect); clearTimeout(drainTimer);
    unsubscribe(); entries.forEach(entry => entry.observer.dispose()); entries.clear(); pending.clear(); latest.clear();
    socket?.close();
  };
}
