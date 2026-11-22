import { describe, expect, it } from 'vitest';
import { canvasDiagrams, summarizeEvalRun, type EvalRun, type EvalRunSummary } from '../evalRun';
import { projectExperimentOverview } from '../experimentOverviewProjection';
import { navigationKey, navigationOrder } from '../experimentNavigation';
import type { EvalExperiment } from '../experiment';
import type { CanvasHistoryRecord } from '../../../core/diagrams/canvasHistory';

const box = (id: string) => ({ id, kind: 'diagram', contentId: id, collapsed: false, position: { column: 0, row: 0 } });
const revision = (id: string, ascii: string) => ({ id, diagramId: id, nodeRefs: {}, diagram: { content: { ascii } } });
const history = {
  schemaVersion: 1, contextId: 'ctx', baselineId: 'h', headId: 'h', past: [], future: [],
  snapshots: { h: { id: 'h', document: { scene: { root: { id: 'root', kind: 'container', position: { column: 0, row: 0 }, children: [
    box('central'), { id: 'group', kind: 'container', position: { column: 0, row: 0 }, children: [box('detail')] }] } } },
    diagramBindings: { central: 'r1', detail: 'r2' }, view: {}, nodeOrigins: {} } },
  diagramRevisions: { r1: revision('r1', 'Central title\n|\n`-- part'), r2: revision('r2', '\nDetail title\n|\n`-- x') }
} as unknown as CanvasHistoryRecord;

const cell = { key: 'p:1:alternative', pass: 1, stage: 'alternative', status: 'finished' as const, canvasId: 'canvas-1', checkpointId: 'h', promptId: 'p' };
const run = { schemaVersion: 1, id: 'run-1', requestHash: 'x', projectId: 'project', workflow: 'alternatives', inputs: {}, prompts: [],
  request: { requestId: 'run-1', workflow: 'alternatives', prompts: [], inputs: {}, passes: 1, model: 'm', effort: 'high' },
  status: 'finished', createdAt: '2026-11-17T00:00:00.000Z', cells: [cell],
  outputSnapshots: { 'canvas-1': { id: 'canvas-1', name: 'Canvas', generated: {}, history } } } as unknown as EvalRun;
const experiment = {
  id: 'exp', name: 'Exp', description: '', revision: 1, projectId: 'project', comparisons: [],
  workflow: { id: 'w', name: 'W', version: 1, stages: [{ id: 'split', name: 'Generate canvas', dependsOn: [] }] },
  cases: [{ id: 'case', name: 'Case', agentContextId: 'saved-agent-context-x' }], conditions: [{ id: 'cond', name: 'Cond' }],
  samples: [{ id: 's1', caseId: 'case', conditionId: 'cond', number: 1, attempt: 1, outputs: [{ stageId: 'split', runId: 'run-1', cellKey: cell.key }] }]
} as unknown as EvalExperiment;

describe('canvas diagram navigation stops', () => {
  it('lists diagram boxes of the pinned checkpoint in scene order with their titles', () => {
    expect(canvasDiagrams(history, 'h')).toEqual([{ id: 'grid:central', title: 'Central title' }, { id: 'grid:detail', title: 'Detail title' }]);
    expect(canvasDiagrams(history, 'missing')).toEqual([]);
  });

  it('summaries carry the diagram list without the stored snapshot', () => {
    const summary = summarizeEvalRun(run);
    expect(summary.cells[0].diagrams?.map(d => d.id)).toEqual(['grid:central', 'grid:detail']);
    expect('outputSnapshots' in summary).toBe(false);
  });

  it('shows the whole canvas first, then one focused stop per diagram', () => {
    const summary: EvalRunSummary = summarizeEvalRun(run);
    const { root } = projectExperimentOverview(experiment, [summary]).overview;
    const { order, stops } = navigationOrder(root);
    expect(order).toEqual(['output:run-1:p:1:alternative', 'output:run-1:p:1:alternative:grid:central', 'output:run-1:p:1:alternative:grid:detail']);
    expect(stops.get(order[2])!.target).toEqual({ kind: 'output', runId: 'run-1', cellKey: cell.key, diagram: 'grid:detail' });
    // The structural "Diagrams" group does not appear in breadcrumbs.
    expect(stops.get(order[1])!.label).not.toContain('Diagrams');
  });

  it('adds no diagram stops for a single-diagram canvas', () => {
    const single = summarizeEvalRun(run);
    single.cells[0] = { ...single.cells[0], diagrams: single.cells[0].diagrams!.slice(0, 1) };
    const { root } = projectExperimentOverview(experiment, [single]).overview;
    expect(navigationOrder(root).order).toEqual([navigationKey({ kind: 'output', runId: 'run-1', cellKey: cell.key })]);
  });
});
