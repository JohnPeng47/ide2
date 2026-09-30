import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { LiveCanvasError, type LiveCanvasService } from '../../../../application/mapping/agent/liveCanvasService';
import { liveCanvasMessageSchema, type LiveCanvasEvent } from '../../../../domain/mapping/agent/liveCanvasStatus';
import { sendJson } from '../../http/http';
import type { Connect } from 'vite';
import type { ServerResponse } from 'node:http';

export function readLiveSelection(request: Connect.IncomingMessage, response: ServerResponse, connectionId: string, service: LiveCanvasService) {
  response.setHeader('cache-control', 'no-store');
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' });
  try {
    const selection = service.read(connectionId);
    response.setHeader('X-Canvas-Epoch', selection.canvasEpoch);
    response.setHeader('X-Selection-Sequence', String(selection.sequence));
    response.setHeader('X-Document-Version', String(selection.documentVersion));
    response.setHeader('X-Selection-Received-At', selection.receivedAt);
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.statusCode = selection.text === null ? 204 : 200;
    response.end(selection.text ?? undefined);
  } catch (error) {
    if (!(error instanceof LiveCanvasError)) throw error;
    sendJson(response, error.status, { code: error.code, error: error.message });
  }
}

/** One endpoint; the first frame either attaches an external reader or registers a browser publisher. */
type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
interface UpgradeServer {
  on(event: 'upgrade', listener: UpgradeListener): unknown;
  off(event: 'upgrade', listener: UpgradeListener): unknown;
}

export function attachLiveCanvasSockets(server: UpgradeServer, service: LiveCanvasService) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  const alive = new Set<WebSocket>();
  sockets.on('connection', ws => {
    alive.add(ws);
    let workspaceInstanceId: string | undefined, connectionId: string | undefined;
    let pending: LiveCanvasEvent | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    const send = (event: LiveCanvasEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // A slow reader retains one latest status, not a queue of obsolete selections.
      if (ws.bufferedAmount > 64 * 1024) {
        pending = event;
        retry ??= setTimeout(() => { retry = undefined; const next = pending; pending = undefined; if (next) send(next); }, 20);
      } else {
        pending = undefined;
        ws.send(JSON.stringify(event));
      }
    };
    const handshake = setTimeout(() => { if (!connectionId && !workspaceInstanceId) ws.close(1008, 'Attach required'); }, 10_000);
    ws.on('pong', () => alive.add(ws));
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw, binary) => {
      try {
        if (binary) throw new LiveCanvasError('INVALID_MESSAGE', 400, 'Expected a JSON text frame');
        const message = liveCanvasMessageSchema.parse(JSON.parse(raw.toString()));
        if (message.type === 'attach' || message.type === 'publish') {
          if (connectionId || workspaceInstanceId) throw new LiveCanvasError('ALREADY_ATTACHED', 409, 'Open another socket to bind another canvas');
          if (message.type === 'attach') {
            const initial = service.attach(message.workspaceInstanceId, message.documentId, send);
            connectionId = initial.connectionId;
            send({ type: 'attached', ...initial });
          } else {
            service.publish(ws, message.workspaceInstanceId);
            workspaceInstanceId = message.workspaceInstanceId;
            send({ type: 'publisher.ready' });
          }
          clearTimeout(handshake);
        } else {
          if (!workspaceInstanceId) throw new LiveCanvasError('PUBLISHER_REQUIRED', 403);
          if (message.type === 'remove') service.remove(ws, workspaceInstanceId, message.documentId, message.canvasEpoch);
          else {
            const { type: _, ...selection } = message;
            service.update(ws, workspaceInstanceId, selection);
          }
        }
      } catch (error) {
        send({ type: 'error', code: error instanceof LiveCanvasError ? error.code : 'INVALID_MESSAGE',
          error: error instanceof Error ? error.message : String(error) });
      }
    });
    ws.on('close', () => {
      clearTimeout(handshake); clearTimeout(retry); alive.delete(ws);
      if (connectionId) service.detach(connectionId);
      if (workspaceInstanceId) service.disconnect(ws, workspaceInstanceId);
    });
  });
  const upgrade: UpgradeListener = (request, socket, head) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/api/mapping/live') return;
    // Native clients may omit Origin. Browser clients must belong to this app's origin.
    let allowed = !request.headers.origin;
    try { allowed ||= new URL(request.headers.origin!).host === request.headers.host; } catch { /* invalid origin */ }
    if (!allowed || sockets.clients.size >= 1024) {
      socket.end(`HTTP/1.1 ${allowed ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request));
  };
  server.on('upgrade', upgrade);
  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      if (!alive.delete(ws)) ws.terminate(); else ws.ping();
    }
  }, 15_000);
  heartbeat.unref();
  return () => {
    clearInterval(heartbeat); server.off('upgrade', upgrade);
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
  };
}
