import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../http/api', () => ({ fetchProjectSourceFile: vi.fn() }));
import { fetchProjectSourceFile } from '../../http/api';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); vi.resetModules(); });

it('times out a stalled preload, reports the error to its reader, and lets the next read retry', async () => {
  vi.useFakeTimers();
  const scope = { onmessage: undefined as undefined | ((event: { data: unknown }) => void), postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.mocked(fetchProjectSourceFile).mockImplementationOnce((_project, _path, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })).mockResolvedValue({ path: 'file.ts', startLine: 1, lines: ['const ready = true;'], sourceSha256: 'hash', lspEnabled: false });
  await import('../sourceFiles.worker');
  const file = { repo: { projectId: 'project', sourceId: 'source' }, path: 'file.ts' };
  scope.onmessage!({ data: { kind: 'preload', files: [file] } });
  scope.onmessage!({ data: { kind: 'read', id: 1, file } });
  expect(fetchProjectSourceFile).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scope.postMessage).toHaveBeenCalledWith({ id: 1, error: 'Source loading timed out. Retry to load this file again.' });
  scope.onmessage!({ data: { kind: 'read', id: 2, file } });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchProjectSourceFile).toHaveBeenCalledTimes(2);
  expect(scope.postMessage).toHaveBeenCalledWith({ id: 2, file: { path: 'file.ts', text: 'const ready = true;', sha256: 'hash', lspEnabled: false } });
});
