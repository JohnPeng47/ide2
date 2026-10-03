import { AgentContext } from '../../../../domain/core/agents/agentContext';
import { expect, it, vi } from 'vitest';
import { DiagramEditService } from '../../../../application/mapping/agent/diagramEditService';
import { RevisionedDiagramService, type DiagramGenerator } from '../../../../domain/core/diagrams/diagramService';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { DiagramRevisionReceiver } from '../../../../src/features/mapping/agent/diagramRevisionReceiver';

function fixture(generator: DiagramGenerator = { generate: async () => ({ ascii: 'Edited\n`-- New branch', structureKind: 'tree' }) }) {
  const diagrams = new RevisionedDiagramService(generator);
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original')), initialCanvasState());
  const base = controller.getSnapshot().document.scene.contents.overview;
  const receiver = new DiagramRevisionReceiver(), persist = vi.fn(async () => {});
  const apply = vi.fn(async (_session: string, input: Parameters<DiagramRevisionReceiver['apply']>[1]) =>
    receiver.apply('doc', structuredClone(input), controller, persist));
  const service = new DiagramEditService(diagrams, {
    snapshot: async () => structuredClone({ ...controller.getSnapshot(), history: controller.exportHistory(), name: 'Test' }), apply
  });
  const input = { sessionId: 'session', requestId: 'edit', expectedVersion: 0, baseRevisionId: base.revisionId,
    nodeId: 'grid:overview', prompt: 'Add a branch' };
  return { diagrams, controller, base, receiver, persist, apply, service, input };
}
async function settled(service: DiagramEditService, runId: string, status: string) {
  await vi.waitFor(() => expect(service.get(runId).status).toBe(status));
  return service.get(runId);
}

it('installs exactly the generated revision once and restores its identity through durable undo/redo', async () => {
  const generate = vi.fn(async () => ({ ascii: 'Edited\n`-- New branch', structureKind: 'tree' as const }));
  const f = fixture({ generate }), run = f.service.start(f.input);
  expect(f.service.start(f.input).runId).toBe(run.runId);
  const complete = await settled(f.service, run.runId, 'completed');
  expect(generate).toHaveBeenCalledOnce(); expect(f.persist).toHaveBeenCalledOnce();
  expect(f.service.start(f.input)).toEqual(complete);
  expect(f.controller.getSnapshot().version).toBe(1);
  expect(f.diagrams.listRevisions(f.base.diagramId).map(r => r.id)).toEqual([f.base.revisionId, complete.result!.revisionId]);
  expect(f.diagrams.getRevision(complete.result!.revisionId).parentId).toBe(f.base.revisionId);
  const snapshot = f.controller.getSnapshot();
  const restored = new MappingDocumentController(structuredClone(snapshot.document), snapshot.canvas, 0,
    undefined, undefined, JSON.parse(JSON.stringify(f.controller.exportHistory())));
  restored.undo(); expect(restored.getSnapshot().document.scene.contents.overview.revisionId).toBe(f.base.revisionId);
  restored.undo(true); expect(restored.getSnapshot().document.scene.contents.overview.revisionId).toBe(complete.result!.revisionId);
  expect(() => f.service.start({ ...f.input, prompt: 'different' })).toThrow('REQUEST_ID_CONFLICT');
});

it('retains an off-canvas candidate when a concurrent canvas edit wins', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const generate = vi.fn(async () => { await pending; return { ascii: 'Generated' }; });
  const f = fixture({ generate }), run = f.service.start(f.input);
  await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
  f.controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Concurrent edit' }]);
  release(); const conflict = await settled(f.service, run.runId, 'conflict');
  expect(conflict.generated!.ascii).toBe('Generated');
  expect(f.controller.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Concurrent edit');
  expect(f.persist).not.toHaveBeenCalled();
});

it('rejects stale bases before invoking the model', async () => {
  const generate = vi.fn(async () => ({ ascii: 'Unexpected' })), f = fixture({ generate });
  await settled(f.service, f.service.start({ ...f.input, expectedVersion: 99 }).runId, 'conflict');
  await settled(f.service, f.service.start({ ...f.input, requestId: 'base', baseRevisionId: 'stale' }).runId, 'conflict');
  expect(generate).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
});

it('cancels generation without issuing a revision or touching the canvas', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const generate = vi.fn(async () => { await pending; return { ascii: 'Late result' }; });
  const f = fixture({ generate }), run = f.service.start(f.input);
  await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
  expect(f.service.cancel(run.runId).status).toBe('cancelled'); release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.diagrams.listRevisions(f.base.diagramId)).toHaveLength(1);
  expect(f.controller.getSnapshot().version).toBe(0);
});

it('does not publish failed or invalid generation', async () => {
  for (const generate of [async () => { throw Error('Model failed'); }, async () => ({ ascii: '' })]) {
    const f = fixture({ generate });
    await settled(f.service, f.service.start(f.input).runId, 'failed');
    expect(f.diagrams.listRevisions(f.base.diagramId)).toHaveLength(1);
    expect(f.apply).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().version).toBe(0);
  }
});

