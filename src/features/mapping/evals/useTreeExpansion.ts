import { useCallback, useMemo, useRef, useState } from 'react';
import { sha256 } from '../../../../domain/core/sha256';

const cookieName = 'eval-tree-expansion-v1';
// One bounded cookie for all trees, below the browser's 4 KiB cookie limit.
const maxEntries = 180;
function readExpansion(): Map<string, boolean> {
  try {
    const value = document.cookie.split('; ').find(cookie => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
    return new Map(value.split('.').filter(entry => /^[a-f0-9]{16}:[01]$/.test(entry)).slice(-maxEntries)
      .map(entry => [entry.slice(0, 16), entry.endsWith(':1')]));
  } catch { return new Map(); }
}

/** Cache explicit choices; nodes without a choice retain their normal defaults. */
export function useTreeExpansion(scope: string) {
  const [entries, setEntries] = useState(readExpansion);
  const current = useRef(entries);
  const keyOf = useMemo(() => {
    const keys = new Map<string, string>();
    return (id: string) => {
      if (!keys.has(id)) keys.set(id, sha256(`${scope}\0${id}`).slice(0, 16));
      return keys.get(id)!;
    };
  }, [scope]);
  const setMany = useCallback((changes: [string, boolean][]) => {
    const next = new Map(current.current);
    let changed = false;
    for (const [id, open] of changes) {
      const key = keyOf(id);
      if (next.get(key) === open) continue;
      next.delete(key); next.set(key, open); changed = true;
    }
    if (!changed) return;
    current.current = next; setEntries(next);
    try {
      const value = [...next].slice(-maxEntries).map(([key, open]) => `${key}:${open ? 1 : 0}`).join('.');
      document.cookie = `${cookieName}=${value}; Path=/evals; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    } catch { /* Tree controls still work when cookies are unavailable. */ }
  }, [keyOf]);
  const setOpen = useCallback((id: string, open: boolean) => setMany([[id, open]]), [setMany]);
  return { isOpen: (id: string, defaultOpen = true) => entries.get(keyOf(id)) ?? defaultOpen, setOpen, setMany };
}

export type TreeExpansion = ReturnType<typeof useTreeExpansion>;
