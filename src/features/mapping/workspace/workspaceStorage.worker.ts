import { deserializeWorkspace } from '../../../../domain/mapping/workspace/mappingWorkspaceCodec';
import { normalizeRecord, recordsWorkspace, workspaceRecords, type WorkspaceBatch, type WorkspaceRecordState } from '../../../../domain/mapping/workspace/workspaceRecords';
import type { MappingWorkspaceSnapshot } from '../../../../domain/mapping/workspace/mappingWorkspace';

let endpoint = '';
const bodies = new Map<string, string>();
const known = new Map<string, string>();
let initialized = false;
async function readState(): Promise<WorkspaceRecordState> {
  const response = await fetch(endpoint, { cache: 'no-store' });
  const value = await response.json(); if (!response.ok) throw Error(value.error ?? 'Could not load storage');
  const state = value as WorkspaceRecordState;
  known.clear(); for (const [key, record] of Object.entries(state.records)) known.set(key, JSON.stringify(record));
  initialized = true;
  return state;
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; type: string; endpoint?: string; batch?: WorkspaceBatch; snapshot?: MappingWorkspaceSnapshot }>) => {
  try {
    endpoint = data.endpoint ?? endpoint;
    let result: unknown;
    if (data.type === 'load') {
      endpoint = data.endpoint!;
      const state = await readState();
      const workspace = recordsWorkspace(state.records);
      result = { state, workspace: workspace ? deserializeWorkspace(workspace) : null };
    } else if (data.type === 'project') {
      // A restarted worker can retry in-flight writes immediately, but must know
      // the complete key set before diffing an explicit workspace replacement.
      if (!initialized) await readState();
      const records = workspaceRecords(deserializeWorkspace(data.snapshot));
      result = [...Object.entries(records).filter(([key, value]) => JSON.stringify(value) !== known.get(key)).map(([key, value]) => ({ key, value })),
        ...[...known.keys()].filter(key => !Object.hasOwn(records, key)).map(key => ({ key, delete: true }))];
    } else {
      const batch = data.batch!;
      let body = bodies.get(batch.requestId);
      if (!body) {
        body = JSON.stringify({ ...batch, changes: batch.changes.map(c => 'value' in c ? { ...c, value: normalizeRecord(c.key, c.value) } : c) });
        bodies.set(batch.requestId, body);
      }
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      result = await response.json();
      if (!response.ok) {
        // A server/transport failure can happen after publication. Only a client
        // rejection proves the transaction was not accepted.
        const rejected = response.status >= 400 && response.status < 500;
        if (rejected) bodies.delete(batch.requestId);
        throw Error((rejected ? 'REJECTED: ' : 'Write uncertain: ') + ((result as { error?: string }).error ?? 'Could not save storage'));
      }
      const submitted = JSON.parse(body) as WorkspaceBatch;
      for (const change of submitted.changes) { if ('delete' in change) known.delete(change.key); else known.set(change.key, JSON.stringify(change.value)); }
      bodies.delete(batch.requestId);
    }
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
