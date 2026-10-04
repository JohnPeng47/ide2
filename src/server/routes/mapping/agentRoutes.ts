import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { z } from 'zod';
import type { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { agentToolSchemas, type AgentToolName } from '../../../../domain/mapping/agent/contracts';
import { readBody, sendJson } from '../../http/http';
const registration = z.object({ canvasId: z.string().uuid(), stableWorkspaceId: z.string().uuid().optional(), projectId: z.string().optional(), documents: z.array(z.object({ documentId: z.string().min(1), name: z.string(), repositoryId: z.string().min(1).max(200).optional(), representationId: z.string().optional() })).max(100) }).strict();
export async function handleAgentRoutes(request: Connect.IncomingMessage, response: ServerResponse, url: URL, service: AgentDiagrammingSessionService) {
  const path = url.pathname.slice('/api/mapping/agent'.length);
  try {
    if (path === '/change-sessions' && request.method === 'GET') return sendJson(response, 200, await service.changes?.list() ?? []);
    const preview = path.match(/^\/change-sessions\/([^/]+)\/preview$/);
    if (preview && request.method === 'GET' && service.changes) {
      const documentId = url.searchParams.get('documentId'); if (!documentId) throw Error('documentId is required');
      const version = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : undefined;
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) throw Error('Invalid session version');
      response.setHeader('cache-control', 'no-store');
      return sendJson(response, 200, await service.changes.preview(decodeURIComponent(preview[1]), documentId, version));
    }
    const changeSession = path.match(/^\/change-sessions\/([^/]+)$/);
    if (changeSession && request.method === 'GET' && service.changes) {
      const { receipts, ...session } = await service.changes.get(decodeURIComponent(changeSession[1]));
      return sendJson(response, 200, session);
    }
    if (path === '/canvases') {
      if (request.method === 'GET') return sendJson(response, 200, service.bridge.list());
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' });
      service.bridge.register(registration.parse(await readBody(request))); return sendJson(response, 200, { registered: true });
    }
    const canvas = path.match(/^\/canvases\/([^/]+)(?:\/(commands|reply))?$/);
    if (canvas) {
      const id = decodeURIComponent(canvas[1]);
      if (!canvas[2] && request.method === 'DELETE') { service.bridge.unregister(id); return sendJson(response, 200, {}); }
      if (canvas[2] === 'commands' && request.method === 'GET') return sendJson(response, 200, await service.bridge.poll(id));
      if (canvas[2] === 'reply' && request.method === 'POST') {
        const body = z.object({ commandId: z.string(), value: z.unknown().optional(), error: z.string().optional() }).parse(await readBody(request, 64 * 1024 * 1024));
        service.bridge.reply(id, body.commandId, body); return sendJson(response, 200, {});
      }
      return sendJson(response, 405, { error: 'method not allowed' });
    }
    const tool = path.match(/^\/tools\/([^/]+)$/);
    if (tool && request.method === 'POST' && Object.hasOwn(agentToolSchemas, tool[1])) return sendJson(response, 200, await service.call(tool[1] as AgentToolName, await readBody(request)));
    return sendJson(response, 404, { error: 'Unknown agent endpoint' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return sendJson(response, message.includes('VERSION_CONFLICT') || message.includes('REQUEST_ID_CONFLICT') || message.includes('CONTENT_HASH_CONFLICT') ? 409 : message.includes('UNAVAILABLE') ? 503 : 400, { error: message });
  }
}
