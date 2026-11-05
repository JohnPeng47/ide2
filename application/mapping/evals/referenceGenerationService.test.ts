import { describe, expect, it, vi } from 'vitest';
import { AgentChatService } from '../agent-chat/agentChatService';
import type { ChatStore, CodexConnection, CodexMessage } from '../agent-chat/ports';
import { DefaultCanvasHistoryService } from '../../../domain/core/diagrams/canvasHistoryService';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { referenceGenerationRounds, referenceSourcesConfirmation, referenceSourcesStatus, type ReferenceGenerationSession } from '../../../domain/mapping/evals/referenceGeneration';
import { ReferenceGenerationService } from './referenceGenerationService';

class Connection implements CodexConnection {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  notify: (message: CodexMessage) => void = () => {};
  async request<T>(method: string, params: Record<string, unknown>) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: `thread-${this.calls.length}` }, model: 'test-model' } as T;
    if (method === 'turn/start') return { turn: { id: 'turn' } } as T;
    return {} as T;
  }
  respond() {} reject() {} dispose() {}
  subscribe(notify: typeof this.notify) { this.notify = notify; return () => {}; }
  of(method: string) { return this.calls.filter(call => call.method === method); }
}
function fixture() {
  const connection = new Connection(), saved = new Map<string, ReferenceGenerationSession>();
  const chats: ChatStore = { list: async () => [], save: async () => {} };
  const chat = new AgentChatService(connection, chats, '/workspace');
  const scene = singleDiagramScene('Root\n|-- Parent\n|   `-- Child\n`-- Other'), document = mappingDocumentFromScene(scene), histories = new DefaultCanvasHistoryService();
  const history = histories.exportContext(histories.openContext(document, initialCanvasState()));
  const captureCanvas = vi.fn(async () => ({ history }));
  const service = new ReferenceGenerationService({ read: async id => saved.get(id) ?? null, save: async session => { saved.set(session.id, session); } }, chat, { captureCanvas });
  const box = scene.root.kind === 'container' ? scene.root.children[0] : scene.root, diagram = Object.values(scene.contents)[0];
  const open = { source: { documentId: 'doc', checkpointId: 'cp' }, boxId: box.id, revisionId: diagram.revisionId };
  return { connection, chat, service, captureCanvas, open, saved };
}
const request = (prompt: string) => ({ requestId: crypto.randomUUID(), excerpt: 'Parent\n`-- Child', prompt, count: 2 });

