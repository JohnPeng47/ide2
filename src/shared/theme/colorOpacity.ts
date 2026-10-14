import { useSyncExternalStore } from 'react';

export const colorOpacityStorageKey = 'new-diagram-color-opacity';
export type TreemapColorScale = 'ranked' | 'continuous';
export type ColorOpacity = { treemap: number; canvas: number; shade: number; scale: TreemapColorScale };
const defaults: ColorOpacity = { treemap: 22, canvas: 22, shade: 0, scale: 'ranked' };
let current = defaults;
const listeners = new Set<() => void>();
const normalize = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? Math.round(Math.max(0, Math.min(100, value))) : 22;

function apply(value: Partial<ColorOpacity> | null) {
  current = { treemap: normalize(value?.treemap), canvas: normalize(value?.canvas),
    scale: value?.scale === 'continuous' ? 'continuous' : 'ranked',
    shade: typeof value?.shade === 'number' && Number.isFinite(value.shade) ? Math.round(Math.max(-20, Math.min(20, value.shade))) : 0 };
  for (const key of ['treemap', 'canvas'] as const)
    document.documentElement.style.setProperty(`--${key}-identity-opacity`, `${current[key]}%`);
  document.documentElement.style.setProperty('--treemap-shade-shift', `${current.shade}%`);
  [...listeners].forEach(listener => listener());
}

export function initializeColorOpacity() {
  const restore = () => {
    try { apply(JSON.parse(localStorage.getItem(colorOpacityStorageKey) ?? 'null')); }
    catch { apply(defaults); }
  };
  restore();
  const synchronize = (event: StorageEvent) => {
    if (event.key === colorOpacityStorageKey || event.key === null) restore();
  };
  window.addEventListener('storage', synchronize);
  return () => window.removeEventListener('storage', synchronize);
}

export function setColorOpacity<K extends keyof ColorOpacity>(key: K, value: ColorOpacity[K]) {
  apply({ ...current, [key]: value });
  try { localStorage.setItem(colorOpacityStorageKey, JSON.stringify(current)); }
  catch { /* Controls still work when browser storage is unavailable. */ }
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useColorOpacity = () => useSyncExternalStore(subscribe, () => current, () => defaults);
