import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { AgentChatService } from '../../../../../application/mapping/agent-chat/agentChatService';
import { findChatItem, type ChatEvent, type ChatItem } from '../../../../../domain/mapping/agent-chat/agentChat';
import { readBody, sendJson } from '../../../http/http';

function snapshotItem(item: ChatItem): ChatItem {
  if (item.kind !== 'tool' || item.status === 'inProgress') return item;
  if (item.text.length <= 1000 && !item.changes?.some(change => change.diff.length > 1000)) return item;
  return { ...item, detailAvailable: true, text: item.text.trimEnd().split('\n').slice(-3).map(line => line.slice(0, 240)).join('\n'),
    changes: item.changes?.map(change => ({ ...change, diff: change.diff.split('\n').slice(0, 3).map(line => line.slice(0, 240)).join('\n') })) };
}

export async function handleAgentChat(request: Connect.IncomingMessage, response: ServerResponse, url: URL, chat: AgentChatService) {
  // Use the actual listening socket, not caller-controlled Host/forwarded headers.
  if (request.socket.localPort) chat.setMcpOrigin(`http://127.0.0.1:${request.socket.localPort}`);
  const route = url.pathname.slice('/api/mapping/agent-chat'.length);
  if (route === '/info' && request.method === 'GET') return sendJson(response, 200, await chat.info());
  if (route === '/sessions/resume' && request.method === 'POST') return sendJson(response, 200, await chat.resume(await readBody(request)));
  if (route === '/sessions') {
    if (request.method === 'GET') return sendJson(response, 200, await chat.list());
    if (request.method === 'POST') return sendJson(response, 200, await chat.create(await readBody(request)));
  }
  const match = route.match(/^\/sessions\/([a-f0-9-]+)(?:\/(events|send|read-canvas|interrupt|answer|items)(?:\/([^/]+))?)?$/);
  if (!match) return sendJson(response, 404, { error: 'Chat route not found' });
  const [, id, action, requestId] = match;
  if (request.method === 'GET' && !action) return sendJson(response, 200, await chat.get(id));
  if (request.method === 'GET' && action === 'items' && requestId) {
    const item = findChatItem(await chat.get(id), decodeURIComponent(requestId));
    return sendJson(response, item ? 200 : 404, item ?? { error: 'Chat activity not found' });
  }
  if (request.method === 'GET' && action === 'events') {
    await chat.get(id);
    if (response.destroyed) return;
    // Preview's compression middleware does not honor no-transform. Explicit identity
    // prevents gzip from holding the final records of a long-lived event stream.
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Content-Encoding': 'identity', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    let unsubscribe = () => {};
    let snapshotAllowance = 0;
    response.on('drain', () => { snapshotAllowance = 0; });
    const heartbeat = setInterval(() => { response.write(': heartbeat\n\n'); }, 15_000);
    response.once('close', () => { clearInterval(heartbeat); unsubscribe(); });
    const writeEvent = (event: ChatEvent, snapshot = false) => {
      if (response.destroyed) return;
      const data = `data: ${JSON.stringify(event)}\n\n`;
      // A valid retained-history snapshot can exceed the live-event backlog limit.
      // Allow that single snapshot to drain; still bound additional queued events.
      // Otherwise large histories reconnect forever without ever receiving their snapshot.
      if (snapshot) snapshotAllowance += Buffer.byteLength(data);
      if (response.write(data)) snapshotAllowance = 0;
      else if (response.writableLength > snapshotAllowance + 2 * 1024 * 1024) response.destroy();
    };
    unsubscribe = await chat.subscribe(id, event => {
      if (event.type !== 'snapshot') { writeEvent(event); return; }
      // Keep SSE records small. The client assembles parts before publishing once,
      // so reconnect never renders an incomplete transcript or parses a multi-MB line.
      const items = event.session.items.map(snapshotItem);
      if (items.length <= 1) { writeEvent({ ...event, session: { ...event.session, items } }, true); return; }
      writeEvent({ type: 'snapshot', session: { ...event.session, items: [] }, partial: true }, true);
      for (let start = 0; start < items.length && !response.destroyed; start++)
        writeEvent({ type: 'snapshot-part', items: [items[start]], final: start + 1 >= items.length }, true);
    });
    if (response.destroyed) { clearInterval(heartbeat); unsubscribe(); }
    return;
  }
  if (request.method === 'POST') {
    if (action === 'send') await chat.send(id, await readBody(request));
    else if (action === 'read-canvas') await chat.readCanvas(id, await readBody(request));
    else if (action === 'interrupt') await chat.interrupt(id);
    else if (action === 'answer' && requestId) await chat.answer(id, requestId, await readBody(request));
    else return sendJson(response, 404, { error: 'Chat action not found' });
    return sendJson(response, 200, { ok: true });
  }
  return sendJson(response, 405, { error: 'method not allowed' });
}
