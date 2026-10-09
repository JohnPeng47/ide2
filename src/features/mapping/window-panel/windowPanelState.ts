import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
export type WindowPanelMode = 'full-single' | 'full-split' | 'split-single';
export interface WindowPanelState {
  minimizedWidth: number; expandedWidth?: number; height?: number;
  trackedNode?: string;
  hunkFilterNode?: string;
  focusedPane: 'tree' | 'hunks'; minimized: boolean; mode: WindowPanelMode; pane: 'tree' | 'hunks'; ratio: number; selectedNode: string; collapsed: string[]; wrap: boolean;
}
const initial: WindowPanelState = { minimizedWidth: .4, focusedPane: 'tree', minimized: false, mode: 'full-split', pane: 'tree', ratio: .34, selectedNode: '*', collapsed: [], wrap: false };
export function useWindowPanelState(key: string) {
  return useState<WindowPanelState>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return value ? { focusedPane: value.focusedPane === 'hunks' ? 'hunks' : 'tree', minimized: value.minimized === true, mode: ['full-single', 'full-split', 'split-single'].includes(value.mode) ? value.mode : initial.mode,
        minimizedWidth: Number.isFinite(value.minimizedWidth) ? Math.max(.2, Math.min(.95, value.minimizedWidth)) : .4,
        expandedWidth: Number.isFinite(value.expandedWidth) ? Math.max(.2, Math.min(.95, value.expandedWidth)) : undefined,
        height: Number.isFinite(value.height) ? Math.max(.2, Math.min(.95, value.height)) : undefined,
        pane: value.pane === 'hunks' ? 'hunks' : 'tree', ratio: typeof value.ratio === 'number' ? Math.max(.2, Math.min(.65, value.ratio)) : .34,
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
