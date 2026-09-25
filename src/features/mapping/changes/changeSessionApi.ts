import type { DiagramChangeSession, ChangeSessionSummary } from '../../../../domain/mapping/changes/diagramChangeSession';
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/mapping/agent/change-sessions${path}`, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Could not read change sessions');
  return body;
}
export const listChangeSessions = (signal?: AbortSignal) => get<ChangeSessionSummary[]>('', signal);
export const readChangeSession = (id: string, signal?: AbortSignal) => get<Omit<DiagramChangeSession, 'receipts'>>(`/${encodeURIComponent(id)}`, signal);
export async function acceptChangeSession(id: string, expectedVersion: number, requestId: string): Promise<ChangeSessionSummary> {
  const response = await fetch('/api/mapping/agent/tools/accept_diagram_change_session', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changeSessionId: id, expectedVersion, requestId })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Could not accept change session');
  return body;
}
export interface DisplayModeChange { kind: 'change-session'; sessionId: string; documentId: string; changeId?: string; serial: number }
