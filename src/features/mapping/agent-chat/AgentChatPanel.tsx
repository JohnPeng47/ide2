import { useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { WindowPanelSidebarContext } from '../window-panel/WindowPanel';
import { type ChatAnswer, type ChatApproval, type ChatCanvasTarget, type ChatReadCanvas, type ChatEvent, type ChatInfo, type ChatSession, type ChatSessionSummary, type ChatSettings } from '../../../../domain/mapping/agent-chat/agentChat';
import { MarkdownActivityContext } from './markdown/CodexMarkdown';
import { ChatTranscript } from './ChatTranscript';
import { useChatZoom } from './useTranscriptZoom';
import { ChatHighlightContext, type OpenHighlightReference } from './ChatHighlightLink';
import { ChatFileLinks } from './ChatFileLinks';
import { ChatCanvasCopyContext } from './ChatCanvasCopy';
import { chatReferencesSchema, type ChatSend } from '../../../../domain/mapping/agent-chat/agentChat';
import { useChatReferences, type ChatReferenceCanvas } from './ChatReferences';
import { ChatPromptEditor } from './ChatPromptEditor';
import { emptyChatDraft, serializeChatDraft, type ChatDraft } from './chatDraft';
import { ChatStream } from './chatStream';
import { chatRequest, ChatRequestError } from './agentChatClient';
import { activateChatTab, chatSessionId, closeChatTab, cycleChatTab, newChatTab, restoreChatTabs, saveChatTabs, type ChatTabCommand, type ChatTabs } from './chatTabs';
import './agentChat.css';

const defaults: ChatSettings = { model: '', effort: '', sandbox: 'danger-full-access' };
const modelStorageKey = 'agent-chat-model';
function readSavedModel(): string | null {
  try {
    const model = localStorage.getItem(modelStorageKey);
    return model !== null && model.length <= 200 ? model : null;
  } catch { return null; }
}

function PendingRequest({ request, onAnswer }: { request: ChatApproval; onAnswer: (answer: ChatAnswer) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const send = async (answer: ChatAnswer) => { setBusy(true); setError(''); try { await onAnswer(answer); } catch (error) { setError(String(error)); } finally { setBusy(false); } };
  return <form className="agent-approval" onSubmit={event => { event.preventDefault(); void send({ answers: Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, [value]])) }); }}>
    <strong>{request.title}</strong>{request.detail && <pre>{request.detail}</pre>}
    {request.questions?.map(question => <fieldset key={question.id} disabled={busy}><legend>{question.question}</legend>
      {question.options?.map(option => <label key={option.label}><input type="radio" name={`${request.id}-${question.id}`} checked={answers[question.id] === option.label}
        onChange={() => setAnswers(previous => ({ ...previous, [question.id]: option.label }))} />{option.label}<small>{option.description}</small></label>)}
      <input aria-label={question.header || question.question} type={question.isSecret ? 'password' : 'text'} placeholder="Your answer" value={answers[question.id] ?? ''}
        onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))} />
    </fieldset>)}
    {error && <p role="alert">{error}</p>}
    <div className="agent-approval-actions">{request.kind === 'input' ? <button disabled={busy || request.questions?.some(question => !answers[question.id]?.trim())}>Submit answers</button> : <>
      <button type="button" disabled={busy} onClick={() => void send({ decision: 'decline' })}>Deny</button>
      <button type="button" disabled={busy} onClick={() => void send({ decision: 'accept' })}>Allow once</button></>}</div>
  </form>;
}

