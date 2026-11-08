import { expect, it } from 'vitest';
import { configureGenerationRun, generationModelPresets } from './generationSettings';
import type { EvalExperiment } from './experiment';
import type { EvalRunSummary } from './evalRun';

function fixture(stages = ['linked']) {
  const request = { requestId: '00000000-0000-4000-8000-000000000001', workflow: stages.length > 1 ? 'roll-up' : 'linked-canvases',
    prompts: [{ promptId: 'prompt', version: 3 }], inputs: { context: { agentContextId: 'saved-agent-context-11111111-1111-4111-8111-111111111111' } },
    canvasSources: [{ documentId: 'canvas', checkpointId: 'pinned' }], passes: 1, model: 'gpt-6-astra', effort: 'high' };
  if (stages.length > 1) delete (request as any).canvasSources;
  const run = { id: request.requestId, workflow: request.workflow, request, cells: stages.map(stage => ({ key: `prompt:1:${stage}`, pass: 1, promptId: 'prompt', stage })), prompts: [] } as unknown as EvalRunSummary;
  const experiment = { id: 'experiment', schemaVersion: 1, projectId: 'project', revision: 5, createdAt: '', updatedAt: '',
    name: 'Example', description: '', phases: [{ id: 'one', name: 'Baseline', description: '' }, { id: 'two', name: 'Link', description: '' }],
    workflow: { id: 'flow', name: 'Generate', version: 1, stages: stages.map(id => ({ id, name: id, dependsOn: [] })) },
    cases: [{ id: 'case', name: 'Pinned case', agentContextId: request.inputs.context.agentContextId }], conditions: [{ id: 'condition', name: 'Condition', description: '' }],
    samples: [{ id: 'baseline', phaseId: 'one', caseId: 'case', conditionId: 'condition', number: 1, attempt: 1, outputs: [{ stageId: stages[0], runId: 'completed', cellKey: 'old' }] },
      { id: 'pending', phaseId: 'two', caseId: 'case', conditionId: 'condition', number: 1, attempt: 1, outputs: [] }],
    plannedRuns: [{ request, outputs: stages.map(stage => ({ sampleId: 'pending', stageId: stage, cellKey: `prompt:1:${stage}` })) }],
    comparisons: [], generationReview: { status: 'awaiting-approval', runs: [run] }
  } as unknown as EvalExperiment;
  return { run, experiment };
}

it('expands independent outputs while retaining phase, pinned inputs, prompt versions and completed samples', () => {
  const { experiment } = fixture(), before = structuredClone(experiment);
  const next = configureGenerationRun(experiment, experiment.plannedRuns![0].request.requestId, 3, 'sol-6-1-low');
  expect(next.samples[0]).toEqual(experiment.samples[0]);
  expect(next.samples.filter(s => s.phaseId === 'two').map(s => s.number)).toEqual([1, 2, 3]);
  expect(next.plannedRuns![0].outputs.map(o => o.cellKey)).toEqual(['prompt:1:linked', 'prompt:2:linked', 'prompt:3:linked']);
  expect(next.plannedRuns![0].request).toEqual({ ...experiment.plannedRuns![0].request, passes: 3, model: 'gpt-6.1-sol', effort: 'low' });
  expect(experiment).toEqual(before);
});

it('reduces pending samples without deleting the retained or completed samples', () => {
  const { experiment, run } = fixture();
  const increased = configureGenerationRun(experiment, run.id, 3, 'sol-6-1-high');
  const resized = { ...experiment, ...increased, generationReview: { status: 'awaiting-approval' as const, runs: [{ ...run, request: increased.plannedRuns![0].request,
    cells: increased.plannedRuns![0].outputs.map((o, i) => ({ ...run.cells[0], key: o.cellKey, pass: i + 1 })) }] } };
  const reduced = configureGenerationRun(resized, run.id, 1, 'astra-high');
  expect(reduced.samples).toEqual(experiment.samples);
  expect(reduced.plannedRuns![0].outputs).toEqual(experiment.plannedRuns![0].outputs);
});

it('maps all stages of a new sample to the same sample record', () => {
  const { experiment, run } = fixture(['r2', 'g2']);
  const next = configureGenerationRun(experiment, run.id, 2, 'astra-high');
  expect(next.samples).toHaveLength(3);
  expect(next.plannedRuns![0].outputs.slice(2).map(o => o.sampleId)).toEqual([next.samples[2].id, next.samples[2].id]);
});

it('rejects approved plans, invalid counts and unsupported presets', () => {
  const { experiment, run } = fixture();
  for (const passes of [0, 21, 1.5, NaN]) expect(() => configureGenerationRun(experiment, run.id, passes, 'astra-high')).toThrow();
  expect(() => configureGenerationRun(experiment, run.id, 1, 'other')).toThrow('three');
  experiment.generationReview!.status = 'started';
  expect(() => configureGenerationRun(experiment, run.id, 2, 'astra-high')).toThrow('pending');
});

it('allows model changes but prevents resizing samples shared across runs', () => {
  const { experiment, run } = fixture();
  experiment.plannedRuns!.push({ ...experiment.plannedRuns![0], request: { ...run.request, requestId: '00000000-0000-4000-8000-000000000002' },
    outputs: [{ sampleId: 'pending', stageId: 'later', cellKey: 'other:1:linked' }] });
  experiment.workflow.stages.push({ id: 'later', name: 'Later', dependsOn: ['linked'] });
  expect(() => configureGenerationRun(experiment, run.id, 2, 'astra-high')).toThrow('shared');
  expect(configureGenerationRun(experiment, run.id, 1, 'sol-6-1-low').plannedRuns![0].request.effort).toBe('low');
});

it('exposes exactly the three requested model/effort combinations', () => {
  expect(generationModelPresets.map(p => [p.model, p.effort])).toEqual([['gpt-6-astra', 'high'], ['gpt-6.1-sol', 'high'], ['gpt-6.1-sol', 'low']]);
});
