import { expect, it, vi } from 'vitest';
import { DiagramBatchService } from './diagramBatchService';
import type { DiagramGenerationRequest } from '../../../domain/core/diagrams/diagramGeneration';
import { revisionFixture } from '../../../tests/support/diagramRevisions';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { DiagramRevisionReceiver } from '../../../src/features/mapping/agent/diagramRevisionReceiver';
import type { DiagramBatchApplication, DiagramTool } from '../../../domain/mapping/agent/diagramBatch';

function fixture() {
  const generate = vi.fn(async (_request: DiagramGenerationRequest) => ({ ascii: 'Generated', structureKind: 'tree' as 'tree' | 'diagram' }));
  const diagrams = revisionFixture({ generate });
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original\n`-- Child')), initialCanvasState());
  controller.applyUpdate(0, [{ method: 'diagram-create', id: 'second', position: { column: 50, row: 0 }, ascii: 'Second\n`-- Child', structureKind: 'tree' }]);
  const bases = ['overview', 'second'].map(id => controller.getSnapshot().document.scene.contents[id]);
  const receiver = new DiagramRevisionReceiver(), persist = vi.fn(async () => {});
  const batch = vi.fn(async (_session: string, input: DiagramBatchApplication) => receiver.batch('doc', structuredClone(input), controller, persist));
  const service = new DiagramBatchService((diagrams).generator, {
    snapshot: async (_id, ids) => structuredClone({ ...controller.getSnapshot(), name: 'Test', revisions: controller.exportRevisions(ids ?? [], true) }),
    apply: async () => { throw Error('Unexpected individual apply'); }, batch
  });
  const envelope = { sessionId: 'session', requestId: 'request', expectedVersion: 1 };
  const targets = bases.map(base => ({ nodeId: `grid:${base.id}`, baseRevisionId: base.revisionId }));
  return { service, controller, persist, batch, generate, diagrams, envelope, targets, bases };
}
const edit = { ascii: 'Updated\n`-- New', structureKind: 'tree' as const };
const modes = { 'edit-mode': 'in-place' as const, 'replace-mode': 'diagram' as const };

it.each(['edit-diagram', 'create-diagram', 'extend-diagram'] as const)('applies %s batches without generation, in one persisted undo step', async operation => {
  const f = fixture();
  const operations = f.targets.map((target, index) => operation === 'edit-diagram' ? { ...target, ...modes, edit } : {
    ...target, diagram: edit, ...(operation === 'extend-diagram' ? { origin: { column: 100, row: index * 20 }, sources: [{ kind: 'content-node', displayNodeId: target.nodeId, revisionId: f.bases[index].content.revisionId, contentNodeId: diagramContentNodes(f.bases[index].content)[0].id }] } : {})
  });
  const input = { ...f.envelope, operations }, initial = f.controller.getSnapshot().document;
  const run = f.service.start(input, operation, true), result = await f.service.wait(run.runId);
  expect(result.error).toBeUndefined(); expect(result.status).toBe('completed');
  expect(result.results.map(item => item.operationIndex)).toEqual([0, 1]);
  expect(result.documentVersion).toBe(2); expect(f.batch).toHaveBeenCalledOnce(); expect(f.persist).toHaveBeenCalledOnce();
  expect(f.generate).not.toHaveBeenCalled();
  const snapshot = f.controller.getSnapshot();
  if (operation === 'extend-diagram') expect(snapshot.document.edges).toHaveLength(2);
  if (operation !== 'edit-diagram') expect(Object.keys(snapshot.document.scene.contents)).toHaveLength(Object.keys(initial.scene.contents).length + 4);
  expect(f.service.start(input, operation, true)).toEqual(result);
  const restored = new MappingDocumentController(structuredClone(snapshot.document), snapshot.canvas, 0, undefined, undefined, JSON.parse(JSON.stringify(f.controller.exportHistory())));
  restored.undo(); expect(restored.getSnapshot().document.scene).toEqual(initial.scene);
  restored.undo(true); expect(restored.getSnapshot().document.scene).toEqual(snapshot.document.scene);
});
it.each(['edit-diagram', 'create-diagram', 'extend-diagram'] as const)('retains delegated generation for %s batches', async operation => {
  const f = fixture();
  const operations = f.targets.map((target, index) => ({ ...target, prompt: 'Generate', ...(operation === 'edit-diagram' ? modes : {}),
    ...(operation === 'extend-diagram' ? { origin: { column: 100, row: index * 20 }, sources: [{ kind: 'content-node', displayNodeId: target.nodeId, revisionId: f.bases[index].content.revisionId, contentNodeId: diagramContentNodes(f.bases[index].content)[0].id }] } : {}) }));
  const result = await f.service.wait(f.service.start({ ...f.envelope, operations }, operation, false).runId);
  expect(result.error).toBeUndefined(); expect(result.status).toBe('completed');
  expect(f.generate).toHaveBeenCalledTimes(2); expect(f.batch).toHaveBeenCalledOnce();
});
it('rejects an invalid second operation before any mutation and reports its index', async () => {
  const f = fixture(), before = f.controller.getSnapshot();
  const operations = f.targets.map((target, i) => ({ ...target, ...modes, edit: { ...edit, ascii: i ? 'Bad\ttext' : edit.ascii } }));
  const result = await f.service.wait(f.service.start({ ...f.envelope, operations }, 'edit-diagram', true).runId);
  expect(result.status).toBe('failed'); expect(result.operationIndex).toBe(1); expect(result.error).toContain('operations[1]');
  expect(f.batch).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled(); expect(f.controller.getSnapshot()).toEqual(before);
});
it('retries a persistence failure without applying or generating twice', async () => {
  const f = fixture(), input = { ...f.envelope, operations: f.targets.map(target => ({ ...target, ...modes, edit })) };
  f.persist.mockRejectedValueOnce(Error('disk unavailable'));
  const run = f.service.start(input, 'edit-diagram', true);
  expect((await f.service.wait(run.runId)).status).toBe('awaiting-acknowledgement');
  expect(f.controller.getSnapshot().version).toBe(2);
  f.service.start(input, 'edit-diagram', true);
  expect((await f.service.wait(run.runId)).status).toBe('completed');
  expect(f.controller.getSnapshot().version).toBe(2); expect(f.persist).toHaveBeenCalledTimes(2); expect(f.generate).not.toHaveBeenCalled();
  expect(() => f.service.start({ ...input, expectedVersion: 2 }, 'edit-diagram', true)).toThrow('REQUEST_ID_CONFLICT');
});
it('stores variants as one transaction without changing current diagrams', async () => {
  const f = fixture(), before = f.controller.getSnapshot().document.scene;
  const input = { ...f.envelope, operations: f.targets.map((target, index) => ({ ...target, ...modes, 'edit-mode': 'variant', edit: { ...edit, structureKind: f.bases[index].content.structure.kind } })) };
  const result = await f.service.wait(f.service.start(input, 'edit-diagram', true).runId);
  expect(result.error).toBeUndefined(); expect(result.status).toBe('completed'); expect(result.results.every(item => item.variants?.length === 1)).toBe(true);
  const snapshot = f.controller.getSnapshot();
  expect(snapshot.document.scene).toEqual(before); expect(Object.keys(snapshot.document.revisionReviews!)).toHaveLength(2);
  const restored = new MappingDocumentController(structuredClone(snapshot.document), snapshot.canvas, 0, undefined, undefined, JSON.parse(JSON.stringify(f.controller.exportHistory())));
  restored.undo(); expect(Object.keys(restored.getSnapshot().document.revisionReviews ?? {})).toHaveLength(0);
  restored.undo(true); expect(restored.getSnapshot().document.revisionReviews).toEqual(snapshot.document.revisionReviews);
});
it('rejects overlapping diagram targets and stale snapshots', async () => {
  const f = fixture(), item = { ...f.targets[0], ...modes, edit };
  const duplicate = await f.service.wait(f.service.start({ ...f.envelope, operations: [item, item] }, 'edit-diagram', true).runId);
  expect(duplicate.error).toContain('BATCH_TARGET_CONFLICT');
  const stale = await f.service.wait(f.service.start({ ...f.envelope, requestId: 'stale', expectedVersion: 0, operations: [item] }, 'edit-diagram', true).runId);
  expect(stale.status).toBe('conflict'); expect(f.batch).not.toHaveBeenCalled();
});
it('supports creating an unanchored diagram', async () => {
  const f = fixture();
  const result = await f.service.wait(f.service.start({ ...f.envelope, operations: [{ nodeId: 'canvas', baseRevisionId: 'canvas', diagram: edit }] }, 'create-diagram', true).runId);
  expect(result.error).toBeUndefined(); expect(result.status).toBe('completed');
});

