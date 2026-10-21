import type { StorageChange } from '../../../../domain/core/storage/storageService';
import type { MappingDocumentSnapshot, MappingWorkspaceSnapshot } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { documentRecords, documentPrefix, type WorkspaceIndex, type WorkspaceRecordState } from '../../../../domain/mapping/workspace/workspaceRecords';
import { RecordStorage } from './recordStorage';

/** One worker per opened workspace; no worker construction in a store() call. */
export class WorkspaceStorage {
  records?: RecordStorage;
  private worker?: Worker;
  private id = 0;
  private requests = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private endpoint = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/mapping/workspace/records`;
  private ready?: Promise<MappingWorkspaceSnapshot | null>;
  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.worker = new Worker(new URL('./workspaceStorage.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const request = this.requests.get(data.id); if (!request) return;
      this.requests.delete(data.id);
      if (data.error) request.reject(Error(data.error)); else request.resolve(data.result);
    };
    const fail = () => {
      this.requests.forEach(r => r.reject(Error('Workspace worker stopped; reload to reconnect'))); this.requests.clear();
      worker.terminate(); this.worker = undefined;
    };
    worker.onerror = fail; worker.onmessageerror = fail;
    return worker;
  }
  private request<T>(input: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.requests.set(id, { resolve: value => resolve(value as T), reject });
      try { this.ensureWorker().postMessage({ ...input, id, endpoint: new URL(this.endpoint, location.href).href }); }
      catch (e) { this.requests.delete(id); reject(e); }
    });
  }
  load() {
    return this.ready ??= this.request<{ state: WorkspaceRecordState; workspace: MappingWorkspaceSnapshot | null }>({ type: 'load' }).then(({ state, workspace }) => {
      this.records = new RecordStorage(state, { write: batch => this.request({ type: 'write', batch }) }); return workspace;
    }).catch(error => { this.ready = undefined; throw error; });
  }
  async project(snapshot: MappingWorkspaceSnapshot) { return this.request<StorageChange[]>({ type: 'project', snapshot }); }
  async save(snapshot: MappingWorkspaceSnapshot) {
    await this.load(); await this.records!.flush();
    const changes = await this.project(snapshot);
    await this.records!.commit(changes);
  }

  /** Publish one canvas atomically without exporting/revalidating unrelated histories. */
  async saveDocument(document: MappingDocumentSnapshot, index: WorkspaceIndex, create = false) {
    await this.load(); await this.records!.flush();
    if (create && this.records!.get(documentPrefix(document.representationId) + 'metadata')) throw Error('Canvas already exists');
    await this.records!.commit([
      ...Object.entries(documentRecords(document)).map(([key, value]) => ({ key, value })),
      { key: 'workspace', value: index }
    ]);
  }

  async restore() {
    await this.records?.flush();
    this.records?.dispose(); this.ready = undefined;
    return this.load();
  }
  async flush() { await this.load(); await this.records!.flush(); }
  dispose() {
    this.records?.dispose(); this.worker?.terminate(); this.worker = undefined;
    this.requests.forEach(r => r.reject(Error('Storage closed'))); this.requests.clear();
  }
}
