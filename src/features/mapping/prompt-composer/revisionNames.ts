import { createStore } from 'zustand/vanilla';

const storageKey = 'ide2.diagram-revision-names.v1';
export const maxRevisionNameLength = 80;
function load(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter(([id, name]) => typeof name === 'string' && id.startsWith('diagram-revision-')));
  } catch { return {}; }
}

/** Names live beside revisions, keyed by revision ID: renaming never touches an immutable revision payload. */
export const revisionNames = createStore<{ names: Record<string, string> }>(() => ({ names: typeof localStorage === 'undefined' ? {} : load() }));
export function renameRevision(revisionId: string, name: string) {
  const trimmed = name.trim().slice(0, maxRevisionNameLength);
  revisionNames.setState(state => {
    const names = { ...state.names };
    if (trimmed) names[revisionId] = trimmed; else delete names[revisionId];
    try { localStorage.setItem(storageKey, JSON.stringify(names)); } catch { /* Storage may be disabled; names last for this page. */ }
    return { names };
  });
}
