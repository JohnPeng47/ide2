import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import { readRoute, routeUrl, type Route } from './evalRoutes';

type Panel = { kind: 'snippet'; id: string } | { kind: 'templates' | 'prompt-diff' }
  | { kind: 'overview'; node: string; action: string }
  | { kind: 'ancestry'; id: string; output?: string };
interface VisitView {
  panel?: Panel;
  canvas?: { id: string; diagram?: string; node?: string; display?: 'regular' | 'diff' };
  layout?: { canvas: string; edge?: number; node?: string };
  comparisonStep?: number;
  sidebar?: 'experiments' | 'overview';
  filter?: string;
  promptStage?: string;
  promptPreview?: boolean;
}
interface ReadingPosition { camera?: CanvasTransform; row?: string }
interface Entry {
  group: string; index: number; key: string; view: VisitView; panelOrigin?: number; position: ReadingPosition;
}
interface Guard { dirty(): boolean; confirmLeave(proceed: () => void): void; onNavigate(): void }

const firstEntry = (): Entry => ({ group: crypto.randomUUID(), index: 0, key: crypto.randomUUID(), view: {}, position: {} });
const positionKey = (entry: Entry) => `evals-position:${entry.group}:${entry.index}`;
function stored(): Entry | undefined {
  const entry: Entry | undefined = history.state?.evalVisit;
  if (!entry) return;
  // Native Back has already selected its new entry when popstate fires. The departing
  // viewport is kept in this tab so Forward can restore it even after a reload.
  const saved = sessionStorage.getItem(positionKey(entry));
  const position = saved && JSON.parse(saved) as { key: string; position: ReadingPosition } | null;
  return position && position.key === entry.key ? { ...entry, position: position.position } : entry;
}
type DraftGuard = (destination?: Route) => boolean;

/** The browser owns traversal and forward-branch truncation. Each entry also identifies what the reader opened inside the route. */
export class EvalHistory {
  private current = { ...(stored() ?? firstEntry()), route: readRoute() };
  private listeners = new Set<() => void>();
  private furthest = this.current.index;
  private guard?: Guard;
  private returnAfterCancel?: () => void;
  private allowPop = false;
  private draftGuards = new Set<DraftGuard>();

