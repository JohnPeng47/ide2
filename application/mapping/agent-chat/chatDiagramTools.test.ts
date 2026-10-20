import { expect, it, vi } from 'vitest';
import { ChatDiagramTools } from './chatDiagramTools';
import type { ChatSession } from '../../../domain/mapping/agent-chat/agentChat';
import type { EditDiagramInput } from '../../../domain/mapping/agent/diagramEdit';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';

function fixture() {
  const ascii = 'Root\n|-- Service\n|   `-- Worker\n`-- Other';
  const scene = singleDiagramScene(ascii);
  const diagram = new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram;
  scene.contents = { ...scene.contents, overview: diagram };
  const snapshot = { document: { scene, edges: [], sections: {} }, canvas: initialCanvasState(), version: 7 };
  const dispatch = vi.fn(async () => snapshot);
  const call = vi.fn(async (name: string, _input: unknown): Promise<unknown> => name === 'exec' ? { value: { sessionId: 'attachment' } } : { runId: 'run', status: 'generating' });
  const tools = new ChatDiagramTools({ call, bridge: { dispatch, register: vi.fn(), unregister: vi.fn(), list: vi.fn(), poll: vi.fn(), reply: vi.fn(), dispose: vi.fn() } });
  const session: ChatSession = { id: 'chat', threadId: 'thread', title: '', cwd: '/', createdAt: '', updatedAt: '', settings: { model: '', effort: '', sandbox: 'workspace-write' }, status: 'running', items: [], pending: [], requestIds: [],
    canvasContext: { canvas: { workspaceInstanceId: 'workspace', documentId: 'doc' }, references: [{ canvas: { workspaceInstanceId: 'workspace', documentId: 'doc' }, canvasName: 'Test', displayNodeId: 'grid:overview', ascii,
      reference: { kind: 'diagram', label: 'Root', diagramId: diagram.diagramId, revisionId: diagram.revisionId } }] } };
  return { tools, session, call, dispatch, snapshot, diagram };
}
const input = { reference: 1, prompt: 'Update service', requestId: 'request-1' };
it('uses the existing edit service with captured versions and reuses the exact request on retry', async () => {
  const f = fixture();
  await f.tools.call('edit-diagram', input, f.session);
  const sent = f.call.mock.calls.find(([name]) => name === 'edit-diagram')![1] as EditDiagramInput;
  expect(sent).toMatchObject({ sessionId: 'attachment', nodeId: 'grid:overview', expectedVersion: 7, baseRevisionId: f.diagram.revisionId, prompt: input.prompt });
  f.snapshot.version++;
  await f.tools.call('edit-diagram', input, f.session);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(f.call.mock.calls.filter(([name]) => name === 'edit-diagram').map(([, args]) => args)).toEqual([sent, sent]);
  await expect(f.tools.call('edit-diagram', { ...input, prompt: 'Different' }, f.session)).rejects.toThrow('REQUEST_ID_CONFLICT');
  await f.tools.call('edit-diagram-status', { runId: 'run' }, f.session);
  await f.tools.call('cancel-diagram-edit', { runId: 'run' }, f.session);
  await expect(f.tools.call('cancel-diagram-edit', { runId: 'run' }, { ...f.session, id: 'other' })).rejects.toThrow('does not belong');
});
it('supports current-canvas diagram IDs and blocks read-only or stale targets', async () => {
  const f = fixture();
  await f.tools.call('edit-diagram', { nodeId: 'grid:overview', prompt: 'Edit', requestId: 'by-id' }, f.session);
  expect(f.call.mock.calls.at(-1)?.[0]).toBe('edit-diagram');
  f.session.settings.sandbox = 'read-only';
  await expect(f.tools.call('edit-diagram', input, f.session)).rejects.toThrow('Workspace access');
  f.session.settings.sandbox = 'workspace-write';
  f.session.canvasContext!.references[0].reference.revisionId = 'old';
  await expect(f.tools.call('edit-diagram', input, f.session)).rejects.toThrow('VERSION_CONFLICT');
  expect(f.call.mock.calls.filter(([name]) => name === 'edit-diagram')).toHaveLength(1);
});
it('only scopes node edits to a complete subtree, rejecting holes and unrelated siblings', async () => {
  const f = fixture(), nodes = diagramContentNodes(f.diagram.content);
  const service = nodes.find(node => node.label === 'Service')!, worker = nodes.find(node => node.label === 'Worker')!;
  const ref = f.session.canvasContext!.references[0];
  ref.reference = { ...ref.reference, kind: 'nodes', nodeIds: [service.id], range: { startLine: 2, endLine: 3, startColumn: 1, endColumn: 30 } };
  await expect(f.tools.call('edit-diagram', input, f.session)).rejects.toThrow('excluded nodes');
  ref.reference.nodeIds.push(worker.id);
  await f.tools.call('edit-diagram', input, f.session);
  expect(f.call.mock.calls.at(-1)?.[1]).toMatchObject({ subtree: { contentNodeId: service.id, revisionId: f.diagram.content.revisionId } });
  ref.reference.nodeIds.push(nodes.find(node => node.label === 'Other')!.id);
  await expect(f.tools.call('edit-diagram', { ...input, requestId: 'siblings' }, f.session)).rejects.toThrow('one complete subtree');
});
