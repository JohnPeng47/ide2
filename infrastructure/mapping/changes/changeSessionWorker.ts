import { Worker } from 'node:worker_threads';
/** One persistent worker per project store. Idle workers do not keep a process alive. */
class ChangeSessionWorker {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  constructor(private readonly root: string) {}
  request<T>(method: string, args: unknown[]): Promise<T> {
    if (!this.worker) {
      const worker = this.worker = new Worker(new URL('./changeSessionWorkerEntry.mjs', import.meta.url), { workerData: { root: this.root } });
      worker.on('message', ({ id, value, error }) => {
        const request = this.pending.get(id); if (!request) return;
        this.pending.delete(id);
        if (error) request.reject(Object.assign(Error(error.message), { code: error.code })); else request.resolve(value);
        if (!this.pending.size) worker.unref();
      });
      const fail = (error: Error) => { if (this.worker !== worker) return;
        this.worker = undefined; this.pending.forEach(request => request.reject(error)); this.pending.clear(); void worker.terminate(); };
      worker.on('error', fail); worker.on('exit', () => fail(Error('Change-session worker stopped; retry the request')));
    }
    const id = ++this.sequence;
    this.worker.ref();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      try { this.worker!.postMessage({ id, method, args }); }
      catch (error) { this.pending.delete(id); if (!this.pending.size) this.worker!.unref(); reject(error); }
    });
  }
}
const workers = new Map<string, ChangeSessionWorker>();
export function changeSessionWorker(root: string) {
  let worker = workers.get(root); if (!worker) workers.set(root, worker = new ChangeSessionWorker(root)); return worker;
}
