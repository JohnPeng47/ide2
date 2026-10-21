import type { WorkspaceTask, WorkspaceTaskResult } from './workspaceTask';

/** One isolated job: expensive history validation never blocks pointer or paint events. */
export function runWorkspaceTask<T extends WorkspaceTask>(task: T, signal?: AbortSignal): Promise<WorkspaceTaskResult<T>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Layout cancelled')); return; }
    const worker = new Worker(new URL('./workspaceTask.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const abort = () => fail('Layout cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      cleanup();
      if (data.error) reject(new Error(data.error)); else resolve(data.result);
    };
    worker.onerror = event => fail(event.message || 'Could not prepare workspace');
    worker.onmessageerror = () => fail('Could not read workspace result');
    try { worker.postMessage(task); } catch (error) { fail(String(error)); }
  });
}
