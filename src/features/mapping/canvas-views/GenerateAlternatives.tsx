import { useEffect, useRef, useState } from 'react';
import type { ChatCanvasTarget, ChatSessionSummary } from '../../../../domain/mapping/agent-chat/agentChat';
import { generationRunning, type CanvasGeneration } from '../../../../domain/core/diagrams/canvasGeneration';
import { chatRequest } from '../agent-chat/agentChatClient';

export type GenerationStatus = CanvasGeneration & { viewId: string; pendingSave?: boolean; waitingForInput?: boolean };
export function useGenerations(canvas?: ChatCanvasTarget, enabled = false) {
  const [generations, setGenerations] = useState<GenerationStatus[]>([]);
  useEffect(() => {
    setGenerations([]);
    if (!canvas || !enabled) return;
    let closed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await chatRequest<GenerationStatus[]>(`/generations?${new URLSearchParams(canvas)}`);
        if (!closed) setGenerations(result);
      } catch { /* Persisted canvas statuses remain visible during disconnection. */ }
      if (!closed) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { closed = true; clearTimeout(timer); };
  }, [canvas?.workspaceInstanceId, canvas?.documentId, enabled]);
  return generations;
}
export const generationLabel = (status: GenerationStatus) => status.pendingSave ? 'Saving result…' : status.waitingForInput ? 'Needs input' :
  ({ queued: 'Queued', generating: 'Generating…', finished: 'Finished', failed: 'Failed', cancelled: 'Cancelled' })[status.status];

export function GenerateAlternatives({ canvas, viewId, names, onDone, onCancel }: {
  canvas: ChatCanvasTarget; viewId: string; names: string[]; onDone: () => void; onCancel: () => void;
}) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]), [source, setSource] = useState('');
  const [prompt, setPrompt] = useState('');
  const [alternatives, setAlternatives] = useState(names.map(name => ({ name, prompt: '' })));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ signature: string; requestId: string } | undefined>(undefined);
  useEffect(() => {
    let closed = false;
    void chatRequest<ChatSessionSummary[]>('/sessions').then(items => {
      if (closed) return;
      const roots = items.filter(item => !item.parentChatId); setSessions(roots); setSource(roots[0]?.id ?? '');
    }).catch(error => { if (!closed) setError(String(error)); });
    return () => { closed = true; };
  }, []);
  const selected = sessions.find(session => session.id === source);
  const submit = async () => {
    const body = { canvas, viewId, prompt, alternatives }, signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await chatRequest(`/sessions/${source}/gen-alternatives`, { ...body, requestId: pending.current.requestId }); onDone(); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="canvas-generation-form" role="group" aria-label="Generate alternatives">
    <strong>Generate alternatives</strong>
    <label>Source AgentChat<select aria-label="Source AgentChat" value={source} disabled={busy} onChange={event => setSource(event.target.value)}>
      {!sessions.length && <option value="">Start an AgentChat conversation first</option>}
      {sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
    </select></label>
    {selected && <p>Inherits {selected.settings?.model || 'the chat’s model'} · {selected.settings?.effort || 'default'} reasoning and the same tools.</p>}
    <label>Shared prompt<textarea aria-label="Shared generation prompt" value={prompt} disabled={busy} maxLength={50000}
      onChange={event => setPrompt(event.target.value)} placeholder="What should all alternatives accomplish?" /></label>
    <label>Alternatives<input type="number" aria-label="Alternative count" min={1} max={8} value={alternatives.length} disabled={busy}
      onChange={event => { const count = Math.min(8, Math.max(1, Number(event.target.value) || 1));
        setAlternatives(items => Array.from({ length: count }, (_, i) => items[i] ?? { name: names[i] ?? `${names[0].replace(/\.\d+$/, '')}.${i + 1}`, prompt: '' })); }} /></label>
    {alternatives.map((alternative, i) => <div key={i} className="canvas-generation-candidate">
      <label>Name<input aria-label={`Alternative ${i + 1} name`} value={alternative.name} disabled={busy} maxLength={120}
        onChange={event => setAlternatives(items => items.map((item, index) => index === i ? { ...item, name: event.target.value } : item))} /></label>
      <label>Generation prompt<textarea aria-label={`Alternative ${i + 1} prompt`} value={alternative.prompt} disabled={busy} maxLength={50000}
        onChange={event => setAlternatives(items => items.map((item, index) => index === i ? { ...item, prompt: event.target.value } : item))} /></label>
    </div>)}
    <p>Each alternative starts from the saved view and runs in parallel.</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy || !source || !prompt.trim() || alternatives.some(item => !item.name.trim() || !item.prompt.trim())}
      onClick={() => void submit()}>{busy ? 'Starting…' : 'Generate alternatives'}</button>
    <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
  </div>;
}

export function GenerationDetails({ generation, onOpenChat }: { generation: GenerationStatus; onOpenChat?: (id: string) => void }) {
  const [error, setError] = useState('');
  return <div className="canvas-generation-details">
    <strong>{generationLabel(generation)}</strong>
    <p>{generation.model || 'Inherited model'} · {generation.effort || 'default'} reasoning
      {generation.durationMs !== undefined ? ` · ${(generation.durationMs / 1000).toFixed(1)}s` : ''}
      {generation.usage ? ` · ${generation.usage.totalTokens.toLocaleString()} tokens` : ''}</p>
    <details><summary>Prompts and usage</summary>
      <p>Triggering prompt</p><pre>{generation.triggerPrompt}</pre>
      {generation.taskPrompt && <><p>Shared prompt</p><pre>{generation.taskPrompt}</pre></>}
      <p>Candidate prompt</p><pre>{generation.prompt}</pre>
      {generation.usage && <p>Input {generation.usage.inputTokens.toLocaleString()} · Cached input {generation.usage.cachedInputTokens.toLocaleString()} · Output {generation.usage.outputTokens.toLocaleString()} · Reasoning {generation.usage.reasoningOutputTokens.toLocaleString()}</p>}
    </details>
    {generation.error && <p role="alert">{generation.error}</p>}
    {onOpenChat && <><button type="button" onClick={() => onOpenChat(generation.chatId)}>Open generation chat</button>
      <button type="button" onClick={() => onOpenChat(generation.parentChatId)}>Open source chat</button></>}
    {generationRunning(generation) && <button type="button" onClick={() => void chatRequest(`/sessions/${generation.chatId}/cancel-generation`, {}).catch(error => setError(String(error)))}>Cancel generation</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
