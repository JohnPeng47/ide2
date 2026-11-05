import { expect, it } from 'vitest';
import { ExperimentService, type StoredExperiment } from './experimentService';
import { experimentDesignSchema, experimentProgress, type ExperimentDesign } from '../../../domain/mapping/evals/experiment';
import type { EvalRunService } from './evalRunService';
import type { EvalRunSummary } from '../../../domain/mapping/evals/evalRun';

const design: ExperimentDesign = {
  name: 'Style controls', description: '', workflow: { id: 'generation', name: 'Generate', version: 1, stages: [{ id: 'generate', name: 'Generate', dependsOn: [] }] },
  cases: [{ id: 'case', name: 'Pinned source', agentContextId: 'context', contentHash: 'hash' }],
  conditions: [{ id: 'baseline', name: 'Baseline', description: '' }, { id: 'variant', name: 'Variant', description: '' }],
  samples: [ { id: 'b1', caseId: 'case', conditionId: 'baseline', number: 1, attempt: 1, outputs: [{ stageId: 'generate', runId: 'old-run', cellKey: 'b1' }] },
    { id: 'v1', caseId: 'case', conditionId: 'variant', number: 1, attempt: 1, outputs: [{ stageId: 'generate', runId: 'new-run', cellKey: 'v1' }] } ],
  comparisons: [{ id: 'contrast', name: 'Contrast', description: '', conditionIds: ['baseline', 'variant'], caseIds: ['case'], judgementIds: ['report'] }]
};
function fixture() {
  const records = new Map<string, StoredExperiment>();
  const sourceRuns = [{ id: 'old-run', projectId: 'project', agentContextId: 'context', contexts: { context: { agentContextId: 'context', contentHash: 'hash' } }, cells: [{ key: 'b1', status: 'finished' }] },
    { id: 'new-run', projectId: 'project', agentContextId: 'context', contexts: { context: { agentContextId: 'context', contentHash: 'hash' } }, cells: [{ key: 'v1', status: 'finished' }] }];
  const before = structuredClone(sourceRuns);
  const runs = { read: async (id: string) => { const value = sourceRuns.find(r => r.id === id); if (!value) throw Error('Run not found'); return value; },
    judgements: { list: async () => [{ id: 'report', projectId: 'project', subjects: [{ runId: 'old-run', outputKey: 'b1' }, { runId: 'new-run', outputKey: 'v1' }] }] }
  } as unknown as Pick<EvalRunService, 'read' | 'judgements'>;
  const service = new ExperimentService({ list: async () => [...records.values()], read: async id => records.get(id) ?? null, save: async value => { records.set(value.id, structuredClone(value)); } },
    runs, { loadProject: async () => ({ id: 'project' }) }, { read: async id => { if (id !== 'context') throw Error('No context'); return { contentHash: 'hash' }; } });
  return { service, records, sourceRuns, before };
}
it('registers shared inputs and reports without rewriting source runs; retains stable saved records', async () => {
  const f = fixture(), request = { requestId: crypto.randomUUID(), experiment: design };
  const [a, b] = await Promise.all([f.service.save(request), f.service.save(request)]);
  expect(a).toEqual(b); expect(a.revision).toBe(1); expect(f.sourceRuns).toEqual(f.before);
  expect(await f.service.read(a.id)).toEqual(a); expect(await f.service.list()).toHaveLength(1);
  expect(experimentProgress(a, f.sourceRuns as unknown as EvalRunSummary[])).toEqual({ finished: 2, total: 2, status: 'finished' });
});
it('serializes concurrent edits and rejects stale revisions and conflicting request reuse', async () => {
  const f = fixture(), created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const update = { requestId: crypto.randomUUID(), experimentId: created.id, expectedRevision: 1, experiment: { ...design, name: 'Revised' } };
  const outcomes = await Promise.allSettled([f.service.save(update), f.service.save({ ...update, requestId: crypto.randomUUID() })]);
  expect(outcomes.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  expect((await f.service.save(update)).revision).toBe(2);
  await expect(f.service.save({ ...update, experiment: design })).rejects.toThrow('Request ID');
});
it('rejects output misassignment, incorrect hashes, unknown cells and comparisons that omit their subjects', async () => {
  for (const change of [
    (d: ExperimentDesign) => { d.cases[0].contentHash = 'wrong'; },
    (d: ExperimentDesign) => { d.samples[0].outputs[0].cellKey = 'missing'; },
    (d: ExperimentDesign) => { d.comparisons[0].conditionIds = ['baseline']; },
    (d: ExperimentDesign) => { d.cases[0].agentContextId = 'missing'; },
  ]) {
    const f = fixture(), edited = structuredClone(design); change(edited);
    await expect(f.service.save({ requestId: crypto.randomUUID(), experiment: edited })).rejects.toThrow();
    expect(f.records.size).toBe(0);
  }
});
it('gives each Judgement one home while allowing the same output pool to be referenced', async () => {
  const f = fixture(); await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  await expect(f.service.save({ requestId: crypto.randomUUID(), experiment: design })).rejects.toThrow('another experiment');
  await expect(f.service.save({ requestId: crypto.randomUUID(), experiment: { ...design, comparisons: [] } })).resolves.toHaveProperty('revision', 1);
});
it('rejects cyclic stages, duplicate sample attempts and duplicate output membership', () => {
  expect(experimentDesignSchema.safeParse({ ...design, workflow: { ...design.workflow, stages: [{ id: 'a', name: 'A', dependsOn: ['b'] }, { id: 'b', name: 'B', dependsOn: ['a'] }] } }).success).toBe(false);
  expect(experimentDesignSchema.safeParse({ ...design, samples: [...design.samples, { ...design.samples[0], id: 'duplicate' }] }).success).toBe(false);
  const duplicateOutput = structuredClone(design); duplicateOutput.samples[1].outputs = duplicateOutput.samples[0].outputs;
  expect(experimentDesignSchema.safeParse(duplicateOutput).success).toBe(false);
});
it('represents pending stages and missing or deleted outputs without silently declaring completion', () => {
  const f = fixture(), d = structuredClone(design); d.workflow.stages.push({ id: 'expand', name: 'Expand', dependsOn: ['generate'] });
  expect(experimentProgress(d, f.sourceRuns as unknown as EvalRunSummary[])).toMatchObject({ finished: 2, total: 4, status: 'planned' });
  expect(experimentProgress(design, []).status).toBe('partial');
});

it('records a new attempt once, survives attachment failure, and rejects stale or changed requests', async () => {
  const records = new Map<string, StoredExperiment>();
  let failCompletion = true;
  const store = { list: async () => [...records.values()], read: async (id: string) => records.get(id) ?? null,
    save: async (record: StoredExperiment) => { if (record.samples.length > 2 && failCompletion) { failCompletion = false; throw Error('Disk temporarily unavailable'); } records.set(record.id, structuredClone(record)); } };
  const launches = new Map<string, EvalRunSummary>();
  const runs = {
    read: async (id: string) => ({ id, projectId: 'project', agentContextId: 'context', workflow: 'alternatives', contexts: { context: { agentContextId: 'context', contentHash: 'hash' } }, cells: [{ key: id === 'old-run' ? 'b1' : 'v1', stage: 'alternative', pass: 1, promptId: 'p' }] }),
    editedPrompt: async () => ({}),
    launchEdited: async (_run: string, _cell: string, _stages: Record<string, string>, id: string) => {
      if (!launches.has(id)) launches.set(id, { id, cells: [{ key: 'edited:1:alternative', stage: 'alternative', pass: 1, status: 'queued' }] } as EvalRunSummary);
      return launches.get(id)!;
    }
  } as unknown as ConstructorParameters<typeof ExperimentService>[1];
  const make = () => new ExperimentService(store, runs, { loadProject: async () => ({ id: 'project' }) }, { read: async () => ({ contentHash: 'hash' }) });
  const service = make(), created = await service.save({ requestId: crypto.randomUUID(), experiment: { ...design, comparisons: [] } });
  const request = { requestId: crypto.randomUUID(), expectedRevision: 1, sampleId: 'b1', stageId: 'generate', stages: { alternative: 'Edited prompt' } };
  await expect(service.relaunch(created.id, { ...request, expectedRevision: 9 })).rejects.toThrow('Refresh'); expect(launches.size).toBe(0);
  await expect(service.relaunch(created.id, request)).rejects.toThrow('Disk'); expect(launches.size).toBe(1);
  const restarted = make();
  const [a, b] = await Promise.all([restarted.relaunch(created.id, request), restarted.relaunch(created.id, request)]);
  expect(a).toEqual(b); expect(launches.size).toBe(1); expect(a.experiment.samples).toHaveLength(3);
  expect(a.experiment.samples.slice(0, 2)).toEqual(created.samples);
  expect(a.experiment.samples[2]).toMatchObject({ number: 1, attempt: 2, relaunchedFrom: { sampleId: 'b1', stageId: 'generate' }, outputs: [{ runId: request.requestId, stageId: 'generate' }] });
  expect(a.experiment.revision).toBe(2); expect(a.experiment).not.toHaveProperty('launches');
  await expect(restarted.relaunch(created.id, { ...request, stages: { alternative: 'Changed retry' } })).rejects.toThrow('request ID');
});

it('preserves explicit prompt lineage and rejects cycles or invalid condition assignments', async () => {
  const promptTree = [
    { id: 'base', name: 'Baseline', conditionId: 'baseline' },
    { id: 'axis', name: 'Expression', parentId: 'base' },
    { id: 'variation', name: 'Variant', parentId: 'axis', conditionId: 'variant' }
  ];
  const f = fixture();
  const saved = await f.service.save({ requestId: crypto.randomUUID(), experiment: { ...design, promptTree } });
  expect((await f.service.read(saved.id)).promptTree).toEqual(promptTree);
  for (const invalid of [
    [{ ...promptTree[0], parentId: 'variation' }, ...promptTree.slice(1)],
    [...promptTree, { id: 'other', name: 'Other', conditionId: 'variant' }],
    [...promptTree, { id: 'other', name: 'Other', conditionId: 'missing' }],
  ]) expect(experimentDesignSchema.safeParse({ ...design, promptTree: invalid }).success).toBe(false);
});

it('pins a review plan without executing and requires current, idempotent approval', async () => {
  const f = fixture();
  const prepared = { id: crypto.randomUUID(), projectId: 'project', agentContextId: 'context', request: {}, contexts: { context: { contentHash: 'hash' } }, inputs: {}, cells: [{ key: 'p:1:alternative' }], prompts: [{ stages: { alternative: 'Pinned prompt' } }] };
  let launches = 0;
  const service = new ExperimentService({ list: async () => [...f.records.values()], read: async id => f.records.get(id) ?? null, save: async value => { f.records.set(value.id, structuredClone(value)); } },
    { read: async () => prepared, prepareForReview: async () => structuredClone(prepared), launchPrepared: async () => { launches++; return prepared; } } as unknown as ConstructorParameters<typeof ExperimentService>[1],
    { loadProject: async () => ({ id: 'project' }) }, { read: async () => ({ contentHash: 'hash' }) });
  const d = { ...design, comparisons: [], samples: [{ ...design.samples[0], outputs: [] }], plannedRuns: [{ request: { requestId: prepared.id, workflow: 'alternatives', prompts: [{ promptId: 'p', version: 1 }], inputs: { context: { agentContextId: 'saved-agent-context-11111111-1111-4111-8111-111111111111' } }, passes: 1, model: 'gpt-6-astra', effort: 'high' }, outputs: [{ sampleId: 'b1', stageId: 'generate', cellKey: 'p:1:alternative' }] }] };
  const saved = await service.save({ requestId: crypto.randomUUID(), experiment: d });
  expect(launches).toBe(0); expect(saved.generationReview?.status).toBe('awaiting-approval'); expect(saved).not.toHaveProperty('preparedRuns');
  await expect(service.approve(saved.id, { requestId: crypto.randomUUID(), expectedRevision: 9 })).rejects.toThrow('changed'); expect(launches).toBe(0);
  const approval = { requestId: crypto.randomUUID(), expectedRevision: saved.revision };
  const [a,b] = await Promise.all([service.approve(saved.id, approval), service.approve(saved.id, approval)]);
  expect(a).toEqual(b); expect(launches).toBe(1); expect(a.generationReview?.status).toBe('started');
  expect(a.samples[0].outputs).toEqual([{ stageId: 'generate', runId: prepared.id, cellKey: 'p:1:alternative' }]);
});

it('groups repeated sample numbers by phase and rejects missing or dangling phase membership', async () => {
  const d = structuredClone(design);
  d.phases = [{ id: 'baseline', name: 'Baseline', description: '' }, { id: 'revision', name: 'Revision', description: '' }];
  d.samples[0].phaseId = 'baseline'; d.samples[1].phaseId = 'revision'; d.samples[1].conditionId = 'baseline';
  d.comparisons = [];
  expect(experimentDesignSchema.safeParse(d).success).toBe(true);
  expect((await fixture().service.save({ requestId: crypto.randomUUID(), experiment: d })).phases).toEqual(d.phases);
  for (const phaseId of [undefined, 'missing']) {
    expect(experimentDesignSchema.safeParse({ ...d, samples: [{ ...d.samples[0], phaseId }] }).success).toBe(false);
  }
});
it('rejects a phase judgement whose subjects include another phase', async () => {
  const d = structuredClone(design);
  d.phases = [{ id: 'one', name: 'One', description: '' }, { id: 'two', name: 'Two', description: '' }];
  d.samples[0].phaseId = 'one'; d.samples[1].phaseId = 'two'; d.comparisons[0].phaseId = 'one';
  await expect(fixture().service.save({ requestId: crypto.randomUUID(), experiment: d })).rejects.toThrow('phase, cases and conditions');
});
it('keeps baseline outputs fixed while preparing and approving a later phase independently', async () => {
  const records = new Map<string, StoredExperiment>();
  const prepared = new Map<string, any>(); const launches: string[] = [];
  const service = new ExperimentService({ list: async () => [...records.values()], read: async id => records.get(id) ?? null, save: async e => { records.set(e.id, structuredClone(e)); } }, {
    read: async id => prepared.get(id),
    prepareForReview: async (request: any) => {
      const run = { id: request.requestId, projectId: 'project', agentContextId: 'context', request, inputs: {}, contexts: { context: { agentContextId: 'context', contentHash: 'hash' } }, cells: [{ key: 'p:1:proposal' }], prompts: [] };
      prepared.set(run.id, run); return run;
    }, launchPrepared: async run => { launches.push(run.id); return run; }
  } as ConstructorParameters<typeof ExperimentService>[1], { loadProject: async () => ({ id: 'project' }) }, { read: async () => ({ contentHash: 'hash' }) });
  const plan = (sampleId: string) => ({ request: { requestId: crypto.randomUUID(), workflow: 'diagram-change-proposal', prompts: [{ promptId: 'p', version: 1 }], inputs: { context: { agentContextId: 'saved-agent-context-11111111-1111-4111-8111-111111111111' } }, passes: 1, model: 'gpt-6-sol', effort: 'high' }, outputs: [{ sampleId, stageId: 'generate', cellKey: 'p:1:proposal' }] });
  const initial = { ...design, phases: [{ id: 'one', name: 'Baseline', description: '' }], comparisons: [], samples: [{ ...design.samples[0], phaseId: 'one', outputs: [] }], plannedRuns: [plan('b1')] };
  let saved = await service.save({ requestId: crypto.randomUUID(), experiment: initial });
  expect(launches).toEqual([]);
  saved = await service.approve(saved.id, { requestId: crypto.randomUUID(), expectedRevision: saved.revision });
  const { id, schemaVersion, projectId, revision, createdAt, updatedAt, generationReview, ...next } = saved;
  next.phases!.push({ id: 'two', name: 'Revision', description: '' });
  next.samples.push({ ...initial.samples[0], id: 'b2', phaseId: 'two' });
  next.plannedRuns!.push(plan('b2') as any);
  const reviewed = await service.save({ requestId: crypto.randomUUID(), experimentId: id, expectedRevision: revision, experiment: next });
  expect(reviewed.generationReview?.status).toBe('awaiting-approval');
  expect(reviewed.generationReview?.runs.map(r => r.id)).toEqual([next.plannedRuns![1].request.requestId]);
  expect(launches).toHaveLength(1);
  const approved = await service.approve(id, { requestId: crypto.randomUUID(), expectedRevision: reviewed.revision });
  expect(launches).toEqual(next.plannedRuns!.map(p => p.request.requestId));
  expect(approved.samples[0]).toEqual(saved.samples[0]);
});
it('deterministically judges only completed phase outputs and retains raw evidence with idempotent attachment', async () => {
  const f = fixture(), d = structuredClone(design), storedJudgements = new Map<string, any>();
  d.phases = [{ id: 'one', name: 'Baseline', description: '' }, { id: 'two', name: 'Later', description: '' }];
  d.samples[0].phaseId = 'one'; d.samples[1].phaseId = 'two';
  d.comparisons = [{ ...d.comparisons[0], phaseId: 'one', judgementIds: [], evaluator: { kind: 'deterministic', parser: 'diagram-change-tree', version: 1 } }];
  const tree = 'Proposed diagram changes\n  `-- Core                              existing canvas\n      `-- [4] Rewrite overview';
  Object.assign(f.sourceRuns[0].cells[0], { proposalTree: tree, canvasId: 'canvas', checkpointId: 'checkpoint' });
  const service = new ExperimentService({ list: async () => [...f.records.values()], read: async id => f.records.get(id) ?? null, save: async e => { f.records.set(e.id, structuredClone(e)); } }, {
    read: async id => f.sourceRuns.find(r => r.id === id), judgements: { list: async () => [], read: async id => storedJudgements.get(id), saveDeterministic: async j => { storedJudgements.set(j.id, j); return j; } }
  } as unknown as ConstructorParameters<typeof ExperimentService>[1], { loadProject: async () => ({ id: 'project' }) }, { read: async () => ({ contentHash: 'hash' }) });
  const saved = await service.save({ requestId: crypto.randomUUID(), experiment: d });
  expect(storedJudgements.size).toBe(0);
  const input = { requestId: crypto.randomUUID(), expectedRevision: saved.revision, comparisonId: 'contrast' };
  f.sourceRuns[0].cells[0].status = 'queued';
  await expect(service.judge(saved.id, input)).rejects.toThrow('finished');
  expect(storedJudgements.size).toBe(0);
  f.sourceRuns[0].cells[0].status = 'finished';
  const judged = await service.judge(saved.id, input);
  expect(await service.judge(saved.id, input)).toEqual(judged);
  expect(storedJudgements.get(input.requestId)).toMatchObject({ subjects: [{ runId: 'old-run', outputKey: 'b1' }], data: { outputsUsing4: 1, outputs: [{ text: tree }] } });
  expect(judged.comparisons[0].judgementIds).toEqual([input.requestId]);
});
