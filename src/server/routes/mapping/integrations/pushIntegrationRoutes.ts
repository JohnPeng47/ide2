import { createHash, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { PushIntegrationService } from '../../../../../application/core/integrations/pushIntegrationService';
import { readBody, sendJson } from '../../../http/http';

export async function handlePushIntegration(request: Connect.IncomingMessage, response: ServerResponse, url: URL,
  service: PushIntegrationService, token: string | undefined) {
  if (!token) return sendJson(response, 503, { error: 'Set NEW_DIAGRAM_PUSH_TOKEN to enable push integrations' });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(request.headers.authorization ?? ''), digest(`Bearer ${token}`))) {
    return sendJson(response, 401, { error: 'Invalid push integration token' });
  }
  const base = '/api/mapping/integrations';
  const connection = url.pathname.match(/^\/api\/mapping\/integrations\/connections\/([a-zA-Z0-9_-]+)(?:\/(pushes|artifacts))?$/);
  if (url.pathname === `${base}/connections` && request.method === 'GET') {
    return sendJson(response, 200, await service.connections());
  }
  if (connection) {
    const [, id, format] = connection;
    if (!format && request.method === 'PUT') {
      const body = await readBody(request, 64 * 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(response, 400, { error: 'Expected connection object' });
      return sendJson(response, 200, await service.connect({ ...body, id }));
    }
    if (format && request.method === 'POST') {
      const generation = await service.receive(id, await readBody(request), format === 'artifacts' ? 'artifacts' : 'generic');
      return sendJson(response, generation.status === 'running' || generation.status === 'resolving' ? 202 : 200, generation);
    }
    return sendJson(response, 405, { error: 'method not allowed' });
  }
  if (url.pathname === `${base}/pushes` && request.method === 'GET') {
    return sendJson(response, 200, await service.generations(url.searchParams.get('connectionId') ?? undefined));
  }
  const push = url.pathname.match(/^\/api\/mapping\/integrations\/pushes\/(push-[a-f0-9]{32})$/);
  if (push && request.method === 'GET') {
    const generation = await service.get(push[1]);
    return sendJson(response, generation ? 200 : 404, generation ?? { error: 'Push generation not found' });
  }
  return sendJson(response, 404, { error: 'Integration route not found' });
}
