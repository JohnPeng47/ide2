import { publishLiveCanvasSelections } from './liveCanvasPublisher';
import type { CanvasWorkspace } from '../workspace/canvasWorkspace';
import { useEffect, useRef, useState } from 'react';
import type { CanvasCommand, CanvasDescriptor } from '../../../../domain/mapping/agent/contracts';
import { apiFetch, errorFrom } from '../../../shared/http/http';

export function useAgentCanvasBridge(descriptor: Omit<CanvasDescriptor, 'canvasId'>, handle: (command: CanvasCommand) => Promise<unknown>, workspace?: CanvasWorkspace) {
  const [canvasId] = useState(() => crypto.randomUUID());
  const latest = useRef({ descriptor, handle }); latest.current = { descriptor, handle };
  const registration = JSON.stringify({ ...descriptor, canvasId });
  useEffect(() => {
    void apiFetch('/api/mapping/agent/canvases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: registration }).catch(() => undefined);
  }, [registration]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const results = new Map<string, { value?: unknown; error?: string }>();
    const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
      const response = await apiFetch(`/api/mapping/agent${path}`, { method, signal: abort.signal,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
      if (!response.ok) throw await errorFrom(response);
      return response.json();
    };
    const register = () => request('/canvases', { ...latest.current.descriptor, canvasId });
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
              results.set(command.id, result);
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
    return () => { abort.abort(); clearTimeout(timer); void apiFetch(`/api/mapping/agent/canvases/${canvasId}`, { method: 'DELETE', keepalive: true }).catch(() => undefined); };
  }, [canvasId]);
  useEffect(() => {
    if (!workspace) return;
    const endpoint = new URL(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/mapping/live`, location.href);
    endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    return publishLiveCanvasSelections(workspace, canvasId, endpoint.href);
  }, [workspace, canvasId]);
  return canvasId;
}
