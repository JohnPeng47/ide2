import { AgentContext } from '../../../../domain/core/agents/agentContext';
import { compileDiagramAgentContext, storeDiagramAgentContext, type DiagramAgentContextStore } from '../../../../domain/core/diagrams/diagramAgentContext';
import { expect, it, vi } from 'vitest';
import { editDiagramSchema } from '../../../../domain/mapping/agent/diagramEdit';
import { DiagramEditService } from '../../../../application/mapping/agent/diagramEditService';
import type { DiagramGenerator, DiagramGenerationRequest, GenerationOptions } from '../../../../domain/core/diagrams/diagramGeneration';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { DiagramRevisionReceiver } from '../../../../src/features/mapping/agent/diagramRevisionReceiver';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { validateConnectionAnchor, type ContentNodeAnchor, type DiagramConnection } from '../../../../domain/core/diagrams/diagramConnection';

function fixture(generator: DiagramGenerator = { generate: async () => ({ ascii: 'Edited\n`-- New branch', structureKind: 'tree' }) },
  contextStore?: DiagramAgentContextStore) {
  const diagrams = revisionFixture(generator);
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original')), initialCanvasState());
  const base = controller.getSnapshot().document.scene.contents.overview;
  const receiver = new DiagramRevisionReceiver(), persist = vi.fn(async () => {});
  const apply = vi.fn(async (_session: string, input: Parameters<DiagramRevisionReceiver['apply']>[1]) =>
    receiver.apply('doc', structuredClone(input), controller, persist));
  const service = new DiagramEditService((diagrams).generator, {
    snapshot: async (_session, ids) => structuredClone({ ...controller.getSnapshot(), revisions: controller.exportRevisions(ids ?? [], true), name: 'Test' }), apply
  }, contextStore);
  const input = { 'edit-mode': 'in-place' as const, 'replace-mode': 'diagram' as const, sessionId: 'session', requestId: 'edit', expectedVersion: 0, baseRevisionId: base.revisionId,
    nodeId: 'grid:overview', prompt: 'Add a branch' };
  return { diagrams, controller, base, receiver, persist, apply, service, input };
}
async function settled(service: DiagramEditService, runId: string, status: string) {
  await vi.waitFor(() => expect(service.get(runId).status).toBe(status));
  return service.get(runId);
}

it('publishes panel context only after persistence and passes it into the next generation', async () => {
  const generate = vi.fn(async (request: DiagramGenerationRequest, options: GenerationOptions) => {
    options.onAgentSession?.('runtime-id');
    options.onAgentContext?.(AgentContext.fromMessages(request.llmSessionId!, [
      ...(request.agentContext?.messages ?? []), { role: 'user', content: [{ type: 'text', text: request.instruction }], timestamp: 0 }
    ]).toSnapshot());
    return { ascii: 'Generated' };
  });
  const f = fixture({ generate }), input = { ...f.input, llmSessionId: 'panel' };
  f.persist.mockRejectedValueOnce(Error('Disk unavailable'));
  const run = f.service.start(input);
  const pending = await settled(f.service, run.runId, 'awaiting-acknowledgement');
  expect(pending.agentSessionId).toBe('runtime-id');
  expect(pending.agentContext).toBeUndefined();
  f.service.start(input);
  const completed = await settled(f.service, run.runId, 'completed');
  expect(completed.agentContext?.source.sourceSessionId).toBe('panel');
  expect(generate).toHaveBeenCalledOnce();
  const next = f.service.start({ ...input, requestId: 'next', expectedVersion: 1,
    baseRevisionId: completed.result!.revisionId, agentContext: completed.agentContext, prompt: 'Continue' });
  const continued = await settled(f.service, next.runId, 'completed');
  expect(generate.mock.calls[1][0].agentContext).toEqual(completed.agentContext);
  expect(continued.agentContext?.messages).toHaveLength(2);
  expect(() => f.service.start({ ...input, requestId: 'wrong-panel', llmSessionId: 'other', agentContext: completed.agentContext })).toThrow('AGENT_CONTEXT_SESSION_MISMATCH');
  expect(() => f.service.start({ ...input, requestId: 'missing-panel', llmSessionId: undefined, agentContext: completed.agentContext })).toThrow('requires llmSessionId');
  expect(() => f.service.start({ ...input, requestId: 'ambiguous', agentContextId: 'uploaded', agentContext: completed.agentContext })).toThrow('only one agent context');
});

