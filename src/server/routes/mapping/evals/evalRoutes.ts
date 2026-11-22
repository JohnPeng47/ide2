import { projectOutput, projectCopies, projectCopy, projectCheckpoint } from '../../../../../domain/mapping/projections/savedCanvasProjection';
import { queryProjection } from '../../../../../domain/mapping/projections/projectionType';
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
  const historyMatch = route.match(new RegExp(`^/histories/${segment}$`));
  if (historyMatch && method === 'GET' && runs.histories) {
    const timeline = await runs.histories.read(historyMatch[1]);
    const { documents: _, ...summary } = timeline;
    return sendJson(response, 200, summary);
  }
  if (route === '/experiments' && runs.experiments) {
    if (method === 'GET') return sendJson(response, 200, await runs.experiments.list());
    if (method === 'POST') return sendJson(response, 200, await runs.experiments.save(await readBody(request)));
  }
  const experimentMatch = route.match(new RegExp(`^/experiments/${segment}$`));
  if (experimentMatch && method === 'GET' && runs.experiments) return sendJson(response, 200, await runs.experiments.read(experimentMatch[1]));
  if (experimentMatch && method === 'PATCH' && runs.experiments) return sendJson(response, 200, await runs.experiments.rename(experimentMatch[1], await readBody(request)));
  const experimentTagsMatch = route.match(new RegExp(`^/experiments/${segment}/tags$`));
  if (experimentTagsMatch && method === 'PATCH' && runs.experiments) return sendJson(response, 200, await runs.experiments.updateTags(experimentTagsMatch[1], await readBody(request)));
  const commentMatch = route.match(new RegExp(`^/experiments/${segment}/comments$`));
  if (commentMatch && method === 'POST' && runs.experiments) return sendJson(response, 200, await runs.experiments.addComment(commentMatch[1], await readBody(request)));
  const groundTruthMatch = route.match(new RegExp(`^/experiments/${segment}/ground-truth$`));
  if (groundTruthMatch && method === 'POST' && runs.experiments) return sendJson(response, 200, await runs.experiments.addGroundTruth(groundTruthMatch[1], await readBody(request)));
  const savedCommentMatch = route.match(new RegExp(`^/experiments/${segment}/comments/${segment}$`));
  if (savedCommentMatch && method === 'PATCH' && runs.experiments) return sendJson(response, 200, await runs.experiments.updateComment(savedCommentMatch[1], savedCommentMatch[2], await readBody(request)));
  if (savedCommentMatch && method === 'DELETE' && runs.experiments) return sendJson(response, 200, await runs.experiments.deleteComment(savedCommentMatch[1], savedCommentMatch[2]));
  const overviewMatch = route.match(new RegExp(`^/experiments/${segment}/overview$`));
  if (overviewMatch && method === 'GET' && runs.experiments) return sendJson(response, 200, await runs.experiments.overview(overviewMatch[1]));
  const readMatch = route.match(new RegExp(`^/experiments/${segment}/read$`));
  if (readMatch && method === 'POST' && runs.experiments) return sendJson(response, 200, await runs.experiments.readBatch(readMatch[1], await readBody(request)));
  const approveMatch = route.match(new RegExp(`^/experiments/${segment}/approve$`));
  if (approveMatch && method === 'POST' && runs.experiments) return sendJson(response, 202, await runs.experiments.approve(approveMatch[1], await readBody(request)));
  const judgeMatch = route.match(new RegExp(`^/experiments/${segment}/judge$`));
  if (judgeMatch && method === 'POST' && runs.experiments) return sendJson(response, 200, await runs.experiments.judge(judgeMatch[1], await readBody(request)));
  const rerunMatch = route.match(new RegExp(`^/experiments/${segment}/rerun$`));
  if (rerunMatch && method === 'POST' && runs.experiments) return sendJson(response, 202, await runs.experiments.rerun(rerunMatch[1], await readBody(request)));
  const relaunchMatch = route.match(new RegExp(`^/experiments/${segment}/relaunch$`));
  if (relaunchMatch && method === 'POST' && runs.experiments) return sendJson(response, 202, await runs.experiments.relaunch(relaunchMatch[1], await readBody(request)));
  if (route === '/judgements/tree-comparisons' && method === 'POST') return sendJson(response, 200, await runs.saveTreeComparison(await readBody(request)));
  if (route === '/judgements' && method === 'GET') return sendJson(response, 200, await runs.judgements?.list(url.searchParams.get('runId') ?? undefined) ?? []);
  const judgementMatch = route.match(new RegExp(`^/judgements/${segment}$`));
  if (judgementMatch && runs.judgements) {
    if (method === 'GET') return sendJson(response, 200, projectCopies(await runs.judgements.read(judgementMatch[1]), queryProjection(url)));
    if (method === 'DELETE') { await runs.judgements.delete(judgementMatch[1]); return sendJson(response, 200, { deleted: true }); }
  }
  if (route === '/references') {
    if (method === 'GET') return sendJson(response, 200, await references.list(url.searchParams.get('archived') === 'true'));
    if (method === 'POST') return sendJson(response, 200, await references.create(await readBody(request)));
  }
  const referenceMatch = route.match(new RegExp(`^/references/${segment}$`));
  if (referenceMatch && method === 'GET') return sendJson(response, 200, await references.read(referenceMatch[1]));
  if (referenceMatch && method === 'PATCH') return sendJson(response, 200, await references.update(referenceMatch[1], await readBody(request)));
  if (route === '/reference-groups') {
    if (method === 'GET') return sendJson(response, 200, await references.listGroups());
    if (method === 'POST') return sendJson(response, 200, await references.createGroup(await readBody(request)));
  }
  const referenceGroupMatch = route.match(new RegExp(`^/reference-groups/${segment}$`));
  if (referenceGroupMatch && method === 'PATCH') return sendJson(response, 200, await references.updateGroup(referenceGroupMatch[1], await readBody(request)));
  if (referenceGroupMatch && method === 'DELETE') { await references.deleteGroup(referenceGroupMatch[1]); return sendJson(response, 200, { deleted: true }); }
  if (route === '/reference-sessions' && method === 'POST' && runs.referenceGenerations) return sendJson(response, 200, await runs.referenceGenerations.open(await readBody(request)));
  const referenceSessionMatch = route.match(new RegExp(`^/reference-sessions/${segment}/generate$`));
  if (referenceSessionMatch && method === 'POST' && runs.referenceGenerations) return sendJson(response, 202, await runs.referenceGenerations.generate(referenceSessionMatch[1], await readBody(request)));
  const referenceSourcesMatch = route.match(new RegExp(`^/reference-sessions/${segment}/load-sources$`));
  if (referenceSourcesMatch && method === 'POST' && runs.referenceGenerations) return sendJson(response, 202, await runs.referenceGenerations.loadSources(referenceSourcesMatch[1], await readBody(request)));
  if (route === '/capture' && method === 'POST') {
    const input = captureCanvasSchema.parse(await readBody(request));
    const copy = await runs.captureCanvas(input.source);
    return sendJson(response, 200, input.projectionType ? projectCopy(copy, input.projectionType) : copy);
  }
  if (route.startsWith('/layout-templates') && runs.layoutTemplates) {
    const templates = runs.layoutTemplates;
    if (route === '/layout-templates' && method === 'GET') return sendJson(response, 200, await templates.list());
    if (route === '/layout-templates' && method === 'POST') return sendJson(response, 200, await templates.save(await readBody(request)));
    if (route === '/layout-templates/capture' && method === 'POST') return sendJson(response, 200, await templates.capture(await readBody(request)));
    const match = route.match(new RegExp(`^/layout-templates/${segment}$`));
    if (match && method === 'POST') return sendJson(response, 200, await templates.update(match[1], await readBody(request)));
    if (match && method === 'DELETE') { await templates.delete(match[1]); return sendJson(response, 200, { deleted: true }); }
  }
  const snapshotMatch = route.match(new RegExp(`^/prompt-snapshots/${segment}$`));
  if (snapshotMatch && method === 'GET') return sendJson(response, 200, await prompts.readSnapshot(snapshotMatch[1]));
  if (route === '/prompt-snapshots' && method === 'GET') return sendJson(response, 200, await prompts.listSnapshots());
  if (route === '/prompt-snapshots' && method === 'POST') {
    const input = z.object({ requestId: z.string().uuid(), name: z.string().min(1).max(120) }).strict().parse(await readBody(request));
    return sendJson(response, 200, await prompts.snapshot(input.requestId, input.name));
  }
  const forkMatch = route.match(new RegExp(`^/prompts/${segment}/fork$`));
  if (forkMatch && method === 'POST') {
    const input = z.object({ requestId: z.string().uuid(), version: z.number().int().positive(), name: z.string().min(1).max(120) }).strict().parse(await readBody(request));
    return sendJson(response, 200, await prompts.fork(forkMatch[1], input.version, input.requestId, input.name));
  }
  if (route === '/prompts') {
    if (method === 'GET') return sendJson(response, 200, await prompts.list());
    if (method === 'POST') return sendJson(response, 200, await prompts.save(await readBody(request)));
  }
  let match = route.match(new RegExp(`^/prompts/${segment}$`));
  if (match && method === 'GET') return sendJson(response, 200, await prompts.read(match[1]));
  match = route.match(new RegExp(`^/prompts/${segment}/lineage$`));
  if (match && method === 'POST') return sendJson(response, 200, await prompts.trackLineage(match[1], await readBody(request)));
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
  if (route === '/promotion-targets' && method === 'GET') return sendJson(response, 200, await runs.promotionTargets());
  const placementBackfillMatch = route.match(new RegExp(`^/runs/${segment}/placement-backfill$`));
  if (placementBackfillMatch && method === 'POST') return sendJson(response, 200, await runs.backfillPlacementTracking(placementBackfillMatch[1], await readBody(request)));
  const promoteMatch = route.match(new RegExp(`^/runs/${segment}/promote$`));
  if (promoteMatch && method === 'POST') return sendJson(response, 200, await runs.promoteOutput(promoteMatch[1], await readBody(request)));
  const sourceMatch = route.match(new RegExp(`^/runs/${segment}/promotion-source$`));
  if (sourceMatch && method === 'GET') return sendJson(response, 200, projectOutput(await runs.promotionSource(sourceMatch[1], url.searchParams.get('cell') ?? ''), queryProjection(url)));
  const resultMatch = route.match(new RegExp(`^/runs/${segment}/output-result$`));
  if (resultMatch && method === 'GET') return sendJson(response, 200, projectOutput(await runs.outputResult(resultMatch[1], url.searchParams.get('cell') ?? ''), queryProjection(url)));
  if (resultMatch && method === 'POST') {
    return sendJson(response, 200, await runs.captureOutputResult(resultMatch[1], await readBody(request)));
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
  if (match && method === 'GET') {
    const output = url.searchParams.has('run') || url.searchParams.has('cell')
      ? z.object({ runId: z.string().min(1).max(200), cellKey: z.string().min(1).max(300) }).parse({ runId: url.searchParams.get('run'), cellKey: url.searchParams.get('cell') }) : undefined;
    const type = queryProjection(url), checkpointId = url.searchParams.get('checkpoint') ?? undefined;
    const canvas = await runs.canvas(match[1], checkpointId, output);
    return sendJson(response, 200, type ? { id: canvas.id, name: canvas.name, ...projectCheckpoint(canvas.history, type, checkpointId) } : canvas);
  }
  if (match && method === 'DELETE') { await runs.deleteCanvas(match[1]); return sendJson(response, 200, { deleted: true }); }
  match = route.match(new RegExp(`^/contexts/${segment}/outputs$`));
  if (match && method === 'DELETE') {
    const workflow = url.searchParams.get('workflow');
    if (workflow !== 'roll-up' && workflow !== 'alternatives' && workflow !== 'few-shot-refinement' && workflow !== 'diagram-change-proposal') return sendJson(response, 400, { error: 'Choose a workflow.' });
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
