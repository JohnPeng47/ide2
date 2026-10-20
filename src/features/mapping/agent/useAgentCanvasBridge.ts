import { canvasReply, mutationCommands } from '../../../../domain/mapping/agent/canvasReply';
import { publishLiveCanvasSelections, type LiveAgentStatus } from './liveCanvasPublisher';
import type { CanvasWorkspace } from '../workspace/canvasWorkspace';
import { useEffect, useRef, useState } from 'react';
import type { CanvasCommand, CanvasDescriptor } from '../../../../domain/mapping/agent/contracts';
import { apiFetch, errorFrom } from '../../../shared/http/http';
import { browserStableWorkspaceId } from './stableWorkspaceIdentity';

export function useAgentCanvasBridge(descriptor: Omit<CanvasDescriptor, 'canvasId' | 'stableWorkspaceId'>, handle: (command: CanvasCommand) => Promise<unknown>, workspace?: CanvasWorkspace, canMutate: () => boolean = () => true) {
  const [agentStatus, setAgentStatus] = useState<LiveAgentStatus>({ connected: false, count: 0 });
  const [canvasId] = useState(() => crypto.randomUUID());
  const [identity, setIdentity] = useState<{ stableWorkspaceId?: string }>();
  useEffect(() => {
    let active = true;
    void browserStableWorkspaceId(import.meta.env.BASE_URL).then(stableWorkspaceId => {
      if (active) setIdentity({ stableWorkspaceId });
    });
    return () => { active = false; };
  }, []);
  const latest = useRef({ descriptor, handle, canMutate }); latest.current = { descriptor, handle, canMutate };
  const registration = identity && JSON.stringify({ ...descriptor, canvasId, ...identity });
  useEffect(() => {
    if (!registration) return;
    void apiFetch('/api/mapping/agent/canvases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: registration }).catch(() => undefined);
  }, [registration]);
  useEffect(() => {
    if (!identity) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const results = new Map<string, { value?: unknown; error?: string }>();
    const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
      const response = await apiFetch(`/api/mapping/agent${path}`, { method, signal: abort.signal,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
      if (!response.ok) throw await errorFrom(response);
      return response.json();
    };
    const register = () => request('/canvases', { ...latest.current.descriptor, canvasId, ...identity });
    const run = async () => {
      try {
        await register();
        while (!abort.signal.aborted) {
          const commands: CanvasCommand[] = await request(`/canvases/${canvasId}/commands`);
          for (const command of commands) {
            const started = performance.now();
            let result = results.get(command.id);
            if (!result) {
              try { result = { value: await latest.current.handle(command) }; }
              catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
              if (mutationCommands.has(command.method)) results.set(command.id, result);
              if (results.size > 200) results.delete(results.keys().next().value!);
            }
            const handled = performance.now();
            const reply = canvasReply(command, result);
            const encoded = performance.now();
            const response = await apiFetch(`/api/mapping/agent/canvases/${canvasId}/reply`, { method: 'POST', signal: abort.signal,
              headers: { 'content-type': 'application/json', 'x-canvas-command-id': command.id }, body: reply.body });
            if (!response.ok) {
              // A proxy/backend can enforce a lower limit. Resolve the pending command immediately.
              await request(`/canvases/${canvasId}/reply`, { commandId: command.id,
                error: `CANVAS_REPLY_REJECTED: method=${command.method} actualBytes=${reply.bytes} status=${response.status}; retry the identical requestId if this was a mutation` });
            }
            console.debug('canvas-reply', { method: command.method, bytes: reply.bytes, handleMs: Math.round(handled - started), encodeMs: Math.round(encoded - handled), replyMs: Math.round(performance.now() - encoded), durationMs: Math.round(performance.now() - started), oversized: reply.oversized });
          }
          await register();
        }
      } catch {
        if (!abort.signal.aborted) timer = setTimeout(() => void run(), 1000);
      }
    };
    void run();
    const unregister = () => { void apiFetch(`/api/mapping/agent/canvases/${canvasId}`, { method: 'DELETE', keepalive: true }).catch(() => undefined); };
    // React cleanup does not run on page reload. Retire this ephemeral instance
    // promptly, without ever deleting a replacement that has the same stable ID.
    window.addEventListener('pagehide', unregister);
    return () => { abort.abort(); clearTimeout(timer); window.removeEventListener('pagehide', unregister); unregister(); };
  }, [canvasId, identity]);
  useEffect(() => {
    setAgentStatus({ connected: false, count: 0 });
    if (!workspace || !identity) return;
    const endpoint = new URL(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/mapping/live`, location.href);
    endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    return publishLiveCanvasSelections(workspace, canvasId, endpoint.href, setAgentStatus, () => latest.current.canMutate());
  }, [workspace, canvasId, identity]);
  return { canvasId, agentStatus };
}
