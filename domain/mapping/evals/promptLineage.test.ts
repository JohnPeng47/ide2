import { expect, it } from 'vitest';
import { experimentPromptLineage, promptVersionKey } from './promptLineage';
import type { EvalExperiment } from './experiment';
import type { EvalRunSummary } from './evalRun';
import type { EvalPrompt } from './evalPrompt';

it('derives groups from exact version relationships, deduplicates samples, and separates edited attempts', () => {
  const root = { promptId: 'base', version: 1, name: 'Renamed base', stages: { alternative: 'Original' } };
  const child = { promptId: 'child', version: 1, name: 'Different name', stages: { alternative: 'Code' }, derivation: { parent: { promptId: 'base', version: 1 }, kind: 'variation' as const, dimension: { id: 'expression', name: 'Expression', value: '100% code' } } };
  const retry = { promptId: 'retry', version: 1, name: 'Attempt', stages: { alternative: 'Edit' }, derivation: { parent: { promptId: 'child', version: 1 }, kind: 'relaunch' as const } };
  const runs = [{ id: 'run', workflow: 'alternatives', prompts: [root, child, retry], cells: [root, root, child, retry].map((p, i) => ({ key: `cell-${i}`, promptId: p.promptId, promptVersion: p.version })) }] as unknown as EvalRunSummary[];
  const experiment = { conditions: [{ id: 'base', name: 'Shared baseline' }, { id: 'code', name: 'Code' }], samples: ['base', 'base', 'code', 'code'].map((conditionId, i) => ({ id: `sample-${i}`, conditionId, outputs: [{ stageId: 'generate', runId: 'run', cellKey: `cell-${i}` }], ...(i === 3 ? { relaunchedFrom: { sampleId: 'sample-2', stageId: 'generate' } } : {}) })) } as EvalExperiment;
  const nodes = experimentPromptLineage(experiment, runs, []);
  expect(nodes).toHaveLength(4);
  expect(nodes.find(n => n.id === promptVersionKey('base', 1))?.outputKeys).toHaveLength(2);
  const axis = nodes.find(n => n.name === 'Expression')!;
  expect(axis.parentId).toBe(promptVersionKey('base', 1));
  expect(nodes.find(n => n.name === 'Code')).toMatchObject({ parentId: axis.id, description: '100% code', outputKeys: ['sample-2:generate'] });
  expect(nodes.find(n => n.name === 'Code · edited attempt')?.parentId).toBe(promptVersionKey('child', 1));
  // Parent context remains present when this experiment contains only a variation.
  const onlyChild = { ...experiment, samples: [experiment.samples[2]] };
  expect(experimentPromptLineage(onlyChild, runs, []).find(n => n.id === promptVersionKey('base', 1))).toMatchObject({ outputKeys: [], prompt: root });
});
it('uses explicitly backfilled legacy lineage, never infers it from matching labels or conditions', () => {
  const run = { id: 'run', workflow: 'alternatives', prompts: [{ promptId: 'p', version: 1, name: 'Code', stages: { alternative: 'x' } }], cells: [{ key: 'cell', promptId: 'p' }] } as unknown as EvalRunSummary;
  const experiment = { conditions: [{ id: 'code', name: 'Code' }], samples: [{ id: 's', conditionId: 'code', outputs: [{ stageId: 'g', runId: 'run', cellKey: 'cell' }] }], promptTree: [{ id: 'invented', name: 'Fake parent', conditionId: 'code' }] } as EvalExperiment;
  expect(experimentPromptLineage(experiment, [run], [])).toHaveLength(1);
  const catalog = [{ id: 'p', name: 'Code', workflow: 'alternatives', versions: [{ version: 1, stages: { alternative: 'x' }, derivation: { parent: { promptId: 'b', version: 1 }, kind: 'variation', dimension: { id: 'expr', name: 'Expression', value: 'Code' } } }] }, { id: 'b', name: 'Baseline', workflow: 'alternatives', versions: [{ version: 1, stages: { alternative: 'old' } }, { version: 2, stages: { alternative: 'new' } }] }] as unknown as EvalPrompt[];
  const nodes = experimentPromptLineage(experiment, [run], catalog);
  expect(nodes).toHaveLength(3);
  expect(nodes.find(n => n.id === promptVersionKey('b', 1))?.prompt?.stages.alternative).toBe('old');
});
