import { compareWorkspaceFixture } from '../../../../tests/support/compareWorkspace';
import { compareSteps } from '../../../../domain/mapping/compare/comparePageSession';
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
  const pane = session.compares[0].A;
  expect(pane.kind).not.toBe('diagram');
  if (pane.kind !== 'diagram') expect(pane.camera.transform).toEqual(f.camera);
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
  await expect(f.service.create({ ...f.input, pairs: [{ A, B, focusPairs: [{ title: 'Missing', A: 'grid:missing', B: 'grid:overview' }] }] })).rejects.toThrow('Unknown diagram focus');
  await expect(f.service.create({ ...f.input, pairs: [{ A, B: { ...B, documentId: 'missing' } }] })).rejects.toThrow('Unknown canvas');
  expect(await f.service.list()).toEqual([]);
});

it('copies the same view for independent panes with three ordered target cameras and explicit correspondences', async () => {
  const f = await fixture();
  const records = workspaceRecords(compareWorkspaceFixture('test-project'));
  const before = JSON.stringify(records);
  const service = new CompareSessionService({ loadRecords: async () => ({ revision: 1, records }) }, new FileCompareSessionStore(f.root));
  const candidate = (await service.candidates()).find(item => item.name === 'First view')!;
  const A = { documentId: candidate.documentId, viewId: candidate.viewId, checkpointId: candidate.checkpointId };
  const session = await service.create({ requestId: crypto.randomUUID(), title: 'Same canvas tour', pairs: [{ A, B: A }, { A, B: A }] });
  expect(session.canvases).toHaveLength(1); // Shared immutable snapshot, independent editor instances.
  const view = session.canvases[0].view;
  expect(view.cameraViews?.map(camera => camera.focus)).toEqual(['overview', 'relationships', 'persistence'].map(id => ({ type: 'DiagramFocused', diagramId: `grid:${id}` })));
  expect(view.defaultCameraViewId).toBe(view.cameraViews![0].id);
  expect(session.compares[0].points?.map(point => [point.A, point.B])).toEqual(view.cameraViews!.map(camera => [camera.id, camera.id]));
  expect(compareSteps(session).map(step => step.compare.id)).toEqual([
    ...Array(3).fill(session.compares[0].id), ...Array(3).fill(session.compares[1].id)
  ]);
  expect(await service.read(session.id)).toEqual(session);
  expect(JSON.stringify(records)).toBe(before);
});

it('pins independent diagram revisions, including subtree scopes, across source deletion and restart', async () => {
  const f = await fixture(), before = JSON.stringify(f.getRecords());
  const candidates = await f.service.candidates();
  const a = candidates.find(item => item.viewId === f.input.pairs[0].A.viewId)!.diagrams[0];
  const b = candidates.find(item => item.viewId === f.input.pairs[0].B.viewId)!.diagrams[0];
  expect(a.revisionId).not.toBe(b.revisionId);
  const revision = f.controller.exportHistory().diagramRevisions[b.revisionId];
  const nodeRef = Object.values(revision.nodeRefs)[1];
  const request = { ...f.input, pairs: [{
    A: { ...f.input.pairs[0].A, diagram: { diagramId: a.diagramId, revisionId: a.revisionId } },
    B: { ...f.input.pairs[0].B, diagram: { diagramId: b.diagramId, revisionId: b.revisionId, nodeRef } }
  }] };
  const session = await f.service.create(request), pair = session.compares[0];
  expect(pair.A).toMatchObject({ kind: 'diagram', revisionId: a.revisionId });
  expect(pair.B).toMatchObject({ kind: 'diagram', revisionId: b.revisionId, nodeRef });
  expect(pair.A).not.toHaveProperty('camera');
  expect(pair.points).toBeUndefined();
  expect(compareSteps(session)).toHaveLength(1);
  expect(JSON.stringify(f.getRecords())).toBe(before);
  f.deleteSources();
  const restarted = new CompareSessionService(f.workspace, new FileCompareSessionStore(f.root));
  const saved = await restarted.read(session.id);
  expect(saved).toEqual(session);
  expect(saved.canvases[0].history.diagramRevisions[a.revisionId].diagram.content.ascii).toContain('First');
  expect(saved.canvases[1].history.diagramRevisions[b.revisionId].diagram.content.ascii).toContain('Second');
  expect(await restarted.create(request)).toEqual(session);
});

it('rejects diagram targets outside the pinned snapshot and invalid subtree scopes before saving', async () => {
  const f = await fixture(), candidates = await f.service.candidates();
  const a = candidates.find(item => item.viewId === f.input.pairs[0].A.viewId)!.diagrams[0];
  const b = candidates.find(item => item.viewId === f.input.pairs[0].B.viewId)!.diagrams[0];
  const A = { ...f.input.pairs[0].A, diagram: { diagramId: a.diagramId, revisionId: a.revisionId } };
  const B = { ...f.input.pairs[0].B, diagram: { diagramId: b.diagramId, revisionId: b.revisionId } };
  for (const [diagram, error] of [
    [{ ...A.diagram, diagramId: 'grid:missing' }, 'Unknown diagram'],
    [{ ...A.diagram, revisionId: b.revisionId }, 'does not match this snapshot'],
    [{ ...A.diagram, nodeRef: 'missing' }, 'subtree does not exist']
  ] as const) await expect(f.service.create({ ...f.input, pairs: [{ A: { ...A, diagram }, B }] })).rejects.toThrow(error);
  await expect(f.service.create({ ...f.input, pairs: [{ A, B: f.input.pairs[0].B }] })).rejects.toThrow('Choose two diagrams');
  expect(await f.service.list()).toEqual([]);
});
