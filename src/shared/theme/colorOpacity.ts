import { useSyncExternalStore } from 'react';

export const colorOpacityStorageKey = 'new-diagram-color-opacity';
export type ColorOpacity = { treemap: number; canvas: number };
const defaults: ColorOpacity = { treemap: 22, canvas: 22 };
let current = defaults;
const listeners = new Set<() => void>();
const normalize = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? Math.round(Math.max(0, Math.min(100, value))) : 22;

function apply(value: Partial<ColorOpacity> | null) {
  current = { treemap: normalize(value?.treemap), canvas: normalize(value?.canvas) };
  for (const key of ['treemap', 'canvas'] as const)
    document.documentElement.style.setProperty(`--${key}-identity-opacity`, `${current[key]}%`);
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

export function setColorOpacity(key: keyof ColorOpacity, value: number) {
  apply({ ...current, [key]: value });
  try { localStorage.setItem(colorOpacityStorageKey, JSON.stringify(current)); }
  catch { /* Controls still work when browser storage is unavailable. */ }
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useColorOpacity = () => useSyncExternalStore(subscribe, () => current, () => defaults);
