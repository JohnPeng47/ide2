import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { JudgementService } from './judgementService';
import { CompareSessionService } from '../compare/compareSessionService';
import { ComparisonGenerationService, type ComparisonRuntime } from '../compare/comparisonGenerationService';
import { FileCompareSessionStore } from '../../../infrastructure/mapping/compare/fileCompareSessionStore';
import { FileComparisonRunStore } from '../../../infrastructure/mapping/compare/fileComparisonRunStore';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { workspaceRecords } from '../../../domain/mapping/workspace/workspaceRecords';
import type { Judgement } from '../../../domain/mapping/evals/judgement';
import type { EvalRun } from '../../../domain/mapping/evals/evalRun';
import { compareWorkspaceFixture } from '../../../tests/support/compareWorkspace';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'judgements-test-')); roots.push(root);
  const records = workspaceRecords(compareWorkspaceFixture('test-project'));
  const sessions = new CompareSessionService({ loadRecords: async () => ({ revision: 1, records }) }, new FileCompareSessionStore(root));
  const capture = sessions.capture.bind(sessions);
  sessions.capture = async sources => {
    const result = await capture(sources);
    result.canvases.forEach((copy, i) => { copy.generated = { key: copy.id, agentContextId: 'context', contextName: 'Example', stage: 'alternative', runId: `run-${i}` }; });
    return result;
  };
  let received: Parameters<ComparisonRuntime['generate']>[0] | undefined;
  let finish!: (output: { output: unknown }) => void;
  const runtime: ComparisonRuntime = { generate: input => { received = input; return new Promise(resolve => { finish = resolve; }); } };
  const jobs = new FileComparisonRunStore(root), comparisons = new ComparisonGenerationService(sessions, jobs, runtime);
  const store = new JsonDirectoryStore<Judgement>(root, 'judgements'), runs = new JsonDirectoryStore<EvalRun>(root, 'eval-runs');
  const createService = () => new JudgementService(store, sessions, jobs, comparisons, runs);
  const service = createService();
  const candidates = (await sessions.candidates()).filter(item => item.viewId);
  const sources = candidates.map(({ documentId, checkpointId, viewId }) => ({ documentId, checkpointId, viewId }));
  return { service, createService, store, runs, sessions, comparisons, jobs, candidates, sources,
    get received() { return received; }, finish: (output: unknown) => finish({ output }) };
}

it('imports both formats from a mixed legacy session, attaches shared results, and preserves independent deletion across restarts', async () => {
  const f = await fixture();
  const session = await f.sessions.create({ requestId: crypto.randomUUID(), title: 'Existing comparison', pairs: [
    { A: f.sources[0], B: f.sources[1] },
    { title: 'Related diagrams', explanation: 'The same concept in two outputs.',
      A: { ...f.sources[0], diagram: f.candidates[0].diagrams[0] && { diagramId: f.candidates[0].diagrams[0].diagramId, revisionId: f.candidates[0].diagrams[0].revisionId } },
      B: { ...f.sources[1], diagram: { diagramId: f.candidates[1].diagrams[0].diagramId, revisionId: f.candidates[1].diagrams[0].revisionId } } }
  ] });
  const summaries = await f.service.list();
  expect(summaries.map(item => item.kind).sort()).toEqual(['canvas-comparison', 'diagram-comparison']);
  expect(summaries.every(item => item.evaluator.kind === 'manual')).toBe(true);
  expect(summaries.every(item => item.runIds.join(',') === 'run-0,run-1')).toBe(true);
  expect(await f.service.list('run-1')).toHaveLength(2);
  const diagram = await f.service.read(`${session.id}-diagram`);
  if (diagram.kind !== 'diagram-comparison') throw Error('Expected diagram comparison');
  expect(diagram.canvases).toEqual(session.canvases);
  expect(diagram.data?.comparisons[0].explanation).toContain('same concept');
  expect(diagram.subjects.map(subject => subject.source.checkpointId)).toEqual(f.sources.map(source => source.checkpointId));
  await f.service.delete(`${session.id}-canvas`);
  await f.service.delete(`${session.id}-canvas`);
  expect((await f.createService().list()).map(item => item.kind)).toEqual(['diagram-comparison']);
  await expect(f.service.read(`${session.id}-canvas`)).rejects.toThrow('Judgement not found');
  await f.sessions.delete(session.id);
  expect(await f.service.list()).toEqual([]);
});