export function AgentChatPanel({ open, projectId, canvasTarget, onCopyDiagram, referenceCanvas, tabCommand, onHighlightReference }: { onHighlightReference?: OpenHighlightReference; tabCommand?: ChatTabCommand; open: boolean; projectId?: string; canvasTarget?: ChatCanvasTarget; onCopyDiagram?: (ascii: string) => void; referenceCanvas?: ChatReferenceCanvas }) {
  const sidebar = useContext(WindowPanelSidebarContext);
  const [info, setInfo] = useState<ChatInfo>();
  const [zoom, setZoom] = useChatZoom();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loadedSession, setSession] = useState<ChatSession>();
  const [tabs, setTabs] = useState<ChatTabs>(() => { const selected = newChatTab(); return { ids: [selected], selected }; });
  const selected = tabs.selected, activeSessionId = chatSessionId(selected);
  const session = loadedSession?.id === activeSessionId ? loadedSession : undefined;
  const tabsId = useId();
  const tabSettings = useRef<Record<string, ChatSettings>>({});
  const consumedCommand = useRef(0);
  const tabList = useRef<HTMLDivElement>(null);
  const selectedReferences = useChatReferences(referenceCanvas);
  const [savedModel] = useState(readSavedModel);
  const preferredModel = useRef(savedModel);
  const [settings, setSettings] = useState<ChatSettings>(() => ({ ...defaults, model: savedModel ?? defaults.model }));
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>({});
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stream = useRef<ChatStream | undefined>(undefined), visible = useRef(open);
  visible.current = open;
  const emptyDraft = useMemo(emptyChatDraft, []);
  const initialized = useRef(false), pendingSend = useRef<Record<string, { id: string; signature: string; body: ChatSend }>>({});
  const pendingRead = useRef<Record<string, { id: string; body: ChatReadCanvas }>>({});
  const draft = drafts[selected] ?? emptyDraft;
  const { prompt: text, references } = useMemo(() => serializeChatDraft(draft), [draft]);
  const referenceValidation = chatReferencesSchema.safeParse(references);
  const referenceError = referenceValidation.success ? '' : referenceValidation.error.issues[0].message;
  const running = session?.status === 'running';
  const activate = (id: string) => {
    if (busy) return;
    tabSettings.current[selected] = settings;
    setSettings(tabSettings.current[id] ?? settings);
    setTabs(current => activateChatTab(current, id)); setError('');
  };
  const newTab = () => {
    const id = newChatTab();
    tabSettings.current[id] = { ...settings, sandbox: defaults.sandbox };
    activate(id);
  };
  const closeTab = (id: string) => {
    if (busy) return;
    const next = closeChatTab(tabs, id);
    if (next.selected !== selected) activate(next.selected);
    setTabs(next);
  };
  const promoteTab = (id: string) => {
    tabSettings.current[id] = settings;
    setTabs(current => ({ ids: current.ids.map(entry => entry === selected ? id : entry), selected: id }));
  };
  useEffect(() => {
    if (!open || !info || busy || !tabCommand || consumedCommand.current >= tabCommand.serial) return;
    consumedCommand.current = tabCommand.serial;
    if (tabCommand.action === 'new') newTab();
    else if (tabCommand.action === 'next' || tabCommand.action === 'previous') activate(cycleChatTab(tabs, tabCommand.action === 'next' ? 1 : -1).selected);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.agent-chat-prompt')?.focus({ preventScroll: true }));
  }, [tabCommand, info, open, busy]);
  useEffect(() => {
    tabList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (info && initialized.current) saveChatTabs(info.cwd, tabs);
  }, [tabs, info]);
  useEffect(() => {
    if (!open || initialized.current) return;
    let cancelled = false;
    setError('');
    void Promise.allSettled([chatRequest<ChatInfo>('/info'), chatRequest<ChatSessionSummary[]>('/sessions')]).then(([connection, history]) => {
      if (cancelled) return;
      if (connection.status === 'fulfilled') {
        initialized.current = true; setInfo(connection.value);
        setSettings(current => ({ ...current, model: preferredModel.current ?? connection.value.models.find(model => model.isDefault)?.id ?? '' }));
      } else setError(String(connection.reason));
      if (history.status === 'fulfilled') {
        setSessions(history.value);
        const restored = connection.status === 'fulfilled' ? restoreChatTabs(connection.value.cwd, history.value) : undefined;
        if (restored) setTabs(restored);
        else if (history.value.length) setTabs({ ids: [history.value[0].id], selected: history.value[0].id });
      }
      else { initialized.current = false; setError(String(history.reason)); }
    });
    return () => { cancelled = true; };
  }, [open, attempt]);
  useEffect(() => {
    setSession(undefined); setConnected(false);
    if (!activeSessionId) return;
    const buffer = new ChatStream(setSession); stream.current = buffer; buffer.setVisible(visible.current);
    const events = new EventSource(`/api/mapping/agent-chat/sessions/${activeSessionId}/events`);
    events.onmessage = message => {
      const event = JSON.parse(message.data) as ChatEvent;
      setConnected(true);
      if (event.type === 'snapshot') {
        const restored = tabSettings.current[selected] ?? event.session.settings, model = tabSettings.current[selected]?.model ?? preferredModel.current ?? restored.model;
        setSettings({ ...restored, model, effort: model === restored.model ? restored.effort : '' });
      }
      buffer.receive(event);
    };
    events.onerror = () => setConnected(false);
    return () => { events.close(); buffer.dispose(); if (stream.current === buffer) stream.current = undefined; };
  }, [activeSessionId, attempt]);
  useEffect(() => {
    if (!session) return;
    setSessions(current => [{ id: session.id, title: session.title, cwd: session.cwd, updatedAt: session.updatedAt, status: session.status }, ...current.filter(item => item.id !== session.id)]);
  }, [session?.title, session?.status, session?.id]);
  useEffect(() => { stream.current?.setVisible(open); }, [open]);
  const backgroundRunning = sessions.some(entry => entry.id !== activeSessionId && tabs.ids.includes(entry.id) && entry.status === 'running');
  useEffect(() => {
    if (!open || !backgroundRunning) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const history = await chatRequest<ChatSessionSummary[]>('/sessions');
        if (!cancelled) setSessions(current => history.map(entry => entry.id === activeSessionId ? current.find(old => old.id === entry.id) ?? entry : entry));
      } catch { /* The active conversation's stream reports connection problems. */ }
    };
    const timer = setInterval(() => void refresh(), 2500);
    void refresh();
    return () => { cancelled = true; clearInterval(timer); };
  }, [open, backgroundRunning, activeSessionId]);
  const send = async () => {
    if (!text.trim() || referenceError || busy || running || !info || (activeSessionId && (!session || !connected))) return;
    setBusy(true); setError('');
    let id = activeSessionId;
    try {
      if (!id) { const created = await chatRequest<ChatSession>('/sessions', settings); id = created.id; promoteTab(id); setSession(created); }
      // Preserve the exact request after a lost response; explicit new text gets a new identity.
      const signature = JSON.stringify({ text, references, canvas: canvasTarget });
      const request = pendingSend.current[id]?.signature === signature ? pendingSend.current[id]
        : { id, signature, body: { ...settings, text, canvas: canvasTarget, ...(references.length ? { references: structuredClone(references) } : {}), requestId: crypto.randomUUID() } };
      pendingSend.current[id] = request;
      await chatRequest(`/sessions/${id}/send`, request.body);
      delete pendingSend.current[id]; setDrafts(current => ({ ...current, [selected]: emptyDraft, [id]: emptyDraft }));
    } catch (error) {
      // A server rejection is known to the caller; a lost response keeps its identity for reconciliation.
      if (error instanceof ChatRequestError) delete pendingSend.current[id];
      setError(error instanceof Error ? error.message : String(error)); setDrafts(current => ({ ...current, [id]: draft }));
    }
    finally { setBusy(false); }
  };
  const readCanvas = async () => {
    if (!canvasTarget || busy || running || !info || (activeSessionId && (!session || !connected))) return;
    setBusy(true); setError('');
    let id = activeSessionId;
    try {
      if (!id) {
        const created = await chatRequest<ChatSession>('/sessions', settings);
        id = created.id; promoteTab(id); setSession(created);
        setDrafts(current => ({ ...current, [id]: current[selected] ?? emptyDraft, [selected]: emptyDraft }));
      }
      const previous = pendingRead.current[id];
      const request = previous?.id === id && previous.body.canvas.workspaceInstanceId === canvasTarget.workspaceInstanceId
        && previous.body.canvas.documentId === canvasTarget.documentId ? previous
        : { id, body: { ...settings, canvas: { ...canvasTarget }, requestId: crypto.randomUUID() } };
      pendingRead.current[id] = request;
      await chatRequest(`/sessions/${id}/read-canvas`, request.body);
      delete pendingRead.current[id];
    } catch (error) {
      if (error instanceof ChatRequestError) delete pendingRead.current[id];
      setError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  const stop = async () => { setBusy(true); try { await chatRequest(`/sessions/${selected}/interrupt`, {}); } catch (error) { setError(String(error)); } finally { setBusy(false); } };
  const chooseModel = (model: string) => {
    preferredModel.current = model;
    setSettings(current => ({ ...current, model, effort: '' }));
    try { localStorage.setItem(modelStorageKey, model); } catch { /* Selection still works without browser storage. */ }
  };
  const model = info?.models.find(model => model.id === settings.model);
  const sidebarContent = <div className="agent-chat-sidebar-content">
    {info && <small className="agent-chat-account">{info.account}</small>}
    <div className="agent-chat-sessions"><select aria-label="Agent conversations" value={activeSessionId} disabled={busy} onChange={event => { if (event.target.value) activate(event.target.value); else newTab(); sidebar.close(); }}>
      <option value="">New conversation</option>{sessions.map(entry => <option key={entry.id} value={entry.id}>{entry.status === 'running' ? '● ' : ''}{entry.title}</option>)}
    </select><button disabled={busy} onClick={() => { newTab(); sidebar.close(); }}>New chat</button></div>
      <div className="agent-chat-controls"><label>Model<select aria-label="Codex model" disabled={running || busy} value={settings.model} onChange={event => chooseModel(event.target.value)}>
        <option value="">Codex default</option>{settings.model && !model && <option value={settings.model}>{settings.model}</option>}{info?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
        <label>Effort<select aria-label="Reasoning effort" disabled={running || busy} value={settings.effort} onChange={event => setSettings(current => ({ ...current, effort: event.target.value as ChatSettings['effort'] }))}>
          <option value="">Default</option>{model?.efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}</select></label>
        <label>Access<select aria-label="Codex access" disabled={running || busy} value={settings.sandbox} onChange={event => setSettings(current => ({ ...current, sandbox: event.target.value as ChatSettings['sandbox'] }))}>
          <option value="danger-full-access">Full access (YOLO)</option><option value="workspace-write">Workspace</option><option value="read-only">Read only</option></select></label>
      </div>
  </div>;
  const content = <div className="agent-chat" style={{ '--agent-transcript-scale': zoom / 100 } as CSSProperties} data-chat-state={running ? 'running' : activeSessionId && !connected ? 'connecting' : session?.status ?? 'idle'} data-mapping-static-ui data-diagram-canvas-static-ui onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}>
    {sidebar.element && createPortal(sidebarContent, sidebar.element)}
    <div className="agent-chat-tabbar">
      <div ref={tabList} className="agent-chat-tabs" role="tablist" aria-label="Agent Chat conversations">
        {tabs.ids.map((id, index) => {
          const summary = sessions.find(entry => entry.id === id);
          const label = summary?.title || 'New chat';
          return <div className="agent-chat-tab" key={id} data-active={selected === id}>
            <button type="button" role="tab" id={`${tabsId}-${id}`} aria-controls={`${tabsId}-panel`} aria-selected={selected === id}
              tabIndex={selected === id ? 0 : -1} disabled={busy} title={label} onClick={() => activate(id)}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = tabs.ids[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.ids.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.ids.length) % tabs.ids.length];
                activate(next); requestAnimationFrame(() => document.getElementById(`${tabsId}-${next}`)?.focus());
              }}><span>{summary?.status === 'running' ? '● ' : ''}{label}</span></button>
            <button type="button" className="agent-chat-tab-close" aria-label={`Close chat tab: ${label}`} title="Close tab (keeps conversation in history)" disabled={busy} onClick={() => closeTab(id)}>×</button>
          </div>;
        })}
      </div>
      <button type="button" className="agent-chat-new-tab" aria-label="New chat tab" title="New chat (Ctrl+B, C)" disabled={!info || busy} onClick={newTab}>+</button>
    </div>
    <div className="agent-chat-tab-content" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${selected}`}>
    {error && <div className="agent-chat-error" role="alert">{error}{!info && <button onClick={() => setAttempt(value => value + 1)}>Retry connection</button>}</div>}
    {session?.items.length ? <ChatTranscript key={session.id} session={session} open={open} zoom={zoom} onZoomChange={setZoom} /> : <div className="agent-chat-timeline"><div className="agent-chat-empty"><span>CODEX</span><h2>What would you like to work on?</h2><p>Ask about your project, explore code, or make a change.</p>{info && <code>{info.cwd}</code>}</div></div>}
    <div className="agent-chat-requests">{session?.pending.map(request => <PendingRequest key={request.id} request={request} onAnswer={answer => chatRequest(`/sessions/${selected}/answer/${request.id}`, answer)} />)}</div>
    <form className="agent-chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      {session && !session.canvasTools && <small className="agent-chat-tool-hint">Start a new chat to enable diagram editing tools.</small>}
      {referenceError && <small className="agent-chat-reference-error" role="alert">{referenceError}</small>}
      <ChatPromptEditor value={draft} draftKey={selected} selectedReferences={selectedReferences} open={open} disabled={!info || busy}
        onChange={value => setDrafts(current => ({ ...current, [selected]: value }))} onSend={() => void send()} />
      <div className="agent-chat-composer-actions">
      <button type="button" className="agent-chat-read-canvas" disabled={!canvasTarget || busy || running || !info || (!!activeSessionId && (!session || !connected))}
        title={canvasTarget ? 'Send the current canvas to the agent' : 'Open a live canvas to read it'} onClick={() => void readCanvas()}>Read Canvas</button>
        {running ? <button type="button" className="agent-chat-send" disabled={busy} onClick={() => void stop()}>Stop</button> : <button className="agent-chat-send" disabled={busy || !!referenceError || !text.trim() || !info || (!!activeSessionId && (!session || !connected))}>{busy ? 'Starting…' : 'Send ↑'}</button>}
      </div>
    </form>
    </div>
  </div>;
  return <MarkdownActivityContext.Provider value={open}><ChatCanvasCopyContext.Provider value={onCopyDiagram}>
    <ChatHighlightContext.Provider value={onHighlightReference}><ChatFileLinks cwd={session?.cwd || info?.cwd || ''} projectId={projectId}>{content}</ChatFileLinks></ChatHighlightContext.Provider>
  </ChatCanvasCopyContext.Provider></MarkdownActivityContext.Provider>;
}
