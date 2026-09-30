import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { LiveCanvasService } from '../../../../../application/mapping/agent/liveCanvasService';
import { attachLiveCanvasSockets, readLiveSelection } from '../liveCanvasRoutes';

it('serves attach, push, plain-text GET, clears, disconnects and reconnects over real sockets', async () => {
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [{ documentId: 'doc', name: 'Test' }] }]);
  const server = createServer((req, res) => readLiveSelection(req, res, req.url!.split('/').at(-1)!, service));
  const dispose = attachLiveCanvasSockets(server, service), clients: WebSocket[] = [];
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const connect = async () => {
    const ws = new WebSocket(root.replace('http:', 'ws:') + '/api/mapping/live'); clients.push(ws); await once(ws, 'open'); return ws;
  };
  const send = async (ws: WebSocket, body: unknown) => {
    const next = once(ws, 'message'); ws.send(JSON.stringify(body)); return JSON.parse(String((await next)[0]));
  };
  try {
    const publisher = await connect(), reader = await connect();
    expect(await send(reader, { type: 'attach', workspaceInstanceId: 'workspace', documentId: 'doc' })).toMatchObject({ type: 'error', code: 'CANVAS_NOT_READY' });
    expect(await send(publisher, { type: 'publish', workspaceInstanceId: 'workspace' })).toEqual({ type: 'publisher.ready' });
    const text = 'Root\n|\n`--   Keep spaces  \nAssociated Code Entities:';
    const selection = { type: 'selection', documentId: 'doc', canvasEpoch: 'first', documentVersion: 4, sequence: 0, text };
    publisher.send(JSON.stringify(selection));
    // A producer ping's pong is ordered after the selection frame at the server.
    const pong = once(publisher, 'pong'); publisher.ping(); await pong;
    const attached = await send(reader, { type: 'attach', workspaceInstanceId: 'workspace', documentId: 'doc' });
    expect(attached).toMatchObject({ type: 'attached', text, canvasEpoch: 'first', sequence: 0 });
    const get = () => fetch(`${root}/${attached.connectionId}`);
    const response = await get(); expect(await response.text()).toBe(text);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-document-version')).toBe('4');
    expect(await send(reader, { type: 'attach', workspaceInstanceId: 'workspace', documentId: 'other' })).toMatchObject({ code: 'ALREADY_ATTACHED' });
    expect(await send(reader, selection)).toMatchObject({ code: 'PUBLISHER_REQUIRED' });
    let next = once(reader, 'message'); publisher.send(JSON.stringify({ ...selection, sequence: 1, text: null }));
    expect(JSON.parse(String((await next)[0]))).toMatchObject({ type: 'selection.changed', text: null, sequence: 1 });
    expect((await get()).status).toBe(204);
    next = once(reader, 'message'); publisher.close();
    expect(JSON.parse(String((await next)[0]))).toMatchObject({ type: 'canvas.disconnected' });
    expect((await get()).status).toBe(503);
    const closed = once(reader, 'close'); reader.close(); await closed;
    await expect.poll(async () => (await get()).status).toBe(404);
    const reconnect = await connect();
    expect(await send(reconnect, { type: 'attach', workspaceInstanceId: 'workspace', documentId: 'doc' })).toMatchObject({ code: 'CANVAS_NOT_READY' });
    const denied = new WebSocket(root.replace('http:', 'ws:') + '/api/mapping/live', { origin: 'https://unrelated.example' });
    clients.push(denied); const error = once(denied, 'error'); await error;
  } finally {
    clients.forEach(ws => ws.terminate()); dispose(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
