import { describe, expect, it, vi } from 'vitest';
import { AgentChatService } from './agentChatService';
import type { ChatCanvasReader, ChatStore, ChatTools, CodexConnection, CodexMessage } from './ports';
import { reduceChatEvent, type ChatEvent, type ChatSession } from '../../../domain/mapping/agent-chat/agentChat';

class Connection implements CodexConnection {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  replies: { id: string | number; result: unknown }[] = [];
  notify: (message: CodexMessage) => void = () => {};
  exit: (error: string) => void = () => {};
  turn = 0;
  fail = false;
  completeBeforeReply = false;
  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: `thread-${this.calls.length}` }, model: 'test-model' } as T;
    if (method === 'turn/start') {
      if (this.fail) throw new Error('turn failed');
      const id = `turn-${++this.turn}`;
      this.notify({ method: 'turn/started', params: { threadId: params.threadId, turn: { id } } });
      if (this.completeBeforeReply) this.notify({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id, status: 'completed' } } });
      return { turn: { id } } as T;
    }
    return {} as T;
  }
  respond(id: string | number, result: unknown) { this.replies.push({ id, result }); }
  reject(id: string | number, result: string) { this.replies.push({ id, result }); }
  subscribe(notify: typeof this.notify, exit: typeof this.exit) { this.notify = notify; this.exit = exit; return () => {}; }
  dispose() {}
}
function fixture(initial: ChatSession[] = [], canvasReader?: ChatCanvasReader, tools?: ChatTools) {
  const connection = new Connection();
  const saved = new Map(initial.map(session => [session.id, structuredClone(session)]));
  const store: ChatStore = { list: async () => [...saved.values()], save: async session => { saved.set(session.id, structuredClone(session)); } };
  const service = new AgentChatService(connection, store, '/workspace', canvasReader, tools);
  return { connection, service, saved, store };
}
const input = (text = 'Hello') => ({ text, requestId: crypto.randomUUID(), model: 'test-model', effort: 'high', sandbox: 'workspace-write' });

