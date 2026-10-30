import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { EvalPromptService } from '../../../../../application/mapping/evals/evalPromptService';
import type { EvalRunService } from '../../../../../application/mapping/evals/evalRunService';
import { archiveEvalPromptSchema } from '../../../../../domain/mapping/evals/evalPrompt';
import { renameEvalRunSchema, summarizeEvalRun } from '../../../../../domain/mapping/evals/evalRun';
import { readBody, sendJson } from '../../../http/http';

const segment = '([A-Za-z0-9][A-Za-z0-9_-]{0,80})';
export async function handleEvalRoutes(request: Connect.IncomingMessage, response: ServerResponse, url: URL, prompts: EvalPromptService, runs: EvalRunService) {
  const route = url.pathname.slice('/api/mapping/evals'.length), method = request.method;
  if (route === '/prompts') {
    if (method === 'GET') return sendJson(response, 200, await prompts.list());
    if (method === 'POST') return sendJson(response, 200, await prompts.save(await readBody(request)));
  }
  let match = route.match(new RegExp(`^/prompts/${segment}$`));
  if (match && method === 'GET') return sendJson(response, 200, await prompts.read(match[1]));
  match = route.match(new RegExp(`^/prompts/${segment}/archive$`));
  if (match && method === 'POST') return sendJson(response, 200, await prompts.setArchived(match[1], archiveEvalPromptSchema.parse(await readBody(request)).archived));
  if (route === '/runs') {
    if (method === 'GET') return sendJson(response, 200, await runs.list());
    if (method === 'POST') return sendJson(response, 202, await runs.start(await readBody(request)));
  }
  match = route.match(new RegExp(`^/runs/${segment}$`));
  if (match && method === 'GET') return sendJson(response, 200, summarizeEvalRun(await runs.read(match[1])));
  if (match && method === 'DELETE') { await runs.deleteRun(match[1]); return sendJson(response, 200, { deleted: true }); }
  match = route.match(new RegExp(`^/runs/${segment}/rename$`));
  if (match && method === 'POST') return sendJson(response, 200, await runs.rename(match[1], renameEvalRunSchema.parse(await readBody(request)).name));
  match = route.match(new RegExp(`^/runs/${segment}/cancel$`));
  if (match && method === 'POST') { runs.cancel(match[1]); return sendJson(response, 202, { cancelled: true }); }
  if (route === '/contexts' && method === 'GET') return sendJson(response, 200, await runs.listContexts(url.searchParams.get('query') ?? ''));
  if (route === '/canvases' && method === 'GET') return sendJson(response, 200, await runs.generated());
  match = route.match(new RegExp(`^/canvases/${segment}$`));
  if (match && method === 'GET') return sendJson(response, 200, await runs.canvas(match[1]));
  if (match && method === 'DELETE') { await runs.deleteCanvas(match[1]); return sendJson(response, 200, { deleted: true }); }
  match = route.match(new RegExp(`^/contexts/${segment}/outputs$`));
  if (match && method === 'DELETE') {
    const workflow = url.searchParams.get('workflow');
    if (workflow !== 'roll-up' && workflow !== 'alternatives') return sendJson(response, 400, { error: 'Choose a workflow.' });
    await runs.deleteContextOutputs(match[1], workflow); return sendJson(response, 200, { deleted: true });
  }
  if (route === '/migrate' && method === 'POST') return sendJson(response, 200, await runs.migrate());
  return sendJson(response, 404, { error: 'Evals route not found' });
}

/** Mapping's Canvas tab only lists generated canvases and links to Evals. */
export async function handleGeneratedCanvasRoutes(request: Connect.IncomingMessage, response: ServerResponse, url: URL, runs: EvalRunService) {
  const route = url.pathname.slice('/api/mapping/generated-canvases'.length);
  if (request.method === 'GET' && !route) return sendJson(response, 200, await runs.generated());
  if (request.method === 'POST' && route === '/migrate') return sendJson(response, 200, await runs.migrate());
  return sendJson(response, 404, { error: 'Generated canvas route not found' });
}
