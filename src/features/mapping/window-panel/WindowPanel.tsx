import { createContext, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { WindowPanelMode } from './windowPanelState';
import { TabbedPanelResize } from './TabbedPanelResize';
import { readWindowPanelSize, saveWindowPanelSize } from './windowPanelSize';

const windowPanelModes: readonly WindowPanelMode[] = ['full-single', 'full-split', 'split-single'];
const windowPanelModeLabels: Record<WindowPanelMode, string> = { 'full-single': 'Full screen · single pane', 'full-split': 'Full screen · split panes', 'split-single': 'Beside canvas · single pane' };
import './windowPanel.css';

export interface WindowPanelLayout<Pane extends string> { mode: WindowPanelMode; pane: Pane; focusedPane: Pane; minimized: boolean; ratio: number;
  minimizedWidth: number; expandedWidth?: number; height?: number }
type PaneContent<Pane extends string> = { id: Pane; title: string; content: ReactNode };

/** A workspace overlay with independent pane focus and a compact right-hand view. */
function SplitWindowPanel<Pane extends string>(props: { title: string; subtitle?: string; notice?: ReactNode; actions?: ReactNode; canvasId: string; state: WindowPanelLayout<Pane>;
  onChange: (patch: Partial<WindowPanelLayout<Pane>>) => void; onClose: () => void; panes: readonly [PaneContent<Pane>, ...PaneContent<Pane>[]]; canvas: ReactNode;
  /** Stable identity for this panel's saved dimensions, independent of its title. */ sizeStorageKey?: string;
  /** Layouts offered in the header; panels without a canvas pane omit split-single. */ modes?: readonly WindowPanelMode[]; className?: string }) {
  const tabId = useId();
  const body = useRef<HTMLDivElement>(null), drag = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const restoredKey = useRef<string | undefined>(undefined);
  const pendingSize = useRef<Partial<WindowPanelLayout<Pane>> | null>(null);
  useLayoutEffect(() => {
    if (restoredKey.current === props.sizeStorageKey) return;
    restoredKey.current = props.sizeStorageKey;
    const saved = readWindowPanelSize(props.sizeStorageKey, 'fraction');
    if (saved) props.onChange({
      ...(saved.width !== undefined ? { expandedWidth: saved.width } : {}),
      ...(saved.height !== undefined ? { height: saved.height } : {}),
      ...(saved.minimizedWidth !== undefined ? { minimizedWidth: saved.minimizedWidth } : {}),
    });
  }, [props.sizeStorageKey, props.onChange]);
  const saveSize = () => {
    const size = pendingSize.current;
    if (!size) return;
    pendingSize.current = null;
    saveWindowPanelSize(props.sizeStorageKey, 'fraction', { width: size.expandedWidth, height: size.height, minimizedWidth: size.minimizedWidth });
  };
  const changeSize = (patch: Partial<WindowPanelLayout<Pane>>) => {
    pendingSize.current = { expandedWidth: props.state.expandedWidth, height: props.state.height,
      minimizedWidth: props.state.minimizedWidth, ...pendingSize.current, ...patch };
    props.onChange(patch);
  };
  useEffect(() => {
    const element = panel.current!;
    // Trackpad pinch arrives as Ctrl-wheel. Outside the canvas it otherwise
    // magnifies the browser's visual viewport and clips the entire workspace.
    const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const resize = useRef<{ x: number; y: number; width: number; height: number; areaWidth: number; areaHeight: number; right: number; top: number } | undefined>(undefined);
  const width = props.state.minimized ? props.state.minimizedWidth : props.state.expandedWidth;
  const style: CSSProperties = { ...(width !== undefined ? { left: 'auto', width: `${width * 100}%` } : {}),
    ...(props.state.height !== undefined ? { bottom: 'auto', height: `${props.state.height * 100}%` } : {}) };
  const single = props.panes.length === 1;
  const activePane = props.state.minimized ? props.state.focusedPane : props.state.pane;
  const extraPane = props.panes.slice(2).find(pane => pane.id === activePane);
  const split = !single && !extraPane && !props.state.minimized && props.state.mode === 'full-split';
  const focus = (pane: Pane) => { if (props.state.focusedPane !== pane) props.onChange({ focusedPane: pane }); };
  const paneEvents = (pane: Pane) => ({ onClickCapture: () => focus(pane), onWheelCapture: () => focus(pane), onPointerDownCapture: () => focus(pane),
    onKeyDownCapture: () => focus(pane), onScrollCapture: (event: React.UIEvent) => { if ((event.target as HTMLElement).dataset.programmaticScroll !== 'true') focus(pane); } });
  return <section ref={panel} style={style} className={`window-panel window-panel-${props.state.mode}${props.state.minimized ? ' window-panel-minimized' : ''}${props.className ? ` ${props.className}` : ''}`} data-window-panel-canvas={props.canvasId} aria-label={props.title}>
    {(['left', 'bottom', 'corner'] as const).map(edge => <div key={edge} className={`window-panel-resize window-panel-resize-${edge}`}
      role="separator" aria-label={edge === 'left' ? 'Resize window width' : edge === 'bottom' ? 'Resize window height' : 'Resize window'}
      aria-orientation={edge === 'bottom' ? 'horizontal' : 'vertical'} tabIndex={0}
      onKeyDown={event => {
        const horizontal = edge !== 'bottom' && ['ArrowLeft', 'ArrowRight'].includes(event.key);
        const vertical = edge !== 'left' && ['ArrowUp', 'ArrowDown'].includes(event.key);
        if (!horizontal && !vertical) return;
        event.preventDefault(); event.stopPropagation();
        const rect = panel.current!.getBoundingClientRect(), area = panel.current!.parentElement!.getBoundingClientRect();
        if (horizontal) changeSize({ [props.state.minimized ? 'minimizedWidth' : 'expandedWidth']:
          Math.max(.2, Math.min(.95, (rect.width + (event.key === 'ArrowLeft' ? 24 : -24)) / area.width)) });
        else changeSize({ height: Math.max(.2, Math.min(.95, (rect.height + (event.key === 'ArrowDown' ? 24 : -24)) / area.height)) });
        saveSize();
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        const rect = panel.current!.getBoundingClientRect(), area = panel.current!.parentElement!.getBoundingClientRect();
        resize.current = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height,
          areaWidth: area.width, areaHeight: area.height, right: rect.right - area.left, top: rect.top - area.top };
      }}
      onPointerMove={event => {
        const start = resize.current; if (!start) return;
        event.preventDefault(); event.stopPropagation();
        changeSize({ ...(edge !== 'bottom' ? { [props.state.minimized ? 'minimizedWidth' : 'expandedWidth']:
          Math.max(.2, Math.min(.95, (start.right - 8) / start.areaWidth, (start.width + start.x - event.clientX) / start.areaWidth)) } : {}),
          ...(edge !== 'left' ? { height: Math.max(.2, Math.min(.95, (start.areaHeight - start.top - 8) / start.areaHeight,
            (start.height + event.clientY - start.y) / start.areaHeight)) } : {}) });
      }}
      onPointerUp={() => { resize.current = undefined; saveSize(); }} onPointerCancel={() => { resize.current = undefined; saveSize(); }}
      onLostPointerCapture={() => { resize.current = undefined; saveSize(); }} />)}
    <header className="window-panel-header">
      <div><strong>{props.title}</strong>{props.subtitle && <small>{props.subtitle}</small>}</div>
      {props.actions}
      {!single && <><button type="button" aria-label={props.state.minimized ? 'Restore split view' : 'Minimize to focused pane'} onClick={() => props.onChange({ minimized: !props.state.minimized })}>{props.state.minimized ? 'Restore' : 'Minimize'}</button>
      <label>Layout <select aria-label="Window panel layout" value={props.state.mode}
        onChange={event => props.onChange({ mode: event.target.value as WindowPanelMode, minimized: false })}>
        {(props.modes ?? windowPanelModes).map(mode => <option key={mode} value={mode}>{windowPanelModeLabels[mode]}</option>)}
      </select></label></>}
      <button type="button" onClick={props.onClose} aria-label={`Close ${props.title}`}>Close</button>
    </header>
    {props.notice}
    <div className="window-panel-workspace">
      {!single && props.state.mode === 'split-single' && <div hidden={props.state.minimized} className="window-panel-canvas" aria-label="Canvas beside panel">{props.canvas}</div>}
      <div className="window-panel-content">
        {!single && (!split || props.panes.length > 2) && <div className="window-panel-tabs" role="tablist" aria-label="Panel panes">
          {props.panes.map(pane => <button key={pane.id} role="tab" id={`${tabId}-${pane.id}`} aria-controls={`${tabId}-${pane.id}-panel`}
            tabIndex={activePane === pane.id ? 0 : -1} aria-selected={activePane === pane.id}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); const index = props.panes.findIndex(p => p.id === pane.id);
                const next = props.panes[event.key === 'Home' ? 0 : event.key === 'End' ? props.panes.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + props.panes.length) % props.panes.length];
                props.onChange({ pane: next.id, focusedPane: next.id }); document.getElementById(`${tabId}-${next.id}`)?.focus();
              }
            }}
            onClick={() => props.onChange({ pane: pane.id, focusedPane: pane.id })}>{pane.title}</button>)}
        </div>}
        <div ref={body} className="window-panel-panes" style={{ '--tree-ratio': `${props.state.ratio * 100}%` } as CSSProperties}>
          {(split || activePane === props.panes[0].id) && <div className="window-panel-primary" data-pane={props.panes[0].id} data-focused={props.state.focusedPane === props.panes[0].id} {...paneEvents(props.panes[0].id)} role={single ? 'region' : split ? undefined : 'tabpanel'} id={`${tabId}-${props.panes[0].id}-panel`} aria-label={single ? props.panes[0].title : undefined} aria-labelledby={single || split ? undefined : `${tabId}-${props.panes[0].id}`}>{props.panes[0].content}</div>}
          {split && <div className="window-panel-divider" role="separator" aria-label={`Resize ${props.panes[0].title} and ${props.panes[1]!.title}`} aria-orientation="vertical" tabIndex={0}
            aria-valuemin={20} aria-valuemax={65} aria-valuenow={Math.round(props.state.ratio * 100)}
            onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); props.onChange({ ratio: event.key === 'Home' ? .2 : event.key === 'End' ? .65 : Math.max(.2, Math.min(.65, props.state.ratio + (event.key === 'ArrowLeft' ? -.03 : .03))) });
            } }}
            onPointerDown={event => { drag.current = true; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
            onPointerMove={event => { if (drag.current && body.current) { const rect = body.current.getBoundingClientRect(); props.onChange({ ratio: Math.max(.2, Math.min(.65, (event.clientX - rect.left) / rect.width)) }); } }}
            onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }} onLostPointerCapture={() => { drag.current = false; }} />}
          {!single && (split || activePane === props.panes[1]!.id) && <div className="window-panel-secondary" data-pane={props.panes[1]!.id} data-focused={props.state.focusedPane === props.panes[1]!.id} {...paneEvents(props.panes[1]!.id)} role={split ? undefined : 'tabpanel'} id={`${tabId}-${props.panes[1]!.id}-panel`} aria-labelledby={split ? undefined : `${tabId}-${props.panes[1]!.id}`}>{props.panes[1]!.content}</div>}
          {extraPane && <div className="window-panel-secondary" data-pane={extraPane.id} data-focused={props.state.focusedPane === extraPane.id}
            {...paneEvents(extraPane.id)} role="tabpanel" id={`${tabId}-${extraPane.id}-panel`} aria-labelledby={`${tabId}-${extraPane.id}`}>{extraPane.content}</div>}
        </div>
      </div>
    </div>
  </section>;
}


