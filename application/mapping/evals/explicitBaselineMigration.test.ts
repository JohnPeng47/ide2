import { expect, it } from 'vitest';
import { explicitBaselineMigration } from './explicitBaselineMigration';
import type { EvalRun } from '../../../domain/mapping/evals/evalRun';
import type { ProjectRepresentationCatalogRecord } from '../../../domain/core/representations/projectCatalog';

const id = 'd574746f-91fc-4351-ab7f-f3bb4c292ff5';
function fixture() {
  const generated = { runId: id, key: 'stable-key', prompt: { id: 'old', version: 2, name: 'Old' }, promptStages: { alternative: 'Task: {{task}}' } };
  const history = { headId: 'immutable-head', snapshots: { 'immutable-head': { evidence: 'original content' } } };
  const run = { schemaVersion: 1, id, workflow: 'alternatives', projectId: 'p', status: 'finished', createdAt: 'old-date', completedAt: 'old-end',
    requestHash: 'old-hash', request: { requestId: id, workflow: 'alternatives', prompts: [{ promptId: 'old', version: 2 }],
      inputs: { context: { agentContextId: 'saved-agent-context-4d7a8b9e-2ffb-46ea-a2e0-d49a9067802e' } }, task: 'Fill all seven titled slots.', passes: 1, model: 'gpt-6-astra', effort: 'high' },
    prompts: [{ promptId: 'old', version: 2, name: 'Old', stages: { alternative: 'Context {{context}}.\nTask: {{task}}\nPass {{pass}} of {{passes}}.' } }],
    contexts: { context: { name: 'Pinned source', contentHash: 'source-hash' } }, layoutTemplate: { id: 'layout', geometry: { slots: Array.from({ length: 7 }, (_, i) => ({ id: `slot-${i + 1}` })) } },
    cells: [{ key: 'old:1:alternative', promptId: 'old', status: 'finished', canvasId: 'canvas', checkpointId: 'immutable-head' }],
    outputSnapshots: { canvas: { id: 'canvas', generated, history } }
  } as unknown as EvalRun;
  const catalog = { representations: { canvas: { id: 'canvas', generated }, unrelated: { id: 'unrelated', name: 'Keep me' } }, revisions: { original: history } } as unknown as ProjectRepresentationCatalogRecord;
  return { run, catalog };
}
it('unfolds the recorded task and hidden contract into one visible version, preserving output identity and history', () => {
  const { run, catalog } = fixture(), before = structuredClone({ run, catalog });
  const failed = { ...run, id: 'failed-run', parentRunId: id, status: 'failed' as const, cells: [], outputSnapshots: undefined };
  const result = explicitBaselineMigration(run, [run, failed], catalog, 'migration-date');
  expect(result.runs).toHaveLength(2);
  expect(result.prompt.versions[0].stages.alternative).toContain('Task: Fill all seven titled slots.');
  expect(result.prompt.versions[0].stages.alternative).toContain('Read layout-template.json.');
  expect(result.prompt.versions[0].stages.alternative).toContain('template-slots-v1');
  expect(result.prompt.versions[0].stages.alternative).not.toContain('{{task}}');
  for (const updated of result.runs) {
    expect(updated.request).not.toHaveProperty('task');
    expect(updated.prompts[0].promptId).toBe(result.prompt.id);
    expect(updated.request.prompts[0].promptId).toBe(result.prompt.id);
  }
  const updated = result.runs[0];
  expect(updated.cells[0].key).toBe(run.cells[0].key);
  expect(updated.cells[0].canvasId).toBe('canvas');
  expect(updated.outputSnapshots!.canvas.history).toEqual(run.outputSnapshots!.canvas.history);
  expect(updated.createdAt).toBe(run.createdAt); expect(updated.completedAt).toBe(run.completedAt);
  expect(result.catalog.revisions).toEqual(catalog.revisions);
  expect(result.catalog.representations.unrelated).toEqual(catalog.representations.unrelated);
  expect(result.catalog.representations.canvas.generated!.prompt!.id).toBe(result.prompt.id);
  expect(result.catalog.representations.canvas.generated!.key).toBe('stable-key');
  expect({ run, catalog }).toEqual(before);
});
it('refuses active runs and descendants with different prompt or layout settings', () => {
  const { run, catalog } = fixture();
  expect(() => explicitBaselineMigration(run, [{ ...run, status: 'generating' }], catalog, '')).toThrow('active');
  expect(() => explicitBaselineMigration(run, [{ ...run, request: { ...run.request, task: 'Different instructions' } }], catalog, '')).toThrow('different instructions');
});
