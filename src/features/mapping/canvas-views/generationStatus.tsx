import { useEffect, useState } from 'react';
import type { ChatCanvasTarget } from '../../../../domain/mapping/agent-chat/agentChat';
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
