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
