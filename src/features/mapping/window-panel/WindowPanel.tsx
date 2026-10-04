import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import type { WindowPanelMode } from './windowPanelState';
import './windowPanel.css';

export interface WindowPanelLayout<Pane extends string> { mode: WindowPanelMode; pane: Pane; focusedPane: Pane; minimized: boolean; ratio: number }
type PaneContent<Pane extends string> = { id: Pane; title: string; content: ReactNode };

/** A workspace overlay with independent pane focus and a compact right-hand view. */
export function WindowPanel<Pane extends string>(props: { title: string; subtitle?: string; notice?: ReactNode; canvasId: string; state: WindowPanelLayout<Pane>;
  onChange: (patch: Partial<WindowPanelLayout<Pane>>) => void; onClose: () => void; panes: readonly [PaneContent<Pane>, PaneContent<Pane>]; canvas: ReactNode }) {
  const tabId = useId();
  const body = useRef<HTMLDivElement>(null), drag = useRef(false);
  const split = !props.state.minimized && props.state.mode === 'full-split';
  const activePane = props.state.minimized ? props.state.focusedPane : props.state.pane;
  const focus = (pane: Pane) => { if (props.state.focusedPane !== pane) props.onChange({ focusedPane: pane }); };
  const paneEvents = (pane: Pane) => ({ onClickCapture: () => focus(pane), onWheelCapture: () => focus(pane), onPointerDownCapture: () => focus(pane),
    onKeyDownCapture: () => focus(pane), onScrollCapture: (event: React.UIEvent) => { if ((event.target as HTMLElement).dataset.programmaticScroll !== 'true') focus(pane); } });
  return <section className={`window-panel window-panel-${props.state.mode}${props.state.minimized ? ' window-panel-minimized' : ''}`} data-window-panel-canvas={props.canvasId} aria-label={props.title}>
    <header className="window-panel-header">
      <div><strong>{props.title}</strong>{props.subtitle && <small>{props.subtitle}</small>}</div>
      <button type="button" aria-label={props.state.minimized ? 'Restore split view' : 'Minimize to focused pane'} onClick={() => props.onChange({ minimized: !props.state.minimized })}>{props.state.minimized ? 'Restore' : 'Minimize'}</button>
      <label>Layout <select aria-label="Window panel layout" value={props.state.mode}
        onChange={event => props.onChange({ mode: event.target.value as WindowPanelMode, minimized: false })}>
        <option value="full-single">Full screen · single pane</option>
        <option value="full-split">Full screen · split panes</option>
        <option value="split-single">Beside canvas · single pane</option>
      </select></label>
      <button type="button" onClick={props.onClose} aria-label={`Close ${props.title}`}>Close</button>
    </header>
    {props.notice}
    <div className="window-panel-workspace">
      {!props.state.minimized && props.state.mode === 'split-single' && <div className="window-panel-canvas" aria-label="Canvas beside panel">{props.canvas}</div>}
      <div className="window-panel-content">
        {!split && <div className="window-panel-tabs" role="tablist" aria-label="Panel panes">
          {props.panes.map(pane => <button key={pane.id} role="tab" id={`${tabId}-${pane.id}`} aria-controls={`${tabId}-${pane.id}-panel`}
            tabIndex={activePane === pane.id ? 0 : -1} aria-selected={activePane === pane.id}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); const next = event.key === 'Home' ? props.panes[0] : event.key === 'End' ? props.panes[1] : props.panes.find(p => p.id !== pane.id)!;
                props.onChange({ pane: next.id, focusedPane: next.id }); document.getElementById(`${tabId}-${next.id}`)?.focus();
              }
            }}
            onClick={() => props.onChange({ pane: pane.id, focusedPane: pane.id })}>{pane.title}</button>)}
        </div>}
        <div ref={body} className="window-panel-panes" style={{ '--tree-ratio': `${props.state.ratio * 100}%` } as CSSProperties}>
          {(split || activePane === props.panes[0].id) && <div className="window-panel-primary" data-pane={props.panes[0].id} data-focused={props.state.focusedPane === props.panes[0].id} {...paneEvents(props.panes[0].id)} role={split ? undefined : 'tabpanel'} id={`${tabId}-${props.panes[0].id}-panel`} aria-labelledby={split ? undefined : `${tabId}-${props.panes[0].id}`}>{props.panes[0].content}</div>}
          {split && <div className="window-panel-divider" role="separator" aria-label={`Resize ${props.panes[0].title} and ${props.panes[1].title}`} aria-orientation="vertical" tabIndex={0}
            aria-valuemin={20} aria-valuemax={65} aria-valuenow={Math.round(props.state.ratio * 100)}
            onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); props.onChange({ ratio: event.key === 'Home' ? .2 : event.key === 'End' ? .65 : Math.max(.2, Math.min(.65, props.state.ratio + (event.key === 'ArrowLeft' ? -.03 : .03))) });
            } }}
            onPointerDown={event => { drag.current = true; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
            onPointerMove={event => { if (drag.current && body.current) { const rect = body.current.getBoundingClientRect(); props.onChange({ ratio: Math.max(.2, Math.min(.65, (event.clientX - rect.left) / rect.width)) }); } }}
            onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }} onLostPointerCapture={() => { drag.current = false; }} />}
          {(split || activePane === props.panes[1].id) && <div className="window-panel-secondary" data-pane={props.panes[1].id} data-focused={props.state.focusedPane === props.panes[1].id} {...paneEvents(props.panes[1].id)} role={split ? undefined : 'tabpanel'} id={`${tabId}-${props.panes[1].id}-panel`} aria-labelledby={split ? undefined : `${tabId}-${props.panes[1].id}`}>{props.panes[1].content}</div>}
        </div>
      </div>
    </div>
  </section>;
}
