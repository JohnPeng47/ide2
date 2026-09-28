import type { StorageChange, StorageService, StorageStatus } from '../../../../domain/core/storage/storageService';
import type { WorkspaceBatch, WorkspaceRecordState } from '../../../../domain/mapping/workspace/workspaceRecords';

export interface RecordTransport { write(batch: WorkspaceBatch): Promise<{ revision: number }> }
function equalEntry(a: unknown, b: unknown) { return a === b || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]); }
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && equalEntry((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
/** Cheap synchronous submission. Encoding and transport are supplied by a persistent worker. */
export class RecordStorage implements StorageService {
  private cache = new Map<string, unknown>();
  private pending = new Map<string, StorageChange>();
  private flight?: { batch: WorkspaceBatch; sequence: number };
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private firstPendingAt = 0;
  private sequence = 0;
  private persisted = 0;
  private revision: number;
  private error?: string;
  private failures = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  constructor(state: WorkspaceRecordState, private readonly transport: RecordTransport, private readonly delay = 150) {
    this.cache = new Map(Object.entries(state.records)); this.revision = state.revision;
  }
  get<T>(key: string): T | undefined { return this.cache.get(key) as T | undefined; }
  keys() { return [...this.cache.keys()]; }
  get status(): StorageStatus { return { pending: this.sequence > this.persisted, writing: !!this.running, error: this.error }; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { this.listeners.forEach(fn => fn()); }
  store(key: string, value: unknown) { this.batch([{ key, value }]); }
  remove(key: string) { this.batch([{ key, delete: true }]); }
  batch(changes: readonly StorageChange[]) {
    if (this.disposed) throw Error('Storage is closed');
    let changed = false;
    for (const change of changes) {
      if ('delete' in change) { if (!this.cache.delete(change.key)) continue; }
      else { if (this.cache.has(change.key) && same(this.cache.get(change.key), change.value)) continue; this.cache.set(change.key, change.value); }
      this.pending.set(change.key, change); changed = true;
    }
    if (!changed) return;
    this.sequence++;
    if (!this.firstPendingAt) this.firstPendingAt = Date.now();
    this.schedule(); this.notify();
  }
  private schedule(retry = false) {
    if (this.disposed || this.error?.includes('REJECTED:') || this.error?.includes('VERSION_CONFLICT') || this.error?.includes('REQUEST_ID_CONFLICT')) return;
    clearTimeout(this.timer);
    const delay = retry ? Math.min(30000, 500 * 2 ** Math.min(this.failures, 6))
      : Math.max(0, Math.min(this.delay, 1000 - (Date.now() - this.firstPendingAt)));
    this.timer = setTimeout(() => { this.timer = undefined; void this.pump().catch(() => {}); }, delay);
  }
  private pump(): Promise<void> {
    if (this.running) return this.running;
    if (!this.flight && !this.pending.size) return Promise.resolve();
    clearTimeout(this.timer);
    if (!this.flight) {
      this.flight = { batch: { requestId: crypto.randomUUID(), expectedRevision: this.revision, changes: [...this.pending.values()] }, sequence: this.sequence };
      this.pending.clear(); this.firstPendingAt = 0;
    }
    const flight = this.flight;
    this.running = Promise.resolve().then(() => this.transport.write(flight.batch)).then(result => {
      this.revision = result.revision; this.persisted = flight.sequence; this.flight = undefined; this.error = undefined; this.failures = 0;
    }).catch(error => { this.error = error instanceof Error ? error.message : String(error); this.failures++; throw error; })
      .finally(() => {
        this.running = undefined; this.notify();
        if (this.flight || this.pending.size) this.schedule(!!this.error);
      });
    this.notify(); return this.running;
  }
  async flush() {
    if (this.disposed) throw Error('Storage is closed');
    const target = this.sequence;
    while (this.persisted < target) await this.pump();
  }
  /** Explicit transactions are installed by the UI only after acknowledgement. */
  async commit(changes: readonly StorageChange[]) {
    await this.flush();
    const before = new Map(this.cache);
    this.batch(changes);
    for (;;) {
      try { await this.flush(); return; }
      catch (error) {
        if (String(error).includes('REJECTED:')) {
          // A definitive rejection did not commit. Do not later publish an abandoned UI operation.
          clearTimeout(this.timer); this.cache = before; this.pending.clear(); this.flight = undefined;
          this.persisted = this.sequence; this.error = undefined; this.notify(); throw error;
        }
        // An interrupted response is ambiguous: retry the identical request/ID before allowing another write.
        if (this.disposed) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  /** Callers must flush before an orderly close. Abrupt tab termination is not a flush guarantee. */
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear(); }
}