/** Optional destination for a tool's controls without moving/remounting the tool itself. */
export const WindowPanelSidebarContext = createContext<{ element: HTMLElement | null; close: () => void }>({ element: null, close: () => {} });

/** A panel may host independent tools as tabs, or use the original two-pane layout. */
export function WindowPanel<Pane extends string>(props: Parameters<typeof SplitWindowPanel<Pane>>[0] | {
  title: string; tabs: readonly PaneContent<Pane>[]; activeTab: Pane; onTabChange: (tab: Pane) => void;
  onClose: () => void; className?: string; compact?: boolean;
  /** Stable identity for this panel's saved dimensions, shared across its tabs. */ sizeStorageKey?: string;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tabbed = 'tabs' in props;
  useLayoutEffect(() => {
    const element = panel.current;
    if (!tabbed || !element) return;
    const saved = readWindowPanelSize(props.sizeStorageKey, 'pixels');
    element.style.width = saved?.width ? `${saved.width}px` : '';
    element.style.height = saved?.height ? `${saved.height}px` : '';
  }, [tabbed, props.sizeStorageKey]);
  const compact = 'tabs' in props && props.compact;
  const closeSidebar = useCallback(() => {
    setDrawerOpen(false);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('.agent-chat-prompt')?.focus({ preventScroll: true }));
  }, []);
  const sidebarContext = useMemo(() => ({ element: sidebar, close: closeSidebar }), [sidebar, closeSidebar]);
  useEffect(() => {
    if (!drawerOpen || !compact) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setDrawerOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [drawerOpen, compact]);
  if (!('tabs' in props)) return <SplitWindowPanel {...props} />;
  const tabs = <header className="window-panel-tabs" role="tablist" aria-label={props.title}>
      {props.tabs.map((tab, index) => <button key={tab.id} id={`${id}-${tab.id}`} role="tab"
        aria-selected={props.activeTab === tab.id} aria-controls={`${id}-${tab.id}-panel`} tabIndex={props.activeTab === tab.id ? 0 : -1}
        onClick={() => { props.onTabChange(tab.id); setDrawerOpen(false); }} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.tabs.length - 1
            : (index + (event.key === 'ArrowLeft' ? -1 : 1) + props.tabs.length) % props.tabs.length;
          props.onTabChange(props.tabs[next].id); document.getElementById(`${id}-${props.tabs[next].id}`)?.focus();
        }}>{tab.title}</button>)}
      <button className="window-panel-tab-close" aria-label={`Close ${props.title}`} onClick={props.onClose}>×</button>
    </header>;
  return <section ref={panel} className={`window-panel window-panel-tabbed${compact ? ' window-panel-compact' : ''} ${props.className ?? ''}`} aria-label={props.title}
    data-mapping-static-ui data-diagram-canvas-static-ui onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); setDrawerOpen(false); toggle.current?.focus(); }
    }}>
    <TabbedPanelResize panel={panel} sizeStorageKey={props.sizeStorageKey} />
    {compact ? <><button ref={toggle} type="button" className="window-panel-sidebar-toggle" aria-label="Chat menu" aria-expanded={drawerOpen}
      aria-controls={`${id}-sidebar`} title={drawerOpen ? 'Hide chat menu' : 'Conversations and settings'}
      onClick={() => setDrawerOpen(value => !value)}>{drawerOpen ? '>' : '<'}</button>
      <button type="button" className="window-panel-compact-close" aria-label="Close Agent Chat" title="Minimize chat"
        onClick={() => { setDrawerOpen(false); props.onClose(); }}>×</button></> : tabs}
    <aside className="window-panel-sidebar" id={`${id}-sidebar`} hidden={!compact || !drawerOpen} aria-label="Chat conversations and settings">
      {compact && tabs}
      <div ref={setSidebar} />
    </aside>
    <WindowPanelSidebarContext.Provider value={sidebarContext}>
    {props.tabs.map(tab => <div key={tab.id} id={`${id}-${tab.id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab.id}`}
      className="window-panel-tool" hidden={props.activeTab !== tab.id}>{tab.content}</div>)}
    </WindowPanelSidebarContext.Provider>
  </section>;
}
