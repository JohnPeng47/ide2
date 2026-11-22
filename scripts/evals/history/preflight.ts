import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { canvasInput, controller, materializeHistoryStep, type HistoryCanvasSet } from '../../../application/mapping/history/historyMaterializer';
import { validateConnectionAnchor } from '../../../domain/core/diagrams/diagramConnection';
import type { HistoryBatch, HistoryFill, HistoryStep } from '../../../domain/mapping/history/diagramHistory';

/** Exercise actual persisted inputs with deterministic content before paying for a model.
 * All writes go to a disposable store; experiment outputs remain untouched. */
export async function preflightHistory(source: FileCanvasTimeline, timelineId: string, mapping: Record<string, Omit<HistoryCanvasSet[string], 'history'>>, stepId = 'baseline') {
  const timeline = await source.read(timelineId), baseline = timeline.steps.find(s => s.id === stepId);
  if (!baseline) throw Error(`Preflight: missing input step ${stepId}`);
  const original: HistoryCanvasSet = {};
  for (const [key, canvas] of Object.entries(mapping)) {
    const ref = baseline.canvases.find(c => c.documentId === canvas.id);
    if (!ref) throw Error(`Preflight: missing canvas ${key}`);
    original[key] = { ...canvas, history: await source.editingHistory(timelineId, ref) };
    controller(original[key]);
  }
  const root = await mkdtemp(path.join(tmpdir(), 'history-preflight-'));
  try {
    const roundTrip = async (id: string, set: HistoryCanvasSet, previousStepId?: string) => {
      const store = new FileCanvasTimeline(root);
      const step: HistoryStep = { id, previousStepId, phase: 'execution', title: id, commits: [], agentContextId: 'preflight', planId: 'preflight',
        canvases: Object.values(set).map(c => ({ documentId: c.id, name: c.name, viewId: c.history.canvasViews!.activeViewId!, checkpointId: c.history.headId })) };
      const prior = previousStepId ? await store.read('preflight') : undefined;
      await store.append('preflight', timeline.projectId, prior?.revision ?? 0, step, Object.fromEntries(Object.values(set).map(c => [c.id, c.history])));
      const reopened = new FileCanvasTimeline(root), restored: HistoryCanvasSet = {};
      for (const [key, c] of Object.entries(set)) {
        restored[key] = { ...c, history: await reopened.editingHistory('preflight', step.canvases.find(ref => ref.documentId === c.id)!) };
        const doc = controller(restored[key]).getSnapshot().document;
        for (const edge of doc.edges) { validateConnectionAnchor(doc.scene, edge.source); validateConnectionAnchor(doc.scene, edge.target); }
      }
      const output = await reopened.result('preflight', id);
      if (output.canvases.length !== Object.keys(set).length) throw Error('Preflight: incomplete output');
      return restored;
    };
    const before = await roundTrip('baseline', original);
    let probeId = 'PreflightCheck';
    while (Object.values(before).some(c => probeId in c.diagramIds)) probeId += 'X';
    const batch: HistoryBatch = { id: 'preflight', title: 'Storage preflight', commits: [], rationale: 'Deterministic storage exercise', dependsOn: [], futureDependencies: [], sourcePaths: [], tree: '',
      changes: canvasInput(before).map(c => ({ canvasId: c.id, canvasName: c.name, newCanvas: false,
        diagrams: [{ diagramId: probeId, title: 'Storage check', newDiagram: true, operation: '2', instruction: 'Add a disposable tree', targetNodes: 2,
          position: { column: Math.ceil(Math.max(0, ...c.diagrams.map(d => d.position.column + d.position.columns))) + 200, row: 0 } }] })), edges: [] };
    batch.edges = batch.changes.flatMap(c => {
      const target = Object.keys(before[c.canvasId].diagramIds)[0];
      return target ? [{ sourceCanvas: c.canvasId, sourceDiagram: probeId, sourceLabel: 'Child', targetCanvas: c.canvasId, targetDiagram: target, targetLabel: null, label: 'checks' }] : [];
    });
    const scaffolds = await roundTrip('scaffold', materializeHistoryStep(before, batch, 'preflight', 'scaffold', undefined, undefined, true), 'baseline');
    const fill: HistoryFill = { explanation: 'Deterministic fill', diagrams: batch.changes.map(c => ({canvasId:c.canvasId,diagramId:probeId,ascii:'Storage check\n`-- Child',position:null})), edges:batch.edges, attachmentMappings:[] };
    const filled = await roundTrip('fill', materializeHistoryStep(before, batch, 'preflight', 'execute', fill, scaffolds, true), 'scaffold');
    const edit = { ...batch, edges: [], changes: batch.changes.map(c => ({ ...c, diagrams: c.diagrams.map(d => ({ ...d, newDiagram: false })) })) };
    const edited = await roundTrip('edit', materializeHistoryStep(filled, edit, 'preflight', 'execute', { ...fill, edges: [], diagrams: fill.diagrams.map(d => ({ ...d, ascii: 'Storage check\n+-- Added\n`-- Child' })) }), 'fill');
    return { canvases: Object.keys(edited).length, checks: ['restore', 'scaffold', 'fill', 'edit', 'save', 'reopen', 'output', 'edge anchors'], modelCalls: 0 };
  } finally { await rm(root, { recursive: true, force: true }); }
}
