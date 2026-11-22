import { describe, it, expect } from 'vitest';
import { ExperimentService, type StoredExperiment } from './experimentService';
import type { EvalRunService } from './evalRunService';
import { evalOutputFixture } from '../../../tests/support/evalOutputResult';
import { captureChangeSessionOutput } from '../../../domain/mapping/evals/evalOutputResult';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { exportExperimentComments } from '../../../domain/mapping/evals/experimentNodeComments';
import { projectExperimentOverview } from '../../../domain/mapping/evals/experimentOverviewProjection';
import { commentNavigationOrder, navigationOrder } from '../../../domain/mapping/evals/experimentNavigation';
import { summarizeEvalRun } from '../../../domain/mapping/evals/evalRun';

function fixture() {
  const { run, session } = evalOutputFixture('project');
  const result = captureChangeSessionOutput(session);
  run.status = 'finished'; run.cells[0].status = 'finished'; run.cells[0].error = undefined;
  run.cells[0].canvasId = 'existing-canvas'; run.cells[0].checkpointId = 'pinned';
  const second = { ...run, id: 'other-run', cells: [{ ...run.cells[0], canvasId: 'new-canvas' }] };
  const experiment: StoredExperiment = { schemaVersion: 1, id: 'study', projectId: 'project', revision: 1, name: 'Architecture review', description: '',
    createdAt: run.createdAt, updatedAt: run.createdAt, workflow: { id: 'review', name: 'Review', version: 1, stages: [{ id: 'generate', name: 'Generate', dependsOn: [] }] },
    phases: [{ id: 'first', name: 'First phase', description: '' }, { id: 'second', name: 'Second phase', description: '' }],
    cases: [{ id: 'case', name: 'Architecture', agentContextId: run.agentContextId }], conditions: [{ id: 'condition', name: 'Variant', description: '' }],
    samples: [run, second].map((r, i) => ({ id: `sample-${i}`, phaseId: i ? 'second' : 'first', caseId: 'case', conditionId: 'condition', number: i + 1, attempt: 1,
      outputs: [{ stageId: 'generate', runId: r.id, cellKey: r.cells[0].key }] })), comparisons: [], lastRequest: { id: 'fixture', hash: 'fixture' } };
  let stored = structuredClone(experiment);
  const service = new ExperimentService({ list: async () => [stored], read: async id => id === stored.id ? stored : null, save: async value => { stored = structuredClone(value); } },
    { read: async (id: string) => [run, second].find(r => r.id === id)!, promotionSource: async () => result } as unknown as EvalRunService,
    { loadProject: async () => ({ id: 'project' }) }, { read: async () => ({ contentHash: 'fixture' }) });
  const doc = result.canvases[0].proposed.document, diagram = doc.scene.contents.overview;
  const nodes = diagramContentNodes(diagram.content);
  const anchor = { runId: run.id, cellKey: run.cells[0].key, canvasId: 'existing-canvas', checkpointId: 'pinned',
    selections: [{ diagramId: 'grid:overview', revisionId: diagram.content.revisionId, nodeIds: nodes.slice(0, 2).map(node => node.id) }] };
  return { service, run, second, result, doc, nodes, anchor };
}

describe('experiment node comments', () => {
  it('pins exact nodes, derives export excerpts, retries idempotently and leaves outputs unchanged', async () => {
    const f = fixture(), before = structuredClone(f.result);
    const input = { requestId: crypto.randomUUID(), text: 'Review this boundary', anchor: f.anchor };
    const [a, b] = await Promise.all([f.service.addComment('study', input), f.service.addComment('study', input)]);
    expect(a).toEqual(b); expect(a.comments).toHaveLength(1);
    expect(a.comments![0].anchor).toEqual(f.anchor);
    expect(a.comments![0].excerpts![0].ascii).toContain(f.nodes[1].label);
    expect(a.comments![0].excerpts![0].ascii).not.toContain(f.nodes[2].label);
    expect(f.result).toEqual(before);
    await expect(f.service.addComment('study', { ...input, anchor: { ...f.anchor, selections: [{ ...f.anchor.selections[0], nodeIds: [f.nodes[0].id] }] } })).rejects.toThrow('Request ID');
    const edited = await f.service.updateComment('study', input.requestId, { text: 'Edited note' });
    expect(edited.comments![0].anchor).toEqual(f.anchor);
    expect(exportExperimentComments(edited)).toContain('Edited note');
    expect(exportExperimentComments(edited)).toContain(f.nodes[1].label);
    expect(exportExperimentComments(edited)).toContain('Snapshot: pinned');
  });
  it('rejects foreign outputs, snapshots, canvases and stale or unknown nodes', async () => {
    const f = fixture();
    for (const anchor of [
      { ...f.anchor, runId: 'foreign' }, { ...f.anchor, checkpointId: 'changed' }, { ...f.anchor, canvasId: 'foreign' },
      { ...f.anchor, selections: [{ ...f.anchor.selections[0], revisionId: 'changed' }] },
      { ...f.anchor, selections: [{ ...f.anchor.selections[0], nodeIds: ['missing'] }] }
    ]) await expect(f.service.addComment('study', { requestId: crypto.randomUUID(), text: 'Invalid', anchor })).rejects.toThrow();
    expect((await f.service.read('study')).comments).toBeUndefined();
  });
  it('keeps comment traversal closed and separate across phase-filtered trees', async () => {
    const f = fixture(), first = crypto.randomUUID(), last = crypto.randomUUID();
    await f.service.addComment('study', { requestId: first, text: 'First note', anchor: f.anchor });
    const secondDiagram = f.result.canvases[1].proposed.document.scene.contents.overview;
    const saved = await f.service.addComment('study', { requestId: last, text: 'Other phase note', anchor: { ...f.anchor, runId: f.second.id, canvasId: 'new-canvas',
      selections: [{ diagramId: 'grid:overview', revisionId: secondDiagram.content.revisionId, nodeIds: [diagramContentNodes(secondDiagram.content)[0].id] }] } });
    const root = projectExperimentOverview(saved, [f.run, f.second].map(summarizeEvalRun), 'first').overview.root;
    const outputs = navigationOrder(root), comments = commentNavigationOrder(root);
    expect(outputs.order.every(key => !key.startsWith('comment:'))).toBe(true);
    expect(comments.order).toEqual([`comment:${first}`, `comment:${last}`]);
    expect(comments.stops.get(comments.order[0])!.prev).toBe(comments.order[1]);
    expect(comments.stops.get(comments.order[1])!.next).toBe(comments.order[0]);
    expect(exportExperimentComments(saved)).toContain('Other phase note');
    const deleted = await f.service.deleteComment('study', last);
    const single = commentNavigationOrder(projectExperimentOverview(deleted, [summarizeEvalRun(f.run)]).overview.root);
    expect(single.stops.get(single.order[0])!.next).toBe(single.order[0]);
  });
});
