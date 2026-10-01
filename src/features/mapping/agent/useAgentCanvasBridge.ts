import { publishLiveCanvasSelections, type LiveAgentStatus } from './liveCanvasPublisher';
import type { CanvasWorkspace } from '../workspace/canvasWorkspace';
import { useEffect, useRef, useState } from 'react';
import type { CanvasCommand, CanvasDescriptor } from '../../../../domain/mapping/agent/contracts';
import { apiFetch, errorFrom } from '../../../shared/http/http';
import { browserStableWorkspaceId } from './stableWorkspaceIdentity';

export function useAgentCanvasBridge(descriptor: Omit<CanvasDescriptor, 'canvasId' | 'stableWorkspaceId'>, handle: (command: CanvasCommand) => Promise<unknown>, workspace?: CanvasWorkspace) {
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
  const latest = useRef({ descriptor, handle }); latest.current = { descriptor, handle };
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
            let result = results.get(command.id);
            if (!result) {
              try { result = { value: await latest.current.handle(command) }; }
              catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
              // Context is a fresh read and may be large; never retain it in the mutation receipt cache.
              if (command.method === 'context' && new TextEncoder().encode(JSON.stringify(result)).length > 64 * 1024 * 1024 - 1024)
                result = { error: 'CONTEXT_TOO_LARGE: canvas context exceeds the 64 MiB transport limit' };
              if (command.method !== 'context') results.set(command.id, result);
              if (results.size > 200) results.delete(results.keys().next().value!);
            }
            await request(`/canvases/${canvasId}/reply`, { commandId: command.id, ...result });
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
    return publishLiveCanvasSelections(workspace, canvasId, endpoint.href, setAgentStatus);
  }, [workspace, canvasId, identity]);
  return { canvasId, agentStatus };
}
