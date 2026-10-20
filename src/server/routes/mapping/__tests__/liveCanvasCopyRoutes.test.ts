import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { LiveCanvasService } from '../../../../../application/mapping/agent/liveCanvasService';
import { attachLiveCanvasSockets } from '../liveCanvasRoutes';

it.each([false, true])('correlates copy receipts, keeps readers attached and enforces writes=%s', async enabled => {
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [] }]), owner = {};
  service.publish(owner, 'workspace', message => {
    if (message.type === 'diagram.copy.command') service.copyReply(owner, 'workspace', { type: 'diagram.copy.reply', commandId: message.commandId, result: { ok: true } });
  }, ['diagram.copy']);
  service.update(owner, 'workspace', { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 0, sequence: 0, regions: [] });
  const server = createServer(), dispose = attachLiveCanvasSockets(server, service, { canvasWritesEnabled: enabled });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/live`);
  await once(ws, 'open');
  const send = async (frame: unknown) => {
    const next = once(ws, 'message'); ws.send(JSON.stringify(frame)); return JSON.parse(String((await next)[0]));
  };
  try {
    const attached = await send({ type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc' });
    const copy = { type: 'diagram.copy', requestId: 'copy', text: 'Root\n`-- Child' };
    expect(await send(copy)).toMatchObject(enabled
      ? { type: 'diagram.copied', requestId: 'copy', connectionId: attached.connectionId, workspaceInstanceId: 'workspace', documentId: 'doc', canvasEpoch: 'epoch' }
      : { type: 'error', requestId: 'copy', code: 'HTTP_WRITES_DISABLED' });
    expect(await send({ ...copy, requestId: 'invalid', text: '─' })).toMatchObject({ type: 'error', requestId: 'invalid', code: enabled ? 'INVALID_DIAGRAM' : 'HTTP_WRITES_DISABLED' });
    expect(service.read(attached.connectionId).canvasEpoch).toBe('epoch');
    expect(await send({ ...copy, requestId: 'next' })).toHaveProperty('type', enabled ? 'diagram.copied' : 'error');
  } finally { ws.terminate(); dispose(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it.each([undefined, [], ['future.feature'], ['diagram.copy', 'future.feature']].map(capabilities => ({ capabilities })))('negotiates copy capability over real publisher and reader sockets ($capabilities)', async ({ capabilities }) => {
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [] }]);
  const server = createServer(), dispose = attachLiveCanvasSockets(server, service, { canvasWritesEnabled: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/live`;
  const publisher = new WebSocket(url), reader = new WebSocket(url);
  await Promise.all([once(publisher, 'open'), once(reader, 'open')]);
  const send = async (ws: WebSocket, frame: unknown) => {
    const next = once(ws, 'message'); ws.send(JSON.stringify(frame)); return JSON.parse(String((await next)[0]));
  };
  const commands: unknown[] = [];
  publisher.on('message', raw => {
    const message = JSON.parse(String(raw));
    if (message.type !== 'diagram.copy.command') return;
    commands.push(message);
    publisher.send(JSON.stringify({ type: 'diagram.copy.reply', commandId: message.commandId, result: { ok: true } }));
  });
  try {
    expect(await send(publisher, { type: 'publish', protocolVersion: 2, workspaceInstanceId: 'workspace', ...(capabilities ? { capabilities } : {}) }))
      .toEqual({ type: 'publisher.ready', protocolVersion: 2 });
    publisher.send(JSON.stringify({ type: 'selection.snapshot', documentId: 'doc', canvasEpoch: 'epoch', sequence: 0, documentVersion: 0, regions: [] }));
    const pong = once(publisher, 'pong'); publisher.ping(); await pong;
    const attached = await send(reader, { type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc' });
    expect(attached.type).toBe('attached');
    const supported = capabilities?.includes('diagram.copy');
    expect(await send(reader, { type: 'diagram.copy', requestId: 'capability-check', text: 'Root\n|-- A\n`-- B' }))
      .toMatchObject(supported ? { type: 'diagram.copied', requestId: 'capability-check' }
        : { type: 'error', requestId: 'capability-check', code: 'COPY_UNSUPPORTED', error: expect.stringContaining('Reload the canvas tab') });
    expect(commands).toHaveLength(supported ? 1 : 0);
    const next = once(reader, 'message');
    publisher.send(JSON.stringify({ type: 'selection.delta', documentId: 'doc', canvasEpoch: 'epoch', sequence: 1, baseSequence: 0, documentVersion: 0, upserted: [], removed: [] }));
    expect(JSON.parse(String((await next)[0]))).toMatchObject({ type: 'selection.delta', connectionId: attached.connectionId, sequence: 1 });
  } finally {
    publisher.terminate(); reader.terminate(); dispose();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
