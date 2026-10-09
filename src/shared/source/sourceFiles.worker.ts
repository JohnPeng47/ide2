import { fetchProjectSourceFile } from '../http/api';
import { SourceFileCache, type SourceFileRequest } from './sourceFileCache';

export type SourceWorkerRequest = { kind: 'preload'; files: SourceFileRequest[] }
  | { kind: 'read'; id: number; file: SourceFileRequest; reload?: boolean };
const cache = new SourceFileCache(async ({ repo, path }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const file = await fetchProjectSourceFile(repo.projectId, path, controller.signal, repo.sourceId || undefined);
    return { path: file.path, text: file.lines.join('\n'), sha256: file.sourceSha256, lspEnabled: file.lspEnabled };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Source loading timed out. Retry to load this file again.');
    throw error;
  } finally { clearTimeout(timeout); }
});
self.onmessage = (event: MessageEvent<SourceWorkerRequest>) => {
  const request = event.data;
  if (request.kind === 'preload') { cache.preload(request.files); return; }
  void cache.read(request.file, request.reload).then(file => self.postMessage({ id: request.id, file }),
    error => self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }));
};
