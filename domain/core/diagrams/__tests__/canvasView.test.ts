import { expect, it, vi } from 'vitest';
import { MappingDocumentController, type DiagramOperation } from '../../../mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';
import { singleDiagramScene } from '../projectDiagramCanvas';
import { RevisionedDiagramService } from '../diagramService';
import { validateCanvasHistory } from '../canvasHistory';
import type { CanvasViewCommand } from '../canvasView';
import { CanvasViewReceiver } from '../../../../src/features/mapping/canvas-views/canvasViewReceiver';
import { workspaceRecords, recordsWorkspace, validateRecordUpdate } from '../../../mapping/workspace/workspaceRecords';
import { serializeWorkspace, deserializeWorkspace } from '../../../mapping/workspace/mappingWorkspaceCodec';

function fixture() {
  const document = { scene: singleDiagramScene('Original'), edges: [], sections: {} };
  const controller = new MappingDocumentController(document, initialCanvasState());
  const command = (input: CanvasViewCommand) => controller.canvasView(controller.getSnapshot().version, input);
  const edit = (...operations: DiagramOperation[]) => controller.applyUpdate(controller.getSnapshot().version, operations);
  return { controller, document, command, edit };
}

it('records edits and undo/redo in order, pins intermediate revisions, and restores the final state in one undo step', () => {
  const { controller: c, command, edit } = fixture();
  const start = command({ operation: 'start', name: 'Overview' }).recording!;
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'One' });
  const one = c.getSnapshot().canvasRevisionId;
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'Two' });
  const two = c.getSnapshot().canvasRevisionId;
  c.undo(); c.undo(true); c.undo();
  const saved = command({ operation: 'stop' }).saved[start.id];
  expect(saved.checkpointIds).toEqual([start.startCheckpointId, one, two, one, two, one]);
  expect(saved.finalCheckpointId).toBe(one);
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'Later' });
  const before = c.getSnapshot(), past = c.exportHistory().past.length;
  command({ operation: 'apply', viewId: saved.id });
  expect(c.getSnapshot().document.scene.contents.overview.content.ascii).toBe('One');
  expect(c.exportHistory().past).toHaveLength(past + 1);
  expect(c.exportHistory().snapshots[two]).toBeDefined();
  c.undo(); expect(c.getSnapshot().document).toEqual(before.document);
  expect(c.canvasViews().saved[saved.id]).toEqual(saved);
  c.undo(true); expect(c.getSnapshot().document.scene.contents.overview.content.ascii).toBe('One');
  validateCanvasHistory(c.exportHistory());
});

it('freezes diagram and variant revisions together with composition and camera while retaining multiple views', () => {
  const { controller: c, command, edit } = fixture(), diagrams = new RevisionedDiagramService();
  c.captureViewCamera({ scale: 2, offset: { x: 100, y: 200 } });
  const a = command({ operation: 'start', name: 'A' }).recording!.id;
  const base = c.getSnapshot().document.scene.contents.overview;
  diagrams.importRevision(c.exportRevisions([base.revisionId])[0]);
  const generated = diagrams.revise(base.revisionId, { kind: 'replace', input: { ascii: 'Alternative', structureKind: 'diagram' } });
  const variant = { id: 'alternative', name: 'Alternative', diagramId: base.diagramId, contentId: base.id, ownerNodeId: 'root',
    baseRevisionId: base.revisionId, headRevisionId: generated.revision.id, revisionIds: [generated.revision.id], prompt: '', decisions: {} };
  edit({ method: 'move', nodeId: 'grid:overview', position: { column: 10, row: 5 } },
    { method: 'variant-store', nodeId: 'grid:overview', expectedRevisionId: base.revisionId, variants: [{ variant, revision: generated.revision }] });
  command({ operation: 'stop' });
  const expected = c.getSnapshot();
  const b = command({ operation: 'start', name: 'B' }).recording!.id;
  edit({ method: 'variant-review', variantId: variant.id, remove: true }, { method: 'replace', nodeId: 'grid:overview', ascii: 'B' });
  command({ operation: 'stop' });
  command({ operation: 'apply', viewId: a });
  expect(c.getSnapshot().document).toEqual(expected.document);
  expect(c.getSnapshot().canvas.viewport).toEqual({ scale: 2, offset: { x: 100, y: 200 } });
  expect(c.canvasViews().saved[b]).toBeDefined();
  command({ operation: 'apply', viewId: b });
  expect(c.getSnapshot().document.scene.contents.overview.content.ascii).toBe('B');
});