it('uses diagram context for diagram edits and lets explicit context take precedence', async () => {
  const generate = vi.fn(async (_request: DiagramGenerationRequest) => ({ ascii: 'Edited\n`-- New branch', structureKind: 'tree' as const }));
  const f = fixture({ generate });
  const bound = compileDiagramAgentContext(f.base);
  f.controller.applyUpdate(0, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: f.base.revisionId, context: bound }]);
  const input = { ...f.input, requestId: 'context-edit', expectedVersion: 1 };
  await settled(f.service, f.service.start(input).runId, 'completed');
  expect(generate.mock.calls[0][0]).toMatchObject({ agentContext: bound.snapshot });

  const other = fixture({ generate });
  const explicit = AgentContext.fromMessages('panel', [{ role: 'user', content: [{ type: 'text', text: 'Panel direction' }], timestamp: 0 }]).toSnapshot();
  const compiled = compileDiagramAgentContext(other.base);
  other.controller.applyUpdate(0, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: other.base.revisionId, context: compiled }]);
  await settled(other.service, other.service.start({ ...other.input, requestId: 'explicit', expectedVersion: 1,
    llmSessionId: 'panel', agentContext: explicit }).runId, 'completed');
  expect(generate.mock.calls[1][0].agentContext).toEqual(explicit);
});

it('loads a diagram context from its backing record for diagram edits', async () => {
  const saved = new Map<string, unknown>(), recordId = 'b'.repeat(64);
  const store: DiagramAgentContextStore = { put: async snapshot => { saved.set(recordId, snapshot); return recordId; },
    get: async id => saved.get(id) };
  const generate = vi.fn(async (_request: DiagramGenerationRequest) => ({ ascii: 'Edited\n`-- New branch', structureKind: 'tree' as const }));
  const f = fixture({ generate }, store);
  const compiled = compileDiagramAgentContext(f.base), bound = await storeDiagramAgentContext(compiled, store);
  f.controller.applyUpdate(0, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: f.base.revisionId, context: bound }]);
  await settled(f.service, f.service.start({ ...f.input, expectedVersion: 1 }).runId, 'completed');
  expect(generate.mock.calls[0][0]).toMatchObject({ agentContext: compiled.snapshot });
});

