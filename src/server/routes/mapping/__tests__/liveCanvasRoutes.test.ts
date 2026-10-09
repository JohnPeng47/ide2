import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, it, vi } from 'vitest';
import { LiveCanvasService } from '../../../../../application/mapping/agent/liveCanvasService';
import { attachLiveCanvasSockets, readLiveSelection } from '../liveCanvasRoutes';

it('serves attach, push, JSON snapshots, deltas, conditional GET, clears, disconnects and reconnects over real sockets', async () => {
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
    expect(await send(reader, { type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc' })).toMatchObject({ type: 'error', code: 'CANVAS_NOT_READY' });
    expect(await send(publisher, { type: 'publish', protocolVersion: 2, workspaceInstanceId: 'workspace' })).toEqual({ type: 'publisher.ready', protocolVersion: 2 });
    const text = 'Root\n|\n`--   Keep spaces  \nAssociated Code Entities:';
    const region = { id: 'a', sourceBoxId: 'box', sourceContentId: 'content', rect: { startLine: 1, endLine: 3, startColumn: 1, endColumn: 10 }, text, stale: false };
    const selection = { type: 'selection.snapshot', documentId: 'doc', canvasEpoch: 'first', documentVersion: 4, sequence: 0, regions: [region] };
    publisher.send(JSON.stringify(selection));
    // A producer ping's pong is ordered after the selection frame at the server.
    const pong = once(publisher, 'pong'); publisher.ping(); await pong;
    const attached = await send(reader, { type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc' });
    expect(attached).toMatchObject({ type: 'attached', regions: [region], canvasEpoch: 'first', sequence: 0 });
    const get = () => fetch(`${root}/${attached.connectionId}`);
    const response = await get(); expect((await response.json()).regions).toEqual([region]);
    const cached = await fetch(`${root}/${attached.connectionId}`, { headers: { 'If-None-Match': response.headers.get('etag')! } });
    expect(cached.status).toBe(304); expect(await cached.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('x-document-version')).toBe('4');
    expect(await send(reader, { type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'other' })).toMatchObject({ code: 'ALREADY_ATTACHED' });
    expect(await send(reader, selection)).toMatchObject({ code: 'PUBLISHER_REQUIRED' });
    const b = { ...region, id: 'b', text: 'Second region' };
    let next = once(reader, 'message'); publisher.send(JSON.stringify({ type: 'selection.delta', documentId: 'doc', canvasEpoch: 'first', documentVersion: 4, baseSequence: 0, sequence: 1, upserted: [b], removed: [] }));
    expect(JSON.parse(String((await next)[0]))).toMatchObject({ type: 'selection.delta', upserted: [b], removed: [], baseSequence: 0, sequence: 1 });
    const laterReader = await connect();
    expect(await send(laterReader, { type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc' })).toMatchObject({ regions: [region, b], sequence: 1 });
    next = once(reader, 'message'); publisher.send(JSON.stringify({ type: 'selection.delta', documentId: 'doc', canvasEpoch: 'first', documentVersion: 4, baseSequence: 1, sequence: 2, upserted: [], removed: ['a', 'b'] }));
    expect(JSON.parse(String((await next)[0]))).toMatchObject({ type: 'selection.delta', upserted: [], removed: ['a', 'b'], sequence: 2 });
    expect((await (await get()).json()).regions).toEqual([]);
    expect((await fetch(`${root}/${attached.connectionId}`, { headers: { 'If-None-Match': response.headers.get('etag')! } })).status).toBe(200);
    next = once(reader, 'message'); publisher.close();
    expect(JSON.parse(String((await next)[0]))).toMatchObject({ type: 'canvas.disconnected' });
    expect((await get()).status).toBe(503);
    const closed = once(reader, 'close'); reader.close(); await closed;
    await expect.poll(async () => (await get()).status).toBe(404);
    const reconnect = await connect();
    expect(await send(reconnect, { type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc' })).toMatchObject({ code: 'CANVAS_NOT_READY' });
    const denied = new WebSocket(root.replace('http:', 'ws:') + '/api/mapping/live', { origin: 'https://unrelated.example' });
    clients.push(denied); const error = once(denied, 'error'); await error;
  } finally {
    clients.forEach(ws => ws.terminate()); dispose(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});


it('closes slow readers instead of dropping removal deltas and reattaches with current state', async () => {
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [] }]);
  const server = createServer(), dispose = attachLiveCanvasSockets(server, service), clients: WebSocket[] = [];
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/live`;
  const owner = {};
  const region = { id: 'a', sourceBoxId: 'box', sourceContentId: 'content', rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 1 }, text: 'A', stale: false };
  const selection = { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 1, sequence: 0, regions: [region] };
  service.publish(owner, 'workspace'); service.update(owner, 'workspace', selection);
  const attach = async () => {
    const ws = new WebSocket(url); clients.push(ws); await once(ws, 'open');
    const message = once(ws, 'message');
    ws.send(JSON.stringify({ type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc' }));
    return { ws, initial: JSON.parse(String((await message)[0])) };
  };
  try {
    const { ws, initial } = await attach();
    expect(initial.regions).toEqual([region]);
    const closed = once(ws, 'close');
    const backlog = vi.spyOn(WebSocket.prototype, 'bufferedAmount', 'get').mockReturnValue(100_000);
    try { service.update(owner, 'workspace', { ...selection, sequence: 1, regions: [] }); }
    finally { backlog.mockRestore(); }
    expect((await closed)[0]).toBe(1013);
    const replacement = await attach();
    expect(replacement.initial).toMatchObject({ regions: [], sequence: 1 });
  } finally {
    clients.forEach(ws => ws.terminate()); dispose();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('optionally attaches context before deltas, refreshes on demand, and correlates context failures', async () => {
  let resolve!: (value: { version: number; name: string; nodes: []; edges: [] }) => void;
  const load = vi.fn(() => new Promise<{ version: number; name: string; nodes: []; edges: [] }>(done => { resolve = done; }));
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [] }], load);
  const owner = {};
  service.publish(owner, 'workspace');
  const selection = { documentId: 'doc', canvasEpoch: 'epoch', sequence: 0, documentVersion: 1, regions: [] };
  service.update(owner, 'workspace', selection);
  const server = createServer(), dispose = attachLiveCanvasSockets(server, service);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const reader = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/live`);
  await once(reader, 'open');
  const frames: Record<string, unknown>[] = [];
  reader.on('message', raw => frames.push(JSON.parse(String(raw))));
  try {
    reader.send(JSON.stringify({ type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc', includeContext: true }));
    await expect.poll(() => load.mock.calls.length).toBe(1);
    service.update(owner, 'workspace', { ...selection, sequence: 1 });
    expect(frames).toHaveLength(0);
    resolve({ version: 4, name: 'Canvas', nodes: [], edges: [] });
    await expect.poll(() => frames.length).toBe(1);
    expect(frames[0]).toMatchObject({ type: 'attached', sequence: 1, context: { version: 4, name: 'Canvas', nodes: [], edges: [] } });
    reader.send(JSON.stringify({ type: 'context.get', requestId: 'refresh' }));
    await expect.poll(() => load.mock.calls.length).toBe(2);
    reader.send(JSON.stringify({ type: 'context.get', requestId: 'busy' }));
    await expect.poll(() => frames.length).toBe(2);
    expect(frames[1]).toMatchObject({ type: 'error', requestId: 'busy', code: 'CONTEXT_BUSY' });
    resolve({ version: 5, name: 'Renamed', nodes: [], edges: [] });
    await expect.poll(() => frames.length).toBe(3);
    expect(frames[2]).toMatchObject({ type: 'context.snapshot', requestId: 'refresh', connectionId: frames[0].connectionId,
      workspaceInstanceId: 'workspace', documentId: 'doc', canvasEpoch: 'epoch', context: { version: 5, name: 'Renamed' } });
    reader.send(JSON.stringify({ type: 'context.get', requestId: 'closing' }));
    await expect.poll(() => load.mock.calls.length).toBe(3);
    service.remove(owner, 'workspace', 'doc', 'epoch');
    resolve({ version: 6, name: 'Obsolete', nodes: [], edges: [] });
    await expect.poll(() => frames.length).toBe(5);
    expect(frames[3]).toMatchObject({ type: 'canvas.closed' });
    expect(frames[4]).toMatchObject({ type: 'error', requestId: 'closing', code: 'CANVAS_REPLACED' });
  } finally {
    reader.terminate(); dispose();
    await new Promise<void>(done => server.close(() => done()));
  }
});

it('does not leak a binding when the reader closes during initial context loading', async () => {
  let resolve!: (value: { version: number; nodes: []; edges: [] }) => void;
  const load = vi.fn(() => new Promise<{ version: number; nodes: []; edges: [] }>(done => { resolve = done; }));
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [] }], load);
  const attach = vi.spyOn(service, 'attach'), owner = {};
  service.publish(owner, 'workspace');
  service.update(owner, 'workspace', { documentId: 'doc', canvasEpoch: 'epoch', sequence: 0, documentVersion: 1, regions: [] });
  const server = createServer(), dispose = attachLiveCanvasSockets(server, service);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const reader = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/live`);
  await once(reader, 'open');
  try {
    reader.send(JSON.stringify({ type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc', includeContext: true }));
    await expect.poll(() => load.mock.calls.length).toBe(1);
    const closed = once(reader, 'close'); reader.close(); await closed;
    resolve({ version: 1, nodes: [], edges: [] });
    await new Promise(done => setImmediate(done));
    expect(attach).not.toHaveBeenCalled();
  } finally {
    reader.terminate(); dispose();
    await new Promise<void>(done => server.close(() => done()));
  }
});

it('allows WebSocket reads by default while rejecting agent-context uploads', async () => {
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [{ documentId: 'doc', name: 'Test' }] }],
    async () => ({ version: 1, name: 'Test', nodes: [], edges: [] }));
  const owner = {};
  service.publish(owner, 'workspace');
  service.update(owner, 'workspace', { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 1, sequence: 0, regions: [] });
  const server = createServer(), dispose = attachLiveCanvasSockets(server, service);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/live`);
  const send = async (body: unknown) => { const next = once(ws, 'message'); ws.send(JSON.stringify(body)); return JSON.parse(String((await next)[0])); };
  try {
    await once(ws, 'open');
    expect(await send({ type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc', includeContext: true }))
      .toMatchObject({ type: 'attached', context: { name: 'Test' }, sequence: 0 });
    expect(await send({ type: 'context.get', requestId: 'read' })).toMatchObject({ type: 'context.snapshot', requestId: 'read' });
    for (const message of [
      { type: 'agent-context.upload', requestId: 'upload', agentType: 'codex', sourceSessionId: 'source', format: 'messages-v1',
        fromEntryId: 'one', throughEntryId: 'one', entries: [{ id: 'one', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Injected context' }] } }] }
    ]) expect(await send(message)).toMatchObject({ type: 'error', code: 'HTTP_WRITES_DISABLED' });
    expect(await send({ type: 'context.get', requestId: 'after' })).toMatchObject({ type: 'context.snapshot', requestId: 'after', context: { version: 1 } });
  } finally {
    ws.terminate(); dispose(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
