import type { WorkspaceTask, WorkspaceTaskResult } from './workspaceTask';

/** One isolated job: expensive history validation never blocks pointer or paint events. */
export function runWorkspaceTask<T extends WorkspaceTask>(task: T): Promise<WorkspaceTaskResult<T>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workspaceTask.worker.ts', import.meta.url), { type: 'module' });
    const fail = (message: string) => { worker.terminate(); reject(new Error(message)); };
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error)); else resolve(data.result);
    };
    worker.onerror = event => fail(event.message || 'Could not prepare workspace');
    worker.onmessageerror = () => fail('Could not read workspace result');
    try { worker.postMessage(task); } catch (error) { fail(String(error)); }
  });
}
