import { z } from 'zod';
import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { EvalPromptService } from '../../../../../application/mapping/evals/evalPromptService';
import type { EvalRunService } from '../../../../../application/mapping/evals/evalRunService';
import type { EvalReferenceService } from '../../../../../application/mapping/evals/evalReferenceService';
import { captureCanvasSchema } from '../../../../../domain/mapping/evals/evalReference';
import { archiveEvalPromptSchema } from '../../../../../domain/mapping/evals/evalPrompt';
import { renameEvalRunSchema, summarizeEvalRun } from '../../../../../domain/mapping/evals/evalRun';
import { readBody, sendJson } from '../../../http/http';

const segment = '([A-Za-z0-9][A-Za-z0-9_-]{0,80})';
export async function handleEvalRoutes(request: Connect.IncomingMessage, response: ServerResponse, url: URL, prompts: EvalPromptService, runs: EvalRunService, references: EvalReferenceService) {
  const route = url.pathname.slice('/api/mapping/evals'.length), method = request.method;
  if (route === '/experiments' && runs.experiments) {
    if (method === 'GET') return sendJson(response, 200, await runs.experiments.list());
    if (method === 'POST') return sendJson(response, 200, await runs.experiments.save(await readBody(request)));
  }
  const experimentMatch = route.match(new RegExp(`^/experiments/${segment}$`));
  if (experimentMatch && method === 'GET' && runs.experiments) return sendJson(response, 200, await runs.experiments.read(experimentMatch[1]));
  if (route === '/judgements' && method === 'GET') return sendJson(response, 200, await runs.judgements?.list(url.searchParams.get('runId') ?? undefined) ?? []);
  const judgementMatch = route.match(new RegExp(`^/judgements/${segment}$`));
  if (judgementMatch && runs.judgements) {
    if (method === 'GET') return sendJson(response, 200, await runs.judgements.read(judgementMatch[1]));
    if (method === 'DELETE') { await runs.judgements.delete(judgementMatch[1]); return sendJson(response, 200, { deleted: true }); }
  }
  if (route === '/references') {
    if (method === 'GET') return sendJson(response, 200, await references.list(url.searchParams.get('archived') === 'true'));
    if (method === 'POST') return sendJson(response, 200, await references.create(await readBody(request)));
  }
  const referenceMatch = route.match(new RegExp(`^/references/${segment}$`));
  if (referenceMatch && method === 'GET') return sendJson(response, 200, await references.read(referenceMatch[1]));
  if (referenceMatch && method === 'PATCH') return sendJson(response, 200, await references.update(referenceMatch[1], await readBody(request)));
  if (route === '/capture' && method === 'POST') return sendJson(response, 200, await runs.captureCanvas(captureCanvasSchema.parse(await readBody(request)).source));
  if (route.startsWith('/layout-templates') && runs.layoutTemplates) {
    const templates = runs.layoutTemplates;
    if (route === '/layout-templates' && method === 'GET') return sendJson(response, 200, await templates.list());
    if (route === '/layout-templates' && method === 'POST') return sendJson(response, 200, await templates.save(await readBody(request)));
    if (route === '/layout-templates/capture' && method === 'POST') return sendJson(response, 200, await templates.capture(await readBody(request)));
    const match = route.match(new RegExp(`^/layout-templates/${segment}$`));
    if (match && method === 'POST') return sendJson(response, 200, await templates.update(match[1], await readBody(request)));
    if (match && method === 'DELETE') { await templates.delete(match[1]); return sendJson(response, 200, { deleted: true }); }
  }
  if (route === '/prompts') {
    if (method === 'GET') return sendJson(response, 200, await prompts.list());
    if (method === 'POST') return sendJson(response, 200, await prompts.save(await readBody(request)));
  }
  let match = route.match(new RegExp(`^/prompts/${segment}$`));
  if (match && method === 'GET') return sendJson(response, 200, await prompts.read(match[1]));
  match = route.match(new RegExp(`^/prompts/${segment}/archive$`));
  if (match && method === 'POST') return sendJson(response, 200, await prompts.setArchived(match[1], archiveEvalPromptSchema.parse(await readBody(request)).archived));
  if (route === '/roll-ups' && method === 'POST') return sendJson(response, 202, await runs.startRollUp(await readBody(request)));
  if (route === '/runs') {
    if (method === 'GET') return sendJson(response, 200, await runs.list());
    if (method === 'POST') return sendJson(response, 202, await runs.start(await readBody(request)));
  }
  if (route === '/runs/delete' && method === 'POST') {
    const input = z.object({ ids: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/)).min(1) }).strict().parse(await readBody(request));
    await runs.deleteRuns(input.ids); return sendJson(response, 200, { deleted: true });
  }
  match = route.match(new RegExp(`^/runs/${segment}$`));
  if (match && method === 'GET') {
    const summary = summarizeEvalRun(await runs.read(match[1]));
    const judgements = await runs.judgements?.list(summary.id) ?? [];
    return sendJson(response, 200, { ...summary, ...(judgements.length ? { judgements } : {}) });
  }
  if (match && method === 'DELETE') { await runs.deleteRun(match[1]); return sendJson(response, 200, { deleted: true }); }
  match = route.match(new RegExp(`^/runs/${segment}/rerun-chat$`));
  if (match && method === 'POST') { const input = z.object({ requestId: z.string().min(1).max(200) }).strict().parse(await readBody(request));
    return sendJson(response, 202, await runs.rerunLegacy(match[1], input.requestId)); }
  match = route.match(new RegExp(`^/runs/${segment}/rename$`));
  if (match && method === 'POST') return sendJson(response, 200, await runs.rename(match[1], renameEvalRunSchema.parse(await readBody(request)).name));
  match = route.match(new RegExp(`^/runs/${segment}/cancel$`));
  if (match && method === 'POST') { await runs.cancel(match[1]); return sendJson(response, 202, { cancelled: true }); }
  if (route === '/contexts' && method === 'GET') return sendJson(response, 200, await runs.listContexts(url.searchParams.get('query') ?? '', Number(url.searchParams.get('offset') ?? 0)));
  if (route === '/canvases' && method === 'GET') return sendJson(response, 200, await runs.generated());
  match = route.match(new RegExp(`^/canvases/${segment}$`));
  if (match && method === 'GET') return sendJson(response, 200, await runs.canvas(match[1], url.searchParams.get('checkpoint') ?? undefined));
  if (match && method === 'DELETE') { await runs.deleteCanvas(match[1]); return sendJson(response, 200, { deleted: true }); }
  match = route.match(new RegExp(`^/contexts/${segment}/outputs$`));
  if (match && method === 'DELETE') {
    const workflow = url.searchParams.get('workflow');
    if (workflow !== 'roll-up' && workflow !== 'alternatives' && workflow !== 'few-shot-refinement') return sendJson(response, 400, { error: 'Choose a workflow.' });
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
