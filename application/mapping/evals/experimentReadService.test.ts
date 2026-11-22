import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { expect, it, vi } from 'vitest';
import { ExperimentReadService } from './experimentReadService';
import type { EvalExperiment } from '../../../domain/mapping/evals/experiment';
import { summarizeEvalRun, type EvalRun } from '../../../domain/mapping/evals/evalRun';
import type { ExperimentOverviewNode, ExperimentReadValue } from '../../../domain/mapping/evals/experimentOverview';
import type { MarkdownOutputResult } from '../../../domain/mapping/evals/evalOutputResult';
import { projectExperimentOverview } from '../../../domain/mapping/evals/experimentOverviewProjection';

const result: MarkdownOutputResult = { schemaVersion: 1, format: 'markdown', markdown: '# Retained result', canvases: [], diagramRevisions: {} };
function fixture() {
  const run: EvalRun = { schemaVersion: 1, id: 'run', projectId: 'project', requestHash: 'hash', workflow: 'alternatives', agentContextId: 'context', contextName: 'Context', createdAt: '2026-11-13T00:00:00Z', status: 'finished',
    request: { requestId: 'run', workflow: 'alternatives', prompts: [{ promptId: 'prompt', version: 2 }], inputs: {}, passes: 1, model: 'test', effort: 'high' },
    prompts: [{ promptId: 'prompt', version: 2, name: 'Saved prompt', contentHash: 'pinned-hash', stages: { alternative: '# Raw **prompt**\n{{context}}', tree: 'Wrong stage' } }], inputs: {},
    contexts: { context: { agentContextId: 'context', name: 'Context', contentHash: 'source-hash' } },
    cells: [{ key: 'one', stage: 'alternative', status: 'finished', pass: 1, promptId: 'prompt', promptVersion: 2, output: { format: 'markdown', canvases: [] } },
      { key: 'two', stage: 'alternative', status: 'finished', pass: 1, promptId: 'prompt', promptVersion: 2, output: { format: 'markdown', canvases: [] } }], outputResults: { one: result, two: result } };
  const experiment: EvalExperiment = { schemaVersion: 1, id: 'experiment', projectId: 'project', revision: 3, createdAt: run.createdAt, updatedAt: run.createdAt, name: 'Study', description: 'Saved description',
    phases: [{ id: 'phase-2', name: 'Phase 2', description: 'Explain the comparison' }],
    workflow: { id: 'study', name: 'Study', version: 1, stages: [{ id: 'tree', name: 'Generate tree', dependsOn: [] }] },
    cases: [{ id: 'case', name: 'Source', agentContextId: 'context', contentHash: 'source-hash' }],
    conditions: [{ id: 'a', name: 'A', description: 'First variant' }, { id: 'b', name: 'B', description: 'Second variant' }],
    samples: ['one', 'two'].map((id, i) => ({ id, phaseId: 'phase-2', caseId: 'case', conditionId: i ? 'b' : 'a', number: 1, attempt: 1, outputs: [{ stageId: 'tree', runId: 'run', cellKey: id }] })), comparisons: [] };
  const readRun = vi.fn(async (id: string) => { if (id !== run.id) throw Error('Run not found'); return run; });
  const outputResult = vi.fn(async () => result);
  const experiments = { read: vi.fn(async () => experiment) };
  const service = new ExperimentReadService(experiments, { read: readRun, outputResult });
  return { experiment, run, readRun, outputResult, experiments, service };
}
function nodes(node: ExperimentOverviewNode): ExperimentOverviewNode[] { return [node, ...(node.children ?? []).flatMap(nodes)]; }
const refsFor = (root: ExperimentOverviewNode, label: string) => [...new Set(nodes(root).flatMap(node => node.actions?.filter(action => action.label === label).flatMap(action => action.refs) ?? []))];
function value(result: Awaited<ReturnType<ExperimentReadService['read']>>['results'][number]): ExperimentReadValue {
  expect(result.status).toBe('ok'); if (result.status !== 'ok') throw Error(result.error.message); return result.value;
}

it('returns a standalone view with summary/comment nodes and no prompt or output payloads', async () => {
  const f = fixture(), before = structuredClone({ experiment: f.experiment, run: f.run });
  const overview = await f.service.overview('experiment');
  expect(overview.root.counts).toEqual({ finished: 2, total: 2 });
  expect(nodes(overview.root).some(node => node.kind === 'summary' && node.label === 'Variants and prompts')).toBe(true);
  const phase = nodes(overview.root).find(node => node.id === 'phase/phase-2')!;
  expect(phase.actions?.[0].refs).toHaveLength(1); // identical prompts shared across variants
  expect(nodes(phase).some(node => node.kind === 'comment' && node.label === 'Explain the comparison')).toBe(true);
  expect(JSON.stringify(overview)).not.toContain('# Raw');
  expect(JSON.stringify(overview)).not.toContain('# Retained');
  expect(f.outputResult).not.toHaveBeenCalled();
  expect(f.readRun).toHaveBeenCalledTimes(1); // two outputs share the run read
  expect({ experiment: f.experiment, run: f.run }).toEqual(before);
});