describe('Codex agent chat', () => {
  const nativeThreadId = '019a0000-0000-7000-8000-000000000001';
  const nativeResume = () => ({
    thread: { id: nativeThreadId, name: 'CLI conversation', cwd: '/original/project', createdAt: 1700000000, status: { type: 'idle' }, turns: [
      { id: 'old-turn', status: 'completed', items: [
        { id: 'old-user', type: 'userMessage', content: [{ type: 'text', text: 'Original question\nwith context' }, { type: 'localImage', path: '/image.png' }] },
        { id: 'old-command', type: 'commandExecution', command: 'pwd', status: 'completed', aggregatedOutput: '/original/project' },
        { id: 'old-answer', type: 'agentMessage', text: 'Original answer', phase: 'final_answer' },
        { id: 'old-partial', type: 'commandExecution', command: 'unfinished', status: 'inProgress' }
      ] }
    ] },
    model: 'native-model', reasoningEffort: 'medium', sandbox: { type: 'workspaceWrite' }
  });
  it('imports native history and settings once without overriding instructions, tools, or cwd', async () => {
    const { service, connection, saved } = fixture();
    const rpc = vi.spyOn(connection, 'request').mockResolvedValue(nativeResume());
    try {
      const [session, duplicate] = await Promise.all([
        service.resume({ sessionId: ` ${nativeThreadId.toUpperCase()} ` }),
        service.resume({ sessionId: nativeThreadId })
      ]);
      expect(duplicate.id).toBe(session.id);
      expect(rpc).toHaveBeenCalledExactlyOnceWith('thread/resume', { threadId: nativeThreadId, sandbox: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user' });
      expect(session).toMatchObject({ origin: 'codex', canvasTools: false, title: 'CLI conversation', cwd: '/original/project',
        threadId: nativeThreadId, accessDefaultApplied: true, settings: { model: 'native-model', effort: 'medium', sandbox: 'danger-full-access' } });
      expect(session.items).toEqual([
        expect.objectContaining({ id: 'old-user', kind: 'user', text: 'Original question\nwith context\n[Image]', turnId: 'old-turn' }),
        expect.objectContaining({ kind: 'tool', text: '/original/project', command: expect.objectContaining({ command: 'pwd' }) }),
        expect.objectContaining({ kind: 'assistant', text: 'Original answer', phase: 'final_answer' }),
        expect.objectContaining({ status: 'interrupted' })
      ]);
      expect(saved.get(session.id)).toEqual(session);
      expect((await service.resume({ sessionId: nativeThreadId })).id).toBe(session.id);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(await service.list()).toHaveLength(1);
    } finally { service.dispose(); }
  });
  it('continues the imported thread after restart without injecting the Agent Chat prompt or MCP config', async () => {
    const { service, connection, store } = fixture();
    vi.spyOn(connection, 'request').mockResolvedValueOnce(nativeResume());
    const session = await service.resume({ sessionId: nativeThreadId });
    service.dispose();
    const next = new Connection();
    const mcp = { config: vi.fn(() => ({ custom: true })), bind: vi.fn(() => { throw Error('No Agent Chat binding for a native session'); }), clear: vi.fn(), setOrigin: vi.fn() };
    const restored = new AgentChatService(next, store, '/workspace', undefined, undefined, mcp);
    try {
      await restored.send(session.id, { ...input('Continue'), ...session.settings });
      expect(next.calls[0]).toEqual({ method: 'thread/resume', params: {
        threadId: nativeThreadId, cwd: '/original/project', sandbox: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user'
      } });
      expect(mcp.config).not.toHaveBeenCalled();
      expect(mcp.bind).not.toHaveBeenCalled();
      expect(next.calls[1]).toMatchObject({ method: 'turn/start', params: { threadId: nativeThreadId, model: 'native-model', effort: 'medium', approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } } });
      next.notify({ method: 'item/completed', params: { threadId: nativeThreadId, turnId: 'turn-1', item: { id: 'continued', type: 'agentMessage', text: 'Continued answer' } } });
      expect((await restored.get(session.id)).items.at(-1)?.text).toBe('Continued answer');
    } finally { restored.dispose(); }
  });
  it('opens an existing Agent Chat thread without duplicating it or disabling its tools', async () => {
    const { service, connection } = fixture([], undefined, { definitions: [], call: vi.fn() });
    const rpc = vi.spyOn(connection, 'request').mockResolvedValueOnce({ thread: { id: nativeThreadId }, model: 'test-model' });
    try {
      const session = await service.create({});
      expect(await service.resume({ sessionId: nativeThreadId })).toEqual(session);
      expect(session.canvasTools).toBe(true);
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally { service.dispose(); }
  });
  it.each(['read-only', 'workspace-write'] as const)('upgrades an earlier %s import to YOLO once and preserves later explicit choices', async sandbox => {
    const { service, connection, store, saved } = fixture();
    vi.spyOn(connection, 'request').mockResolvedValueOnce(nativeResume());
    const imported = await service.resume({ sessionId: nativeThreadId });
    service.dispose();
    const legacy = { ...imported, settings: { ...imported.settings, sandbox } };
    delete legacy.accessDefaultApplied;
    await store.save(legacy);

    const next = new Connection();
    const migrated = new AgentChatService(next, store, '/workspace');
    try {
      const session = await migrated.resume({ sessionId: nativeThreadId });
      expect(session.settings.sandbox).toBe('danger-full-access');
      expect(saved.get(session.id)).toMatchObject({ accessDefaultApplied: true, settings: { sandbox: 'danger-full-access' } });
      await migrated.send(session.id, { ...input(), ...session.settings });
      expect(next.calls[0]).toMatchObject({ method: 'thread/resume', params: { sandbox: 'danger-full-access', approvalPolicy: 'never' } });
      expect(next.calls[1]).toMatchObject({ method: 'turn/start', params: { sandboxPolicy: { type: 'dangerFullAccess' }, approvalPolicy: 'never' } });
      next.notify({ method: 'turn/completed', params: { threadId: nativeThreadId, turn: { status: 'completed' } } });
      await migrated.send(session.id, { ...input('Explicit access selection'), sandbox });
    } finally { migrated.dispose(); }

    const restarted = new AgentChatService(new Connection(), store, '/workspace');
    try {
      expect((await restarted.get(imported.id)).settings.sandbox).toBe(sandbox);
    } finally { restarted.dispose(); }
  });
  it('rejects invalid or active sessions, surfaces missing sessions, and permits retry after failure', async () => {
    const { service, connection } = fixture();
    const rpc = vi.spyOn(connection, 'request');
    try {
      await expect(service.resume({ sessionId: '../session.jsonl' })).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
      rpc.mockRejectedValueOnce(Error('Session not found'));
      await expect(service.resume({ sessionId: nativeThreadId })).rejects.toThrow('Session not found');
      rpc.mockResolvedValueOnce({ ...nativeResume(), thread: { ...nativeResume().thread, status: { type: 'active' } } });
      await expect(service.resume({ sessionId: nativeThreadId })).rejects.toThrow('active turn');
      expect(await service.list()).toHaveLength(0);
      rpc.mockResolvedValueOnce(nativeResume());
      expect((await service.resume({ sessionId: nativeThreadId })).items).toHaveLength(4);
    } finally { service.dispose(); }
  });
  it('defaults to YOLO and carries full access through sends, restart/resume, and Read Canvas', async () => {
    const { service, connection, store } = fixture();
    const session = await service.create({});
    expect(session.settings.sandbox).toBe('danger-full-access');
    expect(connection.calls[0]).toMatchObject({ method: 'thread/start', params: { sandbox: 'danger-full-access', approvalPolicy: 'never' } });
    expect(connection.calls[0].params.developerInstructions).toContain('only create highlights or generate highlight-reference Markdown markers when explicitly instructed');
    await service.send(session.id, { text: 'Hello', requestId: crypto.randomUUID() });
    expect(connection.calls.at(-1)).toMatchObject({ method: 'turn/start', params: { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } } });
    service.dispose();
    const resumedConnection = new Connection();
    const resumed = new AgentChatService(resumedConnection, store, '/workspace', { shortContextForCanvas: async () => canvasSnapshot() });
    try {
      await resumed.readCanvas(session.id, { canvas: { workspaceInstanceId: 'workspace', documentId: 'doc' }, requestId: crypto.randomUUID() });
      expect(resumedConnection.calls[0]).toMatchObject({ method: 'thread/resume', params: { sandbox: 'danger-full-access', approvalPolicy: 'never' } });
      expect(resumedConnection.calls[0].params.developerInstructions).toBe(connection.calls[0].params.developerInstructions);
      expect(resumedConnection.calls.at(-1)).toMatchObject({ method: 'turn/start', params: { input: [], approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } } });
    } finally { resumed.dispose(); }
  });
  it.each(['read-only', 'workspace-write'] as const)('honors an explicit %s selection instead of YOLO', async sandbox => {
    const { service, connection } = fixture();
    try {
      const session = await service.create({ sandbox });
      expect(connection.calls[0].params).toMatchObject({ sandbox, approvalPolicy: 'on-request' });
      await service.send(session.id, { ...input(), sandbox });
      expect(connection.calls.at(-1)?.params).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite' } });
    } finally { service.dispose(); }
  });

  it('registers native edit tools, routes calls with turn-bound canvas context, and returns structured failures', async () => {
    const call = vi.fn(async () => ({ runId: 'edit-1', status: 'generating' }));
    const tools: ChatTools = { definitions: [{ type: 'function', name: 'edit-diagram', description: 'Edit', inputSchema: { type: 'object' } }], call };
    const { service, connection } = fixture([], undefined, tools);
    const session = await service.create({});
    expect(connection.calls[0].params.dynamicTools).toEqual(tools.definitions);
    expect(session.canvasTools).toBe(true);
    const canvas = { workspaceInstanceId: 'workspace', documentId: 'doc' };
    await service.send(session.id, { ...input(), canvas });
    const params = { threadId: session.threadId, turnId: 'turn-1', callId: 'call-1', namespace: null, tool: 'edit-diagram', arguments: { reference: 1, prompt: 'Edit', requestId: 'r' } };
    connection.notify({ method: 'item/tool/call', id: 'native-1', params });
    await expect.poll(() => connection.replies.length).toBe(1);
    expect(call).toHaveBeenCalledWith('edit-diagram', params.arguments, expect.objectContaining({ id: session.id, canvasContext: { canvas, references: [] } }));
    expect(connection.replies[0]).toEqual({ id: 'native-1', result: { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ runId: 'edit-1', status: 'generating' }) }] } });
    connection.notify({ method: 'item/tool/call', id: 'native-2', params: { ...params, tool: 'unregistered' } });
    await expect.poll(() => connection.replies.length).toBe(2);
    expect(connection.replies[1].result).toMatchObject({ success: false });
    expect(call).toHaveBeenCalledTimes(1);
    service.dispose();
  });
  it('delivers pinned canvas references with a message and retains them across replay without duplicating a retry', async () => {
    const { service, connection, saved, store } = fixture();
    const session = await service.create({});
    const references = [{ canvas: { workspaceInstanceId: 'workspace', documentId: 'doc' }, canvasName: 'Services', displayNodeId: 'grid:overview',
      reference: { kind: 'diagram', label: 'Service', diagramId: 'diagram-1', revisionId: 'revision-1' }, ascii: 'Service\n\n`-- Child  ' }];
    const request = { ...input('Explain [ref 1]'), references };
    await service.send(session.id, request);
    await service.send(session.id, request);
    const turns = connection.calls.filter(call => call.method === 'turn/start');
    expect(turns).toHaveLength(1);
    const parts = turns[0].params.input as { type: string; text: string }[];
    expect(parts[0].text).toBe('Explain [ref 1]');
    expect(JSON.parse(parts[1].text.slice(parts[1].text.indexOf('\n') + 1))).toEqual([{ ref: 1, ...references[0] }]);
    expect(saved.get(session.id)?.items[0]).toMatchObject({ text: 'Explain [ref 1]', references });
    const restored = new AgentChatService(new Connection(), store, '/workspace');
    expect((await restored.get(session.id)).items[0].references).toEqual(references);
    service.dispose(); restored.dispose();
  });
  it('rejects oversized reference context before starting a turn', async () => {
    const { service, connection } = fixture();
    const session = await service.create({});
    const reference = { canvas: { workspaceInstanceId: 'workspace', documentId: 'doc' }, canvasName: 'Services', displayNodeId: 'grid:overview',
      reference: { kind: 'diagram', label: 'Service', diagramId: 'diagram-1', revisionId: 'revision-1' }, ascii: 'A'.repeat(60_000) };
    await expect(service.send(session.id, { ...input(), references: [reference, reference] })).rejects.toThrow('too large');
    expect(connection.calls.some(call => call.method === 'turn/start')).toBe(false);
    service.dispose();
  });
  const canvasSnapshot = (documentId = 'doc', version = 12) => ({
    apiFormatVersion: 1 as const, shortFormatVersion: 1 as const, view: 'short' as const,
    workspaceInstanceId: 'workspace', documentId, canvasEpoch: 'epoch', version, name: 'Canvas',
    diagrams: [], edges: [], groups: [], selections: [], otherNodes: [], detailsDeferred: []
  });
  const readInput = (documentId = 'doc') => ({ ...input(), canvas: { workspaceInstanceId: 'workspace', documentId } });
  it('delivers complete canvas tool output to the existing thread, with fresh targets and retry deduplication', async () => {
    const snapshot = { ...canvasSnapshot(), name: 'Large canvas ' + 'x'.repeat(130_000) };
    const read = vi.fn<ChatCanvasReader['shortContextForCanvas']>().mockResolvedValue(snapshot);
    const { service, connection, saved } = fixture([], { shortContextForCanvas: read });
    const first = await service.create({}), other = await service.create({});
    const request = readInput();
    await service.readCanvas(first.id, request);
    await service.readCanvas(first.id, request);
    expect(read).toHaveBeenCalledExactlyOnceWith('workspace', 'doc');
    const turn = connection.calls.find(call => call.method === 'turn/start')!;
    expect(turn.params).toMatchObject({ threadId: first.threadId, input: [], toolOutput: { name: 'read_canvas', namespace: null, output: JSON.stringify(snapshot) } });
    expect(turn.params).not.toHaveProperty('clientUserMessageId');
    await expect(service.readCanvas(first.id, readInput('other'))).rejects.toThrow('active turn');
    connection.notify({ method: 'item/completed', params: { threadId: first.threadId, turnId: 'turn-1', item: {
      id: 'canvas-tool', type: 'functionCallOutput', name: 'read_canvas', namespace: null, output: JSON.stringify(snapshot)
    } } });
    connection.notify({ method: 'turn/completed', params: { threadId: first.threadId, turn: { status: 'completed' } } });
    expect(saved.get(first.id)?.items).toEqual([expect.objectContaining({ kind: 'tool', title: 'Read Canvas', sourceType: 'functionCallOutput', status: 'completed', omittedChars: expect.any(Number) })]);
    expect((await service.get(other.id)).items).toEqual([]);
    expect(saved.get(first.id)?.title).toBe('Read Canvas');
    read.mockResolvedValue(canvasSnapshot('other', 14));
    await service.readCanvas(first.id, readInput('other'));
    expect(read).toHaveBeenLastCalledWith('workspace', 'other');
    expect(connection.calls.at(-1)?.params.toolOutput).toMatchObject({ output: JSON.stringify(canvasSnapshot('other', 14)) });
  });
  it('fails a missing canvas without starting a model turn, and allows the read to be retried', async () => {
    const read = vi.fn<ChatCanvasReader['shortContextForCanvas']>().mockRejectedValue(Error('CANVAS_NOT_READY'));
    const { service, connection } = fixture([], { shortContextForCanvas: read });
    const session = await service.create({}), request = readInput();
    await expect(service.readCanvas(session.id, request)).rejects.toThrow('CANVAS_NOT_READY');
    expect(connection.calls.some(call => call.method === 'turn/start')).toBe(false);
    expect(await service.get(session.id)).toMatchObject({ status: 'failed', activity: null, items: [], requestIds: [] });
    read.mockResolvedValue(canvasSnapshot());
    await service.readCanvas(session.id, request);
    expect(connection.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  });
  it('resumes old conversations for read-only canvas reads and does not replay an ambiguous model start', async () => {
    const read = vi.fn<ChatCanvasReader['shortContextForCanvas']>().mockResolvedValue(canvasSnapshot());
    const { service, store } = fixture();
    const session = await service.create({});
    const connection = new Connection(); connection.fail = true;
    const restored = new AgentChatService(connection, store, '/workspace', { shortContextForCanvas: read });
    const request = { ...readInput(), sandbox: 'read-only' };
    await expect(restored.readCanvas(session.id, request)).rejects.toThrow('turn failed');
    await restored.readCanvas(session.id, request);
    expect(read).toHaveBeenCalledTimes(1);
    expect(connection.calls[0]).toMatchObject({ method: 'thread/resume', params: { threadId: session.threadId } });
    expect(connection.calls.filter(call => call.method === 'turn/start')).toEqual([expect.objectContaining({ params: expect.objectContaining({ input: [], sandboxPolicy: { type: 'readOnly' } }) })]);
  });
  it('keeps streamed items, deduplicates requests, isolates threads, and preserves follow-up context', async () => {
    const { service, connection, saved } = fixture();
    const first = await service.create({}), second = await service.create({});
    const events: ChatEvent[] = [];
    await service.subscribe(first.id, event => events.push(structuredClone(event)));
    const send = input();
    await service.send(first.id, send);
    await service.send(first.id, send);
    await expect(service.send(first.id, input('overlap'))).rejects.toThrow('active turn');
    connection.notify({ method: 'item/agentMessage/delta', params: { threadId: first.threadId, itemId: 'a', delta: '**Hi' } });
    connection.notify({ method: 'item/agentMessage/delta', params: { threadId: first.threadId, itemId: 'a', delta: '** there' } });
    connection.notify({ method: 'item/completed', params: { threadId: first.threadId, item: { type: 'agentMessage', id: 'a', text: '**Hi** there' } } });
    connection.notify({ method: 'turn/completed', params: { threadId: first.threadId, turn: { status: 'completed' } } });
    expect((await service.get(first.id)).items.map(item => item.text)).toEqual(['Hello', '**Hi** there']);
    expect((await service.get(second.id)).items).toEqual([]);
    expect(saved.get(first.id)?.status).toBe('idle');
    expect(events.flatMap(event => event.type === 'batch' ? event.events : [event]).filter(event => event.type === 'delta')).toHaveLength(1);
    await service.send(first.id, input('Continue'));
    expect(connection.calls.filter(call => call.method === 'turn/start').map(call => call.params.threadId)).toEqual([first.threadId, first.threadId]);
  });
  it('routes approval and question responses to the original RPC and refuses cross-thread answers', async () => {
    const { service, connection } = fixture();
    const first = await service.create({}), other = await service.create({});
    connection.notify({ id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: first.threadId, command: 'npm test' } });
    const requestId = (await service.get(first.id)).pending[0].id;
    await expect(service.answer(other.id, requestId, { decision: 'accept' })).rejects.toThrow('no longer pending');
    await service.answer(first.id, requestId, { decision: 'decline' });
    expect(connection.replies).toEqual([{ id: 42, result: { decision: 'decline' } }]);
    connection.notify({ id: 'q', method: 'item/tool/requestUserInput', params: { threadId: first.threadId, questions: [{ id: 'color', question: 'Color?', header: 'Color' }] } });
    const questionId = (await service.get(first.id)).pending[0].id;
    await expect(service.answer(first.id, questionId, { answers: {} })).rejects.toThrow('every question');
    await service.answer(first.id, questionId, { answers: { color: ['blue'] } });
    expect(connection.replies[1]).toEqual({ id: 'q', result: { answers: { color: { answers: ['blue'] } } } });
  });
  it('clears stale approvals on disconnect and resumes the native thread after restart', async () => {
    const { service, connection, store } = fixture();
    const session = await service.create({});
    await service.send(session.id, input());
    connection.notify({ id: 1, method: 'item/fileChange/requestApproval', params: { threadId: session.threadId } });
    connection.exit('disconnected');
    expect((await service.get(session.id)).pending).toEqual([]);
    const newConnection = new Connection(), restored = new AgentChatService(newConnection, store, '/workspace');
    await restored.send(session.id, input('Continue'));
    expect(newConnection.calls[0]).toEqual({ method: 'thread/resume', params: expect.objectContaining({ threadId: session.threadId }) });
    await restored.interrupt(session.id);
    expect(newConnection.calls.at(-1)).toEqual({ method: 'turn/interrupt', params: { threadId: session.threadId, turnId: 'turn-1' } });
  });
  it('surfaces failed starts without replaying an ambiguous request', async () => {
    const { service, connection } = fixture();
    const session = await service.create({}); connection.fail = true;
    const request = input();
    await expect(service.send(session.id, request)).rejects.toThrow('turn failed');
    await service.send(session.id, request);
    expect((await service.get(session.id)).status).toBe('failed');
    expect(connection.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  });
  it('does not revive a turn that completed before turn/start returned', async () => {
    const { service, connection } = fixture();
    const session = await service.create({}); connection.completeBeforeReply = true;
    await service.send(session.id, input());
    expect((await service.get(session.id)).status).toBe('idle');
  });
  it('removes server-resolved requests and saves partial output on shutdown', async () => {
    const { service, connection, saved } = fixture();
    const session = await service.create({});
    await service.send(session.id, input());
    connection.notify({ id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: session.threadId } });
    connection.notify({ method: 'serverRequest/resolved', params: { threadId: session.threadId, requestId: 42 } });
    expect((await service.get(session.id)).pending).toEqual([]);
    connection.notify({ method: 'item/agentMessage/delta', params: { threadId: session.threadId, itemId: 'partial', delta: 'Partial response' } });
    service.dispose();
    expect(saved.get(session.id)?.status).toBe('interrupted');
    expect(saved.get(session.id)?.items.at(-1)?.text).toBe('Partial response');
  });
  it('retains protocol presentation fields, canonical completion and plan update history', async () => {
    const { service, connection, saved } = fixture();
    const session = await service.create({}); await service.send(session.id, input());
    const notify = (method: string, params: Record<string, unknown>) => connection.notify({ method, params: { threadId: session.threadId, turnId: 'turn-1', ...params } });
    notify('item/completed', { item: { id: 'read', type: 'commandExecution', command: 'cat a', commandActions: [{ type: 'read', name: 'a' }], exitCode: 0, durationMs: 12, aggregatedOutput: 'contents' } });
    notify('item/agentMessage/delta', { itemId: 'answer', delta: 'lost suffix' });
    notify('item/completed', { item: { id: 'answer', type: 'agentMessage', phase: 'commentary', text: 'Canonical answer' } });
    for (const status of ['inProgress', 'completed']) notify('turn/plan/updated', { explanation: 'Plan', plan: [{ step: 'Read code', status }] });
    notify('turn/completed', { turn: { status: 'completed' } });
    const result = saved.get(session.id)!;
    expect(result.schemaVersion).toBe(2);
    expect(result.items.find(item => item.id === 'read')).toMatchObject({ turnId: 'turn-1', command: { exitCode: 0, durationMs: 12, actions: [{ type: 'read', name: 'a' }] } });
    expect(result.items.find(item => item.id === 'answer')).toMatchObject({ phase: 'commentary', text: 'Canonical answer' });
    expect(result.items.filter(item => item.plan)).toHaveLength(2);
  });
  it('retains masked question history and distinguishes retries from terminal failures', async () => {
    const { service, connection, saved } = fixture();
    const session = await service.create({}); await service.send(session.id, input());
    connection.notify({ id: 'q', method: 'item/tool/requestUserInput', params: { threadId: session.threadId, questions: [{ id: 'secret', question: 'Token?', header: 'Token', isSecret: true }] } });
    await service.answer(session.id, (await service.get(session.id)).pending[0].id, { answers: { secret: ['do-not-store'] } });
    expect(JSON.stringify(saved.get(session.id))).not.toContain('do-not-store');
    expect(saved.get(session.id)?.items.at(-1)?.text).toContain('••••••');
    connection.notify({ method: 'error', params: { threadId: session.threadId, willRetry: true, error: { message: 'Temporary disconnect' } } });
    expect((await service.get(session.id)).activity).toContain('Retrying');
    expect((await service.get(session.id)).error).toBeNull();
  });

  it('clears completion metadata over the JSON wire when starting a follow-up', async () => {
    const { service, connection } = fixture();
    const session = await service.create({});
    let client = session;
    await service.subscribe(session.id, event => { client = reduceChatEvent(client, JSON.parse(JSON.stringify(event))); });
    await service.send(session.id, input());
    connection.notify({ method: 'turn/completed', params: { threadId: session.threadId, turn: { status: 'completed' } } });
    expect(client.completedAt).toBeTruthy();
    await service.send(session.id, input('Next turn'));
    expect(client.completedAt).toBeNull();
  });

});
