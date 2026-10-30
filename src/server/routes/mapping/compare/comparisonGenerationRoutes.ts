import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { ComparisonGenerationService } from '../../../../../application/mapping/compare/comparisonGenerationService';
import { summarizeComparisonRun } from '../../../../../domain/mapping/compare/comparisonGeneration';
import { readBody, sendJson } from '../../../http/http';

export async function handleComparisonGenerationRoutes(request: Connect.IncomingMessage, response: ServerResponse, url: URL, service: ComparisonGenerationService) {
  const base = '/api/mapping/comparison-runs';
  if (url.pathname === base) {
    if (request.method === 'GET') return sendJson(response, 200, await service.list(url.searchParams.get('documentId') ?? undefined));
    if (request.method === 'POST') return sendJson(response, 202, await service.start(await readBody(request)));
    return sendJson(response, 405, { error: 'method not allowed' });
  }
  const match = url.pathname.slice(base.length).match(/^\/([a-f0-9-]{36})(?:\/ascii\/(D[1-9]\d*)\.txt)?$/i);
  if (!match) return sendJson(response, 404, { error: 'Comparison run route not found' });
  if (request.method === 'DELETE' && !match[2]) { await service.delete(match[1]); return sendJson(response, 200, { deleted: true }); }
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' });
  const run = await service.read(match[1]);
  if (!match[2]) return sendJson(response, 200, summarizeComparisonRun(run));
  const diagram = run.diagrams.find(d => d.id === match[2]);
  if (!diagram) return sendJson(response, 404, { error: 'Comparison diagram not found' });
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.setHeader('x-content-type-options', 'nosniff'); response.end(diagram.ascii);
}
