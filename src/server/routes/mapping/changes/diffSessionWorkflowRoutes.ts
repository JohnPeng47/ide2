import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { DiffSessionWorkflowService } from '../../../../../application/mapping/changes/diffSessionWorkflowService';
import { readBody, sendJson } from '../../../http/http';

export async function handleDiffSessionWorkflow(request: Connect.IncomingMessage, response: ServerResponse, url: URL, service: DiffSessionWorkflowService) {
  const base = '/api/mapping/workflows/diff-session-create';
  if (url.pathname === base) {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' });
    return sendJson(response, 202, await service.start(await readBody(request)));
  }
  const match = url.pathname.slice(base.length).match(/^\/(diff-run-[a-f0-9]{32})(\/cancel)?$/);
  if (!match) return sendJson(response, 404, { error: 'Workflow run not found' });
  if (request.method !== (match[2] ? 'POST' : 'GET')) return sendJson(response, 405, { error: 'method not allowed' });
  const run = match[2] ? await service.cancel(match[1]) : await service.get(match[1]);
  return sendJson(response, run ? 200 : 404, run ?? { error: 'Workflow run not found' });
}
