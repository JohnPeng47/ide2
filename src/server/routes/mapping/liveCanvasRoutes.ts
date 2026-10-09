import { AgentContextError } from '../../../../application/mapping/agent/agentContextService';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { LiveCanvasError, type LiveCanvasService } from '../../../../application/mapping/agent/liveCanvasService';
import { liveCanvasMessageSchema, type LiveCanvasEvent } from '../../../../domain/mapping/agent/liveCanvasStatus';
import { sendJson } from '../../http/http';
import type { Connect } from 'vite';
import type { ServerResponse } from 'node:http';

export async function readShortContext(request: Connect.IncomingMessage, response: ServerResponse, url: URL, service: LiveCanvasService) {
  response.setHeader('cache-control', 'no-store');
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' });
  const workspaceInstanceId = url.searchParams.get('workspaceInstanceId'), documentId = url.searchParams.get('documentId');
  if (!workspaceInstanceId || workspaceInstanceId.length > 200 || !documentId || documentId.length > 200
    || url.searchParams.getAll('workspaceInstanceId').length !== 1 || url.searchParams.getAll('documentId').length !== 1)
    return sendJson(response, 400, { code: 'INVALID_REQUEST', error: 'Provide one workspaceInstanceId and one documentId (1–200 characters each)' });
  try {
    const context = await service.shortContextForCanvas(workspaceInstanceId, documentId);
    response.setHeader('X-Canvas-Epoch', context.canvasEpoch);
    response.setHeader('X-Document-Version', String(context.version));
    return sendJson(response, 200, context);
  } catch (error) {
    if (error instanceof LiveCanvasError) return sendJson(response, error.status, { code: error.code, error: error.message });
    const message = error instanceof Error ? error.message : String(error);
    return sendJson(response, 503, { code: 'CONTEXT_UNAVAILABLE', error: message });
  }
}

export function readLiveSelection(request: Connect.IncomingMessage, response: ServerResponse, connectionId: string, service: LiveCanvasService) {
  response.setHeader('cache-control', 'private, no-cache');
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' });
  try {
    const selection = service.read(connectionId);
    response.setHeader('X-Canvas-Epoch', selection.canvasEpoch);
    response.setHeader('X-Selection-Sequence', String(selection.sequence));
    response.setHeader('X-Document-Version', String(selection.documentVersion));
    response.setHeader('X-Selection-Received-At', selection.receivedAt);
    const etag = `"${selection.connectionId}:${selection.sequence}"`;
    response.setHeader('etag', etag);
    const matches = request.headers['if-none-match']?.split(',').some(tag => tag.trim().replace(/^W\//, '') === etag || tag.trim() === '*');
    if (matches) { response.statusCode = 304; response.end(); return; }
    sendJson(response, 200, selection);
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

export function attachLiveCanvasSockets(server: UpgradeServer, service: LiveCanvasService, options: { agentContextUploadsEnabled?: boolean } = {}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  const alive = new Set<WebSocket>();
  sockets.on('connection', ws => {
    alive.add(ws);
    let workspaceInstanceId: string | undefined, connectionId: string | undefined;
    let contextPending = false, attaching = false, contextAllowance = 0;
    const send = (event: LiveCanvasEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Deltas cannot be dropped/coalesced independently. Bound the transport queue
      // and force slow readers to reconnect for an authoritative snapshot instead.
      if (ws.bufferedAmount > 64 * 1024 + contextAllowance) { ws.close(1013, 'Reader too slow; reconnect for snapshot'); return; }
      const encoded = JSON.stringify(event);
      const hasContext = event.type === 'context.snapshot' || event.type === 'attached' && event.context !== undefined;
      if (hasContext) {
        const bytes = Buffer.byteLength(encoded);
        if (bytes > 64 * 1024 * 1024) { ws.close(1009, 'Canvas context exceeds 64 MiB transport limit'); return; }
        contextAllowance += bytes;
        ws.send(encoded, () => { contextAllowance -= bytes; });
      } else ws.send(encoded);
    };
    let handshake = setTimeout(() => { if (!connectionId && !workspaceInstanceId) ws.close(1008, 'Attach required'); }, 10_000);
    ws.on('pong', () => alive.add(ws));
    ws.on('error', () => ws.terminate());
    ws.on('message', async (raw, binary) => {
      let requestId: string | undefined;
      try {
        if (binary) throw new LiveCanvasError('INVALID_MESSAGE', 400, 'Expected a JSON text frame');
        const decoded: unknown = JSON.parse(raw.toString());
        if (decoded && typeof decoded === 'object' && 'requestId' in decoded
          && typeof decoded.requestId === 'string' && decoded.requestId.length <= 200) requestId = decoded.requestId;
        const message = liveCanvasMessageSchema.parse(decoded);
        if (options.agentContextUploadsEnabled !== true && message.type === 'agent-context.upload') {
          throw new LiveCanvasError('HTTP_WRITES_DISABLED', 403, 'Agent context uploads are disabled; start the server with --http to enable them.');
        }
        if (message.type === 'attach' || message.type === 'publish') {
          if (connectionId || workspaceInstanceId || attaching) throw new LiveCanvasError('ALREADY_ATTACHED', 409, 'Open another socket to bind another canvas');
          if (message.type === 'attach') {
            attaching = true;
            let context;
            try {
              if (message.includeContext) {
                clearTimeout(handshake);
                handshake = setTimeout(() => ws.close(1008, 'Canvas context timed out'), 30_000);
                context = await service.contextForCanvas(message.workspaceInstanceId, message.documentId);
              }
            } finally { attaching = false; }
            if (ws.readyState !== WebSocket.OPEN) return;
            const initial = service.attach(message.workspaceInstanceId, message.documentId, send);
            connectionId = initial.connectionId;
            send({ type: 'attached', ...initial, ...(context ? { context } : {}) });
          } else {
            service.publish(ws, message.workspaceInstanceId, send);
            workspaceInstanceId = message.workspaceInstanceId;
            send({ type: 'publisher.ready', protocolVersion: 2 });
          }
          clearTimeout(handshake);
        } else if (message.type === 'agent-context.upload') {
          if (!connectionId) throw new LiveCanvasError('READER_REQUIRED', 403);
          const { type: _, requestId: uploadRequestId, ...trajectory } = message;
          send({ type: 'agent-context.uploaded', requestId: uploadRequestId, connectionId,
            ...service.uploadAgentContext(connectionId, uploadRequestId, trajectory) });
        } else if (message.type === 'context.get') {
          requestId = message.requestId;
          if (!connectionId) throw new LiveCanvasError('READER_REQUIRED', 403);
          if (contextPending || contextAllowance > 0) throw new LiveCanvasError('CONTEXT_BUSY', 409, 'Wait for the pending context request');
          contextPending = true;
          try { send({ type: 'context.snapshot', requestId, ...await service.context(connectionId) }); }
          finally { contextPending = false; }
        } else {
          if (!workspaceInstanceId) throw new LiveCanvasError('PUBLISHER_REQUIRED', 403);
          if (message.type === 'remove') service.remove(ws, workspaceInstanceId, message.documentId, message.canvasEpoch);
          else {
            const { type: _, ...selection } = message;
            service.update(ws, workspaceInstanceId, selection);
          }
        }
      } catch (error) {
        send({ type: 'error', ...(requestId ? { requestId } : {}), code: error instanceof LiveCanvasError || error instanceof AgentContextError ? error.code : 'INVALID_MESSAGE',
          error: error instanceof Error ? error.message : String(error) });
      }
    });
    ws.on('close', () => {
      clearTimeout(handshake); alive.delete(ws);
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