it('tracks evaluator progress and preserves its typed result, exact prompt, evidence and shared attachments', async () => {
  const f = await fixture();
  const job = await f.comparisons.start({ requestId: crypto.randomUUID(), sources: f.sources, title: 'Evaluation', model: 'evaluator', effort: 'high' });
  await expect.poll(() => !!f.received).toBe(true);
  const pending = (await f.service.list())[0];
  expect(pending).toMatchObject({ status: 'generating', kind: 'diagram-comparison', evaluator: { kind: 'model', model: 'evaluator' }, runIds: ['run-0', 'run-1'] });
  expect(pending).not.toHaveProperty('canvases');
  expect(pending.evaluator).not.toHaveProperty('prompt');
  f.finish({ comparisons: [{ title: 'Concept', explanation: 'Related content.',
    A: { diagram: 'D1', ranges: [{ startLine: 1, endLine: 2 }] }, B: { diagram: 'D4', ranges: [{ startLine: 1, endLine: 3 }] } }] });
  await expect.poll(async () => (await f.comparisons.read(job.id)).status).toBe('finished');
  const result = await f.service.read(pending.id);
  if (result.kind !== 'diagram-comparison') throw Error('Expected diagram comparison');
  expect(result.status).toBe('finished'); expect(result.data?.comparisons).toHaveLength(1);
  expect(result.evaluator).toMatchObject({ prompt: (await f.jobs.read(job.id))!.evaluationPrompt, promptVersion: 1 });
  expect((await f.createService().list())[0].id).toBe(pending.id);
  expect((await f.store.list()).filter(item => !item.deletedAt)).toHaveLength(1);
});

it('shows evaluator failures, and cancelling a pending judgement cannot resurrect it', async () => {
  const f = await fixture();
  const job = await f.comparisons.start({ requestId: crypto.randomUUID(), sources: f.sources });
  await expect.poll(() => !!f.received).toBe(true);
  const pending = (await f.service.list())[0];
  await f.service.delete(pending.id);
  expect(f.received!.signal.aborted).toBe(true);
  f.finish({ comparisons: [] });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(await f.createService().list()).toEqual([]);
  expect(await f.jobs.read(job.id)).toBeNull();
  const failed = await fixture();
  const failJob = await failed.comparisons.start({ requestId: crypto.randomUUID(), sources: failed.sources });
  await expect.poll(() => !!failed.received).toBe(true);
  failed.finish({ comparisons: [] });
  await expect.poll(async () => (await failed.comparisons.read(failJob.id)).status).toBe('failed');
  expect((await failed.service.list())[0]).toMatchObject({ status: 'failed', kind: 'diagram-comparison', error: expect.any(String) });
});

it.each([0, 1])('persists a two-page experiment with %i comparisons, group provenance and independent cameras', async count => {
  const f = await fixture();
  const job = await f.comparisons.start({ requestId: crypto.randomUUID(), title: 'Prompt effect', sources: f.sources,
    experiment: { baseline: [f.sources[0]], prompted: [f.sources[1]], promptDifference: '+ explicit ownership', controlledSettings: 'Same source, template and model', maxComparisons: 2 } });
  await expect.poll(() => !!f.received).toBe(true);
  const pending = (await f.service.list())[0];
  expect(pending).toMatchObject({ kind: 'comparison-report', status: 'generating', runIds: ['run-0', 'run-1'] });
  expect(f.received!.evaluationPrompt).toContain('n=1, m=1');
  expect(f.received!.evaluationPrompt).toContain('within-group variability cannot be assessed');
  const camera = (x: number) => ({ transform: { offset: { x, y: 10 }, scale: .5 } });
  f.finish({ scale: { kind: 'default' }, summary: 'Tentative difference.', limitations: 'No recurrence evidence.', comparisonSummary: count ? 'One illustration.' : 'No evidence sufficient to select comparisons.',
    comparisons: count ? [{ kind: 'canvas', opinion: { level: 'moderate', attributionConfidence: 'low', rationale: 'Material change with limited attribution evidence.' }, title: 'State responsibility', explanation: 'More explicit responsibility.', A: { canvas: 'C1', camera: camera(-100) }, B: { canvas: 'C2', camera: camera(-200) } }] : [] });
  await expect.poll(async () => (await f.comparisons.read(job.id)).status).toBe('finished');
  const result = await f.service.read(pending.id);
  if (result.kind !== 'comparison-report') throw Error('Expected report');
  expect(result.data?.pages).toHaveLength(2);
  expect(result.data?.pages[1].blocks).toHaveLength(1 + count);
  expect(result.canvases).toHaveLength(2); // Evidence survives even when no comparisons are selected.
  expect(result.status).toBe('finished');
  if (count) expect(result.data?.pages[1].blocks[1]).toMatchObject({ kind: 'compare-canvas', spec: { A: { camera: camera(-100) }, B: { camera: camera(-200) } } });
  expect((await f.createService().read(result.id))).toEqual(result);
  await f.service.delete(result.id);
  expect(await f.createService().list()).toEqual([]);
});