it('retries failed persistence without regenerating or adding another canvas undo step', async () => {
  const generate = vi.fn(async () => ({ ascii: 'Generated' })), f = fixture({ generate });
  f.persist.mockRejectedValueOnce(Error('Disk unavailable'));
  const run = f.service.start(f.input);
  await settled(f.service, run.runId, 'awaiting-acknowledgement');
  expect(f.controller.getSnapshot().version).toBe(1);
  expect(f.service.cancel(run.runId).status).toBe('awaiting-acknowledgement');
  f.service.start(f.input);
  const complete = await settled(f.service, run.runId, 'completed');
  expect(f.persist).toHaveBeenCalledTimes(2); expect(generate).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot().version).toBe(1);
  expect(f.apply.mock.calls[0][1]).toEqual(f.apply.mock.calls[1][1]);
  expect(complete.result!.revisionId).toBe(f.controller.getSnapshot().document.scene.contents.overview.revisionId);
  f.controller.undo(); expect(f.controller.getSnapshot().document.scene.contents.overview.revisionId).toBe(f.base.revisionId);
});

it('replays a lost application acknowledgement without a second edit', async () => {
  const f = fixture(), originalApply = f.apply.getMockImplementation()!;
  f.apply.mockImplementationOnce(async (...args) => { await originalApply(...args); throw Error('CANVAS_TIMEOUT: lost acknowledgement'); });
  const run = f.service.start(f.input);
  await settled(f.service, run.runId, 'awaiting-acknowledgement');
  f.service.start(f.input); await settled(f.service, run.runId, 'completed');
  expect(f.controller.getSnapshot().version).toBe(1);
  const application = f.apply.mock.calls[0][1];
  await expect(f.receiver.apply('doc', { ...application, baseRevisionId: 'changed' }, f.controller, f.persist)).rejects.toThrow('REQUEST_ID_CONFLICT');
});

it('rejects invalid revision ancestry at application without changing the document', async () => {
  const f = fixture(), next = f.diagrams.revise(f.base.revisionId, { kind: 'replace', input: { ascii: 'Next' } });
  const before = f.controller.getSnapshot();
  await expect(f.receiver.apply('doc', { requestId: 'bad', nodeId: f.input.nodeId, expectedVersion: 0,
    baseRevisionId: f.base.revisionId, revision: { ...next.revision, parentId: 'other' } }, f.controller, f.persist)).rejects.toThrow('ancestry');
  expect(f.controller.getSnapshot()).toBe(before);
  expect(f.persist).not.toHaveBeenCalled();
});

it('reports stale content connections while preserving their repairable anchors', async () => {
  const f = fixture();
  const node = f.controller.nodes().find(n => n.id === 'grid:overview')!;
  if (node.layout !== 'grid') throw Error('Expected grid diagram');
  f.controller.applyUpdate(0, [{ method: 'edge-create', edge: { id: 'related',
    source: { kind: 'content-node', displayNodeId: node.id, contentNodeId: node.contentNodes![0].id,
      revisionId: node.content!.revisionId, side: 'auto' }, target: { kind: 'box', displayNodeId: node.id, side: 'auto' },
    appearance: { color: '#88c0d0', lineStyle: 'solid', label: '' } } }]);
  const edges = f.controller.getSnapshot().document.edges;
  const complete = await settled(f.service, f.service.start({ ...f.input, expectedVersion: 1 }).runId, 'completed');
  expect(complete.result!.unresolvedEdgeIds).toEqual(['related']);
  expect(f.controller.getSnapshot().document.edges).toEqual(edges);
  f.controller.undo(); expect(f.controller.getSnapshot().document.edges).toEqual(edges);
});

it('does not report cancellation once application has started and keeps persistence conflicts retryable', async () => {
  const f = fixture();
  let reject!: (error: Error) => void;
  f.persist.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const run = f.service.start(f.input);
  await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce());
  expect(f.service.cancel(run.runId).status).toBe('applying');
  reject(Error('VERSION_CONFLICT: storage conflict'));
  await settled(f.service, run.runId, 'awaiting-acknowledgement');
  expect(f.controller.getSnapshot().version).toBe(1);
});

it('captures context for generation and binds its hash to retries without regenerating', async () => {
  const context = AgentContext.fromTrajectory({ agentType: 'codex', sourceSessionId: 'source', format: 'messages-v1',
    fromEntryId: '1', throughEntryId: '1', entries: [{ id: '1', parentId: null,
      message: { role: 'user', content: [{ type: 'text', text: 'Cache now belongs to workspace' }] } }] });
  const generate = vi.fn(async () => ({ ascii: 'Workspace owns cache' })), f = fixture({ generate });
  const snapshot = context.toSnapshot(), input = { ...f.input, agentContextId: 'uploaded' };
  expect(() => f.service.start(input)).toThrow('AGENT_CONTEXT_NOT_FOUND');
  f.persist.mockRejectedValueOnce(Error('Disk unavailable'));
  const run = f.service.start(input, snapshot);
  snapshot.messages.length = 0;
  await settled(f.service, run.runId, 'awaiting-acknowledgement');
  expect(generate.mock.calls[0]).toMatchObject([{ agentContext: context.toSnapshot() }, expect.anything()]);
  expect(() => f.service.start({ ...input, agentContextId: 'different' }, context.toSnapshot())).toThrow('REQUEST_ID_CONFLICT');
  f.service.start(input, context.toSnapshot());
  await settled(f.service, run.runId, 'completed');
  expect(generate).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot().version).toBe(1);
});
