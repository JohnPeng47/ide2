import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceRecordStore } from '../workspaceRecordStore';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { documentPrefix, type WorkspaceBatch, type WorkspaceIndex } from '../../../../../domain/mapping/workspace/workspaceRecords';
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, rename: vi.fn(actual.rename) }; });
const roots: string[] = [];
afterEach(async () => { vi.mocked(rename).mockClear(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'workspace-records-')); roots.push(root);
  const store = new WorkspaceRecordStore(root), document = { scene: singleDiagramScene('Alpha'), edges: [], sections: {} };
  const state = await store.state('project', async () => ({ schemaVersion: 3, projectId: 'project', activeDocumentId: 'draft-a', documents: [
    { representationId: 'draft-a', name: 'Alpha', savedName: '', savedScene: JSON.stringify(document.scene), revisionId: '', document, canvas: initialCanvasState() }
  ] }));
  const prefix = documentPrefix('draft-a');
  const batch: WorkspaceBatch = { requestId: 'rename', expectedRevision: 0, changes: [{ key: prefix + 'metadata', value: { ...state.records[prefix + 'metadata'] as object, name: 'Renamed' } }] };
  return { root, store, state, batch, prefix };
}
it('migrates once and persists a changed record without rewriting existing histories', async () => {
  const { root, store, state, batch } = await fixture(); vi.mocked(rename).mockClear();
  await store.apply('project', batch);
  expect(vi.mocked(rename).mock.calls).toHaveLength(2); // one record, one manifest
  const loaded = await new WorkspaceRecordStore(root).load('project');
  expect(loaded?.documents[0].name).toBe('Renamed');
  expect(Object.keys((await store.state('project', async () => null)).records)).toEqual(Object.keys(state.records));
});
it('recognizes identical retries after restart and rejects changed IDs and stale clients', async () => {
  const { root, store, batch } = await fixture(); await store.apply('project', batch);
  const restarted = new WorkspaceRecordStore(root);
  expect(await restarted.apply('project', batch)).toEqual({ revision: 1 });
  await expect(restarted.apply('project', { ...batch, changes: [] })).rejects.toThrow('REQUEST_ID_CONFLICT');
  await expect(restarted.apply('project', { ...batch, requestId: 'other-client' })).rejects.toThrow('VERSION_CONFLICT');
});
it('a failed manifest publication exposes the old complete workspace and can be retried', async () => {
  const { root, store, batch } = await fixture();
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockImplementationOnce(real.rename).mockRejectedValueOnce(Error('disk full'));
  await expect(store.apply('project', batch)).rejects.toThrow('disk full');
  expect((await new WorkspaceRecordStore(root).load('project'))?.documents[0].name).toBe('Alpha');
  expect(await store.apply('project', batch)).toEqual({ revision: 1 });
});
it('rejects incomplete atomic removals and broken history references without replacing the manifest', async () => {
  const { store, batch, prefix } = await fixture();
  await expect(store.apply('project', { ...batch, changes: [{ key: prefix + 'history', delete: true }] })).rejects.toThrow('Incomplete');
  expect((await store.load('project'))?.documents[0].name).toBe('Alpha');
});
it('removes a canvas and its records atomically', async () => {
  const { root, store, state } = await fixture();
  const index = state.records.workspace as WorkspaceIndex;
  await store.apply('project', { requestId: 'delete', expectedRevision: 0, changes: [
    ...Object.keys(state.records).filter(key => key !== 'workspace').map(key => ({ key, delete: true as const })),
    { key: 'workspace', value: { ...index, activeDocumentId: undefined, documentIds: [] } }
  ] });
  expect((await new WorkspaceRecordStore(root).load('project'))?.documents).toEqual([]);
});
it('can reopen an initialized project before its first canvas is saved', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'empty-workspace-')); roots.push(root);
  await new WorkspaceRecordStore(root).state('project', async () => null);
  expect(await new WorkspaceRecordStore(root).state('project', async () => { throw Error('Must not migrate again'); }))
    .toEqual({ revision: 0, records: {} });
});
it('rejects deletion of a revision still referenced by an accepted checkpoint', async () => {
  const { store, state, batch } = await fixture();
  const key = Object.keys(state.records).find(key => key.includes('/revision/'))!;
  await expect(store.apply('project', { ...batch, changes: [{ key, delete: true }] })).rejects.toThrow('Invalid diagram binding');
  expect((await store.load('project'))?.documents[0].name).toBe('Alpha');
});
it('requires canvas removal to delete all its indexed records in the same batch', async () => {
  const { store, state, batch } = await fixture();
  await expect(store.apply('project', { ...batch, changes: [{ key: 'workspace', value: {
    ...state.records.workspace as WorkspaceIndex, documentIds: [], activeDocumentId: undefined
  } }] })).rejects.toThrow('Record belongs to a removed canvas');
});