it('rejects overlapping groups and wrong-group Judge references', async () => {
  const f = await fixture(), request = { requestId: crypto.randomUUID(), sources: f.sources,
    experiment: { baseline: [f.sources[0]], prompted: [f.sources[0]], promptDifference: 'delta', controlledSettings: 'controlled', maxComparisons: 2 } };
  await expect(f.comparisons.start(request)).rejects.toThrow('partition');
  await f.comparisons.start({ ...request, experiment: { ...request.experiment, prompted: [f.sources[1]] } });
  await expect.poll(() => !!f.received).toBe(true);
  const camera = { transform: { offset: { x: 0, y: 0 }, scale: 1 } };
  f.finish({ scale: { kind: 'default' }, summary: 'Summary', limitations: 'Limitations', comparisonSummary: 'Comparisons', comparisons: [{ kind: 'canvas', opinion: { level: 'small', attributionConfidence: 'low', rationale: 'Tentative.' }, title: 'Wrong groups', explanation: 'Reversed', A: { canvas: 'C2', camera }, B: { canvas: 'C1', camera } }] });
  await expect.poll(async () => (await f.comparisons.read(request.requestId)).status).toBe('failed');
  expect((await f.comparisons.read(request.requestId)).error).toContain('Invalid baseline');
});

it('keeps canvas reports mixed, pins paired diagram excerpts and enforces the custom opinion legend', async () => {
  const f = await fixture();
  const job = await f.comparisons.start({ requestId: crypto.randomUUID(), sources: f.sources,
    experiment: { baseline: [f.sources[0]], prompted: [f.sources[1]], promptDifference: 'Ownership emphasis', controlledSettings: 'Matched inputs', maxComparisons: 3 } });
  await expect.poll(() => !!f.received).toBe(true);
  const { FakeComparisonRuntime } = await import('../../../infrastructure/mapping/compare/comparisonRuntime');
  const { output } = await new FakeComparisonRuntime().generate(f.received!);
  f.finish(output);
  await expect.poll(async () => (await f.comparisons.read(job.id)).status).toBe('finished');
  const report = await f.service.read(job.id + '-report');
  if (report.kind !== 'comparison-report') throw Error('Expected report');
  expect(report.data?.scale).toEqual({ kind: 'default' });
  expect(report.data?.pages[1].blocks.map(block => block.kind)).toEqual(['text', 'compare-canvas', 'compare-diagrams']);
  expect(report.data?.pages[1].blocks[2]).toMatchObject({ spec: { opinion: { level: 'small', attributionConfidence: 'low' }, A: { kind: 'diagram' }, B: { kind: 'diagram' } } });
  expect(report.evaluator).toMatchObject({ promptVersion: 4 });
});

it.each(['bounds', 'unpaired', 'unknown-level', 'duplicate-level', 'no-reason', 'high-confidence', 'diagram-with-canvas'] as const)('rejects invalid mixed report output: %s', async failure => {
  const f = await fixture();
  const job = await f.comparisons.start({ requestId: crypto.randomUUID(), sources: f.sources,
    experiment: { baseline: [f.sources[0]], prompted: [f.sources[1]], promptDifference: 'Changed prompt', controlledSettings: 'Same settings', maxComparisons: 3 } });
  await expect.poll(() => !!f.received).toBe(true);
  const { FakeComparisonRuntime } = await import('../../../infrastructure/mapping/compare/comparisonRuntime');
  const { output } = await new FakeComparisonRuntime().generate(f.received!);
  const raw = JSON.parse(JSON.stringify(output));
  if (failure === 'bounds') raw.comparisons[1].A.ranges[0].endLine = 999999;
  if (failure === 'unpaired') raw.comparisons[1].A.ranges.push({ startLine: 3, endLine: 3 });
  if (failure === 'unknown-level') raw.comparisons[0].opinion.level = 'unsupported';
  if (failure === 'high-confidence') raw.comparisons[0].opinion.attributionConfidence = 'high';
  if (failure === 'diagram-with-canvas') raw.comparisons[1].A = raw.comparisons[0].A;
  if (failure === 'duplicate-level' || failure === 'no-reason') raw.scale = { kind: 'custom', title: 'Special scale', reason: failure === 'no-reason' ? '' : 'A substantive justification for using a custom scale.',
    levels: [{ id: 'small', label: 'Small', meaning: 'Small effect' }, { id: 'small', label: 'Other', meaning: 'Other effect' }] };
  f.finish(raw);
  await expect.poll(async () => (await f.comparisons.read(job.id)).status).toBe('failed');
});