  snapshot = () => this.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  registerDraft = (dirty: DraftGuard) => { this.draftGuards.add(dirty); return () => { this.draftGuards.delete(dirty); }; };
  private edited() { return !!this.guard?.dirty() || [...this.draftGuards].some(check => check()); }
  private record(entry: Entry, replace: boolean, url = new URL(location.href)) {
    history[replace ? 'replaceState' : 'pushState']({ ...history.state, evalVisit: entry }, '', url);
  }
  private show(entry: Entry, route: Route) {
    this.current = { ...entry, route };
    this.guard?.onNavigate();
    this.listeners.forEach(listener => listener());
  }
  connect(guard: Guard) {
    this.guard = guard;
    const storageKey = 'evals-history-end:' + this.current.group;
    this.furthest = Math.max(this.current.index, Number(sessionStorage.getItem(storageKey)) || 0);
    const savePosition = () => {
      this.record(this.current, true);
      sessionStorage.removeItem(positionKey(this.current));
    };
    savePosition();
    const pop = () => {
      const next = stored() ?? firstEntry();
      if (this.returnAfterCancel && next.key === this.current.key) {
        const ask = this.returnAfterCancel; this.returnAfterCancel = undefined; ask(); return;
      }
      const delta = next.index - this.current.index;
      const nextRoute = readRoute();
      if (!this.allowPop && next.group === this.current.group && delta && this.needsGuard(nextRoute)) {
        // popstate cannot be cancelled. Return to the untouched editor before asking whether to leave it.
        this.returnAfterCancel = () => guard.confirmLeave(() => this.traverse(delta));
        history.go(-delta); return;
      }
      this.allowPop = false;
      if (Object.keys(this.current.position).length) {
        sessionStorage.setItem(positionKey(this.current), JSON.stringify({ key: this.current.key, position: this.current.position }));
      }
      this.show(next, nextRoute);
    };
    const unload = (event: BeforeUnloadEvent) => { if (this.edited()) event.preventDefault(); };
    window.addEventListener('popstate', pop);
    window.addEventListener('pagehide', savePosition);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('popstate', pop); window.removeEventListener('pagehide', savePosition);
      window.removeEventListener('beforeunload', unload); this.guard = undefined;
    };
  }
  private needsGuard(route: Route) {
    return [...this.draftGuards].some(check => check(route)) || (!!this.guard?.dirty() && routeUrl(route).href !== routeUrl(this.current.route).href);
  }
  private navigate(route: Route, view: VisitView, replace = false) {
    const previous = this.current, url = routeUrl(route);
    const sameRoute = url.href === routeUrl(previous.route).href;
    if (this.returnAfterCancel || (sameRoute && JSON.stringify(view) === JSON.stringify(previous.view))) return;
    const commit = () => {
      const entry: Entry = { group: previous.group, index: previous.index + (replace ? 0 : 1), key: crypto.randomUUID(), view,
        position: sameRoute && previous.view.canvas === view.canvas ? { ...previous.position } : {},
        ...(view.panel ? { panelOrigin: previous.panelOrigin ?? previous.index } : {}) };
      if (!replace) this.record(previous, true);
      sessionStorage.removeItem(positionKey(previous));
      this.record(entry, replace, url);
      if (!replace) {
        this.furthest = entry.index;
        sessionStorage.setItem('evals-history-end:' + entry.group, String(entry.index));
      }
      this.show(entry, route);
    };
    if (this.needsGuard(route)) this.guard?.confirmLeave(commit); else commit();
  }
  go = (route: Route, options?: { replace?: boolean; view?: VisitView }) => this.navigate(route, options?.view ?? {}, options?.replace);
  update = (patch: Partial<VisitView>, route = this.current.route) => this.navigate(route, { ...this.current.view, ...patch });
  openPanel = (panel: Panel) => this.update({ panel });
  closePanel = () => {
    const origin = this.current.panelOrigin;
    if (origin !== undefined && origin < this.current.index) this.move(origin - this.current.index);
    else this.navigate(this.current.route, { ...this.current.view, panel: undefined }, true);
  };
  private traverse(delta: number) {
    this.allowPop = true;
    history.go(delta);
  }
  move = (delta: number) => {
    const index = this.current.index + delta;
    if (document.querySelector('dialog[open]') || this.returnAfterCancel || !delta || index < 0 || index > this.furthest) return;
    // The destination route is known only after traversal. A dirty prompt underneath a read-only panel stays mounted.
    history.go(delta);
  };
}

export const EvalHistoryContext = createContext<EvalHistory | null>(null);
export function useEvalHistory() {
  const navigation = useContext(EvalHistoryContext);
  if (!navigation) throw Error('Experiment navigation requires an Evals workspace');
  const visit = useSyncExternalStore(navigation.subscribe, navigation.snapshot);
  return { navigation, visit };
}

export function useNavigationDraft(dirty: boolean, leaves: (destination: Route) => boolean = () => true) {
  const navigation = useContext(EvalHistoryContext);
  const latest = useRef({ dirty, leaves });
  latest.current = { dirty, leaves };
  useEffect(() => navigation?.registerDraft(next => latest.current.dirty && (!next || latest.current.leaves(next))), [navigation]);
}

/** Store pan/zoom on the current visit without rendering or adding browser entries on every pointer move. */
export function useVisitCamera() {
  const { visit } = useEvalHistory();
  return useMemo(() => ({
    initial: visit.position.camera,
    remember: (value: CanvasTransform) => { visit.position.camera = value; }
  }), [visit]);
}

export function useHistoryGestures(navigation: EvalHistory) {
  useEffect(() => {
    let held: number | undefined;
    const mouse = (event: MouseEvent) => {
      const modified = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.button === 0 || event.button === 2);
      if (event.type === 'pointerdown') held = modified ? event.button : undefined;
      if (held !== event.button && !modified) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === 'pointerup' && held === event.button) navigation.move(event.button === 0 ? -1 : 1);
      if (event.type === 'click' || event.type === 'auxclick') held = undefined;
    };
    const events = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const;
    const key = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) navigation.move(event.key === 'ArrowLeft' ? -1 : 1);
    };
    const link = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button || event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return;
      const anchor = event.target instanceof Element && event.target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.hash) return;
      event.preventDefault(); navigation.go(readRoute(url));
    };
    events.forEach(type => window.addEventListener(type, mouse, true));
    window.addEventListener('keydown', key, true); window.addEventListener('click', link);
    return () => {
      events.forEach(type => window.removeEventListener(type, mouse, true));
      window.removeEventListener('keydown', key, true); window.removeEventListener('click', link);
    };
  }, [navigation]);
}
