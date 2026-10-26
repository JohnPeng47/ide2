import { expect, it, vi } from 'vitest';
import { AgentChatService } from './agentChatService';
import { GenerationCanvasBridge } from './generationCanvasBridge';
import type { ChatStore, ChatTools, ChatMcpBinding, CodexConnection, CodexMessage } from './ports';
import type { ChatSession } from '../../../domain/mapping/agent-chat/agentChat';
import type { CanvasSessionPort } from '../agent/ports';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { documentFromHistory, validateCanvasHistory } from '../../../domain/core/diagrams/canvasHistory';

async function fixture() {
  const c = new MappingDocumentController({ scene: singleDiagramScene('Original'), edges: [], sections: {} }, initialCanvasState());
  const viewId = c.canvasView(0, { operation: 'create', name: 'A' }).activeViewId!;
  const receipts = new Map<string, unknown>();
  const live: CanvasSessionPort = { register() {}, list: () => [{ canvasId: 'live', stableWorkspaceId: 'stable', documents: [{ documentId: 'doc', name: 'A' }] }],
    poll: async () => [], reply() {}, unregister() {}, dispose() {},
    async dispatch(_id, command) {
      if (command.method === 'identity') return { version: c.getSnapshot().version };
      const p = command.payload as any;
      if (command.method !== 'canvas-generation') throw Error('Unexpected command');
      if (receipts.has(p.requestId)) return receipts.get(p.requestId);
      const result = p.operation === 'start' ? c.startGeneration(p.expectedVersion, p.viewId, p.candidates) : c.updateGeneration(p.viewId, p.generation, p.history);
      receipts.set(p.requestId, result); return result;
    } };
  const bridge = new GenerationCanvasBridge(live), saved = new Map<string, ChatSession>();
  const store: ChatStore = { list: async () => [...saved.values()], save: async s => { saved.set(s.id, structuredClone(s)); } };
  let notify: (event: CodexMessage) => void = () => {}, serial = 0;
  const requests: { method: string; params: Record<string, any> }[] = [], replies: unknown[] = [];
  const connection: CodexConnection = { async request<T>(method: string, params: Record<string, any>): Promise<T> {
    requests.push({ method, params });
    if (method === 'thread/start' || method === 'thread/fork') return { thread: { id: `thread-${++serial}` }, model: 'model-x', reasoningEffort: 'high' } as T;
    if (method === 'turn/start') { const id = `turn-${++serial}`; notify({ method: 'turn/started', params: { threadId: params.threadId, turn: { id } } }); return { turn: { id } } as T; }
    return {} as T;
  }, respond: (_id, result) => replies.push(result), reject() {}, subscribe(listener) { notify = listener; return () => {}; }, dispose() {} };
  const tools: ChatTools = { definitions: [{ type: 'function', name: 'gen-alternatives', description: 'Generate', inputSchema: {} }, { type: 'function', name: 'edit-diagram', description: 'Edit', inputSchema: {} }], call: vi.fn() };
  const mcp: ChatMcpBinding = { chatId: token => token, setOrigin() {}, config: id => ({ binding: id }), bind: vi.fn(), clear: vi.fn() };
  const service = new AgentChatService(connection, store, '/workspace', undefined, tools, mcp, bridge);
  const parent = await service.create({ model: 'model-x', effort: 'high', sandbox: 'workspace-write' });
  await service.send(parent.id, { text: 'Try three different layouts exactly as described.', model: 'model-x', effort: 'high', sandbox: 'workspace-write', requestId: crypto.randomUUID(), canvas: { workspaceInstanceId: 'live', documentId: 'doc' } });
  const input = { viewId, prompt: 'Explore layouts', alternatives: [1, 2, 3].map(i => ({ name: `A.${i}`, prompt: `Layout ${i}` })), requestId: 'generation' };
  return { c, viewId, bridge, store, saved, service, parent, input, requests, tools, mcp, replies, live, connection, notify: (event: CodexMessage) => notify(event) };
}
it('runs children concurrently with inherited configuration and tools, isolates edits, attributes usage, and publishes without changing the live canvas', async () => {
  const f = await fixture();
  try {
    const before = f.c.getSnapshot().canvasRevisionId;
    const group = await f.service.genAlternatives(f.parent.id, f.input);
    await vi.waitFor(() => expect(f.requests.filter(r => r.method === 'turn/start')).toHaveLength(4));
    const children = await Promise.all(group.candidates.map(candidate => f.service.get(candidate.chatId)));
    expect(children.every(child => child.status === 'running')).toBe(true); // None must finish before others start.
    expect(f.requests.filter(r => r.method === 'thread/fork')).toHaveLength(3);
    for (const request of f.requests.filter(r => r.method === 'thread/fork')) expect(request.params).toMatchObject({
      threadId: f.parent.threadId, beforeTurnId: (await f.service.get(f.parent.id)).turnId, model: 'model-x', config: { model_reasoning_effort: 'high' } });
    for (const child of children) {
      expect(child.settings).toEqual({ model: 'model-x', effort: 'high', sandbox: 'workspace-write' });
      expect(await f.service.toolDefinitions(child.id)).toEqual(f.tools.definitions);
      expect(child.generation!.metadata.triggerPrompt).toBe('Try three different layouts exactly as described.');
      await expect(f.service.genAlternatives(child.id, { ...f.input, requestId: 'nested' })).rejects.toThrow('nested');
    }
    expect(await f.service.genAlternatives(f.parent.id, f.input)).toEqual(group);
    expect(f.requests.filter(r => r.method === 'thread/fork')).toHaveLength(3);
    await expect(f.service.genAlternatives(f.parent.id, { ...f.input, prompt: 'Different' })).rejects.toThrow('REQUEST_ID_CONFLICT');
    for (let i = 0; i < children.length; i++) {
      const child = children[i], canvas = child.canvasContext!.canvas!;
      await f.bridge.dispatch(canvas.workspaceInstanceId, { method: 'apply', documentId: canvas.documentId, payload: { requestId: 'edit', expectedVersion: 0,
        operations: [{ method: 'replace', nodeId: 'grid:overview', ascii: `Candidate ${i}` }] } });
      const last = { totalTokens: 30, inputTokens: 20, cachedInputTokens: 5, outputTokens: 10, reasoningOutputTokens: 3 };
      const total = Object.fromEntries(Object.entries(last).map(([key, value]) => [key, value + 100]));
      f.notify({ method: 'thread/tokenUsage/updated', params: { threadId: child.threadId, turnId: child.turnId, tokenUsage: { total, last } } });
      f.notify({ method: 'thread/tokenUsage/updated', params: { threadId: child.threadId, turnId: child.turnId, tokenUsage: { total, last } } });
      f.notify({ method: 'turn/completed', params: { threadId: child.threadId, turn: { id: child.turnId, status: 'completed' } } });
    }
    await vi.waitFor(() => expect(group.candidates.every(candidate => f.c.canvasViews().saved[candidate.viewId].generation?.status === 'finished')).toBe(true));
    expect(f.c.getSnapshot().canvasRevisionId).toBe(before);
    expect(f.c.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Original');
    for (let i = 0; i < children.length; i++) {
      const view = f.c.canvasViews().saved[group.candidates[i].viewId];
      expect(view.generation!.usage!.totalTokens).toBe(30);
      expect(view.generation!.durationMs).toBeGreaterThanOrEqual(0);
      expect(documentFromHistory(f.c.exportHistory(), view.finalCheckpointId).scene.contents.overview.content.ascii).toBe(`Candidate ${i}`);
    }
    validateCanvasHistory(f.c.exportHistory());
  } finally { f.service.dispose(); }
});
it('cancels child generations and locks unfinished candidates against manual modification', async () => {
  const f = await fixture();
  try {
    const group = await f.service.genAlternatives(f.parent.id, f.input);
    await vi.waitFor(() => expect(f.requests.filter(r => r.method === 'turn/start')).toHaveLength(4));
    expect(() => f.c.canvasView(f.c.getSnapshot().version, { operation: 'open', viewId: group.candidates[0].viewId })).toThrow('still generating');
    expect(() => f.c.canvasView(f.c.getSnapshot().version, { operation: 'discard', viewId: f.viewId })).toThrow('cancel');
    await f.service.interrupt(f.parent.id);
    expect(group.candidates.every(candidate => f.c.canvasViews().saved[candidate.viewId].generation?.status === 'cancelled')).toBe(true);
    expect(f.requests.filter(r => r.method === 'turn/interrupt')).toHaveLength(4);
    expect(f.bridge.list().filter(canvas => canvas.canvasId.startsWith('generation-'))).toHaveLength(0);
  } finally { f.service.dispose(); }
});

it('dispatches the native generation tool and contains a failed child without affecting siblings', async () => {
  const f = await fixture();
  try {
    f.notify({ id: 'native-call', method: 'item/tool/call', params: { threadId: f.parent.threadId,
      turnId: (await f.service.get(f.parent.id)).turnId, tool: 'gen-alternatives', arguments: f.input } });
    await vi.waitFor(() => expect(f.replies).toHaveLength(1));
    const reply = f.replies[0] as { success: boolean; contentItems: { text: string }[] };
    expect(reply.success).toBe(true);
    const group = JSON.parse(reply.contentItems[0].text);
    await vi.waitFor(() => expect(f.requests.filter(r => r.method === 'turn/start')).toHaveLength(4));
    expect(f.requests.filter(r => r.method === 'thread/goal/clear')).toHaveLength(3);
    const child = await f.service.get(group.candidates[0].chatId);
    f.notify({ method: 'turn/completed', params: { threadId: child.threadId, turn: { id: child.turnId, status: 'failed', error: { message: 'Provider unavailable' } } } });
    await vi.waitFor(() => expect(f.c.canvasViews().saved[group.candidates[0].viewId].generation?.status).toBe('failed'));
    expect(f.c.canvasViews().saved[group.candidates[0].viewId].generation?.error).toBe('Provider unavailable');
    expect(f.c.canvasViews().saved[group.candidates[1].viewId].generation?.status).toBe('generating');
    await expect(f.service.send(child.id, {})).rejects.toThrow('retained for review');
    await expect(f.service.readCanvas(child.id, {})).rejects.toThrow('retained for review');
    await f.service.interrupt(f.parent.id);
  } finally { f.service.dispose(); }
});
it('retains a completed result while the source is offline and publishes it once on reconnect', async () => {
  const f = await fixture();
  try {
    const group = await f.service.genAlternatives(f.parent.id, { ...f.input, alternatives: [f.input.alternatives[0]] });
    await vi.waitFor(() => expect(f.requests.filter(r => r.method === 'turn/start')).toHaveLength(2));
    const child = await f.service.get(group.candidates[0].chatId), canvas = child.canvasContext!.canvas!;
    await f.bridge.dispatch(canvas.workspaceInstanceId, { method: 'apply', documentId: canvas.documentId, payload: { requestId: 'edit', expectedVersion: 0,
      operations: [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Retained result' }] } });
    const dispatch = f.live.dispatch.bind(f.live);
    f.live.dispatch = async () => { throw Error('Browser disconnected'); };
    f.notify({ method: 'turn/completed', params: { threadId: child.threadId, turn: { id: child.turnId, status: 'completed' } } });
    await vi.waitFor(() => expect(f.bridge.list()).toHaveLength(1));
    const source = { workspaceInstanceId: 'live', documentId: 'doc' };
    expect((await f.service.generations(source))[0]).toMatchObject({ status: 'finished', pendingSave: true });
    expect(f.saved.get(child.id)!.generation!.history).toBeDefined();
    f.live.dispatch = dispatch;
    expect((await f.service.generations(source))[0]).toMatchObject({ status: 'finished', pendingSave: false });
    const endpoint = f.c.canvasViews().saved[group.candidates[0].viewId].finalCheckpointId;
    expect(documentFromHistory(f.c.exportHistory(), endpoint).scene.contents.overview.content.ascii).toBe('Retained result');
    await f.service.generations(source);
    expect(f.c.canvasViews().saved[group.candidates[0].viewId].finalCheckpointId).toBe(endpoint);
    expect(f.requests.filter(r => r.method === 'thread/fork')).toHaveLength(1);
  } finally { f.service.dispose(); }
});
it('marks interrupted generations failed on server restart without launching replacement turns', async () => {
  const f = await fixture();
  let restarted: AgentChatService | undefined;
  try {
    const group = await f.service.genAlternatives(f.parent.id, { ...f.input, alternatives: [f.input.alternatives[0]] });
    await vi.waitFor(() => expect(f.requests.filter(r => r.method === 'turn/start')).toHaveLength(2));
    // Read persisted sessions as if the previous process had exited abruptly.
    restarted = new AgentChatService(f.connection, f.store, '/workspace', undefined, f.tools, f.mcp, f.bridge);
    const child = await restarted.get(group.candidates[0].chatId);
    expect(child.generation!.metadata.status).toBe('failed');
    expect(child.generation!.metadata.error).toContain('Server restarted');
    await restarted.generations({ workspaceInstanceId: 'live', documentId: 'doc' });
    expect(f.c.canvasViews().saved[group.candidates[0].viewId].generation?.status).toBe('failed');
    expect(f.requests.filter(r => r.method === 'turn/start')).toHaveLength(2);
  } finally { restarted?.dispose(); f.service.dispose(); }
});
