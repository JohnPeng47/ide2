import type { CodeRepoFile, CodeRepoService } from '../../../domain/core/source/codeRepoService';
import type { SourceWorkerRequest } from './sourceFiles.worker';

/** Cancellation detaches a reader without discarding a shared preload. */
export function sourceFilesClient(): Pick<CodeRepoService, 'readFile' | 'preloadFiles'> {
  let worker: Worker | undefined, serial = 0;
  const pending = new Map<number, { resolve: (file: CodeRepoFile) => void; reject: (error: Error) => void }>();
  const send = (request: SourceWorkerRequest) => {
    if (!worker) {
      worker = new Worker(new URL('./sourceFiles.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<{ id: number; file: CodeRepoFile; error?: string }>) => {
        const reader = pending.get(data.id); pending.delete(data.id);
        if (data.error) reader?.reject(new Error(data.error)); else reader?.resolve(data.file);
      };
      worker.onerror = () => {
        worker?.terminate(); worker = undefined;
        pending.forEach(reader => reader.reject(new Error('Could not load source files. Retry to restart the source worker.')));
        pending.clear();
      };
    }
    worker.postMessage(request);
  };
  return {
    preloadFiles: files => send({ kind: 'preload', files: [...files] }),
    readFile: (repo, path, options) => new Promise((resolve, reject) => {
      const id = ++serial, signal = options?.signal;
      const abort = () => { pending.delete(id); reject(new DOMException('Source read cancelled', 'AbortError')); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      const finish = () => signal?.removeEventListener('abort', abort);
      pending.set(id, { resolve: file => { finish(); resolve(file); }, reject: error => { finish(); reject(error); } });
      try { send({ kind: 'read', id, file: { repo, path }, reload: options?.reload }); }
      catch (error) { pending.delete(id); finish(); reject(error); }
    })
  };
}
