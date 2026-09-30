import { selectionClipboardText, selectionDiagram } from '../../../../domain/mapping/workspace/selectionClipboard';
import type { LiveSelection } from '../../../../domain/mapping/agent/liveCanvasStatus';
import type { CanvasWorkspace } from '../workspace/canvasWorkspace';
import type { CanvasSession } from '../workspace/canvasSession';

/** Samples just the copy action's inputs. Pointer previews, layout and history are not serialized. */
export function observeCanvasSelection(session: CanvasSession, documentId: string, changed: (snapshot: LiveSelection) => void) {
  const canvasEpoch = crypto.randomUUID();
  let sequence = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let previous: LiveSelection | undefined;
  let inputs: { diagram: ReturnType<typeof selectionDiagram>; rect: object | null; ids: string[] } | undefined;
  let text: string | null = null;
  const sample = () => {
    timer = undefined;
    if (stopped) return;
    const snapshot = session.controller.getSnapshot(), controls = snapshot.canvas.controls;
    const diagram = controls.selectionRect ? selectionDiagram(snapshot.document, controls) : undefined;
    if (!inputs || inputs.diagram !== diagram || inputs.rect !== controls.selectionRect || inputs.ids !== controls.selectedNodeIds) {
      text = diagram ? selectionClipboardText(diagram, controls.selectionRect, controls.selectedNodeIds) : null;
      inputs = { diagram, rect: controls.selectionRect, ids: controls.selectedNodeIds };
    }
    if (previous && previous.documentVersion === snapshot.version && previous.text === text) return;
    previous = { documentId, canvasEpoch, sequence: sequence++, documentVersion: snapshot.version, text };
    changed(previous);
  };
  const unsubscribe = session.controller.subscribe(() => { timer ??= setTimeout(sample, 0); });
  sample();
  return { canvasEpoch, dispose() { stopped = true; clearTimeout(timer); unsubscribe(); } };
}

/** One publisher socket per browser workspace; reconnects with current, bounded snapshots. */
export function publishLiveCanvasSelections(workspace: CanvasWorkspace, workspaceInstanceId: string, endpoint: string) {
  let socket: WebSocket | undefined, ready = false, disposed = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined, drainTimer: ReturnType<typeof setTimeout> | undefined;
  const entries = new Map<string, { session: CanvasSession; observer: ReturnType<typeof observeCanvasSelection> }>();
  const latest = new Map<string, LiveSelection>();
  const pending = new Map<string, LiveSelection | { documentId: string; canvasEpoch: string }>();
  const drain = () => {
    clearTimeout(drainTimer);
    drainTimer = undefined;
    if (!ready || socket?.readyState !== WebSocket.OPEN) return;
    for (const [id, value] of pending) {
      if (socket.bufferedAmount > 64 * 1024) { drainTimer = setTimeout(drain, 20); return; }
      socket.send(JSON.stringify({ type: 'text' in value ? 'selection' : 'remove', ...value }));
      pending.delete(id);
    }
  };
  const refresh = () => {
    const drafts = workspace.store.getState().drafts;
    for (const [id, entry] of entries) if (!drafts[id] || drafts[id].hidden || drafts[id].session !== entry.session) {
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
    ws.onopen = () => ws.send(JSON.stringify({ type: 'publish', workspaceInstanceId }));
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'publisher.ready') {
        ready = true; pending.clear(); latest.forEach((value, id) => pending.set(id, value)); drain();
      } else if (message.type === 'error') ws.close(); // Registration may be racing this connection; retry with fresh state.
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      ready = false; clearTimeout(drainTimer);
      if (!disposed) reconnect = setTimeout(connect, 1000);
    };
  };
  connect();
  return () => {
    disposed = true; ready = false; clearTimeout(reconnect); clearTimeout(drainTimer);
    unsubscribe(); entries.forEach(entry => entry.observer.dispose()); entries.clear(); pending.clear(); latest.clear();
    socket?.close();
  };
}
