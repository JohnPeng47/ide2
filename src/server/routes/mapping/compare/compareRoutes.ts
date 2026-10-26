import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { CompareSessionService } from '../../../../../application/mapping/compare/compareSessionService';
import { readBody, sendJson } from '../../../http/http';

export async function handleCompareRoutes(request: Connect.IncomingMessage, response: ServerResponse, url: URL, service: CompareSessionService) {
  const base = '/api/mapping/compare-sessions';
  if (url.pathname === `${base}/candidates` && request.method === 'GET') return sendJson(response, 200, await service.candidates());
  if (url.pathname === base) {
    if (request.method === 'GET') return sendJson(response, 200, await service.list());
    if (request.method === 'POST') return sendJson(response, 201, await service.create(await readBody(request)));
    return sendJson(response, 405, { error: 'method not allowed' });
  }
  const id = url.pathname.slice(base.length + 1);
  if (/^[a-f0-9-]{36}$/i.test(id)) {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' });
    return sendJson(response, 200, await service.read(id));
  }
  return sendJson(response, 404, { error: 'Comparison route not found' });
}
