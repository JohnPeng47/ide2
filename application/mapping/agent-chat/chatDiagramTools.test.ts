import { expect, it, vi } from 'vitest';
import { ChatDiagramTools } from './chatDiagramTools';
import type { ChatSession } from '../../../domain/mapping/agent-chat/agentChat';
import { CanvasApiProjection } from '../agent/apiProjection';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { revisionFixture } from '../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';

function fixture() {
  const ascii = 'Root\n|-- Service\n|   `-- Worker\n`-- Other';
  const scene = singleDiagramScene(ascii);
  const diagram = revisionFixture().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram;
  scene.contents = { ...scene.contents, overview: diagram };
  const snapshot = { document: { scene, edges: [], sections: {} }, canvas: initialCanvasState(), version: 7 };
  const dispatch = vi.fn(async () => snapshot);
  const call = vi.fn(async (name: string, _input: unknown): Promise<unknown> => name === 'exec' ? { value: { sessionId: 'attachment' } } : { runId: 'run', status: 'generating' });
  const submitDirect = vi.fn(async (_name: string, _input: unknown) => ({ runId: 'run', operation: 'edit-diagram' as const, status: 'completed' as const, results: [] }));
  const tools = new ChatDiagramTools({ call, submitDirect, projection: new CanvasApiProjection(), resolveDiagramArguments: (_id, raw) => raw, bridge: { dispatch, register: vi.fn(), unregister: vi.fn(), list: vi.fn(), poll: vi.fn(), reply: vi.fn(), dispose: vi.fn() } });
  const session: ChatSession = { id: 'chat', threadId: 'thread', title: '', cwd: '/', createdAt: '', updatedAt: '', settings: { model: '', effort: '', sandbox: 'workspace-write' }, status: 'running', items: [], pending: [], requestIds: [],
    canvasContext: { canvas: { workspaceInstanceId: 'workspace', documentId: 'doc' }, references: [{ canvas: { workspaceInstanceId: 'workspace', documentId: 'doc' }, canvasName: 'Test', displayNodeId: 'grid:overview', ascii,
      reference: { kind: 'diagram', label: 'Root', diagramId: diagram.diagramId, revisionId: diagram.revisionId } }] } };
  return { tools, session, call, submitDirect, dispatch, snapshot, diagram };
}
const operation = { 'edit-mode': 'in-place', 'replace-mode': 'diagram', reference: 1, edit: { ascii: 'Updated', structureKind: 'tree' } };
const input = { requestId: 'request-1', operations: [operation] };
it('binds CanvasView recording to the active canvas, pins retries, and permits read-only listing', async () => {
  const f = fixture(), request = { operation: 'start', name: 'A', requestId: 'view-1' };
  await f.tools.call('canvas-view', request, f.session);
  const sent = f.call.mock.calls.at(-1)![1];
  expect(sent).toMatchObject({ sessionId: 'attachment', operation: 'start', name: 'A', expectedVersion: 7 });
  f.snapshot.version++;
  await f.tools.call('canvas-view', request, f.session);
  expect(f.call.mock.calls.at(-1)![1]).toEqual(sent);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  await expect(f.tools.call('canvas-view', { ...request, name: 'B' }, f.session)).rejects.toThrow('REQUEST_ID_CONFLICT');
  f.session.settings.sandbox = 'read-only';
  await expect(f.tools.call('canvas-view', { ...request, requestId: 'denied' }, f.session)).rejects.toThrow('Workspace access');
  await f.tools.call('canvas-view', { operation: 'list', requestId: 'list' }, f.session);
  expect(f.call.mock.calls.at(-1)![1]).toMatchObject({ operation: 'list', sessionId: 'attachment' });
});
it('submits content directly with captured versions and reuses the exact request on retry', async () => {
  const f = fixture();
  await f.tools.call('edit-diagram', input, f.session);
  const sent = f.submitDirect.mock.calls[0][1];
  expect(sent).toMatchObject({ sessionId: 'attachment', expectedVersion: 7, operations: [{ nodeId: 'grid:overview', baseRevisionId: f.diagram.revisionId, edit: operation.edit, 'edit-mode': 'in-place' }] });
  expect(f.call.mock.calls.some(([name]) => name === 'edit-diagram')).toBe(false);
  f.snapshot.version++;
  await f.tools.call('edit-diagram', input, f.session);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(f.submitDirect.mock.calls.map(([, args]) => args)).toEqual([sent, sent]);
  await expect(f.tools.call('edit-diagram', { ...input, operations: [{ ...operation, edit: { ascii: 'Different', structureKind: 'tree' } }] }, f.session)).rejects.toThrow('REQUEST_ID_CONFLICT');
  await f.tools.call('edit-diagram-status', { runId: 'run' }, f.session);
  await expect(f.tools.call('cancel-diagram-edit', { runId: 'run' }, { ...f.session, id: 'other' })).rejects.toThrow('does not belong');
});
it('supports pinned current-canvas IDs and blocks read-only or stale targets', async () => {
  const f = fixture(), item = { ...operation, reference: undefined, nodeId: 'grid:overview', baseRevisionId: f.diagram.revisionId };
  await f.tools.call('edit-diagram', { requestId: 'by-id', operations: [item] }, f.session);
  await expect(f.tools.call('edit-diagram', { requestId: 'missing-base', operations: [{ ...item, baseRevisionId: undefined }] }, f.session)).rejects.toThrow('VERSION_CONFLICT');
  f.session.settings.sandbox = 'read-only';
  await expect(f.tools.call('edit-diagram', input, f.session)).rejects.toThrow('Workspace access');
  f.session.settings.sandbox = 'workspace-write';
  f.session.canvasContext!.references[0].reference.revisionId = 'old';
  await expect(f.tools.call('edit-diagram', input, f.session)).rejects.toThrow('VERSION_CONFLICT');
  expect(f.submitDirect).toHaveBeenCalledOnce();
});
it('exposes prepare, read, and delete for diagram context with pinned mutation versions', async () => {
  const f = fixture();
  await f.tools.call('diagram-agent-context', { operation: 'prepare', reference: 1, requestId: 'context-1' }, f.session);
  expect(f.call.mock.calls.at(-1)).toMatchObject(['diagram-agent-context', { operation: 'prepare', sessionId: 'attachment', nodeId: 'grid:overview', expectedVersion: 7,
    expectedRevisionId: f.diagram.revisionId }]);
  f.snapshot.version++;
  await f.tools.call('diagram-agent-context', { operation: 'prepare', reference: 1, requestId: 'context-1' }, f.session);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  await expect(f.tools.call('diagram-agent-context', { operation: 'delete', reference: 1, requestId: 'context-1' }, f.session)).rejects.toThrow('REQUEST_ID_CONFLICT');
  f.session.settings.sandbox = 'read-only';
  await f.tools.call('diagram-agent-context', { operation: 'read', nodeId: 'grid:overview', requestId: 'context-read' }, f.session);
  expect(f.call.mock.calls.at(-1)?.[1]).toMatchObject({ operation: 'read', nodeId: 'grid:overview' });
  await expect(f.tools.call('diagram-agent-context', { operation: 'delete', nodeId: 'grid:overview', requestId: 'context-delete' }, f.session)).rejects.toThrow('Workspace access');
});
it('requires complete selected subtrees and explicit modes', async () => {
  const f = fixture(), nodes = diagramContentNodes(f.diagram.content);
  const service = nodes.find(node => node.label === 'Service')!, worker = nodes.find(node => node.label === 'Worker')!;
  const ref = f.session.canvasContext!.references[0];
  ref.reference = { ...ref.reference, kind: 'nodes', nodeIds: [service.id], range: { startLine: 2, endLine: 3, startColumn: 1, endColumn: 30 } };
  const request = { ...input, operations: [{ ...operation, 'replace-mode': 'subnode-single' }] };
  await expect(f.tools.call('edit-diagram', request, f.session)).rejects.toThrow('excluded nodes');
  ref.reference.nodeIds.push(worker.id);
  await f.tools.call('edit-diagram', request, f.session);
  expect(f.submitDirect.mock.calls.at(-1)?.[1]).toMatchObject({ operations: [{ subtree: { contentNodeId: service.id, revisionId: f.diagram.content.revisionId } }] });
  for (const key of ['edit-mode', 'replace-mode'])
    await expect(f.tools.call('edit-diagram', { ...input, operations: [{ ...operation, [key]: undefined }] }, f.session)).rejects.toThrow();
});
it('binds multiple roots and forwards variant mode without widening scope', async () => {
  const f = fixture(), nodes = diagramContentNodes(f.diagram.content);
  const root = (label: string) => nodes.find(node => node.label === label)!.id;
  const item = { ...operation, 'edit-mode': 'variant', 'replace-mode': 'multi-contiguous', contentNodeIds: [root('Service'), root('Other')] };
  await f.tools.call('edit-diagram', { ...input, operations: [item] }, f.session);
  expect(f.submitDirect.mock.calls.at(-1)?.[1]).toMatchObject({ operations: [{ 'edit-mode': 'variant', 'replace-mode': 'multi-contiguous', subtrees: [{ contentNodeId: root('Service') }, { contentNodeId: root('Other') }] }] });
  await expect(f.tools.call('edit-diagram', { ...input, operations: [{ ...item, 'replace-mode': 'multi-disjoint' }] }, f.session)).rejects.toThrow('REQUEST_ID_CONFLICT');
});
it.each(['create-diagram', 'extend-diagram'] as const)('exposes direct batched payloads for %s', async name => {
  const f = fixture();
  const item = { reference: 1, diagram: operation.edit, ...(name === 'extend-diagram' ? { origin: { column: 50, row: 20 }, sources: [{ kind: 'content-node', displayNodeId: 'grid:overview', revisionId: f.diagram.content.revisionId, contentNodeId: diagramContentNodes(f.diagram.content)[0].id }] } : {}) };
  await f.tools.call(name, { requestId: name, operations: [item, item] }, f.session);
  expect(f.submitDirect.mock.calls[0]).toMatchObject([name, { operations: [{ diagram: operation.edit }, { diagram: operation.edit }] }]);
  const definition = f.tools.definitions.find(tool => tool.name === name)!;
  expect(definition.description).toContain('# OUTPUT FORMAT');
  expect(definition.description).toContain('operations[].diagram');
  await expect(f.tools.call(name, { requestId: 'bad', operations: [{ reference: 1, prompt: 'Generate for me' }] }, f.session)).rejects.toThrow();
});