it('reads mixed resources in the second request, preserving order, raw text, pins and per-item errors', async () => {
  const f = fixture(), overview = await f.service.overview('experiment');
  const prompt = refsFor(overview.root, 'prompt')[0], outputs = refsFor(overview.root, 'output'), inputs = refsFor(overview.root, 'inputs')[0];
  const refs = [outputs[1], prompt, inputs, 'output/unrelated/cell', outputs[0], prompt];
  f.readRun.mockClear();
  const batch = await f.service.read('experiment', { refs });
  expect(batch.results.map(result => result.ref)).toEqual(refs);
  expect(value(batch.results[0])).toEqual({ kind: 'output', result });
  expect(value(batch.results[1])).toMatchObject({ kind: 'prompt', stage: 'alternative', text: '# Raw **prompt**\n{{context}}', textKind: 'pinned-template', sources: [
    { promptId: 'prompt', version: 2, contentHash: 'pinned-hash', stageId: 'tree', cellKey: 'one' }, { cellKey: 'two' }
  ] });
  expect(value(batch.results[2])).toMatchObject({ kind: 'inputs', data: { contexts: { context: { contentHash: 'source-hash' } }, available: true } });
  expect(batch.results[3]).toMatchObject({ status: 'error', error: { code: 'not-found' } });
  expect(batch.results[5]).toEqual(batch.results[1]);
  expect(f.readRun).toHaveBeenCalledTimes(1);
});

it('keeps node and resource identities stable across reordering; changed prompt content does not reuse a stale ref', async () => {
  const f = fixture(), before = await f.service.overview('experiment');
  f.experiment.conditions.reverse(); f.experiment.samples.reverse();
  const after = await f.service.overview('experiment');
  expect(nodes(before.root).map(n => n.id).sort()).toEqual(nodes(after.root).map(n => n.id).sort());
  expect(refsFor(before.root, 'prompt')).toEqual(refsFor(after.root, 'prompt'));
  f.run.prompts[0].stages.alternative = 'Different pinned text';
  expect((await f.service.read('experiment', { refs: refsFor(before.root, 'prompt') })).results[0]).toMatchObject({ status: 'error', error: { code: 'not-found' } });
});

it('keeps lengthy generated explanations behind detail reads while exposing short previews', async () => {
  const f = fixture();
  f.run.cells[0].explanation = 'Recorded explanation. '.repeat(1000);
  const overview = await f.service.overview('experiment');
  const preview = nodes(overview.root).find(node => node.id === 'output/one/tree/description')!;
  expect(preview.label.length).toBeLessThanOrEqual(240);
  expect(preview.label.endsWith('…')).toBe(true);
  expect(JSON.stringify(overview)).not.toContain(f.run.cells[0].explanation);
  const batch = await f.service.read('experiment', { refs: preview.actions![0].refs });
  expect(value(batch.results[0])).toMatchObject({ kind: 'details', data: { cell: { explanation: f.run.cells[0].explanation } } });
});

it('returns missing runs as unavailable and excludes records from other projects', async () => {
  const f = fixture(); f.run.projectId = 'other-project';
  const overview = await f.service.overview('experiment');
  expect(overview.root.status).toBe('partial');
  expect(refsFor(overview.root, 'prompt')).toEqual([]);
  expect(JSON.stringify(overview)).not.toContain('Saved prompt');
  const unknown = await f.service.read('experiment', { refs: ['output/another-experiment/tree'] });
  expect(unknown.results[0]).toMatchObject({ status: 'error', error: { code: 'not-found' } });
  expect(f.outputResult).not.toHaveBeenCalled();
});

it('handles prepared runs and stage-only experiments without assuming one phase per stored entity', async () => {
  const f = fixture(); delete f.experiment.phases;
  f.experiment.samples.forEach(sample => { delete sample.phaseId; sample.outputs = []; });
  f.run.cells.forEach(cell => { cell.status = 'queued'; delete cell.output; });
  f.experiment.plannedRuns = [{ request: f.run.request, outputs: f.experiment.samples.map(sample => ({ sampleId: sample.id, stageId: 'tree', cellKey: sample.id })) }];
  f.experiment.generationReview = { status: 'awaiting-approval', runs: [summarizeEvalRun(f.run)] };
  f.readRun.mockRejectedValue(Error('Not started'));
  const overview = await f.service.overview('experiment');
  expect(nodes(overview.root).find(node => node.id === 'phase/tree')).toMatchObject({ label: 'Phase 1 · Generate tree', status: 'queued' });
  expect(value((await f.service.read('experiment', { refs: refsFor(overview.root, 'prompt') })).results[0])).toMatchObject({ kind: 'prompt', text: '# Raw **prompt**\n{{context}}' });
});

