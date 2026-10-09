import type { DiagramChangeSession, ChangeSessionSummary } from '../../../../domain/mapping/changes/diagramChangeSession';
import { apiFetch } from '../../../shared/http/http';
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(`/api/mapping/agent/change-sessions${path}`, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Could not read change sessions');
  return body;
}
export const listChangeSessions = (signal?: AbortSignal) => get<ChangeSessionSummary[]>('', signal);
export const readChangeSession = (id: string, signal?: AbortSignal) => get<Omit<DiagramChangeSession, 'receipts'>>(`/${encodeURIComponent(id)}`, signal);
export async function acceptChangeSession(id: string, expectedVersion: number, requestId: string): Promise<ChangeSessionSummary> {
  const response = await apiFetch(`/api/mapping/agent/change-sessions/${encodeURIComponent(id)}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion, requestId })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Could not accept change session');
  return body;
}
export interface DisplayModeChange { view?: 'diff-tree'; kind: 'change-session'; sessionId: string; documentId: string; changeId?: string; migrationId?: string; migrationRole?: 'source' | 'destination'; displayNodeId?: string; contentNodeId?: string; serial: number }

export interface DiffTreeRead {
  changeSessionId: string; title: string; version: number; status: DiagramChangeSession['status']; head?: string; commits?: string[];
  documents?: ChangeSessionSummary['documents']; changes?: ChangeSessionSummary['changes'];
  diffTree: null | import('../../../../domain/mapping/changes/diffTree').DiffTreeSummary & {
    diagram: import('../../../../domain/core/diagrams/diagram').Diagram;
    nodes: import('../../../../domain/core/diagrams/diagramContent').DiagramContentNode[];
    mappings: import('../../../../domain/mapping/changes/diffTree').DiffTreeMapping[];
  };
  hunks: import('../../../../domain/core/diffs/gitDiffHunk').GitDiffHunk[];
  total: number; nextOffset: number | null; unmappedNodeIds: string[];
}
export async function readDiffTree(id: string, input: { nodeIds?: string[]; offset?: number; limit?: number; includePatches?: boolean }, signal: AbortSignal): Promise<DiffTreeRead> {
  const response = await apiFetch('/api/mapping/agent/tools/read_change_session_diff_tree', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changeSessionId: id, ...input }), signal
  });
  const result = await response.json(); if (!response.ok) throw Error(result.error ?? 'Could not read DiffTree'); return result;
}