it('does not commit a prepared batch when the canvas advances during generation', async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.generate.mockImplementationOnce(async () => { await pending; return edit; });
  const input = { ...f.envelope, operations: f.targets.map(target => ({ ...target, ...modes, prompt: 'Generate' })) };
  const run = f.service.start(input, 'edit-diagram', false);
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalledOnce());
  f.controller.applyUpdate(1, [{ method: 'replace', nodeId: f.targets[0].nodeId, ascii: 'Concurrent' }]);
  release();
  const result = await f.service.wait(run.runId);
  expect(result.status).toBe('conflict'); expect(f.persist).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Concurrent');
  expect(f.controller.getSnapshot().document.scene.contents.second.revisionId).toBe(f.bases[1].revisionId);
});
it('cancels a batch during preparation without applying its staged operations', async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.generate.mockImplementationOnce(async () => { await pending; return edit; });
  const run = f.service.start({ ...f.envelope, operations: f.targets.map(target => ({ ...target, ...modes, prompt: 'Generate' })) }, 'edit-diagram', false);
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalledOnce());
  f.service.cancel(run.runId); release();
  expect((await f.service.wait(run.runId)).status).toBe('cancelled');
  expect(f.batch).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().version).toBe(1);
});

it.each([true, false])('promotes optional presentation alternatives in direct=%s batches', async direct => {
  const f = fixture();
  f.generate.mockImplementation(async request => ({ ascii: 'Generated', structureKind: request.context!.diagram.content.structure.kind }));
  const input = { ...f.envelope, operations: f.targets.map((target, index) => ({ ...target, 'edit-mode': 'variant', 'replace-mode': 'diagram',
    'presentation-alternative': { name: `Choice ${index}`, select: true },
    ...(direct ? { edit: { ...edit, structureKind: f.bases[index].content.structure.kind } } : { prompt: 'Generate' }) })) };
  const result = await f.service.wait(f.service.start(input, 'edit-diagram', direct).runId);
  expect(result.error).toBeUndefined(); expect(result.status).toBe('completed');
  const state = f.controller.getSnapshot().document.alternatives!;
  expect(Object.values(state.items).map(a => a.name).sort()).toEqual(['Choice 0', 'Choice 1']);
  expect(Object.values(state.selected).flat()).toHaveLength(2);
  expect(f.controller.getSnapshot().document.scene.contents.overview).toEqual(f.bases[0]);
});
