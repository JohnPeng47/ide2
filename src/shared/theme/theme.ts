import { useSyncExternalStore } from 'react';

import { themeDefinitions, type ThemeName } from './themeDefinitions';
export { themeDefinitions, type ThemeName } from './themeDefinitions';
export const themeStorageKey = 'new-diagram-theme';
let current: ThemeName = 'dark';
const listeners = new Set<() => void>();
const valid = (value: unknown): ThemeName => value === 'light' ? 'light' : 'dark';
function apply(theme: ThemeName) {
  current = theme;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeDefinitions[theme].browserColor);
  }
  [...listeners].forEach(listener => listener());
}
/** Run before React mounts so persisted light mode never flashes a dark workspace. */
export function initializeTheme() {
  try { apply(valid(localStorage.getItem(themeStorageKey))); } catch { apply('dark'); }
  const synchronize = (event: StorageEvent) => {
    if (event.key === themeStorageKey || event.key === null) apply(valid(event.newValue));
  };
  window.addEventListener('storage', synchronize);
  return () => window.removeEventListener('storage', synchronize);
}
export function setTheme(theme: ThemeName) {
  try { localStorage.setItem(themeStorageKey, theme); } catch { /* In-memory switching still works. */ }
  apply(theme);
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useTheme = () => useSyncExternalStore(subscribe, () => current, () => 'dark' as ThemeName);
