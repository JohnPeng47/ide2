import { expect, it, vi } from 'vitest';
import { SourceFileCache, type SourceFileRequest } from '../sourceFileCache';
const file = (path: string, sourceId = 'repo'): SourceFileRequest => ({ repo: { projectId: 'project', sourceId }, path, version: 'one' });
const content = (path: string) => ({ path, text: 'source', sha256: 'hash' });

it('deduplicates preload and interactive reads, preserving repository identity', async () => {
  const load = vi.fn(async (file: SourceFileRequest) => content(file.path));
  const cache = new SourceFileCache(load);
  cache.preload([file('a.ts'), file('a.ts'), file('b.ts')]);
  await cache.read(file('a.ts'));
  await cache.read({ ...file('b.ts'), version: undefined });
  expect(load).toHaveBeenCalledTimes(2);
  await cache.read(file('a.ts', 'other'));
  expect(load).toHaveBeenCalledTimes(3);
});

it('bounds preload concurrency and prioritizes a requested file already in the queue', async () => {
  const starts: string[] = [], finish: (() => void)[] = [];
  const cache = new SourceFileCache(request => new Promise(resolve => {
    starts.push(request.path); finish.push(() => resolve(content(request.path)));
  }), 1);
  cache.preload([file('first'), file('second'), file('third')]);
  const third = cache.read(file('third'));
  expect(starts).toEqual(['first']);
  finish.shift()!();
  await vi.waitFor(() => expect(starts).toEqual(['first', 'third']));
  finish.shift()!(); await third;
  await vi.waitFor(() => expect(starts).toEqual(['first', 'third', 'second']));
  finish.shift()!();
});

it('retries failed reads, refreshes explicitly, and invalidates changed mapping versions', async () => {
  const load = vi.fn(async (request: SourceFileRequest) => content(request.path));
  load.mockRejectedValueOnce(new Error('missing'));
  const cache = new SourceFileCache(load);
  await expect(cache.read(file('a.ts'))).rejects.toThrow('missing');
  await cache.read(file('a.ts'));
  await cache.read(file('a.ts'), true);
  await cache.read({ ...file('a.ts'), version: 'two' });
  expect(load).toHaveBeenCalledTimes(4);
});

it('a saved pane opening before preload does not fetch the same file twice', async () => {
  const load = vi.fn(async (request: SourceFileRequest) => content(request.path));
  const cache = new SourceFileCache(load);
  const opened = cache.read({ ...file('a.ts'), version: undefined });
  cache.preload([file('a.ts')]);
  await opened;
  expect(load).toHaveBeenCalledTimes(1);
});