it.each(['in-place'] as const)('installs exactly the generated revision once with mode %s and restores its identity through durable undo/redo', async mode => {
  const generate = vi.fn(async () => ({ ascii: 'Edited\n`-- New branch', structureKind: 'tree' as const }));
  const f = fixture({ generate }), input = { ...f.input, 'edit-mode': mode }, run = f.service.start(input);
  expect(f.service.start(input).runId).toBe(run.runId);
  const complete = await settled(f.service, run.runId, 'completed');
  expect(generate).toHaveBeenCalledOnce(); expect(f.persist).toHaveBeenCalledOnce();
  expect(f.service.start(input)).toEqual(complete);
  expect(Object.keys(f.controller.getSnapshot().document.revisionReviews ?? {})).toHaveLength(0);
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

it('saves variant mode as a new durable alternative, retries persistence once, and supports undo/redo', async () => {
  const generate = vi.fn(async (request: DiagramGenerationRequest) => ({ ascii: 'Alternative\n`-- Branch', structureKind: request.context!.diagram.content.structure.kind }));
  const f = fixture({ generate }), input = { ...f.input, 'edit-mode': 'variant' as const };
  f.persist.mockRejectedValueOnce(Error('Disk unavailable'));
  const run = f.service.start(input);
  await settled(f.service, run.runId, 'awaiting-acknowledgement');
  f.service.start(input);
  const complete = await settled(f.service, run.runId, 'completed');
  expect(generate).toHaveBeenCalledOnce();
  expect(complete.variants).toHaveLength(1);
  expect(f.controller.getSnapshot().document.scene.contents.overview).toEqual(f.base);
  const id = complete.variants![0].id, snapshot = f.controller.getSnapshot();
  expect(snapshot.document.revisionReviews![id]).toMatchObject({ ownerNodeId: 'root', baseRevisionId: f.base.revisionId,
    headRevisionId: complete.variants![0].revisionId, name: 'Alternative' });
  const restored = new MappingDocumentController(structuredClone(snapshot.document), snapshot.canvas, 0,
    undefined, undefined, JSON.parse(JSON.stringify(f.controller.exportHistory())));
  restored.undo(); expect(restored.getSnapshot().document.revisionReviews?.[id]).toBeUndefined();
  restored.undo(true); expect(restored.getSnapshot().document.revisionReviews![id]).toEqual(snapshot.document.revisionReviews![id]);
  expect(() => f.service.start({ ...input, 'edit-mode': 'in-place' })).toThrow('REQUEST_ID_CONFLICT');
  const second = await settled(f.service, f.service.start({ ...input, requestId: 'second', expectedVersion: 1 }).runId, 'completed');
  expect(second.variants![0].id).not.toBe(id);
  expect(Object.keys(f.controller.getSnapshot().document.revisionReviews!)).toHaveLength(2);
});

it('validates modes and rejects removed Edit controls and contradictory variant options', () => {
  const f = fixture();
  expect(editDiagramSchema.parse({ ...f.input, 'edit-mode': 'variant' })['edit-mode']).toBe('variant');
  expect(() => editDiagramSchema.parse({ ...f.input, 'edit-mode': 'other' })).toThrow();
  expect(() => editDiagramSchema.parse({ ...f.input, generationMode: 'single-turn' })).toThrow();
  expect(() => f.service.start({ ...f.input, 'edit-mode': 'in-place', variant: { name: 'Option', count: 1 } })).toThrow('cannot include variant');
  expect(() => editDiagramSchema.parse({ ...f.input, 'edit-mode': undefined })).toThrow();
  expect(() => editDiagramSchema.parse({ ...f.input, 'replace-mode': undefined })).toThrow();
  expect(() => editDiagramSchema.parse({ ...f.input, mode: 'variant' })).toThrow();
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

it('preserves incoming and outgoing subtree-edit connections across shifted lines, shared instances and durable undo/redo', async () => {
  const ascii = 'Root\n|-- Edit\n|   `-- Old\n`-- Keep';
  const generated = 'Root\n|-- Edit\n|   |-- Added\n|   `-- More\n`-- Keep';
  const f = fixture({ generate: async () => ({ ascii: generated, structureKind: 'tree' }) });
  f.controller.applyUpdate(0, [
    { method: 'replace', nodeId: 'grid:overview', ascii, structureKind: 'tree' },
    { method: 'duplicate-instance', sourceNodeId: 'grid:overview', id: 'copy', position: { column: 30, row: 0 } },
    { method: 'diagram-create', id: 'other', ascii: 'Keep', position: { column: 60, row: 0 } }
  ]);
  const base = f.controller.getSnapshot().document.scene.contents.overview;
  const anchor = (displayNodeId: string, line: number): ContentNodeAnchor => {
    const diagram = f.controller.getSnapshot().document.scene.contents[displayNodeId === 'grid:other' ? 'other' : 'overview'];
    return { kind: 'content-node', displayNodeId, revisionId: diagram.content.revisionId,
      contentNodeId: diagramContentNodes(diagram.content).find(node => node.line === line)!.id, side: 'right', offset: 0.3 };
  };
  const edge = (id: string, source: ContentNodeAnchor, target: DiagramConnection['target']): DiagramConnection => ({
    id, source, target, appearance: { color: '#88c0d0', lineStyle: 'dashed', label: { text: id, position: { x: 100, y: 200 } } }
  });
  const originalEdges = [
    edge('outgoing', anchor('grid:overview', 1), anchor('grid:other', 1)),
    edge('incoming', anchor('grid:other', 1), anchor('grid:overview', 4)),
    edge('shared', anchor('grid:copy', 4), anchor('grid:overview', 1)),
    edge('box', anchor('grid:other', 1), { kind: 'box', displayNodeId: 'grid:overview', side: 'left' }),
    edge('replaced', anchor('grid:overview', 3), anchor('grid:other', 1))
  ];
  f.controller.applyUpdate(1, originalEdges.map(edge => ({ method: 'edge-create' as const, edge })));
  const input = { ...f.input, expectedVersion: 2, baseRevisionId: base.revisionId,
    'replace-mode': 'subnode-single' as const, subtree: { contentNodeId: anchor('grid:overview', 2).contentNodeId, revisionId: base.content.revisionId } };
  const complete = await settled(f.service, f.service.start(input).runId, 'completed');
  expect(complete.result!.unresolvedEdgeIds).toEqual(['replaced']);
  const after = f.controller.getSnapshot();
  const nextEdges = after.document.edges;
  expect(nextEdges.map(e => e.id)).toEqual(originalEdges.map(e => e.id));
  expect(nextEdges.map(e => e.appearance)).toEqual(originalEdges.map(e => e.appearance));
  expect(nextEdges.find(e => e.id === 'replaced')).toEqual(originalEdges.find(e => e.id === 'replaced'));
  expect(nextEdges.find(e => e.id === 'box')).toEqual(originalEdges.find(e => e.id === 'box'));
  expect(nextEdges.find(e => e.id === 'incoming')!.target).toEqual(anchor('grid:overview', 5));
  expect(nextEdges.find(e => e.id === 'shared')!.source).toEqual(anchor('grid:copy', 5));
  for (const connection of nextEdges.filter(e => e.id !== 'replaced')) {
    expect(() => validateConnectionAnchor(after.document.scene, connection.source)).not.toThrow();
    expect(() => validateConnectionAnchor(after.document.scene, connection.target)).not.toThrow();
  }
  const restored = new MappingDocumentController(structuredClone(after.document), after.canvas, 0,
    undefined, undefined, JSON.parse(JSON.stringify(f.controller.exportHistory())));
  expect(restored.getSnapshot().document.edges).toEqual(nextEdges);
  restored.undo();
  expect(restored.getSnapshot().document.edges).toEqual(originalEdges);
  restored.undo(true);
  expect(restored.getSnapshot().document.edges).toEqual(nextEdges);
  expect(f.service.start(input)).toEqual(complete);
  expect(f.persist).toHaveBeenCalledOnce();
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

it('generates multiple retained subtree variants, retries once, and refines one branch independently', async () => {
  const generate = vi.fn(async (request: DiagramGenerationRequest) => {
    const nodes = diagramContentNodes(request.context!.diagram.content), lines = request.context!.diagram.content.ascii.split('\n');
    lines[request.editRange!.startLine - 1] += ' revised';
    for (const node of nodes) lines[node.line - 1] += ` [[keep:${request.nodeRefs![node.id]}]]`;
    return { ascii: lines.join('\n'), structureKind: 'tree' as const, mappings: [] };
  });
  const f = fixture({ generate });
  f.controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Shop\n|-- Payment\n|   `-- Capture\n`-- Cart', structureKind: 'tree' }]);
  const base = f.controller.getSnapshot().document.scene.contents.overview;
  const payment = diagramContentNodes(base.content).find(n => n.label === 'Payment')!;
  const input = { ...f.input, 'edit-mode': 'variant' as const, expectedVersion: 1, baseRevisionId: base.revisionId,
    'replace-mode': 'subnode-single' as const, subtree: { contentNodeId: payment.id, revisionId: base.content.revisionId }, variant: { name: 'Payment option', count: 3 } };
  f.persist.mockRejectedValueOnce(Error('disk unavailable'));
  const run = f.service.start(input);
  await settled(f.service, run.runId, 'awaiting-acknowledgement');
  f.service.start(input);
  const complete = await settled(f.service, run.runId, 'completed');
  expect(generate).toHaveBeenCalledTimes(3);
  expect(complete.variants).toHaveLength(3);
  expect(f.controller.getSnapshot().document.scene.contents.overview.revisionId).toBe(base.revisionId);
  expect(Object.keys(f.controller.getSnapshot().document.revisionReviews!)).toHaveLength(3);
  const [a, b] = complete.variants!;
  const next = f.service.start({ ...input, subtree: undefined, requestId: 'refine', expectedVersion: 2, variant: { name: 'Refined', count: 1, variantId: a.id } });
  await settled(f.service, next.runId, 'completed');
  const variants = f.controller.getSnapshot().document.revisionReviews!;
  expect(variants[a.id].revisionIds).toHaveLength(2);
  expect(variants[b.id].headRevisionId).toBe(b.revisionId);
  expect(f.controller.getSnapshot().document.scene.contents.overview.revisionId).toBe(base.revisionId);
  expect(f.diagrams.getRevision(variants[a.id].headRevisionId).diagram.content.ascii).not.toContain('[[keep:');
});

it.each(['in-place', 'variant'] as const)('generates disjoint edits in one request with %s mode, persists and undoes atomically', async editMode => {
  const generate = vi.fn(async (request: DiagramGenerationRequest) => {
    const lines = request.context!.diagram.content.ascii.split('\n');
    for (const range of request.editRanges!) lines[range.startLine - 1] += ' revised';
    for (const node of diagramContentNodes(request.context!.diagram.content)) lines[node.line - 1] += ` [[keep:${request.nodeRefs![node.id]}]]`;
    return { ascii: lines.join('\n'), structureKind: 'tree' as const, replacementRanges: request.editRanges };
  });
  const f = fixture({ generate });
  f.controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Root\n|-- A\n|-- B\n`-- C', structureKind: 'tree' }]);
  const base = f.controller.getSnapshot().document.scene.contents.overview;
  const subtrees = diagramContentNodes(base.content).filter(node => ['A', 'C'].includes(node.label)).map(node => ({ contentNodeId: node.id, revisionId: base.content.revisionId }));
  const request = { ...f.input, expectedVersion: 1, baseRevisionId: base.revisionId, 'edit-mode': editMode, 'replace-mode': 'multi-disjoint' as const, subtrees };
  const completed = await settled(f.service, f.service.start(request).runId, 'completed');
  expect(generate).toHaveBeenCalledOnce(); expect(f.persist).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot().version).toBe(2);
  const edited = f.diagrams.getRevision(completed.result!.revisionId);
  expect(edited.parentId).toBe(base.revisionId);
  expect(edited.diagram.content.ascii).toBe('Root\n|-- A revised\n|-- B\n`-- C revised');
  if (editMode === 'variant') {
    expect(f.controller.getSnapshot().document.scene.contents.overview.revisionId).toBe(base.revisionId);
    const id = completed.variants![0].id;
    expect(f.controller.getSnapshot().document.revisionReviews![id].replacementScope).toEqual({ mode: 'multi-disjoint', ranges: [{ startLine: 2, endLine: 2 }, { startLine: 4, endLine: 4 }] });
    const refined = await settled(f.service, f.service.start({ ...request, expectedVersion: 2, requestId: 'refine-multi', subtrees: undefined,
      variant: { name: 'Refined', count: 1, variantId: id } }).runId, 'completed');
    expect(f.diagrams.getRevision(refined.result!.revisionId).diagram.content.ascii).toBe('Root\n|-- A revised revised\n|-- B\n`-- C revised revised');
    f.controller.undo();
  }
  f.controller.undo();
  expect(f.controller.getSnapshot().document.scene.contents.overview.revisionId).toBe(base.revisionId);
  expect(Object.keys(f.controller.getSnapshot().document.revisionReviews ?? {})).toHaveLength(0);
});
