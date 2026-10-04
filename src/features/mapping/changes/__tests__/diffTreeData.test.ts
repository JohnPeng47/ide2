import { afterEach, expect, it, vi } from 'vitest';
import { readDiffTree, type DiffTreeRead } from '../changeSessionApi';
import { prefetchDiffTree } from '../diffTreeData';
vi.mock('../changeSessionApi', () => ({ readDiffTree: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it('starts remaining pages in parallel, coalesces readers, and reuses patches for metadata changes', async () => {
  let now = 10000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const page = (offset: number, version = 0) => ({ version, total: 301, nextOffset: offset < 300 ? offset + 100 : null,
    commits: ['commit'], head: 'head', diffTree: { revisionId: `revision-${version}`, hunkCount: 301 },
    hunks: Array.from({ length: Math.min(100, 301 - offset) }, (_, i) => ({ id: String(offset + i), patch: '+added' })) }) as DiffTreeRead;
  const pending = new Map<number, (value: DiffTreeRead) => void>();
  vi.mocked(readDiffTree).mockImplementation(async (_id, input) => input.offset
    ? new Promise(resolve => pending.set(input.offset!, resolve)) : page(0));
  const first = prefetchDiffTree('parallel-test');
  expect(prefetchDiffTree('parallel-test')).toBe(first);
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([100, 200, 300]));
  // All pages have started while none of the independent page reads has completed.
  pending.forEach((resolve, offset) => resolve(page(offset)));
  await first;
  expect(readDiffTree).toHaveBeenCalledTimes(4);
  await prefetchDiffTree('parallel-test');
  expect(readDiffTree).toHaveBeenCalledTimes(4);
  now += 2000;
  vi.mocked(readDiffTree).mockResolvedValue(page(0, 1));
  await prefetchDiffTree('parallel-test');
  expect(readDiffTree).toHaveBeenCalledTimes(5);
  expect(vi.mocked(readDiffTree).mock.lastCall?.[1].includePatches).toBe(false);
});
