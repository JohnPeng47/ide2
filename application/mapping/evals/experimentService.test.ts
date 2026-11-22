import { projectExperimentOverview } from '../../../domain/mapping/evals/experimentOverviewProjection';
import { sha256 } from '../../../domain/core/sha256';
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

it('reattaches a saved-prompt rerun after an interrupted write without duplicating attempts', async () => {
  const { records, service } = fixture();
  const created = await service.save({ requestId: crypto.randomUUID(), experiment: design });
  const request = { requestId: crypto.randomUUID(), expectedRevision: created.revision, runId: 'old-run', cellKey: 'b1',
    prompt: { promptId: 'saved-copy', version: 2 } };
  let failWrite = true;
  const store = {
    list: async () => [...records.values()], read: async (id: string) => structuredClone(records.get(id) ?? null),
    save: async (record: StoredExperiment) => {
      if (failWrite && record.samples.length > created.samples.length) { failWrite = false; throw Error('Interrupted attachment'); }
      records.set(record.id, structuredClone(record));
    }
  };
  const runIds = new Set<string>();
  const runs = {
    read: async () => ({ id: 'old-run', cells: [{ key: 'b1', promptId: 'original', stage: 'alternative', pass: 1 }] }),
    rerunWithSavedPrompt: async (_source: unknown, key: string, prompt: typeof request.prompt, id: string) => {
      expect(key).toBe('b1'); expect(prompt).toEqual(request.prompt);
      runIds.add(id);
      return { id, cells: [{ key: 'saved:1:alternative', promptId: prompt.promptId, stage: 'alternative', pass: 1 }] };
    }
  } as unknown as ConstructorParameters<typeof ExperimentService>[1];
  const open = () => new ExperimentService(store, runs, { loadProject: async () => ({ id: 'project' }) }, { read: async () => ({ contentHash: 'hash' }) });
  await expect(open().rerun(created.id, { ...request, expectedRevision: 99 })).rejects.toThrow('changed');
  expect(runIds.size).toBe(0);
  await expect(open().rerun(created.id, request)).rejects.toThrow('Interrupted attachment');
  const reopened = open();
  const [first, retry] = await Promise.all([reopened.rerun(created.id, request), reopened.rerun(created.id, request)]);
  expect(first).toEqual(retry);
  expect(first.experiment.samples).toHaveLength(created.samples.length + 1);
  expect(first.experiment.samples.at(-1)).toMatchObject({ attempt: 2, relaunchedFrom: { sampleId: 'b1', stageId: 'generate' },
    outputs: [{ stageId: 'generate', runId: request.requestId, cellKey: 'saved:1:alternative' }] });
  expect(runIds).toEqual(new Set([request.requestId]));
  await expect(reopened.rerun(created.id, { ...request, cellKey: 'another-cell' })).rejects.toThrow('request ID');
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
it.each([false, true])('keeps baseline outputs fixed while adding a later phase (initially unphased: %s)', async unphased => {
  const records = new Map<string, StoredExperiment>();
  const prepared = new Map<string, any>(); const launches: string[] = [];
  const service = new ExperimentService({ list: async () => [...records.values()], read: async id => records.get(id) ?? null, save: async e => { records.set(e.id, structuredClone(e)); } }, {
    read: async (id: string) => prepared.get(id),
    prepareForReview: async (request: any) => {
      const run = { id: request.requestId, projectId: 'project', agentContextId: 'context', request, inputs: {}, contexts: { context: { agentContextId: 'context', contentHash: 'hash' } }, cells: [{ key: 'p:1:proposal' }], prompts: [] };
      prepared.set(run.id, run); return run;
    }, launchPrepared: async (run: import('../../../domain/mapping/evals/evalRun').EvalRun) => { launches.push(run.id); return run; }
  } as unknown as ConstructorParameters<typeof ExperimentService>[1], { loadProject: async () => ({ id: 'project' }) }, { read: async () => ({ contentHash: 'hash' }) });
  const plan = (sampleId: string) => ({ request: { requestId: crypto.randomUUID(), workflow: 'diagram-change-proposal', prompts: [{ promptId: 'p', version: 1 }], inputs: { context: { agentContextId: 'saved-agent-context-11111111-1111-4111-8111-111111111111' } }, passes: 1, model: 'gpt-6-sol', effort: 'high' }, outputs: [{ sampleId, stageId: 'generate', cellKey: 'p:1:proposal' }] });
  const initial = { ...design, phases: [{ id: 'one', name: 'Baseline', description: '' }], comparisons: [], samples: [{ ...design.samples[0], phaseId: 'one', outputs: [] }], plannedRuns: [plan('b1')] };
  const initialDesign = unphased ? { ...initial, phases: undefined, samples: initial.samples.map(({ phaseId: _, ...sample }) => sample) } : initial;
  let saved = await service.save({ requestId: crypto.randomUUID(), experiment: initialDesign });
  expect(launches).toEqual([]);
  saved = await service.approve(saved.id, { requestId: crypto.randomUUID(), expectedRevision: saved.revision });
  const { id, schemaVersion, projectId, revision, createdAt, updatedAt, generationReview, ...next } = saved;
  if (unphased) { next.phases = initial.phases; next.samples[0].phaseId = 'one'; }
  next.phases!.push({ id: 'two', name: 'Revision', description: '' });
  next.samples.push({ ...initial.samples[0], id: 'b2', phaseId: 'two' });
  next.plannedRuns!.push(plan('b2') as any);
  const reviewed = await service.save({ requestId: crypto.randomUUID(), experimentId: id, expectedRevision: revision, experiment: next });
  expect(reviewed.generationReview?.status).toBe('awaiting-approval');
  expect(reviewed.generationReview?.runs.map(r => r.id)).toEqual([next.plannedRuns![1].request.requestId]);
  expect(launches).toHaveLength(1);
  const approved = await service.approve(id, { requestId: crypto.randomUUID(), expectedRevision: reviewed.revision });
  expect(launches).toEqual(next.plannedRuns!.map(p => p.request.requestId));
  expect(approved.samples[0]).toEqual({ ...saved.samples[0], phaseId: 'one' });
  const reassign = structuredClone(next); reassign.phases!.push({ id: 'three', name: 'Third', description: '' });
  reassign.samples = structuredClone(approved.samples); reassign.samples[0].phaseId = 'three';
  await expect(service.save({ requestId: crypto.randomUUID(), experimentId: id, expectedRevision: approved.revision, experiment: reassign })).rejects.toThrow('cannot be reassigned');
});
it('deterministically judges only completed phase outputs and retains raw evidence with idempotent attachment', async () => {
  const f = fixture(), d = structuredClone(design), storedJudgements = new Map<string, any>();
  d.phases = [{ id: 'one', name: 'Baseline', description: '' }, { id: 'two', name: 'Later', description: '' }];
  d.samples[0].phaseId = 'one'; d.samples[1].phaseId = 'two';
  d.comparisons = [{ ...d.comparisons[0], phaseId: 'one', judgementIds: [], evaluator: { kind: 'deterministic', parser: 'diagram-change-tree', version: 1 } }];
  const tree = 'Proposed diagram changes\n  `-- Core                              existing canvas\n      `-- [4] Rewrite overview';
  Object.assign(f.sourceRuns[0].cells[0], { proposalTree: tree, canvasId: 'canvas', checkpointId: 'checkpoint' });
  const service = new ExperimentService({ list: async () => [...f.records.values()], read: async id => f.records.get(id) ?? null, save: async e => { f.records.set(e.id, structuredClone(e)); } }, {
    read: async (id: string) => f.sourceRuns.find(r => r.id === id), judgements: { list: async () => [], read: async (id: string) => storedJudgements.get(id), saveDeterministic: async (j: import('../../../domain/mapping/evals/judgement').Judgement) => { storedJudgements.set(j.id, j); return j; } }
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

it('counts only the stages attached to explicit phase samples', () => {
  const phased: ExperimentDesign = {
    ...design,
    phases: [{ id: 'planning', name: 'Planning', description: '' }, { id: 'execution', name: 'Execution', description: '' }],
    workflow: { ...design.workflow, stages: [...design.workflow.stages, { id: 'execute', name: 'Execute', dependsOn: ['generate'] }] },
    samples: design.samples.map(sample => ({ ...sample, phaseId: 'planning' }))
  };
  expect(experimentProgress(phased, fixture().sourceRuns as unknown as EvalRunSummary[])).toEqual({ finished: 2, total: 2, status: 'finished' });
  const pending = { ...phased, samples: [...phased.samples, { id: 'pending', caseId: 'case', conditionId: 'baseline', number: 2, attempt: 1, phaseId: 'execution', outputs: [] }] };
  pending.plannedRuns = [{ request: { requestId: 'pending-run', workflow: 'diagram-history', prompts: [], inputs: {}, passes: 1, model: 'test', effort: 'high' }, outputs: [{ sampleId: 'pending', stageId: 'execute', cellKey: 'execute' }] }];
  expect(experimentProgress(pending, fixture().sourceRuns as unknown as EvalRunSummary[])).toEqual({ finished: 2, total: 3, status: 'planned' });
});

it('appends comments without losing concurrent notes, retries safely, and preserves them through design updates', async () => {
  const f = fixture();
  const created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const first = { requestId: crypto.randomUUID(), text: 'First note\nWith a second line.' };
  const second = { requestId: crypto.randomUUID(), text: 'Second note' };
  await Promise.all([f.service.addComment(created.id, first), f.service.addComment(created.id, second)]);
  const commented = await f.service.read(created.id);
  expect(commented.comments?.map(comment => comment.text)).toEqual([first.text, second.text]);
  expect(commented.revision).toBe(3);
  expect(commented.samples).toEqual(created.samples);
  expect(f.sourceRuns).toEqual(f.before);
  expect(await f.service.addComment(created.id, first)).toEqual(commented);
  await expect(f.service.addComment(created.id, { ...first, text: 'Different text' })).rejects.toThrow('Request ID');
  const edited = await f.service.save({ requestId: crypto.randomUUID(), experimentId: created.id, expectedRevision: commented.revision,
    experiment: { ...design, description: 'Updated design' } });
  expect(edited.comments).toEqual(commented.comments);
  expect((await f.service.addComment(created.id, first)).revision).toBe(edited.revision);
});

it('attaches comments to the selected overview phase and includes that target in retry checks', async () => {
  const { service } = fixture();
  const phases = [{ id: 'first', name: 'First phase', description: '' }, { id: 'second', name: 'Second phase', description: '' }];
  const experiment = await service.save({ requestId: crypto.randomUUID(), experiment: {
    ...design, phases, samples: [], comparisons: []
  } });
  const note = { requestId: crypto.randomUUID(), phaseId: 'second', text: 'Review this phase', tags: ['insight'] };
  const saved = await service.addComment(experiment.id, note);
  expect(await service.addComment(experiment.id, note)).toEqual(saved);
  await expect(service.addComment(experiment.id, { ...note, phaseId: 'first' })).rejects.toThrow('Request ID');
  await expect(service.addComment(experiment.id, { ...note, requestId: crypto.randomUUID(), phaseId: 'generate' })).rejects.toThrow('phase');
  const overview = projectExperimentOverview(await service.read(experiment.id), []).overview;
  const notes = (phase: string) => overview.root.children!.find(node => node.id === 'phase/' + phase)!.children!.filter(node => node.source?.commentId);
  expect(notes('first')).toEqual([]);
  expect(notes('second')).toMatchObject([{ label: note.text, tags: note.tags, source: { phaseId: 'second', commentId: note.requestId } }]);
});

it('rejects empty comments and comments on missing or other-project experiments', async () => {
  const f = fixture();
  const created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  expect(() => f.service.addComment(created.id, { requestId: crypto.randomUUID(), text: '   ' })).toThrow();
  expect(() => f.service.addComment(created.id, { requestId: crypto.randomUUID(), text: 'x'.repeat(10001) })).toThrow();
  const note = { requestId: crypto.randomUUID(), text: 'A note' };
  await expect(f.service.addComment('missing', note)).rejects.toThrow('not found');
  f.records.set(created.id, { ...f.records.get(created.id)!, projectId: 'another-project' });
  await expect(f.service.addComment(created.id, note)).rejects.toThrow('not found');
  expect(f.records.get(created.id)?.comments).toBeUndefined();
});

it('saves reusable tags, updates and deletes comments safely, and retains tags after deletion and design edits', async () => {
  const f = fixture();
  const created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const first = { requestId: crypto.randomUUID(), text: 'Tagged note', tags: [' follow-up ', 'useful', 'useful'] };
  const tagged = await f.service.addComment(created.id, first);
  expect(tagged.comments?.[0].tags).toEqual(['follow-up', 'useful']);
  expect((await f.service.addComment(created.id, first)).revision).toBe(tagged.revision);
  await expect(f.service.addComment(created.id, { ...first, tags: ['different'] })).rejects.toThrow('Request ID');
  const second = { requestId: crypto.randomUUID(), text: 'Another note', tags: ['useful'] };
  await Promise.all([
    f.service.updateCommentTags(created.id, first.requestId, { tags: ['reviewed'] }),
    f.service.addComment(created.id, second)
  ]);
  const updated = await f.service.read(created.id);
  expect(updated.comments?.map(comment => comment.tags)).toEqual([['reviewed'], ['useful']]);
  expect(updated.commentTags).toEqual(['follow-up', 'useful', 'reviewed']);
  expect((await f.service.updateCommentTags(created.id, first.requestId, { tags: ['reviewed'] })).revision).toBe(updated.revision);
  const cleared = await f.service.updateCommentTags(created.id, second.requestId, { tags: [] });
  expect(cleared.comments?.[1].tags).toEqual([]);
  const deleted = await f.service.deleteComment(created.id, first.requestId);
  expect(deleted.comments?.map(comment => comment.id)).toEqual([second.requestId]);
  expect(deleted.commentTags).toEqual(updated.commentTags);
  expect(await f.service.deleteComment(created.id, first.requestId)).toEqual(deleted);
  await expect(f.service.updateCommentTags(created.id, first.requestId, { tags: ['missing'] })).rejects.toThrow('not found');
  const edited = await f.service.save({ requestId: crypto.randomUUID(), experimentId: created.id, expectedRevision: deleted.revision,
    experiment: { ...design, description: 'Edited design' } });
  expect(edited.comments).toEqual(deleted.comments);
  expect(edited.commentTags).toEqual(deleted.commentTags);
  expect(edited.samples).toEqual(created.samples);
  expect(f.sourceRuns).toEqual(f.before);
});

it('edits comment text without changing identity, creation time, tags, or other comments', async () => {
  const f = fixture();
  const created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const note = { requestId: crypto.randomUUID(), text: 'Original note', tags: ['useful'] };
  const added = await f.service.addComment(created.id, note);
  const second = { requestId: crypto.randomUUID(), text: 'Leave this note alone' };
  await f.service.addComment(created.id, second);
  await Promise.all([
    f.service.updateComment(created.id, note.requestId, { text: '  Revised note\nSecond line.  ' }),
    f.service.updateCommentTags(created.id, note.requestId, { tags: ['reviewed'] })
  ]);
  const edited = await f.service.read(created.id);
  expect(edited.comments?.[0]).toEqual({ ...added.comments![0], text: 'Revised note\nSecond line.', tags: ['reviewed'] });
  expect(edited.comments?.[1].text).toBe(second.text);
  expect(edited.commentTags).toEqual(['useful', 'reviewed']);
  expect(await f.service.updateComment(created.id, note.requestId, { text: 'Revised note\nSecond line.' })).toEqual(edited);
  for (const input of [{}, { text: '' }, { text: '   ' }, { text: 'x'.repeat(10001) }]) {
    expect(() => f.service.updateComment(created.id, note.requestId, input)).toThrow();
  }
  await expect(f.service.updateComment(created.id, 'missing', { text: 'Missing' })).rejects.toThrow('not found');
  expect(edited.samples).toEqual(created.samples);
  expect(f.sourceRuns).toEqual(f.before);
});

it('validates comment tags and isolates comment edits and deletes to the current project', async () => {
  const f = fixture();
  const created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const note = { requestId: crypto.randomUUID(), text: 'Note' };
  await f.service.addComment(created.id, note);
  for (const tags of [[' '], ['x'.repeat(51)], Array(21).fill('tag')]) {
    expect(() => f.service.addComment(created.id, { ...note, tags })).toThrow();
    expect(() => f.service.updateCommentTags(created.id, note.requestId, { tags })).toThrow();
  }
  await expect(f.service.deleteComment('missing', note.requestId)).rejects.toThrow('not found');
  f.records.set(created.id, { ...f.records.get(created.id)!, projectId: 'another-project' });
  await expect(f.service.updateCommentTags(created.id, note.requestId, { tags: ['tag'] })).rejects.toThrow('not found');
  await expect(f.service.updateComment(created.id, note.requestId, { text: 'Edited' })).rejects.toThrow('not found');
  await expect(f.service.deleteComment(created.id, note.requestId)).rejects.toThrow('not found');
  expect(f.records.get(created.id)?.comments).toHaveLength(1);
});

it('appends immutable ground truth samples, retries safely, and preserves them through design updates', async () => {
  const f = fixture();
  const created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const ascii = 'Core\n|-- [M] Controller   \n`-- [O] History\n';
  const sample = { requestId: crypto.randomUUID(), name: 'Reference core', caseIds: ['case'], format: 'ascii-tree' as const, ascii,
    source: { commit: '8ca143700ca4d2c870f1101b8cd4601ab68abd41' }, provenance: { kind: 'model' as const, model: 'test-model' } };
  const added = await f.service.addGroundTruth(created.id, sample);
  expect(added.revision).toBe(created.revision + 1);
  expect(added.groundTruth).toEqual([expect.objectContaining({ id: sample.requestId, ascii, description: '', asciiSha256: sha256(ascii) })]);
  expect(added.samples).toEqual(created.samples);
  expect(await f.service.addGroundTruth(created.id, sample)).toEqual(added);
  await expect(f.service.addGroundTruth(created.id, { ...sample, ascii: 'Changed' })).rejects.toThrow('Request ID');
  await expect(f.service.addGroundTruth(created.id, { ...sample, requestId: crypto.randomUUID(), caseIds: ['missing'] })).rejects.toThrow('unknown input case');
  expect(() => f.service.addGroundTruth(created.id, { ...sample, requestId: crypto.randomUUID(), ascii: '  \n ' })).toThrow();
  expect(() => f.service.addGroundTruth(created.id, { ...sample, requestId: crypto.randomUUID(), source: { commit: 'HEAD' } })).toThrow();


  const edited = await f.service.save({ requestId: crypto.randomUUID(), experimentId: created.id, expectedRevision: added.revision,
    experiment: { ...design, description: 'Updated design' } });
  expect(edited.groundTruth).toEqual(added.groundTruth);
});

it('pins a Markdown answer to its exact query on retry', async () => {
  const f = fixture();
  const experiment = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const sample = { requestId: crypto.randomUUID(), caseIds: ['case'], name: 'Reference review', format: 'markdown',
    query: 'Which components does this canvas explain?', markdown: '## Review\n\n**Input** flows into the renderer.',
    source: { commit: '8ca1437' }, provenance: { kind: 'model', model: 'Claude' } };
  const saved = await f.service.addGroundTruth(experiment.id, sample);
  expect(saved.groundTruth?.[0]).toMatchObject({ query: sample.query, markdown: sample.markdown, markdownSha256: sha256(sample.markdown) });
  expect(await f.service.addGroundTruth(experiment.id, sample)).toEqual(saved);
  await expect(f.service.addGroundTruth(experiment.id, { ...sample, query: 'Different question?' })).rejects.toThrow('Request ID');
});

it('renames an experiment without changing its design, and rejects conflicting renames', async () => {
  const f = fixture();
  const created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const input = { expectedRevision: created.revision, name: '  New title  ' };
  const [first, second] = await Promise.allSettled([
    f.service.rename(created.id, input),
    f.service.rename(created.id, { ...input, name: 'Concurrent title' })
  ]);
  expect(first.status).toBe('fulfilled');
  expect(second.status).toBe('rejected');
  const saved = await f.service.read(created.id);
  expect(saved).toEqual({ ...created, name: 'New title', updatedAt: expect.any(String), revision: created.revision + 1 });
  expect(await f.service.rename(created.id, input)).toEqual(saved);
  for (const name of ['   ', 'x'.repeat(161)]) expect(() => f.service.rename(created.id, { ...input, name })).toThrow();
  expect(f.sourceRuns).toEqual(f.before);
});

it('persists experiment tags separately from comment tags and preserves them on older design saves', async () => {
  const f = fixture();
  const created = await f.service.save({ requestId: crypto.randomUUID(), experiment: { ...design, tags: [' core ', 'core', 'review'] } });
  expect(created.tags).toEqual(['core', 'review']);
  const comment = await f.service.addComment(created.id, { requestId: crypto.randomUUID(), text: 'Note', tags: ['todo'] });
  const updated = await f.service.updateTags(created.id, { expectedRevision: comment.revision, tags: [' discovery ', 'discovery'] });
  expect(updated.tags).toEqual(['discovery']);
  expect(updated.comments).toEqual(comment.comments);
  expect(updated.commentTags).toEqual(['todo']);
  expect((await f.service.read(created.id)).tags).toEqual(['discovery']);
  expect((await f.service.list())[0].tags).toEqual(['discovery']);
  expect((await f.service.updateTags(created.id, { expectedRevision: comment.revision, tags: ['discovery'] })).revision).toBe(updated.revision);
  const edited = await f.service.save({ requestId: crypto.randomUUID(), experimentId: created.id, expectedRevision: updated.revision, experiment: { ...design, name: 'Renamed' } });
  expect(edited.tags).toEqual(['discovery']);
  const cleared = await f.service.updateTags(created.id, { expectedRevision: edited.revision, tags: [] });
  expect(cleared.tags).toEqual([]);
  expect(cleared.comments).toEqual(comment.comments);
  expect(f.sourceRuns).toEqual(f.before);
});

it('serializes experiment tag edits, rejects stale edits, and validates tags and project scope', async () => {
  const f = fixture(), created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  expect(created.tags).toEqual([]);
  const outcomes = await Promise.allSettled([
    f.service.updateTags(created.id, { expectedRevision: created.revision, tags: ['first'] }),
    f.service.updateTags(created.id, { expectedRevision: created.revision, tags: ['second'] })
  ]);
  expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect((await f.service.read(created.id)).tags).toEqual(['first']);
  for (const tags of [[' '], ['x'.repeat(51)], Array(21).fill('tag')]) {
    expect(() => f.service.updateTags(created.id, { expectedRevision: 2, tags })).toThrow();
    expect(experimentDesignSchema.safeParse({ ...design, tags }).success).toBe(false);
  }
  expect(() => f.service.updateTags(created.id, { tags: ['tag'] })).toThrow();
  const record = f.records.get(created.id)!;
  record.projectId = 'other';
  await expect(f.service.updateTags(created.id, { expectedRevision: 2, tags: [] })).rejects.toThrow('not found');
  expect(record.tags).toEqual(['first']);
});

it('tag edits retain prepared generation records and legacy records expose an empty tag list', async () => {
  const f = fixture(), created = await f.service.save({ requestId: crypto.randomUUID(), experiment: design });
  const record = f.records.get(created.id)!;
  delete record.tags;
  record.generationReview = { status: 'awaiting-approval', runs: [] };
  record.preparedRuns = [];
  record.startedRunIds = ['earlier-run'];
  record.approvalRequest = { id: 'approval', hash: 'hash' };
  expect((await f.service.read(created.id)).tags).toEqual([]);
  const before = structuredClone(record);
  await f.service.updateTags(created.id, { expectedRevision: created.revision, tags: ['ready'] });
  const after = f.records.get(created.id)!;
  expect(after).toEqual({ ...before, tags: ['ready'], revision: before.revision + 1, updatedAt: after.updatedAt });
});

it('preserves pinned input sources and projects ordered judge pairs without reading either input', async () => {
  const { service } = fixture();
  const producer = await service.save({ requestId: crypto.randomUUID(), experiment: design });
  const source = { label: 'Tree A', experimentId: producer.id, runId: 'old-run', cellKey: 'b1' };
  const pair = { caseId: 'case', agentContextId: 'context', sources: [source, { ...source, label: 'Tree B' }] };
  const consumer = { ...design, comparisons: [] };
  const saved = await service.save({ requestId: crypto.randomUUID(), experiment: { ...consumer, inputLineage: [pair] } });
  const update = { experimentId: saved.id, expectedRevision: saved.revision, requestId: crypto.randomUUID() };
  const updated = await service.save({ ...update, experiment: consumer });
  expect(updated.inputLineage).toEqual([pair]);
  await expect(service.save({ requestId: crypto.randomUUID(), experimentId: producer.id, expectedRevision: producer.revision,
    experiment: { ...design, comparisons: [], samples: design.samples.slice(1) } })).rejects.toThrow('uses this output');
  const { root } = projectExperimentOverview(updated, []).overview;
  const cases = root.children?.find(node => node.id === 'inputs')?.children?.find(node => node.id === 'inputs/cases');
  expect(cases?.children?.[0].children?.map(node => node.upstreamOutput)).toEqual(pair.sources);
  await expect(service.save({ ...update, requestId: crypto.randomUUID(), expectedRevision: updated.revision,
    experiment: { ...consumer, inputLineage: [] } })).rejects.toThrow('cannot change');
  await expect(service.save({ requestId: crypto.randomUUID(), experiment: { ...consumer,
    inputLineage: [{ ...pair, sources: [{ ...source, cellKey: 'missing' }] }] } })).rejects.toThrow('upstream output');
});