it('runs independent artifact reads concurrently, deduplicates repeated refs, and isolates failures', async () => {
  const f = fixture(); delete f.run.outputResults;
  f.run.cells.forEach(cell => { cell.historyArtifact = { timelineId: 'timeline', stepId: cell.key }; });
  const overview = await f.service.overview('experiment'), outputs = refsFor(overview.root, 'output');
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
  const release = deferred();
  const bothStarted = deferred();
  let started = 0;
  f.outputResult.mockImplementation(async () => { const index = ++started; if (started === 2) bothStarted.resolve(); await release.promise; if (index === 1) throw Error('Missing artifact'); return result; });
  const pending = f.service.read('experiment', { refs: [outputs[0], outputs[1], outputs[1]] });
  await bothStarted.promise; // would deadlock if the service serialized the independent reads
  release.resolve();
  const batch = await pending;
  expect(batch.results[0]).toMatchObject({ status: 'error', error: { message: 'Missing artifact' } });
  expect(value(batch.results[1])).toEqual({ kind: 'output', result });
  expect(batch.results[2]).toEqual(batch.results[1]);
  expect(f.outputResult).toHaveBeenCalledTimes(2);
});

it('validates the batch limit before loading any records', async () => {
  const f = fixture();
  await expect(f.service.read('experiment', { refs: [] })).rejects.toThrow();
  await expect(f.service.read('experiment', { refs: Array(101).fill('settings') })).rejects.toThrow();
  await expect(f.service.read('experiment', { refs: ['settings'], mutate: true })).rejects.toThrow();
  expect(f.experiments.read).not.toHaveBeenCalled();
});

it('supports filtered projections and reports skipped outputs without showing completion', () => {
  const f = fixture(); f.run.cells[1].status = 'skipped';
  const overview = projectExperimentOverview(f.experiment, [summarizeEvalRun(f.run)], 'phase-2').overview;
  expect(overview.root).toMatchObject({ status: 'partial', counts: { finished: 1, total: 2 } });
  expect(nodes(overview.root).filter(node => node.source?.phaseId && node.kind === 'section')).toHaveLength(3);
});

it('lists ground truth under Inputs and reads the exact saved diagram', async () => {
  const f = fixture(), ascii = 'Core\n|-- [M] Controller   \n`-- [O] History\n';
  f.experiment.groundTruth = [{ id: 'truth', name: 'Reference core', description: '', caseIds: ['case'], format: 'ascii-tree', ascii, asciiSha256: 'hash',
    source: { commit: '8ca143700ca4d2c870f1101b8cd4601ab68abd41' }, provenance: { kind: 'model', model: 'test-model' }, createdAt: f.run.createdAt }];
  const overview = await f.service.overview('experiment');
  const group = nodes(overview.root).find(node => node.id === 'inputs/ground-truth')!;
  expect(group.label).toBe('Ground truth · 1 sample');
  const item = group.children!.find(node => node.kind === 'item')!;
  expect(item).toMatchObject({ label: 'Reference core', detail: 'model · source 8ca1437 · 1 case' });
  expect(JSON.stringify(overview)).not.toContain('[M] Controller');
  const read = await f.service.read('experiment', { refs: item.actions![0].refs });
  expect(value(read.results[0])).toEqual({ kind: 'ground-truth', data: f.experiment.groundTruth[0] });
});

it('omits the ground truth section when an experiment has none', async () => {
  const overview = await fixture().service.overview('experiment');
  expect(nodes(overview.root).some(node => node.id === 'inputs/ground-truth')).toBe(false);
});

it('exposes experiment tags in overview metadata without mixing in comment tags', async () => {
  const f = fixture();
  expect((await f.service.overview('experiment')).experiment.tags).toEqual([]);
  f.experiment.tags = ['core-discovery', 'review'];
  f.experiment.comments = [{ id: 'note', text: 'A note', createdAt: '2026-11-16T00:00:00Z', tags: ['todo'] }];
  const overview = await f.service.overview('experiment');
  expect(overview.experiment.tags).toEqual(['core-discovery', 'review']);
  expect(nodes(overview.root).find(node => node.id === 'comment/note')?.tags).toEqual(['todo']);
});

it('projects only canvas artifacts in mixed experiment reads and preserves the two snapshot sides', async () => {
  const f = fixture();
  const document = mappingDocumentFromScene(singleDiagramScene('one diagram'));
  f.run.outputResults!.one = { schemaVersion: 1, diagramRevisions: {}, canvases: [{ id: 'canvas', name: 'Example',
    version: 1, baseline: null, proposed: { document, canvas: initialCanvasState() } }] };
  const overview = await f.service.overview('experiment');
  const refs = refsFor(overview.root, 'output');
  const batch = await f.service.read('experiment', { refs });
  const projected = value(batch.results.find(item => item.ref.includes('/one/'))!);
  expect(projected).toMatchObject({ kind: 'output', result: { projectionType: 'graph', canvases: [
    { baseline: null, proposed: { nodes: [{ id: 'grid:overview', ascii: 'one diagram' }], edges: [] } }
  ] } });
  expect(JSON.stringify(projected)).not.toMatch(/diagramRevisions|asciiSha256|placementSnapshot/);
  expect(value(batch.results.find(item => item.ref.includes('/two/'))!)).toEqual({ kind: 'output', result });
});
