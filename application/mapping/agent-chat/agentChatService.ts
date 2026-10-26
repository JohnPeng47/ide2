import { genAlternativesSchema, generationRunning, type CanvasGeneration } from '../../../domain/core/diagrams/canvasGeneration';
import type { GenerationCanvasBridge } from './generationCanvasBridge';
import type { CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import { agentChatSystemPrompt } from './agentChatPrompt';
import { ApplicationError } from '../../core/errors';
import { chatAnswerSchema, chatReadCanvasSchema, chatResumeSchema, chatSendSchema, chatSettingsSchema, findChatItem, reduceChatEvent, type ChatCanvasTarget, type ChatSend, type ChatEvent, type ChatInfo, type ChatItem, type ChatQuestion, type ChatSession, type ChatSessionSummary, type ChatUpdate } from '../../../domain/mapping/agent-chat/agentChat';
import type { ChatMcpBinding, ChatCanvasReader, ChatStore, ChatTools, CodexConnection, CodexMessage } from './ports';

import { presentNativeItem, printable, record, string } from './chatPresentation';

export class AgentChatService {
  private sessions = new Map<string, ChatSession>();
  private loaded: Promise<void>;
  private resumed = new Set<string>();
  private importing = new Map<string, Promise<ChatSession>>();
  private listeners = new Map<string, Set<(event: ChatEvent) => void>>();
  private requests = new Map<string, { wireId: string | number; method: string; params: Record<string, unknown> }>();
  private starting = new Map<string, Promise<void>>();
  private reloading = new Map<string, Promise<void>>();
  private generating = new Map<string, Promise<unknown>>();
  private settlingGenerations = new Map<string, Promise<void>>();
  private syncedGenerations = new Set<string>();
  private toolSnapshots = new Map<string, ChatTools['definitions']>();
  private unsubscribe: () => void;
  private deltaBuffers = new Map<string, { events: Extract<ChatUpdate, { type: 'delta' }>[]; timer: ReturnType<typeof setTimeout> }>();
  private threadSessions = new Map<string, string>();
  constructor(private connection: CodexConnection, private store: ChatStore, private cwd: string, private canvasReader?: ChatCanvasReader, private tools?: ChatTools, private mcp?: ChatMcpBinding, private generationBridge?: GenerationCanvasBridge) {
    this.loaded = store.list().then(async sessions => {
      for (const session of sessions) {
        // Upgrade earlier imports once. Later explicit access selections stay saved.
        const migrateAccess = session.origin === 'codex' && !session.accessDefaultApplied;
        if (migrateAccess) {
          session.settings = { ...session.settings, sandbox: 'danger-full-access' };
          session.accessDefaultApplied = true;
        }
        this.threadSessions.set(session.threadId, session.id);
        if (session.generation && generationRunning(session.generation.metadata)) {
          session.generation.metadata = { ...session.generation.metadata, status: 'failed', completedAt: new Date().toISOString(), error: 'Server restarted during generation. Start a new generation to retry.' };
        }
        this.sessions.set(session.id, { ...session, schemaVersion: 2, pending: [], activity: null,
          items: session.items.map(item => item.status === 'inProgress' ? { ...item, status: 'interrupted' } : item),
          ...(session.status === 'running' ? { status: 'interrupted', error: 'Server restarted. Send a message to resume.' } : {}) });
        if (migrateAccess || session.generation) await store.save(this.sessions.get(session.id)!);
      }
    });
    // A failed store is surfaced by every public operation, without an unhandled rejection at startup.
    void this.loaded.catch(() => {});
    this.unsubscribe = connection.subscribe(message => this.receive(message), error => {
      this.resumed.clear(); this.requests.clear();
      for (const id of this.sessions.keys()) this.mcp?.clear(id);
      for (const session of this.sessions.values()) if (session.status === 'running' || generationRunning(session.generation?.metadata)) {
        this.flushDeltas(session.id); this.settleOpenItems(session.id); this.resolvePending(session.id, 'interrupted');
        this.emit(session.id, { type: 'state', patch: { status: 'failed', pending: [], activity: null, error } }); this.persist(session.id);
        if (session.generation) void this.finishGeneration(session.id).catch(() => {});
      }
    });
  }
  setMcpOrigin(origin: string) { this.mcp?.setOrigin(origin); }
  async info(): Promise<ChatInfo> {
    const models: ChatInfo['models'] = [];
    let cursor: string | null = null;
    do {
      const page: { data: Record<string, unknown>[]; nextCursor: string | null } = await this.connection.request('model/list', { cursor, limit: 100 });
      for (const model of page.data) if (!model.hidden) models.push({ id: string(model.model), name: string(model.displayName),
        efforts: (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : []).map(option => string(record(option).reasoningEffort)),
        defaultEffort: string(model.defaultReasoningEffort), isDefault: model.isDefault === true });
      cursor = page.nextCursor;
    } while (cursor);
    const auth = await this.connection.request<{ account: { type: string; email?: string } | null }>('account/read', {});
    return { cwd: this.cwd, models, account: auth.account ? auth.account.email || auth.account.type : 'Not signed in — run codex login on the server' };
  }
  async list(): Promise<ChatSessionSummary[]> {
    await this.loaded;
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, cwd, updatedAt, status, settings, generation }) => ({ id, title, cwd, updatedAt, status, settings, ...(generation ? { parentChatId: generation.metadata.parentChatId } : {}) }));
  }
  async get(id: string) { await this.loaded; const session = this.sessions.get(id); if (!session) throw new ApplicationError('invalid-input', 'Chat session not found.'); this.flushDeltas(id); return this.sessions.get(id)!; }
  async create(input: unknown) {
    await this.loaded;
    const settings = chatSettingsSchema.parse(input);
    const chatId = crypto.randomUUID();
    const result = await this.connection.request<{ thread: { id: string }; model: string }>('thread/start', {
      developerInstructions: agentChatSystemPrompt(settings.sandbox === 'read-only'), ...(this.mcp ? { config: this.mcp.config(chatId) } : {}),
      cwd: this.cwd, model: settings.model || undefined, sandbox: settings.sandbox, approvalPolicy: settings.sandbox === 'danger-full-access' ? 'never' : 'on-request', approvalsReviewer: 'user',
      ...(this.tools ? { dynamicTools: this.tools.definitions } : {})
    });
    const now = new Date().toISOString();
    const session: ChatSession = { schemaVersion: 2, canvasTools: !!this.tools, toolDefinitions: structuredClone(this.tools?.definitions), id: chatId, threadId: result.thread.id, title: 'New conversation', cwd: this.cwd,
      createdAt: now, updatedAt: now, settings: { ...settings, model: result.model || settings.model }, status: 'idle', items: [], pending: [], requestIds: [] };
    await this.store.save(session); this.sessions.set(session.id, session); this.threadSessions.set(session.threadId, session.id); this.resumed.add(session.threadId);
    return session;
  }
  async resume(input: unknown): Promise<ChatSession> {
    await this.loaded;
    const { sessionId: threadId } = chatResumeSchema.parse(input);
    const existing = this.threadSessions.get(threadId);
    if (existing) return this.get(existing);
    const pending = this.importing.get(threadId);
    if (pending) return pending;
    const run = this.importThread(threadId);
    this.importing.set(threadId, run);
    try { return await run; } finally { this.importing.delete(threadId); }
  }
  private async importThread(threadId: string): Promise<ChatSession> {
    // Native resume restores the saved base prompt, tools, cwd and model. Do not
    // replace its developer instructions or register tools owned by another client.
    const result = await this.connection.request<{
      thread: { id: string; name?: string; preview?: string; cwd: string; createdAt: number; status?: { type: string }; turns: Record<string, unknown>[] };
      model: string; reasoningEffort?: string;
    }>('thread/resume', { threadId, sandbox: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user' });
    const thread = result.thread;
    if (thread.status?.type === 'active') throw new ApplicationError('conflict', 'This Codex session has an active turn. Wait for it to finish before resuming here.');
    const items: ChatItem[] = thread.turns.flatMap(turn => (Array.isArray(turn.items) ? turn.items : []).map(native => {
      const item = presentNativeItem(record(native), string(turn.id), true);
      return item.status === 'inProgress' ? { ...item, status: 'interrupted' } : item;
    }));
    const now = new Date().toISOString();
    const session: ChatSession = {
      schemaVersion: 2, origin: 'codex', accessDefaultApplied: true, canvasTools: false, id: crypto.randomUUID(), threadId: thread.id,
      title: (thread.name || thread.preview || items.find(item => item.kind === 'user')?.text || 'Resumed Codex session').slice(0, 70),
      cwd: thread.cwd, createdAt: new Date(thread.createdAt * 1000).toISOString(), updatedAt: now,
      settings: { model: result.model, effort: result.reasoningEffort || '', sandbox: 'danger-full-access' },
      status: 'idle', items, pending: [], requestIds: []
    };
    await this.store.save(session);
    this.sessions.set(session.id, session); this.threadSessions.set(session.threadId, session.id); this.resumed.add(session.threadId);
    return session;
  }
  async toolDefinitions(token: string) {
    const id = this.mcp?.chatId(token);
    if (!id) throw new ApplicationError('invalid-input', 'Invalid Agent Chat tool binding.');
    await this.loaded;
    if (!this.tools) throw new ApplicationError('invalid-input', 'Agent Chat tools are unavailable.');
    return this.toolSnapshots.get(id) ?? this.sessions.get(id)?.toolDefinitions ?? this.tools.definitions;
  }
  async callBoundTool(token: string, name: string, input: unknown, callId: string) {
    await this.toolDefinitions(token);
    const session = await this.get(this.mcp!.chatId(token)!);
    if (session.status !== 'running' || !session.canvasTools || this.reloading.has(session.id))
      throw new ApplicationError('conflict', 'Agent Chat tool calls require an active conversation turn.');
    if (!(session.toolDefinitions ?? this.tools!.definitions).some(tool => tool.name === name)) throw new ApplicationError('invalid-input', 'Unknown Agent Chat tool.');
    return this.dispatchTool(name, input, session, structuredClone({ id: session.id, settings: session.settings,
      canvasContext: session.canvasContext, toolCallId: JSON.stringify([session.turnId, callId]) }));
  }
  private dispatchTool(name: string, input: unknown, session: ChatSession, context: import('./ports').ChatToolSession) {
    if (name === 'gen-alternatives') return this.genAlternatives(session.id, input);
    return this.tools!.call(name, input, context);
  }
  async genAlternatives(id: string, raw: unknown, target?: ChatCanvasTarget): Promise<Pick<import('../../../domain/mapping/agent-chat/agentChat').ChatGenerationRequest, 'requestId' | 'runId' | 'candidates'>> {
    const parent = structuredClone(await this.get(id)), input = genAlternativesSchema.parse(raw);
    if (parent.generation) throw Error('Generate alternatives from the parent chat; nested generation is not enabled');
    if (parent.settings.sandbox === 'read-only') throw Error('Generation requires Workspace access');
    if (!this.generationBridge || !this.mcp || !this.tools || !parent.canvasTools) throw Error('Generation tools are unavailable; reload this chat’s tools');
    if (!parent.items.some(item => item.kind === 'user')) throw Error('Send a message in the source AgentChat before generating alternatives');
    const source = target ?? parent.canvasContext?.canvas;
    if (!source) throw Error('Open a canvas and send a message before generating alternatives');
    const signature = JSON.stringify({ input, source }), prior = parent.generationRequests?.find(request => request.requestId === input.requestId);
    if (prior) {
      if (prior.signature !== signature) throw Error('REQUEST_ID_CONFLICT: generation arguments differ');
      if (prior.error) throw Error(prior.error);
      return { requestId: prior.requestId, runId: prior.runId, candidates: prior.candidates };
    }
    const key = `${id}:${input.requestId}`;
    const pending = this.generating.get(key);
    if (pending) { await pending; return this.genAlternatives(id, raw, target); }
    const prepare = async () => {
      const runId = crypto.randomUUID(), startedAt = new Date().toISOString();
      const trigger = [...parent.items].reverse().find(item => item.kind === 'user');
      const candidates = input.alternatives.map(item => ({ ...item, id: `canvas-view-${crypto.randomUUID()}`, chatId: crypto.randomUUID() }));
      const identity = await this.generationBridge!.dispatch(source.workspaceInstanceId, { method: 'identity', documentId: source.documentId }) as { version: number };
      const metadata = (candidate: typeof candidates[number]): CanvasGeneration => ({ runId, chatId: candidate.chatId, parentChatId: id,
        ...(parent.turnId ? { parentTurnId: parent.turnId } : {}), ...(target ? {} : { triggerMessageId: trigger?.id }),
        triggerPrompt: target ? input.prompt : trigger!.text, taskPrompt: input.prompt, prompt: candidate.prompt, model: parent.settings.model, effort: parent.settings.effort,
        status: 'queued', startedAt });
      const receipt = { requestId: input.requestId, signature, runId, candidates: candidates.map(candidate => ({ viewId: candidate.id, chatId: candidate.chatId, name: candidate.name })) };
      for (const candidate of candidates) {
        const child: ChatSession = { schemaVersion: 2, id: candidate.chatId, threadId: `pending-${candidate.chatId}`, origin: 'codex', canvasTools: true,
          title: candidate.name, cwd: parent.cwd, createdAt: startedAt, updatedAt: startedAt, settings: { ...parent.settings }, status: 'idle',
          items: [], pending: [], requestIds: [], toolDefinitions: structuredClone(parent.toolDefinitions ?? this.tools!.definitions),
          generation: { metadata: metadata(candidate), source, stableWorkspaceId: this.generationBridge!.list().find(canvas => canvas.canvasId === source.workspaceInstanceId)?.stableWorkspaceId, viewId: candidate.id, parentViewId: input.viewId } };
        this.sessions.set(child.id, child); await this.store.save(child);
      }
      const current = this.sessions.get(id)!;
      current.generationRequests = [...(current.generationRequests ?? []), receipt]; await this.store.save(current);
      let history: CanvasHistoryRecord;
      try {
        history = await this.generationBridge!.dispatch(source.workspaceInstanceId, { method: 'canvas-generation', documentId: source.documentId,
        payload: { operation: 'start', requestId: `generation:${runId}`, expectedVersion: identity.version, viewId: input.viewId,
          candidates: candidates.map(candidate => ({ id: candidate.id, name: candidate.name, generation: metadata(candidate) })) } }) as CanvasHistoryRecord;
        for (const candidate of candidates) {
          const child = this.sessions.get(candidate.chatId)!;
          child.generation!.history = history; await this.store.save(child);
        }
      } catch (error) {
        (receipt as import('../../../domain/mapping/agent-chat/agentChat').ChatGenerationRequest).error = String(error);
        await this.store.save(this.sessions.get(id)!);
        await Promise.allSettled(candidates.map(async candidate => {
          this.emit(candidate.chatId, { type: 'state', patch: { status: 'failed', error: String(error) } });
          await this.finishGeneration(candidate.chatId);
        }));
        throw error;
      }
      // Schedule all starts together. Each child has a distinct thread, MCP binding and controller.
      void Promise.allSettled(candidates.map(candidate => this.launchGeneration(candidate.chatId, parent, input.prompt)));
      return { requestId: receipt.requestId, runId: receipt.runId, candidates: receipt.candidates };
    };
    const promise = prepare(); this.generating.set(key, promise);
    try { return await promise; } finally { this.generating.delete(key); }
  }
  private async launchGeneration(id: string, parent: ChatSession, sharedPrompt: string) {
    const initial = this.sessions.get(id)!;
    try {
      this.toolSnapshots.set(id, initial.toolDefinitions!);
      const config = { ...this.mcp!.config(id), ...(parent.settings.effort ? { model_reasoning_effort: parent.settings.effort } : {}) };
      const result = await this.connection.request<{ thread: { id: string }; model: string; reasoningEffort?: string }>('thread/fork', {
        threadId: parent.threadId, ...(parent.status === 'running' && parent.turnId ? { beforeTurnId: parent.turnId } : parent.turnId ? { lastTurnId: parent.turnId } : {}),
        model: parent.settings.model || undefined, cwd: parent.cwd, config, deferGoalContinuation: true,
        sandbox: parent.settings.sandbox, approvalPolicy: parent.settings.sandbox === 'danger-full-access' ? 'never' : 'on-request', approvalsReviewer: 'user' });
      const child = this.sessions.get(id)!;
      child.threadId = result.thread.id;
      child.settings = { ...parent.settings, model: parent.settings.model || result.model, effort: parent.settings.effort || result.reasoningEffort || '' };
      child.generation!.metadata = { ...child.generation!.metadata, model: child.settings.model, effort: child.settings.effort };
      this.threadSessions.set(child.threadId, id); this.resumed.add(child.threadId);
      await this.store.save(child);
      // A candidate is one managed turn; an inherited goal must not continue it.
      await this.connection.request('thread/goal/clear', { threadId: child.threadId, origin: 'automatic' });
      if (child.generation!.metadata.status === 'cancelled') {
        await this.connection.request('thread/unsubscribe', { threadId: child.threadId });
        this.resumed.delete(child.threadId); return;
      }
      const canvas = this.generationBridge!.add(`generation-${id}`, child.title, child.generation!.history!, async history => {
        const current = this.sessions.get(id)!; current.generation!.history = history; await this.store.save(current);
      });
      this.emit(id, { type: 'state', patch: { generation: { ...child.generation!, metadata: { ...child.generation!.metadata, status: 'generating' } } } });
      await this.syncGeneration(id);
      const text = `Generate this single canvas alternative. Edit only your automatically bound canvas; it is isolated from the parent and other candidates. Read it before editing. Use the inherited diagram tools directly. Do not create more forks or call gen-alternatives. The application saves your completed result automatically.\n\nOriginal triggering prompt:\n${child.generation!.metadata.triggerPrompt}\n\nCaptured source references (context only; read your bound canvas for current editable IDs):\n${JSON.stringify(parent.canvasContext?.references ?? [])}\n\nShared generation task:\n${sharedPrompt}\n\nCandidate ${child.title}:\n${child.generation!.metadata.prompt}`;
      if (!generationRunning(this.sessions.get(id)!.generation!.metadata)) return;
      await this.startTurn(id, { ...child.settings, text, requestId: crypto.randomUUID(), canvas });
    } catch (error) {
      const child = this.sessions.get(id)!;
      if (child.generation!.metadata.status === 'cancelled') return;
      this.emit(id, { type: 'state', patch: { status: 'failed', error: String(error) } });
      await this.finishGeneration(id);
    } finally { this.toolSnapshots.delete(id); }
  }
  private async syncGeneration(id: string, history?: CanvasHistoryRecord) {
    const child = this.sessions.get(id)!, generation = structuredClone(child.generation!);
    if (generation.stableWorkspaceId && !this.generationBridge!.list().some(canvas => canvas.canvasId === generation.source.workspaceInstanceId)) {
      const matches = this.generationBridge!.list().filter(canvas => canvas.stableWorkspaceId === generation.stableWorkspaceId && canvas.documents.some(doc => doc.documentId === generation.source.documentId));
      if (matches.length !== 1) throw Error('Reopen the source canvas to save generation results');
      generation.source.workspaceInstanceId = matches[0].canvasId;
      child.generation!.source = generation.source;
    }
    const requestId = `${generation.metadata.runId}:${id}:${generation.metadata.status}`;
    await this.generationBridge!.dispatch(generation.source.workspaceInstanceId, { method: 'canvas-generation', documentId: generation.source.documentId,
      payload: { operation: 'update', requestId, viewId: generation.viewId, generation: generation.metadata, ...(history ? { history } : {}) } });
  }
  private async finishGeneration(id: string) {
    if (this.syncedGenerations.has(id)) return;
    const pending = this.settlingGenerations.get(id); if (pending) return pending;
    const run = async () => {
      const child = this.sessions.get(id)!;
      const now = new Date().toISOString(), metadata = child.generation!.metadata;
      const final: CanvasGeneration = { ...metadata, status: metadata.status === 'cancelled' || child.status === 'interrupted' ? 'cancelled' : child.status === 'idle' ? 'finished' : 'failed',
        completedAt: metadata.completedAt ?? now, durationMs: Math.max(0, Date.parse(metadata.completedAt ?? now) - Date.parse(metadata.startedAt)),
        ...(child.error ? { error: child.error } : {}) };
      const history = this.generationBridge?.history(`generation-${id}`) ?? child.generation!.history;
      this.emit(id, { type: 'state', patch: { generation: { ...child.generation!, metadata: final, history } } });
      await this.store.save(this.sessions.get(id)!);
      try { await this.syncGeneration(id, final.status === 'finished' ? history : undefined); this.syncedGenerations.add(id); }
      catch (error) { this.emit(id, { type: 'state', patch: { error: `Result retained; waiting to save to the canvas: ${String(error)}` } }); this.persist(id); }
      finally {
        this.mcp?.clear(id); this.generationBridge?.remove(`generation-${id}`);
        this.resumed.delete(child.threadId);
        if (!child.threadId.startsWith('pending-')) await this.connection.request('thread/unsubscribe', { threadId: child.threadId }).catch(() => {});
      }
    };
    const promise = run(); this.settlingGenerations.set(id, promise);
    try { await promise; } finally { this.settlingGenerations.delete(id); }
  }
  async generations(source: ChatCanvasTarget) {
    await this.loaded;
    const stable = this.generationBridge?.list().find(canvas => canvas.canvasId === source.workspaceInstanceId)?.stableWorkspaceId;
    const children = [...this.sessions.values()].filter(child => child.generation?.source.documentId === source.documentId &&
      (child.generation.source.workspaceInstanceId === source.workspaceInstanceId || stable && child.generation.stableWorkspaceId === stable));
    // Reconcile terminal states after a browser reconnect; publication is idempotent.
    await Promise.allSettled(children.filter(child => !generationRunning(child.generation!.metadata) && !this.syncedGenerations.has(child.id)).map(async child => {
      await this.syncGeneration(child.id, child.generation!.metadata.status === 'finished' ? child.generation!.history : undefined);
      this.syncedGenerations.add(child.id);
    }));
    return children.map(child => ({ viewId: child.generation!.viewId, ...child.generation!.metadata,
      pendingSave: !generationRunning(child.generation!.metadata) && !this.syncedGenerations.has(child.id),
      waitingForInput: child.pending.length > 0 }));
  }
  async cancelGeneration(id: string) {
    const child = await this.get(id);
    if (!child.generation || !generationRunning(child.generation.metadata)) return;
    this.emit(id, { type: 'state', patch: { generation: { ...child.generation, metadata: { ...child.generation.metadata, status: 'cancelled' } } } });
    await this.interrupt(id);
    this.emit(id, { type: 'state', patch: { status: 'interrupted' } });
    await this.finishGeneration(id);
  }
  async reloadTools(id: string) {
    const session = await this.get(id);
    if (this.reloading.has(id)) return this.reloading.get(id)!;
    if (session.status === 'running' || this.starting.has(id))
      throw new ApplicationError('conflict', 'Wait for the current turn to finish before reloading tools.');
    if (!this.tools || !this.mcp)
      throw new ApplicationError('invalid-input', 'Agent Chat tool reload is unavailable in this runtime.');
    const run = async () => {
      // Native dynamicTools are fixed at thread/start. Refresh the current definitions
      // through the thread's existing MCP connection, retaining the thread and its history.
      this.toolSnapshots.set(id, structuredClone(this.tools!.definitions));
      this.resumed.delete(session.threadId);
      await this.connection.request('thread/unsubscribe', { threadId: session.threadId });
      const resumed = await this.connection.request<{ thread?: { status?: { type: string } } }>('thread/resume', { threadId: session.threadId, cwd: session.cwd,
        ...(session.origin === 'codex' ? {} : { developerInstructions: agentChatSystemPrompt(session.settings.sandbox === 'read-only') }), config: this.mcp!.config(id, true),
        sandbox: session.settings.sandbox, approvalPolicy: session.settings.sandbox === 'danger-full-access' ? 'never' : 'on-request', approvalsReviewer: 'user' });
      if (resumed.thread?.status?.type === 'active') throw new ApplicationError('conflict', 'This Codex thread is active in another client. Wait for it to finish before reloading tools.');
      this.resumed.add(session.threadId);
      await this.connection.request('config/mcpServer/reload', {});
      const inventory = await this.connection.request<{ data: { name: string; tools: Record<string, unknown> }[] }>('mcpServerStatus/list',
        { threadId: session.threadId, serverName: 'mapping' });
      const available = inventory.data?.find(server => server.name === 'mapping')?.tools ?? {};
      if (this.tools!.definitions.some(tool => !Object.hasOwn(available, `chat_${tool.name}`)))
        throw new Error('The refreshed Agent Chat tools are not available yet. Try Reload tools again.');
      await this.connection.request('thread/inject_items', { threadId: session.threadId, items: [{
        type: 'message', role: 'developer', content: [{ type: 'input_text',
          text: 'Agent Chat tools have been reloaded. Use the current chat_* tools from the mapping MCP server instead of the earlier native diagram tools. Their schemas and descriptions supersede the earlier definitions. Each chat_ tool has the same purpose as its unprefixed name. Discover the current tool definitions before calling them.' }]
      }] });
      const patch = { canvasTools: true, toolsReloadedAt: new Date().toISOString() };
      this.sessions.get(id)!.toolDefinitions = structuredClone(this.tools!.definitions);
      await this.store.save({ ...this.sessions.get(id)!, ...patch });
      this.emit(id, { type: 'state', patch });
      this.toolSnapshots.delete(id);
    };
    const pending = run(); this.reloading.set(id, pending);
    try { await pending; } finally { this.reloading.delete(id); this.toolSnapshots.delete(id); }
  }
  async send(id: string, input: unknown) {
    if ((await this.get(id)).generation) throw Error('Generated chat sessions are retained for review. Start a new generation to iterate.');
    return this.startTurn(id, chatSendSchema.parse(input));
  }
  async readCanvas(id: string, input: unknown) {
    if ((await this.get(id)).generation) throw Error('Generated chat sessions are retained for review. Start a new generation to iterate.');
    const data = chatReadCanvasSchema.parse(input);
    return this.startTurn(id, { ...data, text: 'Read Canvas' }, data.canvas);
  }
  private async startTurn(id: string, data: ChatSend, canvas?: ChatCanvasTarget) {
    const session = await this.get(id);
    if (session.requestIds.includes(data.requestId)) return;
    if (session.status === 'running' || this.starting.has(id) || this.reloading.has(id)) throw new ApplicationError('conflict', 'This conversation already has an active turn.');
    const run = async () => {
      this.emit(id, { type: 'state', patch: { status: 'running', error: null, activity: null, completedAt: null, turnStartedAt: new Date().toISOString(), turnId: null, settings: chatSettingsSchema.parse(data) } });
      try {
        let toolOutput: { name: string; namespace: null; output: string } | undefined;
        if (canvas) {
          if (!this.canvasReader) throw new ApplicationError('invalid-input', 'Canvas reading is unavailable.');
          this.emit(id, { type: 'state', patch: { activity: 'Reading canvas' } });
          const context = await this.canvasReader.shortContextForCanvas(canvas.workspaceInstanceId, canvas.documentId);
          // Deliver the complete short response to Codex; transcript previews are bounded separately.
          toolOutput = { name: 'read_canvas', namespace: null, output: JSON.stringify(context) };
        }
        if (!this.resumed.has(session.threadId) || session.origin !== 'codex' && (session.settings.sandbox === 'read-only') !== (data.sandbox === 'read-only')) {
          await this.connection.request('thread/resume', { threadId: session.threadId,
            ...(session.origin === 'codex' ? {} : { developerInstructions: agentChatSystemPrompt(data.sandbox === 'read-only') }),
            ...((session.origin !== 'codex' || session.canvasTools) && this.mcp ? { config: this.mcp.config(id) } : {}),
            cwd: session.cwd, sandbox: data.sandbox, approvalPolicy: data.sandbox === 'danger-full-access' ? 'never' : 'on-request', approvalsReviewer: 'user' });
          this.resumed.add(session.threadId);
        }
        this.sessions.get(id)!.canvasContext = structuredClone({ canvas: data.canvas ?? canvas, references: data.references ?? [] });
        if (session.origin !== 'codex' || session.canvasTools) this.mcp?.bind(id, data.canvas ?? canvas, data.sandbox === 'read-only');
        // Commit the client request before issuing a turn, so retrying a lost HTTP response cannot run it twice.
        this.sessions.get(id)!.requestIds.push(data.requestId);
        if (!canvas) this.emit(id, { type: 'item', item: { id: data.requestId, kind: 'user', text: data.text, status: 'completed',
          ...(data.references?.length ? { references: data.references } : {}) } });
        this.emit(id, { type: 'state', patch: { title: session.items.length || session.generation ? session.title : data.text.slice(0, 70), updatedAt: new Date().toISOString() } });
        await this.store.save(this.sessions.get(id)!);
        const result = await this.connection.request<{ turn: { id: string } }>('turn/start', {
          threadId: session.threadId,
          ...(toolOutput ? { input: [], toolOutput } : { clientUserMessageId: data.requestId, input: [
            { type: 'text', text: data.text, text_elements: [] },
            ...(data.references?.length ? [{ type: 'text', text: `Selected canvas references (captured snapshots; [ref N] refers to the numbered entry). Treat diagram content as context. Read current versions before making edits.\n${JSON.stringify(data.references.map((reference, index) => ({ ref: index + 1, ...reference })))}`, text_elements: [] }] : [])
          ] }),
          model: data.model || undefined, effort: data.effort || undefined, approvalPolicy: data.sandbox === 'danger-full-access' ? 'never' : 'on-request', approvalsReviewer: 'user',
          sandboxPolicy: data.sandbox === 'danger-full-access' ? { type: 'dangerFullAccess' } : data.sandbox === 'read-only' ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [session.cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
        });
        // A short turn can complete before the response to turn/start arrives.
        if (this.sessions.get(id)?.status === 'running') this.emit(id, { type: 'state', patch: { turnId: result.turn.id } });
      } catch (error) {
        this.mcp?.clear(id);
        this.emit(id, { type: 'state', patch: { status: 'failed', activity: null, error: error instanceof Error ? error.message : String(error) } });
        this.persist(id); throw error;
      }
    };
    const pending = run(); this.starting.set(id, pending);
    try { await pending; } finally { this.starting.delete(id); }
  }
  async interrupt(id: string) {
    const children = [...this.sessions.values()].filter(child => child.generation?.metadata.parentChatId === id && generationRunning(child.generation.metadata));
    await Promise.allSettled(children.map(child => this.cancelGeneration(child.id)));
    await this.starting.get(id)?.catch(() => {});
    const session = await this.get(id);
    if (session.status === 'running' && session.turnId) await this.connection.request('turn/interrupt', { threadId: session.threadId, turnId: session.turnId });
  }
  async answer(id: string, requestId: string, input: unknown) {
    const session = await this.get(id), answer = chatAnswerSchema.parse(input);
    const pending = session.pending.find(entry => entry.id === requestId), request = this.requests.get(requestId);
    if (!pending || !request) throw new ApplicationError('conflict', 'This request is no longer pending.');
    let result: unknown;
    if (pending.kind === 'input') {
      if (!answer.answers || pending.questions?.some(question => !answer.answers?.[question.id]?.length)) throw new ApplicationError('invalid-input', 'Answer every question.');
      result = { answers: Object.fromEntries(Object.entries(answer.answers).map(([key, answers]) => [key, { answers }])) };
    } else {
      if (!answer.decision) throw new ApplicationError('invalid-input', 'Choose Allow or Deny.');
      result = pending.kind === 'permissions' ? { permissions: answer.decision === 'accept'
        ? Object.fromEntries(Object.entries(record(request.params.permissions)).filter(([, value]) => value != null)) : {}, scope: 'turn' } : { decision: answer.decision };
    }
    this.connection.respond(request.wireId, result); this.requests.delete(requestId);
    const text = pending.kind === 'input' ? pending.questions?.map(question => `${question.question}\nAnswer: ${question.isSecret ? '••••••' : answer.answers?.[question.id]?.join(', ')}`).join('\n\n') ?? '' : pending.detail;
    this.emit(id, { type: 'item', item: { id: `interaction-${requestId}`, kind: 'interaction', sourceType: pending.kind,
      turnId: pending.turnId, title: pending.kind === 'input' ? 'Questions answered' : answer.decision === 'accept' ? 'Approved once' : 'Declined',
      text, status: 'completed' } });
    this.emit(id, { type: 'state', patch: { pending: session.pending.filter(entry => entry.id !== requestId) } });
    this.persist(id);
  }
  async subscribe(id: string, listener: (event: ChatEvent) => void) {
    const session = await this.get(id);
    const listeners = this.listeners.get(id) ?? new Set(); this.listeners.set(id, listeners); listeners.add(listener);
    listener({ type: 'snapshot', session });
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
  }
  private emit(id: string, event: ChatEvent) {
    const session = this.sessions.get(id); if (!session) return;
    this.sessions.set(id, reduceChatEvent(session, event));
    for (const listener of this.listeners.get(id) ?? []) listener(event);
  }
  private persist(id: string) {
    void this.store.save(this.sessions.get(id)!).catch(error => this.emit(id, { type: 'state', patch: { error: `Could not save chat: ${String(error)}` } }));
  }
  private flushDeltas(id: string) {
    const buffer = this.deltaBuffers.get(id);
    if (!buffer) return;
    clearTimeout(buffer.timer); this.deltaBuffers.delete(id);
    this.emit(id, { type: 'batch', events: [...buffer.events, ...(this.sessions.get(id)?.activity ? [{ type: 'state' as const, patch: { activity: null } }] : [])] });
  }
  private queueDelta(id: string, event: Extract<ChatUpdate, { type: 'delta' }>) {
    let buffer = this.deltaBuffers.get(id);
    if (!buffer) {
      buffer = { events: [], timer: setTimeout(() => this.flushDeltas(id), 32) };
      this.deltaBuffers.set(id, buffer);
    }
    const last = buffer.events.at(-1);
    if (last?.id === event.id && last.kind === event.kind) last.text += event.text;
    else buffer.events.push(event);
    // Bound buffered bursts even if the event loop is busy.
    if ((last?.text.length ?? event.text.length) > 64_000) this.flushDeltas(id);
  }
  private settleOpenItems(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    const events: ChatUpdate[] = [];
    for (let i = session.items.length - 1; i >= 0; i--) {
      const item = session.items[i];
      if (item.kind === 'user') break;
      if (item.status === 'inProgress') events.push({ type: 'item', item: { ...item, status: 'interrupted' } });
    }
    if (events.length) this.emit(id, { type: 'batch', events });
  }
  private resolvePending(id: string, outcome: string) {
    for (const pending of this.sessions.get(id)?.pending ?? []) {
      this.requests.delete(pending.id);
      this.emit(id, { type: 'item', item: { id: `interaction-${pending.id}`, kind: 'interaction', sourceType: pending.kind,
        turnId: pending.turnId, title: pending.kind === 'input' ? `Questions ${outcome}` : `Request ${outcome}`,
        text: pending.questions?.map(question => `${question.question} (unanswered)`).join('\n') || pending.detail, status: outcome } });
    }
  }
  private async callTool(wireId: string | number, params: Record<string, unknown>, session: ChatSession) {
    let success = true, result: unknown;
    try {
      if (!this.tools || !session.canvasTools || !(session.toolDefinitions ?? this.tools.definitions).some(tool => tool.name === params.tool) || params.namespace)
        throw Error('Unknown Agent Chat tool. Use Reload tools in the chat menu to update available diagram tools.');
      if (session.status !== 'running' || session.turnId && params.turnId !== session.turnId) throw Error('This chat turn is no longer active.');
      result = await this.dispatchTool(string(params.tool), params.arguments, session, structuredClone({ id: session.id, settings: session.settings, canvasContext: session.canvasContext,
        toolCallId: JSON.stringify([params.turnId, params.callId ?? wireId]) }));
    } catch (error) { success = false; result = { error: error instanceof Error ? error.message : String(error) }; }
    try { this.connection.respond(wireId, { success, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] }); }
    catch { /* Connection exit already marks the conversation interrupted. */ }
  }
  private receive({ method, params: p, id: wireId }: CodexMessage) {
    const sessionId = this.threadSessions.get(string(p.threadId));
    if (sessionId && !method.endsWith('Delta') && !method.endsWith('/delta')) this.flushDeltas(sessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) { if (wireId !== undefined) this.connection.reject(wireId, 'Unknown chat thread'); return; }
    const id = session.id;
    if (wireId !== undefined) {
      if (method === 'item/tool/call') {
        void this.callTool(wireId, p, session);
        return;
      }
      const input = method === 'item/tool/requestUserInput';
      const permissions = method === 'item/permissions/requestApproval';
      if (!input && !permissions && !['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) {
        this.connection.reject(wireId, `Unsupported interactive request: ${method}`);
        this.emit(id, { type: 'state', patch: { error: `Codex requested an unsupported interaction: ${method}` } }); return;
      }
      const requestId = crypto.randomUUID();
      this.requests.set(requestId, { wireId, method, params: p });
      this.emit(id, { type: 'state', patch: { pending: [...session.pending, { id: requestId, turnId: string(p.turnId) || session.turnId || undefined, kind: input ? 'input' : permissions ? 'permissions' : 'approval',
        title: input ? 'Codex has a question' : permissions ? 'Permission requested' : method.includes('fileChange') ? 'Allow file changes?' : 'Allow this command?',
        detail: [string(p.reason), string(p.command), permissions ? printable(p.permissions) : string(p.grantRoot)].filter(Boolean).join('\n'),
        questions: input ? p.questions as ChatQuestion[] : undefined }] } }); return;
    }
    if (method === 'serverRequest/resolved') {
      const resolved = session.pending.filter(entry => this.requests.get(entry.id)?.wireId === p.requestId);
      for (const entry of resolved) {
        this.requests.delete(entry.id);
        this.emit(id, { type: 'item', item: { id: `interaction-${entry.id}`, kind: 'interaction', turnId: entry.turnId,
          title: 'Request resolved', text: entry.detail, status: 'completed' } });
      }
      this.emit(id, { type: 'state', patch: { pending: session.pending.filter(entry => !resolved.includes(entry)) } });
    } else if (method === 'turn/started') this.emit(id, { type: 'state', patch: { turnId: string(record(p.turn).id), status: 'running' } });
    else if (method === 'turn/completed') {
      const turn = record(p.turn), status = turn.status === 'completed' ? 'idle' : turn.status === 'interrupted' ? 'interrupted' : 'failed';
      this.settleOpenItems(id); this.resolvePending(id, status === 'idle' ? 'resolved' : 'interrupted');
      this.emit(id, { type: 'state', patch: { status, pending: [], activity: null, completedAt: new Date().toISOString(), error: string(record(turn.error).message) || null, updatedAt: new Date().toISOString() } }); this.persist(id);
      if (session.generation) void this.finishGeneration(id).catch(() => {});
    } else if (method === 'error') {
      const message = string(record(p.error).message) || 'Codex reported an error.';
      this.emit(id, { type: 'state', patch: p.willRetry ? { activity: `Retrying · ${message}` } : { error: message, activity: null } });
    } else if (method === 'thread/tokenUsage/updated') {
      const total = record(record(p.tokenUsage).total);
      const keys = ['totalTokens', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'] as const;
      const tokenUsage = Object.fromEntries(keys.map(key => [key, typeof total[key] === 'number' ? total[key] : 0])) as NonNullable<CanvasGeneration['usage']>;
      this.emit(id, { type: 'state', patch: { usage: tokenUsage.totalTokens, tokenUsage } });
      if (session.generation && session.status === 'running' && (!session.turnId || p.turnId === session.turnId)) {
        const last = record(record(p.tokenUsage).last);
        if (!keys.every(key => typeof last[key] === 'number')) return;
        // Totals can include the fork's inherited history. The first completed
        // request exposes its own last usage; subtract that to pin the baseline.
        const baseline = session.generation.usageBaseline ?? Object.fromEntries(keys.map(key => [key, Math.max(0, tokenUsage[key] - Number(last[key]))])) as typeof tokenUsage;
        const usage = Object.fromEntries(keys.map(key => [key, Math.max(0, tokenUsage[key] - (baseline?.[key] ?? 0))])) as typeof tokenUsage;
        this.emit(id, { type: 'state', patch: { generation: { ...session.generation, usageBaseline: baseline, metadata: { ...session.generation.metadata, usage } } } });
      }
    } else if (method === 'turn/plan/updated') {
      const plan = Array.isArray(p.plan) ? p.plan.map(step => ({ step: string(record(step).step), status: string(record(step).status) })) : [];
      this.emit(id, { type: 'item', item: { id: `plan-${crypto.randomUUID()}`, turnId: string(p.turnId), kind: 'plan', sourceType: 'planUpdate',
        title: 'Updated plan', text: string(p.explanation), plan, status: 'completed' } });
    } else if (method === 'item/started' || method === 'item/completed') {
      const native = record(p.item), itemId = string(native.id); if (!itemId || native.type === 'userMessage') return;
      const item = presentNativeItem(native, string(p.turnId) || session.turnId || undefined, method === 'item/completed', findChatItem(session, itemId));
      this.emit(id, { type: 'item', item });
      if (session.activity) this.emit(id, { type: 'state', patch: { activity: null } });
    } else if (method === 'item/reasoning/summaryPartAdded') {
      if (findChatItem(session, string(p.itemId))?.text) this.queueDelta(id, { type: 'delta', id: string(p.itemId), kind: 'reasoning', text: '\n\n' });
    } else if (method === 'item/commandExecution/terminalInteraction') {
      if (!string(p.stdin)) this.emit(id, { type: 'state', patch: { activity: 'Waiting for background terminal' } });
      else this.emit(id, { type: 'item', item: { id: `terminal-${crypto.randomUUID()}`, kind: 'notice', turnId: session.turnId || undefined,
        title: 'Sent input to terminal', text: string(p.stdin), status: 'completed' } });
    } else if (['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/commandExecution/outputDelta', 'item/plan/delta'].includes(method)) {
      const kind = method.includes('agentMessage') ? 'assistant' : method.includes('reasoning') ? 'reasoning' : method.includes('plan') ? 'plan' : 'tool';
      this.queueDelta(id, { type: 'delta', id: string(p.itemId), kind, turnId: string(p.turnId) || session.turnId || undefined,
        sourceType: kind === 'tool' ? 'commandExecution' : kind === 'assistant' ? 'agentMessage' : kind, text: string(p.delta) });
    }
  }
  dispose() {
    for (const session of this.sessions.values()) if (session.status === 'running') {
      this.flushDeltas(session.id); this.settleOpenItems(session.id); this.resolvePending(session.id, 'interrupted');
      this.emit(session.id, { type: 'state', patch: { status: 'interrupted', pending: [], activity: null, error: 'Server stopped. Send a message to resume.' } });
      this.persist(session.id);
    }
    for (const session of this.sessions.values()) if (session.generation && generationRunning(session.generation.metadata)) {
      session.generation.metadata = { ...session.generation.metadata, status: 'failed', completedAt: new Date().toISOString(), error: 'Server stopped during generation.' };
      this.persist(session.id);
    }
    for (const id of this.deltaBuffers.keys()) this.flushDeltas(id);
    for (const id of this.sessions.keys()) this.mcp?.clear(id);
    this.unsubscribe(); this.connection.dispose();
  }
}
