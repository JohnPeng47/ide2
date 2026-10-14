import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { WindowPanelLayout } from './WindowPanel';
export type WindowPanelMode = 'full-single' | 'full-split' | 'split-single';
export interface WindowPanelState {
  minimizedWidth: number; expandedWidth?: number; height?: number;
  trackedNode?: string;
  hunkFilterNode?: string;
  focusedPane: 'tree' | 'hunks' | 'treemaps'; minimized: boolean; mode: WindowPanelMode; pane: 'tree' | 'hunks' | 'treemaps'; ratio: number; selectedNode: string; collapsed: string[]; wrap: boolean;
}
const initial: WindowPanelState = { minimizedWidth: .4, focusedPane: 'tree', minimized: false, mode: 'full-split', pane: 'tree', ratio: .34, selectedNode: '*', collapsed: [], wrap: false };
export function useWindowPanelState(key: string) {
  return useState<WindowPanelState>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return value ? { focusedPane: value.focusedPane === 'treemaps' ? 'treemaps' : value.focusedPane === 'hunks' ? 'hunks' : 'tree', minimized: value.minimized === true, mode: ['full-single', 'full-split', 'split-single'].includes(value.mode) ? value.mode : initial.mode,
        minimizedWidth: Number.isFinite(value.minimizedWidth) ? Math.max(.2, Math.min(.95, value.minimizedWidth)) : .4,
        expandedWidth: Number.isFinite(value.expandedWidth) ? Math.max(.2, Math.min(.95, value.expandedWidth)) : undefined,
        height: Number.isFinite(value.height) ? Math.max(.2, Math.min(.95, value.height)) : undefined,
        pane: value.pane === 'treemaps' ? 'treemaps' : value.pane === 'hunks' ? 'hunks' : 'tree', ratio: typeof value.ratio === 'number' ? Math.max(.2, Math.min(.65, value.ratio)) : .34,
        selectedNode: typeof value.selectedNode === 'string' ? value.selectedNode : '*',
        trackedNode: typeof value.trackedNode === 'string' ? value.trackedNode : undefined,
        hunkFilterNode: typeof value.hunkFilterNode === 'string' ? value.hunkFilterNode : undefined,
        collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((id: unknown) => typeof id === 'string') : [], wrap: value.wrap === true } : initial;
    } catch { return initial; }
  });
}
export function useSaveWindowPanelState(key: string, state: WindowPanelState) {
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* Storage may be disabled. */ } }, [key, state]);
}
export function usePanelScroll(ref: RefObject<HTMLDivElement | null>, key: string, ready: boolean) {
  useLayoutEffect(() => {
    const element = ref.current; if (!element || !ready) return;
    try { const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (saved) { element.dataset.programmaticScroll = 'true'; setTimeout(() => { delete element.dataset.programmaticScroll; }, 150); element.scrollTop = saved.top; element.scrollLeft = saved.left; } } catch { /* Optional view state. */ }
    let timer: ReturnType<typeof setTimeout>;
    const save = () => { try { sessionStorage.setItem(key, JSON.stringify({ top: element.scrollTop, left: element.scrollLeft })); } catch { /* Optional view state. */ } };
    const scroll = () => { clearTimeout(timer); timer = setTimeout(save, 100); };
    element.addEventListener('scroll', scroll); window.addEventListener('pagehide', save);
    return () => { clearTimeout(timer); save(); element.removeEventListener('scroll', scroll); window.removeEventListener('pagehide', save); };
  }, [ref, key, ready]);
}

/** Layout-only state for panels with their own panes; persisted per tab like the diff panel. */
export function usePanelLayout<Pane extends string>(key: string, panes: readonly [Pane, Pane], modes: readonly WindowPanelMode[]) {
  const [layout, setLayout] = useState<WindowPanelLayout<Pane>>(() => {
    const initial: WindowPanelLayout<Pane> = { mode: modes[0], pane: panes[0], focusedPane: panes[0], minimized: false, ratio: .5, minimizedWidth: .4 };
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (!value) return initial;
      const pane = (candidate: unknown) => panes.includes(candidate as Pane) ? candidate as Pane : panes[0];
      const fraction = (candidate: unknown, min: number, max: number) => Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate as number)) : undefined;
      return { mode: modes.includes(value.mode) ? value.mode : initial.mode, pane: pane(value.pane), focusedPane: pane(value.focusedPane),
        minimized: value.minimized === true, ratio: fraction(value.ratio, .2, .65) ?? initial.ratio, minimizedWidth: fraction(value.minimizedWidth, .2, .95) ?? .4,
        expandedWidth: fraction(value.expandedWidth, .2, .95), height: fraction(value.height, .2, .95) };
    } catch { return initial; }
  });
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(layout)); } catch { /* Storage may be disabled. */ } }, [key, layout]);
  const update = useCallback((patch: Partial<WindowPanelLayout<Pane>>) => setLayout(current => ({ ...current, ...patch })), []);
  return [layout, update] as const;
}