describe('ReferenceGenerationService', () => {
  it('seeds one read-only conversation with the diagram text alone', async () => {
    const { connection, service, open } = fixture();
    await service.open(open);
    const [start] = connection.of('thread/start');
    expect(start.params).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'never' });
    expect(start.params.dynamicTools).toBeUndefined();
    const injected = JSON.stringify(connection.of('thread/inject_items')[0].params);
    expect(injected).toContain('Root');
    expect(injected).not.toContain('AgentContext');
    expect(injected).not.toContain('evidence');
  });
  it('reuses the conversation for the same diagram revision, even when opened concurrently', async () => {
    const { connection, service, open, captureCanvas } = fixture();
    const [a, b] = await Promise.all([service.open(open), service.open(open)]);
    const c = await service.open(open);
    expect(new Set([a.chatId, b.chatId, c.chatId]).size).toBe(1);
    expect(connection.of('thread/start')).toHaveLength(1);
    expect(captureCanvas).toHaveBeenCalledTimes(1);
  });
  it('refuses a revision the canvas no longer holds', async () => {
    const { service, open } = fixture();
    await expect(service.open({ ...open, revisionId: 'diagram-revision-stale' })).rejects.toThrow('This diagram changed');
  });
  it('runs each generation as a further turn of that thread, without tools or approvals, and parses the stream', async () => {
    const { connection, chat, service, open } = fixture();
    const session = await service.open(open);
    await service.generate(session.id, request('more like this'));
    const held = await chat.get(session.chatId);
    connection.notify({ method: 'item/completed', params: { threadId: held.threadId, turnId: 'turn', item: { id: 'a1', type: 'agentMessage', text: '```text\nX\n`-- Y\n```', phase: 'final_answer' } } });
    connection.notify({ method: 'turn/completed', params: { threadId: held.threadId, turn: { id: 'turn', status: 'completed' } } });
    await service.generate(session.id, request('now smaller'));
    const turns = connection.of('turn/start');
    expect(turns).toHaveLength(2);
    expect(new Set(turns.map(turn => turn.params.threadId)).size).toBe(1);
    expect(turns[0].params).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } });
    expect(JSON.stringify(turns[1].params.input)).toContain('now smaller');
    const rounds = referenceGenerationRounds(await chat.get(session.chatId));
    expect(rounds.map(round => round.prompt)).toEqual(['more like this', 'now smaller']);
    expect(rounds[0].snippets).toEqual(['X\n`-- Y']);
  });
  it('keeps these conversations out of the Agent Chat list', async () => {
    const { chat, service, open } = fixture();
    await service.open(open);
    expect(await chat.list()).toEqual([]);
  });
  it('refuses a second generation while one is running, and retries of one request run once', async () => {
    const { connection, service, open } = fixture();
    const session = await service.open(open), first = request('p');
    await service.generate(session.id, first);
    await expect(service.generate(session.id, request('q'))).rejects.toThrow('already has an active turn');
    await service.generate(session.id, first);
    expect(connection.of('turn/start')).toHaveLength(1);
  });
  describe('Load Sources', () => {
    const files = { files: [{ path: 'a.ts', ranges: [[1, 2]] as [number, number][] }] };
    async function mapped(fixtureValue: ReturnType<typeof fixture>) {
      const session = await fixtureValue.service.open(fixtureValue.open), held = { ...session, sources: files };
      fixtureValue.saved.set(session.id, held);
      return held;
    }
    it('finishes only when the agent returns the confirmation of this request', async () => {
      const value = fixture(), { connection, chat, service } = value, session = await mapped(value), requestId = crypto.randomUUID();
      await service.loadSources(session.id, { requestId });
      const held = await chat.get(session.chatId);
      expect(JSON.stringify(connection.of('turn/start')[0].params.input)).toContain(referenceSourcesConfirmation(requestId));
      expect(referenceSourcesStatus(held).state).toBe('loading');
      connection.notify({ method: 'item/completed', params: { threadId: held.threadId, turnId: 'turn', item: { id: 'c1', type: 'commandExecution', command: 'git show', status: 'completed', aggregatedOutput: 'x' } } });
      connection.notify({ method: 'item/completed', params: { threadId: held.threadId, turnId: 'turn', item: { id: 'a1', type: 'agentMessage', phase: 'final_answer', text: `Read a.ts.\n${referenceSourcesConfirmation(requestId)}` } } });
      expect(referenceSourcesStatus(await chat.get(session.chatId)).state).toBe('loading');
      connection.notify({ method: 'turn/completed', params: { threadId: held.threadId, turn: { id: 'turn', status: 'completed' } } });
      expect(referenceSourcesStatus(await chat.get(session.chatId)).state).toBe('loaded');
      await service.loadSources(session.id, { requestId: crypto.randomUUID() });
      expect(connection.of('turn/start')).toHaveLength(1);
    });
    it('cannot start alongside a generation, and a retried request runs once', async () => {
      const value = fixture(), { connection, service } = value, session = await mapped(value), retried = { requestId: crypto.randomUUID() };
      await service.loadSources(session.id, retried);
      await service.loadSources(session.id, retried);
      await expect(service.generate(session.id, request('p'))).rejects.toThrow('already has an active turn');
      expect(connection.of('turn/start')).toHaveLength(1);
    });
    it('refuses a diagram with no mapped files', async () => {
      const { service, open } = fixture(), session = await service.open(open);
      expect(session.sources?.files).toEqual([]);
      await expect(service.loadSources(session.id, { requestId: crypto.randomUUID() })).rejects.toThrow('No source files');
    });
    it('replaces a stored session that was seeded with source evidence', async () => {
      const value = fixture(), { connection, service, open, saved } = value, session = await service.open(open);
      const { sources: _sources, ...old } = session;
      saved.set(session.id, old as never);
      const reopened = await service.open(open);
      expect(reopened.chatId).not.toBe(session.chatId);
      expect(reopened.sources).toEqual({ files: [] });
      expect(connection.of('thread/start')).toHaveLength(2);
    });
    it('reuses loaded sources: reopening keeps the status, and loading again starts no turn', async () => {
      const value = fixture(), { connection, chat, service, open } = value, session = await mapped(value), requestId = crypto.randomUUID();
      await service.loadSources(session.id, { requestId });
      const held = await chat.get(session.chatId);
      connection.notify({ method: 'item/completed', params: { threadId: held.threadId, turnId: 'turn', item: { id: 'c1', type: 'commandExecution', command: 'git show', status: 'completed', aggregatedOutput: 'x' } } });
      connection.notify({ method: 'item/completed', params: { threadId: held.threadId, turnId: 'turn', item: { id: 'a1', type: 'agentMessage', phase: 'final_answer', text: referenceSourcesConfirmation(requestId) } } });
      connection.notify({ method: 'turn/completed', params: { threadId: held.threadId, turn: { id: 'turn', status: 'completed' } } });
      const reopened = await service.open(open);
      expect(reopened.chatId).toBe(session.chatId);
      expect(referenceSourcesStatus(await chat.get(reopened.chatId)).state).toBe('loaded');
      await service.loadSources(reopened.id, { requestId: crypto.randomUUID() });
      expect(connection.of('turn/start')).toHaveLength(1);
    });
  });
});
