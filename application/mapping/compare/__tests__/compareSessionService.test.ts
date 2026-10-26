import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CompareSessionService } from '../compareSessionService';
import { FileCompareSessionStore } from '../../../../infrastructure/mapping/compare/fileCompareSessionStore';
import { documentFromHistory, validateCanvasHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { workspaceRecords, type WorkspaceRecords } from '../../../../domain/mapping/workspace/workspaceRecords';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'compare-session-test-')); directories.push(root);
  const issued = revisionFixture(), scene = singleDiagramScene('Domain\n`-- First');
  scene.contents = { ...scene.contents, overview: issued.create({ id: 'overview', revision: 0, ascii: 'Domain\n`-- First', structureKind: 'tree' }).diagram };
  const camera = { offset: { x: 35, y: -25 }, scale: .75 };
  const controller = new MappingDocumentController({ scene, edges: [], sections: {} }, { ...initialCanvasState(), viewport: camera });
  const first = controller.canvasView(0, { operation: 'create', name: 'First view' }).activeViewId!;
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Domain\n`-- Second', structureKind: 'tree' }]);
  const second = controller.canvasView(controller.getSnapshot().version, { operation: 'create', name: 'Second view' }).activeViewId!;
  const state = controller.getSnapshot(), history = controller.exportHistory();
  let records: WorkspaceRecords = workspaceRecords({ schemaVersion: 3, projectId: 'test-project', activeDocumentId: 'canvas', documents: [{
    representationId: 'canvas', name: 'CanvasDomain', savedName: 'CanvasDomain', revisionId: 'saved',
    savedScene: JSON.stringify(state.document.scene), savedEdges: '[]', document: state.document, canvas: state.canvas, history
  }] });
  const workspace = { loadRecords: async () => ({ revision: 1, records }) };
  const service = new CompareSessionService(workspace, new FileCompareSessionStore(root));
  const source = (viewId: string) => ({ documentId: 'canvas', viewId, checkpointId: history.canvasViews!.saved[viewId].finalCheckpointId! });
  const input = { requestId: crypto.randomUUID(), title: 'Compare domain', pairs: [{ A: source(first), B: source(second) }] };
  return { root, service, workspace, input, camera, controller, getRecords: () => records, deleteSources: () => {
    records = { workspace: { projectId: 'test-project', documentIds: [], transfers: [] } };
  } };
}

it('copies pinned views and cameras without changing Mapping, and survives source deletion and store restart', async () => {
  const f = await fixture(), before = JSON.stringify(f.getRecords());
  const candidates = await f.service.candidates();
  expect(candidates.map(item => item.name)).toEqual(['Current saved canvas', 'First view', 'Second view']);
  const session = await f.service.create(f.input);
  expect(session.compares).toHaveLength(1);
  expect(session.compares[0].A.camera.transform).toEqual(f.camera);
  expect(JSON.stringify(f.getRecords())).toBe(before);
  for (const copy of session.canvases) {
    validateCanvasHistory(copy.history);
    expect(Object.keys(copy.history.snapshots)).toHaveLength(1);
    expect(copy.view.id).not.toBe(copy.source.viewId);
    expect(copy.history.canvasViews).toBeUndefined();
  }
  expect(documentFromHistory(session.canvases[0].history).scene.contents.overview.content.ascii).toContain('First');
  expect(documentFromHistory(session.canvases[1].history).scene.contents.overview.content.ascii).toContain('Second');
  f.deleteSources();
  const restarted = new CompareSessionService(f.workspace, new FileCompareSessionStore(f.root));
  expect(await restarted.read(session.id)).toEqual(session);
  expect(await restarted.list()).toEqual([expect.objectContaining({ id: session.id, compareCount: 1 })]);
  expect(await restarted.create(f.input)).toEqual(session);
});

it('deduplicates snapshot copies across pairs and serializes duplicate create requests', async () => {
  const f = await fixture();
  const request = { ...f.input, pairs: [...f.input.pairs, { A: f.input.pairs[0].B, B: f.input.pairs[0].A }] };
  const [a, b] = await Promise.all([f.service.create(request), f.service.create(request)]);
  expect(a).toEqual(b);
  expect(a.canvases).toHaveLength(2);
  expect(a.compares).toHaveLength(2);
  expect(a.compares[0].A.canvasCopyId).toBe(a.compares[1].B.canvasCopyId);
  await expect(f.service.create({ ...request, title: 'Different request' })).rejects.toThrow('Request ID already used');
});

it('rejects stale and invalid references before publishing any session', async () => {
  const f = await fixture(), { A, B } = f.input.pairs[0];
  await expect(f.service.create({ ...f.input, pairs: [{ A: { ...A, checkpointId: B.checkpointId }, B }] })).rejects.toThrow('selected view changed');
  await expect(f.service.create({ ...f.input, pairs: [{ A, B: A }] })).rejects.toThrow('two different views');
  await expect(f.service.create({ ...f.input, pairs: [{ A, B: { ...B, documentId: 'missing' } }] })).rejects.toThrow('Unknown canvas');
  expect(await f.service.list()).toEqual([]);
});
