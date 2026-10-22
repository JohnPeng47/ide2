import { checkpointRevisionIds } from '../../../../domain/core/diagrams/canvasHistory';
import { createHash, randomUUID } from 'node:crypto';
import { assertDiagramStorageFormat } from '../../../core/persistence/diagramStorageFormat';
import { mkdir, readFile, rename, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { ApplicationError } from '../../../../application/core/errors';
import { recordHistory, recordsWorkspace, validateRecordUpdate, workspaceRecords, type WorkspaceBatch, type WorkspaceRecords, type WorkspaceRecordState } from '../../../../domain/mapping/workspace/workspaceRecords';
import { loadCanvasCheckpoint } from '../../../../domain/core/diagrams/canvasCheckpointRecords';
import { stateKey } from '../../../../domain/core/diagrams/canvasHistory';
import type { MappingWorkspaceSnapshot } from '../../../../domain/mapping/workspace/mappingWorkspace';
import type { HistoryValidation } from '../../../../domain/core/diagrams/canvasHistory';

interface Manifest { schemaVersion: 1; projectId: string; revision: number; records: Record<string, string>; receipts: Record<string, { hash: string; revision: number }> }
const queues = new Map<string, Promise<unknown>>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** New records become reachable only through the final atomic manifest replacement. */
export class WorkspaceRecordStore {
  private cached?: { raw: string; manifest: Manifest; records: WorkspaceRecords; historyValidation: HistoryValidation };
  constructor(private readonly root: string) {}
  private get file() { return path.join(this.root, 'workspace-records.json'); }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = (queues.get(this.root) ?? Promise.resolve()).catch(() => {}).then(run);
    queues.set(this.root, next);
    void next.finally(() => { if (queues.get(this.root) === next) queues.delete(this.root); }).catch(() => {});
    return next;
  }
  private async read(projectId: string, historyValidation: HistoryValidation = 'all') {
    await assertDiagramStorageFormat(this.root);
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
    if (this.cached?.raw === raw) {
      if (this.cached.manifest.projectId !== projectId) throw Error('Workspace belongs to another project');
      if (historyValidation === 'all' && this.cached.historyValidation !== 'all') {
        if (Object.keys(this.cached.records).length) validateRecordUpdate(this.cached.records, Object.keys(this.cached.records), projectId);
        this.cached.historyValidation = 'all';
      }
      return this.cached;
    }
    const manifest = JSON.parse(raw) as Manifest;
    if (manifest.schemaVersion !== 1 || manifest.projectId !== projectId) throw Error('Workspace belongs to another project or has an invalid version');
    const records = Object.fromEntries(await Promise.all(Object.entries(manifest.records).map(async ([key, id]) => {
      if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid workspace record reference');
      const text = await readFile(path.join(this.root, 'workspace-records', id + '.json'), 'utf8');
      if (hash(text) !== id) throw Error('Workspace record integrity failure');
      return [key, JSON.parse(text)];
    })));
    if (Object.keys(records).length) validateRecordUpdate(records, Object.keys(records), projectId, historyValidation);
    return this.cached = { raw, manifest, records, historyValidation };
  }
  /** Pin immutable references from one manifest; only hydrate the selected current checkpoint. */
  async capture(projectId: string, documentId: string, checkpointId: string, version: number) {
    const manifest = JSON.parse(await readFile(this.file, 'utf8')) as Manifest;
    if (manifest.projectId !== projectId) throw Error('Workspace belongs to another project');
    const prefix = `document/${encodeURIComponent(documentId)}/`;
    const read = async (key: string) => {
      const id = manifest.records[prefix + key];
      if (!id || !/^[a-f0-9]{64}$/.test(id)) throw Error('WORKSPACE_UNAVAILABLE: checkpoint is not persisted');
      const text = await readFile(path.join(this.root, 'workspace-records', id + '.json'), 'utf8');
      if (hash(text) !== id) throw Error('Workspace record integrity failure');
      return JSON.parse(text);
    };
    const [header, metadata] = await Promise.all([read('history'), read('metadata')]);
    if (header.headId !== checkpointId || metadata.version !== version) throw Error('VERSION_CONFLICT: canvas changed while saving');
    const head = await loadCanvasCheckpoint(checkpointId, id => read('checkpoint/' + id), id => read('item/' + id), header.checkpointHead);
    const revisions = Object.fromEntries(await Promise.all(checkpointRevisionIds(head).map(async id => [id, await read('revision/' + id)])));
    const refs = (kind: string) => Object.fromEntries(Object.entries(manifest.records).filter(([key]) => key.startsWith(prefix + kind + '/'))
      .map(([key, id]) => [key.slice((prefix + kind + '/').length), { $diagramRecord: 'workspace', id }]));
    return { header, head, revisions, metadata, stored: { ...header, workspaceRecords: { checkpoints: refs('checkpoint'), revisions: refs('revision'), items: refs('item') } } };
  }
  async load(projectId: string): Promise<MappingWorkspaceSnapshot | undefined> {
    const state = await this.read(projectId); return state ? recordsWorkspace(state.records)! : undefined;
  }
  async state(projectId: string, legacy: () => Promise<MappingWorkspaceSnapshot | null>, historyValidation: HistoryValidation = 'all'): Promise<WorkspaceRecordState> {
    return this.serial(async () => {
      let state = await this.read(projectId, historyValidation);
      if (!state) {
        const snapshot = await legacy();
        const records = snapshot ? workspaceRecords(snapshot) : {};
        state = await this.publish({ schemaVersion: 1, projectId, revision: 0, records: {}, receipts: {} }, records, Object.keys(records));
      }
      return { revision: state.manifest.revision, records: state.records };
    });
  }
  async replace(projectId: string, snapshot: MappingWorkspaceSnapshot): Promise<boolean> {
    return this.serial(async () => {
      const state = await this.read(projectId); if (!state) return false;
      const records = workspaceRecords(snapshot);
      await this.publish({ ...state.manifest, revision: state.manifest.revision + 1, records: {} }, records, Object.keys(records)); return true;
    });
  }
  async apply(projectId: string, input: WorkspaceBatch): Promise<{ revision: number }> {
    return this.serial(async () => {
      if (!input || typeof input.requestId !== 'string' || !/^[\w-]{1,150}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision)
        || !Array.isArray(input.changes) || input.changes.length > 100000) throw Error('Invalid workspace batch');
      const state = await this.read(projectId, 'current'); if (!state) throw Error('Initialize workspace storage first');
      const digest = hash(JSON.stringify(input)), receipt = Object.hasOwn(state.manifest.receipts, input.requestId) ? state.manifest.receipts[input.requestId] : undefined;
      if (receipt) {
        if (receipt.hash !== digest) throw new ApplicationError('conflict', 'REQUEST_ID_CONFLICT: different batch');
        return { revision: receipt.revision };
      }
      if (input.expectedRevision !== state.manifest.revision) throw new ApplicationError('conflict', 'VERSION_CONFLICT: workspace changed in another client; reload before saving');
      const records = { ...state.records }, keys: string[] = [], seen = new Set<string>(), checkpointUpdates: string[] = [];
      for (const change of input.changes) {
        if (!change || typeof change.key !== 'string' || change.key.length > 1000 || Object.keys(change).some(k => !['key', 'value', 'delete'].includes(k))
          || ('delete' in change ? change.delete !== true || 'value' in change : !('value' in change))) throw Error('Invalid record change');
        if (change.key !== 'workspace' && !/^document\//.test(change.key)) throw Error('Invalid workspace key');
        if (seen.has(change.key)) throw Error('Duplicate key in batch');
        seen.add(change.key); keys.push(change.key);
        if ('delete' in change) delete records[change.key]; else {
          const previous = records[change.key];
          if (previous && change.key.includes('/revision/') && JSON.stringify(previous) !== JSON.stringify(change.value)) throw Error('Immutable diagram revision changed');
          if (previous && change.key.includes('/item/') && JSON.stringify(previous) !== JSON.stringify(change.value)) throw Error('Immutable canvas item changed');
          if (previous && change.key.includes('/checkpoint/')) {
            const { transactionId: _before, ...before } = previous as Record<string, unknown>;
            const { transactionId: _after, ...after } = change.value as Record<string, unknown>;
            if (JSON.stringify(before) !== JSON.stringify(after)) checkpointUpdates.push(change.key);
          }
          records[change.key] = change.value;
        }
      }
      // Checkpoints may be re-encoded (legacy migration or a new delta base),
      // but their semantic content is immutable.
      const migrated = new Map<string, [ReturnType<typeof recordHistory>, ReturnType<typeof recordHistory>]>();
      for (const key of checkpointUpdates) {
        const [, encoded, , checkpointId] = key.split('/'), id = decodeURIComponent(encoded);
        if (!migrated.has(id)) migrated.set(id, [recordHistory(state.records, id), recordHistory(records, id)]);
        const [beforeHistory, afterHistory] = migrated.get(id)!;
        const { transactionId: _before, ...before } = beforeHistory.snapshots[checkpointId];
        const { transactionId: _after, ...after } = afterHistory.snapshots[checkpointId];
        if (stateKey(before) !== stateKey(after)) throw Error('Immutable canvas checkpoint changed');
      }
      validateRecordUpdate(records, keys, projectId);
      const revision = state.manifest.revision + 1;
      try {
        await this.publish({ ...state.manifest, revision, records: { ...state.manifest.records },
          receipts: { ...state.manifest.receipts, [input.requestId]: { hash: digest, revision } } }, records, keys);
      } catch (error) {
        // Publication might have succeeded before a directory fsync or response
        // failed. The client must retry this ID to discover the durable receipt.
        throw new ApplicationError('storage-unavailable', error instanceof Error ? error.message : String(error));
      }
      return { revision };
    });
  }
  private async atomic(file: string, text: string) {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temp, 'wx');
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, file);
      const dir = await open(path.dirname(file), 'r'); try { await dir.sync(); } finally { await dir.close(); }
    } finally { await rm(temp, { force: true }); }
  }
  private async publish(manifest: Manifest, records: WorkspaceRecords, keys: string[]) {
    // Serial writes bound descriptors and memory even during initial migration.
    for (const key of keys) {
      if (!Object.hasOwn(records, key)) { delete manifest.records[key]; continue; }
      const text = JSON.stringify(records[key]), id = hash(text);
      if (manifest.records[key] !== id) {
        const file = path.join(this.root, 'workspace-records', id + '.json');
        try { if (await readFile(file, 'utf8') !== text) throw Error('Workspace record integrity failure'); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; await this.atomic(file, text); }
        manifest.records[key] = id;
      }
    }
    const raw = JSON.stringify(manifest);
    await this.atomic(this.file, raw);
    return this.cached = { raw, manifest, records, historyValidation: 'current' };
  }
}
