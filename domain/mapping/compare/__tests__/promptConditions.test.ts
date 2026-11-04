import { expect, it } from 'vitest';
import { promptExperimentSchema, resolveComparisonReport } from '../comparisonReport';
import type { CompareCanvasCopy } from '../comparePageSession';

const sources = ['base', 'left', 'right'].map(documentId => ({ documentId, checkpointId: `revision-${documentId}` }));
const experiment = {
  baseline: [sources[0]], prompted: sources.slice(1), promptDifference: 'One control changes.', controlledSettings: 'Same inputs.', maxComparisons: 6,
  conditions: [{ label: 'left', sources: [sources[1]], promptDifference: 'Left pole' }, { label: 'right', sources: [sources[2]], promptDifference: 'Right pole' }]
};
const copies = sources.map((source, i) => ({ id: `copy-${i}`, source })) as CompareCanvasCopy[];
const camera = { transform: { offset: { x: 0, y: 0 }, scale: 1 } };
const output = (a: string, b: string, confidence = 'low') => ({
  summary: 'Summary', limitations: 'One output per pole.', comparisonSummary: 'Evidence', scale: { kind: 'default' },
  comparisons: [{ kind: 'canvas', title: 'Contrast', explanation: 'Directional movement',
    opinion: { level: 'moderate', attributionConfidence: confidence, rationale: 'Single samples limit attribution.' },
    A: { canvas: a, camera }, B: { canvas: b, camera } }]
});

it('requires unique conditions that exactly partition prompted sources', () => {
  expect(promptExperimentSchema.safeParse(experiment).success).toBe(true);
  for (const conditions of [
    [experiment.conditions[0], experiment.conditions[0]],
    [experiment.conditions[0], { ...experiment.conditions[1], sources: [sources[0]] }],
    [experiment.conditions[0], { ...experiment.conditions[1], label: 'baseline' }],
  ]) expect(promptExperimentSchema.safeParse({ ...experiment, conditions }).success).toBe(false);
});

it('allows baseline-to-pole and opposite-pole evidence but rejects same-condition evidence', () => {
  for (const pair of [['C1', 'C2'], ['C1', 'C3'], ['C2', 'C3'], ['C3', 'C2']])
    expect(resolveComparisonReport(output(...pair as [string, string]), copies, experiment, []).pages).toHaveLength(2);
  for (const pair of [['C2', 'C2'], ['C2', 'C1'], ['C4', 'C3']])
    expect(() => resolveComparisonReport(output(...pair as [string, string]), copies, experiment, [])).toThrow();
});

it('enforces low confidence for singly sampled poles and preserves binary group rules', () => {
  expect(() => resolveComparisonReport(output('C2', 'C3', 'high'), copies, experiment, [])).toThrow('low attribution');
  const { conditions: _, ...binary } = experiment;
  expect(() => resolveComparisonReport(output('C2', 'C3'), copies, binary, [])).toThrow('Invalid baseline');
});
