import { useEffect, useSyncExternalStore } from 'react';
import { readDiffTree, type DiffTreeRead } from './changeSessionApi';

type Snapshot = { data?: DiffTreeRead; error?: string };
type Entry = { snapshot: Snapshot; listeners: Set<() => void>; pending?: Promise<void>; checked: number };
const cache = new Map<string, Entry>();
function entry(id: string): Entry {
  let value = cache.get(id);
  if (!value) {
    // Keep mounted sessions and in-flight requests; bound unused session snapshots.
    for (const [key, old] of cache) if (cache.size >= 8 && !old.listeners.size && !old.pending) cache.delete(key);
    value = { snapshot: {}, listeners: new Set(), checked: 0 }; cache.set(id, value);
  }
  return value;
}

/** One shared capture per session. Read independent pages concurrently, never on selection. */
export function prefetchDiffTree(id: string): Promise<void> {
  const value = entry(id);
  if (value.pending) return value.pending;
  if (Date.now() - value.checked < 1500) return Promise.resolve();
  const run = async () => {
    const previous = value.snapshot.data;
    const signal = AbortSignal.timeout(30000);
    let first = await readDiffTree(id, { limit: 100, includePatches: !previous }, signal);
    // Captured hunks are immutable; mapping/title/status updates reuse their patches.
    if (previous && first.diffTree?.hunkCount === previous.diffTree?.hunkCount
      && JSON.stringify(first.commits) === JSON.stringify(previous.commits) && first.head === previous.head) {
      if (previous.version !== first.version) value.snapshot = { data: { ...first, hunks: previous.hunks, nextOffset: null } };
    } else {
      if (previous) first = await readDiffTree(id, { limit: 100 }, signal);
      const offsets = Array.from({ length: Math.max(0, Math.ceil(first.total / 100) - 1) }, (_, i) => (i + 1) * 100);
      const pages = await Promise.all(offsets.map(offset => readDiffTree(id, { offset, limit: 100 }, signal)));
      if (pages.some(page => page.version !== first.version || page.diffTree?.revisionId !== first.diffTree?.revisionId))
        throw Error('The change tree was updated while loading. Retrying…');
      value.snapshot = { data: { ...first, hunks: [...first.hunks, ...pages.flatMap(page => page.hunks)], nextOffset: null } };
    }
    if (value.snapshot.error) value.snapshot = { data: value.snapshot.data };
    value.checked = Date.now();
  };
  value.pending = run().catch(error => { value.snapshot = { ...value.snapshot, error: String(error instanceof Error ? error.message : error) }; })
    .finally(() => { value.pending = undefined; value.listeners.forEach(listener => listener()); });
  return value.pending;
}

export function useDiffTreeData(id: string | undefined) {
  const value = id ? entry(id) : empty;
  const snapshot = useSyncExternalStore(listener => { value.listeners.add(listener); return () => { value.listeners.delete(listener); }; }, () => value.snapshot);
  useEffect(() => {
    if (!id) return;
    void prefetchDiffTree(id);
    const timer = setInterval(() => {
      if (!['accepted', 'archived'].includes(value.snapshot.data?.status ?? '')) void prefetchDiffTree(id);
    }, 2000);
    return () => clearInterval(timer);
  }, [id, value]);
  return snapshot;
}
const empty: Entry = { snapshot: {}, listeners: new Set(), checked: 0 };
