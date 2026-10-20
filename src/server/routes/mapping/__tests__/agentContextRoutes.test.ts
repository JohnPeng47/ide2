import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, it, vi } from 'vitest';
import { AgentContextService } from '../../../../../application/mapping/agent/agentContextService';
import { LiveCanvasService } from '../../../../../application/mapping/agent/liveCanvasService';
import { AgentDiagrammingSessionService } from '../../../../../application/mapping/agent/sessionService';
import type { CanvasSessionPort } from '../../../../../application/mapping/agent/ports';
import type { MappingDiagramService } from '../../../../../application/mapping/diagrams/diagramService';
import type { DiagramRepository } from '../../../../../application/core/ports/diagramRepository';
import { RevisionedDiagramService, type DiagramGenerationRequest } from '../../../../../domain/core/diagrams/diagramService';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { MappingDocumentController } from '../../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import type { DiagramRevisionApplication } from '../../../../../domain/mapping/agent/diagramEdit';
import { QuickJsAgentRuntime } from '../../../../../infrastructure/mapping/agent/execRuntime';
import { DiagramRevisionReceiver } from '../../../../features/mapping/agent/diagramRevisionReceiver';
import { attachLiveCanvasSockets } from '../liveCanvasRoutes';
import { handleAgentRoutes } from '../agentRoutes';

it('uploads over a bound WebSocket and uses that immutable context in an HTTP diagram edit', async () => {
  const contexts = new AgentContextService();
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original')), initialCanvasState());
  const base = controller.getSnapshot().document.scene.contents.overview;
  const receiver = new DiagramRevisionReceiver();
  const bridge: CanvasSessionPort = {
    register() {}, unregister() {}, dispose() {}, reply() {}, poll: async () => [],
    list: () => [{ canvasId: 'workspace', documents: [{ documentId: 'doc', name: 'Test' }, { documentId: 'other', name: 'Other' }] },
      { canvasId: 'publisher-only', documents: [] }],
    async dispatch(_canvasId, command) {
      if ((command.method === 'snapshot' || command.method === 'identity')) return { ...controller.getSnapshot(), history: controller.exportHistory(), name: 'Test' };
      if (command.method === 'apply-diagram-revision') return receiver.apply('doc', command.payload as DiagramRevisionApplication, controller, async () => {});
      throw Error(`Unexpected command ${command.method}`);
    }
  };
  const generate = vi.fn(async (_request: DiagramGenerationRequest) => ({ ascii: 'Workspace\n`-- Cache', structureKind: 'tree' as const }));
  const agent = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository,
    new QuickJsAgentRuntime(), undefined, new RevisionedDiagramService({ generate }), contexts);
  const live = new LiveCanvasService(() => bridge.list(), undefined, contexts), owner = {};
  live.publish(owner, 'workspace');
  live.update(owner, 'workspace', { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 0, sequence: 0, regions: [] });
  const server = createServer((req, res) => { void handleAgentRoutes(req, res, new URL(req.url!, 'http://localhost'), agent); });
  const dispose = attachLiveCanvasSockets(server, live, { agentContextUploadsEnabled: true }), clients: WebSocket[] = [];
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const connect = async () => {
    const ws = new WebSocket(root.replace('http:', 'ws:') + '/api/mapping/live');
    clients.push(ws); await once(ws, 'open'); return ws;
  };
  const send = async (ws: WebSocket, message: unknown) => {
    const next = once(ws, 'message'); ws.send(JSON.stringify(message)); return JSON.parse(String((await next)[0]));
  };
  const tool = async (name: string, input: unknown) => {
    const response = await fetch(`${root}/api/mapping/agent/tools/${name}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  };
  const attach = { type: 'attach', protocolVersion: 2, workspaceInstanceId: 'workspace', documentId: 'doc' };
  const upload = { type: 'agent-context.upload', requestId: 'upload', agentType: 'codex', sourceSessionId: 'coding-session',
    format: 'messages-v1', fromEntryId: 'first', throughEntryId: 'last', entries: [
      { id: 'first', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Move cache ownership to Workspace' }] } },
      { id: 'last', parentId: 'first', message: { role: 'assistant', content: [{ type: 'text', text: 'Workspace now owns the cache.' }] } }
    ] };
  try {
    const reader = await connect();
    expect(await send(reader, upload)).toMatchObject({ type: 'error', requestId: 'upload', code: 'READER_REQUIRED' });
    const attached = await send(reader, attach);
    expect(attached.type).toBe('attached');
    const { agentType: _, ...missingType } = upload;
    expect(await send(reader, missingType)).toMatchObject({ type: 'error', requestId: 'upload', code: 'INVALID_MESSAGE' });
    const receipt = await send(reader, upload);
    expect(receipt).toMatchObject({ type: 'agent-context.uploaded', requestId: 'upload', connectionId: attached.connectionId,
      agentType: 'codex', sourceSessionId: 'coding-session', messageCount: 2 });
    expect(await send(reader, upload)).toEqual(receipt);
    expect(await send(reader, { ...upload, agentType: 'claude' })).toMatchObject({ code: 'REQUEST_ID_CONFLICT', requestId: 'upload' });
    const publisher = await connect();
    await send(publisher, { type: 'publish', protocolVersion: 2, workspaceInstanceId: 'publisher-only' });
    expect(await send(publisher, upload)).toMatchObject({ code: 'READER_REQUIRED' });
    const closed = once(reader, 'close'); reader.close(); await closed;
    const reconnected = await connect(); await send(reconnected, attach);
    expect(await send(reconnected, upload)).toMatchObject({ agentContextId: receipt.agentContextId, contentHash: receipt.contentHash });
    const apiAttach = async (documentId: string) => (await tool('exec', { requestId: `attach-${documentId}`,
      code: `return canvas.attach({canvasId:"workspace",documentId:${JSON.stringify(documentId)}});` })).data.value;
    const wrong = await apiAttach('other');
    const edit = { nodeId: 'grid:overview', expectedVersion: 0, baseRevisionId: base.revisionId,
      prompt: 'Reflect the ownership change', requestId: 'edit', agentContextId: receipt.agentContextId };
    expect((await tool('edit-diagram', { ...edit, sessionId: wrong.sessionId })).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
    const correct = await apiAttach('doc');
    const run = await tool('edit-diagram', { ...edit, sessionId: correct.sessionId });
    expect(run.status).toBe(200);
    await expect.poll(async () => (await tool('edit-diagram-status', { runId: run.data.runId })).data.status).toBe('completed');
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0].agentContext).toMatchObject({ contentHash: receipt.contentHash, source: { agentType: 'codex' } });
    expect(controller.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Workspace\n`-- Cache');
    expect((await tool('edit-diagram', { ...edit, sessionId: correct.sessionId })).data.runId).toBe(run.data.runId);
    expect(generate).toHaveBeenCalledOnce();
    const invalidated = once(reconnected, 'message'); live.remove(owner, 'workspace', 'doc', 'epoch'); await invalidated;
    expect(await send(reconnected, upload)).toMatchObject({ type: 'error', code: 'canvas.closed', requestId: 'upload' });
  } finally {
    clients.forEach(ws => ws.terminate()); dispose(); agent.dispose(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