it('persists a recording and saved views through records, export/import and current-only export', () => {
  const { controller: c, command, edit, document } = fixture();
  const a = command({ operation: 'start', name: 'Saved' }).recording!.id;
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'Saved content' });
  command({ operation: 'stop' });
  command({ operation: 'start', name: 'In progress' });
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'Progress' });
  const state = c.getSnapshot();
  const workspace = { schemaVersion: 3 as const, projectId: 'project', documents: [{ representationId: 'draft-a', name: 'Test', revisionId: '',
    savedName: '', savedScene: JSON.stringify(document.scene), document: state.document, canvas: state.canvas, history: c.exportHistory(true) }] };
  const records = workspaceRecords(workspace);
  validateRecordUpdate(records, Object.keys(records), 'project');
  const loaded = deserializeWorkspace(serializeWorkspace(recordsWorkspace(records)!)).documents[0];
  const restored = new MappingDocumentController(loaded.document, loaded.canvas, 0, undefined, undefined, loaded.history);
  expect(restored.canvasViews().recording?.name).toBe('In progress');
  restored.canvasView(0, { operation: 'stop' });
  restored.canvasView(restored.getSnapshot().version, { operation: 'apply', viewId: a });
  expect(restored.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Saved content');
  expect(Object.keys(restored.canvasViews().saved)).toHaveLength(2);
  const bad = c.exportHistory(); delete bad.snapshots[bad.canvasViews!.saved[a].finalCheckpointId!];
  expect(() => validateCanvasHistory(bad)).toThrow();
});

it('rejects stale requests and invalid transitions; cancelling keeps edits and deleting keeps the current canvas', () => {
  const { controller: c, command, edit } = fixture();
  expect(() => command({ operation: 'stop' })).toThrow('No CanvasView');
  expect(() => command({ operation: 'start' })).toThrow('name');
  const a = command({ operation: 'start', name: 'A' }).recording!.id;
  expect(() => c.canvasView(0, { operation: 'stop' })).toThrow('VERSION_CONFLICT');
  expect(() => command({ operation: 'start', name: 'Another' })).toThrow('already recording');
  command({ operation: 'stop' });
  command({ operation: 'start', name: 'Cancelled' });
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'Keep me' });
  expect(() => command({ operation: 'apply', viewId: a })).toThrow('Stop recording');
  command({ operation: 'cancel' });
  command({ operation: 'delete', viewId: a });
  expect(c.canvasViews()).toEqual({ saved: {} });
  expect(c.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Keep me');
});

it('retries failed persistence without starting or applying twice and rejects changed request IDs', async () => {
  const { controller: c } = fixture(), receiver = new CanvasViewReceiver();
  const persist = vi.fn().mockRejectedValueOnce(Error('Disk full')).mockResolvedValue(undefined);
  const request = { operation: 'start', name: 'A', requestId: 'request', expectedVersion: 0 };
  await expect(receiver.apply('doc', request, c, persist)).rejects.toThrow('PERSISTENCE_PENDING');
  const version = c.getSnapshot().version, recording = c.canvasViews().recording;
  await receiver.apply('doc', request, c, persist);
  expect(c.getSnapshot().version).toBe(version); expect(c.canvasViews().recording).toEqual(recording);
  await expect(receiver.apply('doc', { ...request, name: 'B' }, c, persist)).rejects.toThrow('REQUEST_ID_CONFLICT');
});
