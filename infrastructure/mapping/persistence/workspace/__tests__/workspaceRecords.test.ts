import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, rename, readFile, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceRecordStore } from '../workspaceRecordStore';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { documentPrefix, historyChanges, type WorkspaceBatch, type WorkspaceIndex } from '../../../../../domain/mapping/workspace/workspaceRecords';
import { CanvasCheckpointEncoder } from '../../../../../domain/core/diagrams/canvasCheckpointRecords';
import { MappingDocumentController } from '../../../../../domain/mapping/workspace/mappingDocumentController';
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open) }; });
const roots: string[] = [];
afterEach(async () => { vi.mocked(rename).mockClear(); vi.mocked(open).mockReset(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
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
it('syncs the record directory once before publishing, including a retry after its sync fails', async () => {
  const { root, store, state, batch, prefix } = await fixture();
  batch.changes.push({ key: prefix + 'baseline', value: { ...state.records[prefix + 'baseline'] as object, savedName: 'New baseline' } });
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const synced: string[] = [];
  let failDirectory = true;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await real.open(...args), sync = handle.sync.bind(handle);
    vi.spyOn(handle, 'sync').mockImplementation(async () => {
      const file = String(args[0]); synced.push(file);
      if (file === path.join(root, 'workspace-records') && failDirectory) { failDirectory = false; throw Error('directory sync failed'); }
      await sync();
    });
    return handle;
  });
  await expect(store.apply('project', batch)).rejects.toThrow('directory sync failed');
  expect((await new WorkspaceRecordStore(root).load('project'))?.documents[0].name).toBe('Alpha');
  expect(synced.filter(file => file === path.join(root, 'workspace-records'))).toHaveLength(1);
  expect(synced.some(file => file.includes('workspace-records.json.'))).toBe(false);
  synced.length = 0;
  await store.apply('project', batch);
  // The already-written immutable blobs still need their directory made durable.
  expect(synced).toEqual([path.join(root, 'workspace-records'), expect.stringContaining('workspace-records.json.'), root]);
  expect((await new WorkspaceRecordStore(root).load('project'))?.documents[0].name).toBe('Renamed');
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

it('defers historical checkpoint validation on startup without weakening full reads or new writes', async () => {
  const { root, store, prefix } = await fixture();
  const document = { scene: singleDiagramScene('Start'), edges: [], sections: {} };
  const controller = new MappingDocumentController(document, initialCanvasState());
  controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Current' }]);
  const history = controller.exportHistory();
  await store.replace('project', { schemaVersion: 3, projectId: 'project', activeDocumentId: 'draft-a', documents: [{
    representationId: 'draft-a', name: 'Current', savedName: 'Current', savedScene: JSON.stringify(controller.getSnapshot().document.scene),
    revisionId: '', document: controller.getSnapshot().document, canvas: initialCanvasState(), history
  }] });
  const file = path.join(root, 'workspace-records.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  // Exercise the pre-diff storage format, which remains readable without a migration.
  const putLegacy = async (key: string, value: unknown) => {
    const text = JSON.stringify(value), hash = createHash('sha256').update(text).digest('hex');
    await writeFile(path.join(root, 'workspace-records', hash + '.json'), text); manifest.records[key] = hash;
  };
  for (const [id, snapshot] of Object.entries(history.snapshots)) await putLegacy(prefix + 'checkpoint/' + id, snapshot);
  const { checkpointHead: _, ...header } = JSON.parse(await readFile(path.join(root, 'workspace-records', manifest.records[prefix + 'history'] + '.json'), 'utf8'));
  await putLegacy(prefix + 'history', header);
  const key = prefix + 'checkpoint/' + history.past.at(-1);
  const checkpoint = JSON.parse(await readFile(path.join(root, 'workspace-records', manifest.records[key] + '.json'), 'utf8'));
  checkpoint.document.scene.root.kind = 'invalid';
  const text = JSON.stringify(checkpoint), hash = createHash('sha256').update(text).digest('hex');
  await writeFile(path.join(root, 'workspace-records', hash + '.json'), text);
  manifest.records[key] = hash; await writeFile(file, JSON.stringify(manifest));
  const restarted = new WorkspaceRecordStore(root);
  const state = await restarted.state('project', async () => null, 'current');
  expect(state.records[key]).toEqual(checkpoint);
  await expect(restarted.state('project', async () => null)).rejects.toThrow('Invalid canvas box kind');
  await expect(restarted.apply('project', { requestId: 'invalid-checkpoint', expectedRevision: state.revision,
    changes: [{ key, value: checkpoint }] })).rejects.toThrow('Invalid canvas box kind');
  // Integrity checking is independent of the deferred semantic validation.
  await writeFile(path.join(root, 'workspace-records', hash + '.json'), '{}');
  await expect(new WorkspaceRecordStore(root).state('project', async () => null, 'current')).rejects.toThrow('integrity');
});

it('migrates legacy checkpoints atomically, accepts equivalent delta bases, and rejects changed history', async () => {
  const { root, store, prefix } = await fixture();
  const document = { scene: singleDiagramScene('Before'), edges: [], sections: {} };
  const controller = new MappingDocumentController(document, initialCanvasState());
  controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'After' }]);
  const history = controller.exportHistory();
  const { snapshots, diagramRevisions, ...header } = history;
  // Seed the previous expanded format through the same atomic record protocol.
  const state = await store.state('project', async () => null);
  await store.apply('project', { requestId: 'legacy', expectedRevision: state.revision, changes: [
    ...Object.keys(state.records).filter(key => key.includes('/checkpoint/') || key.includes('/revision/')).map(key => ({ key, delete: true as const })),
    { key: prefix + 'history', value: header },
    ...Object.entries(snapshots).map(([id, value]) => ({ key: prefix + 'checkpoint/' + id, value })),
    ...Object.entries(diagramRevisions).map(([id, value]) => ({ key: prefix + 'revision/' + id, value }))
  ] });
  const migrated = new WorkspaceRecordStore(root), changes = controller.persistenceChanges();
  await migrated.apply('project', { requestId: 'compact', expectedRevision: state.revision + 1, changes: historyChanges('draft-a', changes) });
  expect((await new WorkspaceRecordStore(root).load('project'))!.documents[0].history).toEqual(history);
  // A standalone encoding and a delta encoding represent the same immutable checkpoint.
  const headId = history.headId, standalone = new CanvasCheckpointEncoder().encode({ [headId]: snapshots[headId] });
  const encodedChanges = [
    ...Object.entries(standalone.items).map(([id, value]) => ({ key: prefix + 'item/' + id, value })),
    { key: prefix + 'checkpoint/' + headId, value: standalone.checkpoints[headId] }
  ];
  await migrated.apply('project', { requestId: 'standalone', expectedRevision: state.revision + 2, changes: encodedChanges });
  expect((await new WorkspaceRecordStore(root).load('project'))!.documents[0].history).toEqual(history);
  const changed = structuredClone(snapshots[headId]); changed.document.sections = { corrupt: 'Changed' } as any;
  const manifestBefore = await readFile(path.join(root, 'workspace-records.json'), 'utf8');
  await expect(migrated.apply('project', { requestId: 'mutate', expectedRevision: state.revision + 3, changes: [
    { key: prefix + 'checkpoint/' + headId, value: changed }, { key: prefix + 'history', value: header }
  ] })).rejects.toThrow('Immutable canvas checkpoint changed');
  expect(await readFile(path.join(root, 'workspace-records.json'), 'utf8')).toBe(manifestBefore);
});
