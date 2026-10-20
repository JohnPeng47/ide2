import { AGENT_CHAT_SYSTEM_PROMPT } from './agentChatPrompt';
import { ApplicationError } from '../../core/errors';
import { chatAnswerSchema, chatReadCanvasSchema, chatSendSchema, chatSettingsSchema, findChatItem, reduceChatEvent, type ChatCanvasTarget, type ChatSend, type ChatEvent, type ChatInfo, type ChatItem, type ChatQuestion, type ChatSession, type ChatSessionSummary, type ChatUpdate } from '../../../domain/mapping/agent-chat/agentChat';
import type { ChatMcpBinding, ChatCanvasReader, ChatStore, ChatTools, CodexConnection, CodexMessage } from './ports';

import { presentNativeItem, printable, record, string } from './chatPresentation';

export class AgentChatService {
  private sessions = new Map<string, ChatSession>();
  private loaded: Promise<void>;
  private resumed = new Set<string>();
  private listeners = new Map<string, Set<(event: ChatEvent) => void>>();
  private requests = new Map<string, { wireId: string | number; method: string; params: Record<string, unknown> }>();
  private starting = new Map<string, Promise<void>>();
  private unsubscribe: () => void;
  private deltaBuffers = new Map<string, { events: Extract<ChatUpdate, { type: 'delta' }>[]; timer: ReturnType<typeof setTimeout> }>();
  private threadSessions = new Map<string, string>();
  constructor(private connection: CodexConnection, private store: ChatStore, private cwd: string, private canvasReader?: ChatCanvasReader, private tools?: ChatTools, private mcp?: ChatMcpBinding) {
    this.loaded = store.list().then(sessions => {
      for (const session of sessions) {
        this.threadSessions.set(session.threadId, session.id);
        this.sessions.set(session.id, { ...session, schemaVersion: 2, pending: [], activity: null,
          items: session.items.map(item => item.status === 'inProgress' ? { ...item, status: 'interrupted' } : item),
          ...(session.status === 'running' ? { status: 'interrupted', error: 'Server restarted. Send a message to resume.' } : {}) });
      }
    });
    // A failed store is surfaced by every public operation, without an unhandled rejection at startup.
    void this.loaded.catch(() => {});
    this.unsubscribe = connection.subscribe(message => this.receive(message), error => {
      this.resumed.clear(); this.requests.clear();
      for (const id of this.sessions.keys()) this.mcp?.clear(id);
      for (const session of this.sessions.values()) if (session.status === 'running') {
        this.flushDeltas(session.id); this.settleOpenItems(session.id); this.resolvePending(session.id, 'interrupted');
        this.emit(session.id, { type: 'state', patch: { status: 'failed', pending: [], activity: null, error } }); this.persist(session.id);
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
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, cwd, updatedAt, status }) => ({ id, title, cwd, updatedAt, status }));
  }
  async get(id: string) { await this.loaded; const session = this.sessions.get(id); if (!session) throw new ApplicationError('invalid-input', 'Chat session not found.'); this.flushDeltas(id); return this.sessions.get(id)!; }
  async create(input: unknown) {
    await this.loaded;
    const settings = chatSettingsSchema.parse(input);
    const chatId = crypto.randomUUID();
    const result = await this.connection.request<{ thread: { id: string }; model: string }>('thread/start', {
      developerInstructions: AGENT_CHAT_SYSTEM_PROMPT, ...(this.mcp ? { config: this.mcp.config(chatId) } : {}),
      cwd: this.cwd, model: settings.model || undefined, sandbox: settings.sandbox, approvalPolicy: settings.sandbox === 'danger-full-access' ? 'never' : 'on-request', approvalsReviewer: 'user',
      ...(this.tools ? { dynamicTools: this.tools.definitions } : {})
    });
    const now = new Date().toISOString();
    const session: ChatSession = { schemaVersion: 2, canvasTools: !!this.tools, id: chatId, threadId: result.thread.id, title: 'New conversation', cwd: this.cwd,
      createdAt: now, updatedAt: now, settings: { ...settings, model: result.model || settings.model }, status: 'idle', items: [], pending: [], requestIds: [] };
    await this.store.save(session); this.sessions.set(session.id, session); this.threadSessions.set(session.threadId, session.id); this.resumed.add(session.threadId);
    return session;
  }
  async send(id: string, input: unknown) {
    return this.startTurn(id, chatSendSchema.parse(input));
  }
  async readCanvas(id: string, input: unknown) {
    const data = chatReadCanvasSchema.parse(input);
    return this.startTurn(id, { ...data, text: 'Read Canvas' }, data.canvas);
  }
  private async startTurn(id: string, data: ChatSend, canvas?: ChatCanvasTarget) {
    const session = await this.get(id);
    if (session.requestIds.includes(data.requestId)) return;
    if (session.status === 'running' || this.starting.has(id)) throw new ApplicationError('conflict', 'This conversation already has an active turn.');
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
        if (!this.resumed.has(session.threadId)) {
          await this.connection.request('thread/resume', { threadId: session.threadId, ...(this.mcp ? { config: this.mcp.config(id) } : {}), cwd: session.cwd, developerInstructions: AGENT_CHAT_SYSTEM_PROMPT, sandbox: data.sandbox, approvalPolicy: data.sandbox === 'danger-full-access' ? 'never' : 'on-request', approvalsReviewer: 'user' });
          this.resumed.add(session.threadId);
        }
        this.sessions.get(id)!.canvasContext = structuredClone({ canvas: data.canvas ?? canvas, references: data.references ?? [] });
        this.mcp?.bind(id, data.canvas ?? canvas, data.sandbox === 'read-only');
        // Commit the client request before issuing a turn, so retrying a lost HTTP response cannot run it twice.
        this.sessions.get(id)!.requestIds.push(data.requestId);
        if (!canvas) this.emit(id, { type: 'item', item: { id: data.requestId, kind: 'user', text: data.text, status: 'completed',
          ...(data.references?.length ? { references: data.references } : {}) } });
        this.emit(id, { type: 'state', patch: { title: session.items.length ? session.title : data.text.slice(0, 70), updatedAt: new Date().toISOString() } });
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
      if (!this.tools || !session.canvasTools || !this.tools.definitions.some(tool => tool.name === params.tool) || params.namespace)
        throw Error('Unknown Agent Chat tool. Start a new chat to enable diagram tools.');
      if (session.status !== 'running' || session.turnId && params.turnId !== session.turnId) throw Error('This chat turn is no longer active.');
      result = await this.tools.call(string(params.tool), params.arguments, structuredClone({ id: session.id, settings: session.settings, canvasContext: session.canvasContext }));
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
    } else if (method === 'error') {
      const message = string(record(p.error).message) || 'Codex reported an error.';
      this.emit(id, { type: 'state', patch: p.willRetry ? { activity: `Retrying · ${message}` } : { error: message, activity: null } });
    } else if (method === 'thread/tokenUsage/updated') {
      const usage = record(record(p.tokenUsage).total).totalTokens;
      if (typeof usage === 'number') this.emit(id, { type: 'state', patch: { usage } });
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
    for (const id of this.deltaBuffers.keys()) this.flushDeltas(id);
    for (const id of this.sessions.keys()) this.mcp?.clear(id);
    this.unsubscribe(); this.connection.dispose();
  }
}
