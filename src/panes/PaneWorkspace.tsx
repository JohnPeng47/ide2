import {
  createContext,
  cloneElement,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { PaneApi } from "./api";
import { clampPaneRatio, type Pane, type PaneNode, type PaneTab } from "./model";

export interface PaneTabView {
  content: ReactNode;
  onActivate?: () => void;
}

const PaneApiContext = createContext<PaneApi | null>(null);

export function usePaneApi(): PaneApi {
  const api = useContext(PaneApiContext);
  if (!api) throw new Error("usePaneApi must be used within PaneWorkspace");
  return api;
}

function PaneFrame(props: {
  pane: Pane;
  focused: boolean;
  api: PaneApi;
  views: Record<string, PaneTabView | undefined>;
}) {
  const activeTab = props.pane.tabs.find((tab) => tab.id === props.pane.activeTabId);
  const activeView = activeTab ? props.views[activeTab.id] : undefined;
  const activate = (tab: PaneTab) => {
    if (tab.id === props.pane.activeTabId) props.api.focusPane(props.pane.id);
    else props.api.activateTab(props.pane.id, tab.id);
    props.views[tab.id]?.onActivate?.();
  };
  return (
    <section
      className={`workspace-pane${props.focused ? " is-focused" : ""}${props.pane.className ? ` ${props.pane.className}` : ""}`}
      aria-label={props.pane.ariaLabel}
      data-pane-id={props.pane.id}
      onPointerDown={() => props.api.focusPane(props.pane.id)}
    >
      <div
        className={`pane-tabs${props.pane.tabListClassName ? ` ${props.pane.tabListClassName}` : ""}`}
        role="tablist"
        aria-label={props.pane.ariaLabel ? `${props.pane.ariaLabel} tabs` : "Pane tabs"}
      >
        {props.pane.tabs.map((tab) => {
          const selected = tab.id === props.pane.activeTabId;
          const panelId = `${props.pane.id}-${tab.id}-panel`;
          const button = <button
            type="button"
            id={tab.domId ?? `${props.pane.id}-${tab.id}-tab`}
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            className={selected ? "is-active" : ""}
            onClick={() => activate(tab)}
          >
            {tab.label}
            {tab.badge !== undefined ? <span className="pane-tab__badge">{tab.badge}</span> : null}
          </button>;
          return tab.closable ? (
            <span className="pane-tab" key={tab.id}>
              {button}
              <button
                type="button"
                className="pane-tab__close"
                aria-label={`Close ${tab.label}`}
                onClick={() => props.api.closeTab(props.pane.id, tab.id)}
              >×</button>
            </span>
          ) : cloneElement(button, { key: tab.id });
        })}
      </div>
      <div
        className="workspace-pane__content"
        id={activeTab ? `${props.pane.id}-${activeTab.id}-panel` : undefined}
        role="tabpanel"
        aria-labelledby={activeTab?.domId ?? (activeTab ? `${props.pane.id}-${activeTab.id}-tab` : undefined)}
      >
        {activeView?.content ?? (
          <div className="workspace-pane__empty">No view is registered for this tab.</div>
        )}
      </div>
    </section>
  );
}

function SplitNode(props: {
  node: Extract<PaneNode, { kind: "split" }>;
  api: PaneApi;
  renderNode: (node: PaneNode) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const verticalDivider = props.node.orientation === "horizontal";
  const updateFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const ratio = verticalDivider
      ? (event.clientX - bounds.left) / bounds.width
      : (event.clientY - bounds.top) / bounds.height;
    props.api.resizeSplit(props.node.id, ratio);
  }, [props.api, props.node.id, verticalDivider]);
  const gridStyle = verticalDivider
    ? { gridTemplateColumns: `minmax(0, ${props.node.ratio}fr) 9px minmax(0, ${1 - props.node.ratio}fr)` }
    : { gridTemplateRows: `minmax(0, ${props.node.ratio}fr) 9px minmax(0, ${1 - props.node.ratio}fr)` };

  return (
    <div
      ref={rootRef}
      className={`pane-split pane-split--${props.node.orientation}${dragging ? " is-dragging" : ""}`}
      data-split-id={props.node.id}
      style={gridStyle}
    >
      <div className="pane-split__child">{props.renderNode(props.node.first)}</div>
      <div
        className="pane-split__divider split-pane__divider"
        role="separator"
        aria-label={`Resize panes ${verticalDivider ? "horizontally" : "vertically"}`}
        aria-orientation={verticalDivider ? "vertical" : "horizontal"}
        aria-valuemin={10}
        aria-valuemax={90}
        aria-valuenow={Math.round(props.node.ratio * 100)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging && event.buttons === 1) updateFromPointer(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          const decrease = verticalDivider ? event.key === "ArrowLeft" : event.key === "ArrowUp";
          const increase = verticalDivider ? event.key === "ArrowRight" : event.key === "ArrowDown";
          if (decrease || increase) {
            event.preventDefault();
            props.api.resizeSplit(props.node.id, props.node.ratio + (increase ? 0.02 : -0.02));
          } else if (event.key === "Home") {
            event.preventDefault();
            props.api.resizeSplit(props.node.id, clampPaneRatio(0));
          } else if (event.key === "End") {
            event.preventDefault();
            props.api.resizeSplit(props.node.id, clampPaneRatio(1));
          }
        }}
      ><span aria-hidden="true" /></div>
      <div className="pane-split__child">{props.renderNode(props.node.second)}</div>
    </div>
  );
}

export function PaneWorkspace(props: {
  api: PaneApi;
  views: Record<string, PaneTabView | undefined>;
  className?: string;
}) {
  const state = useSyncExternalStore(props.api.subscribe, props.api.getState, props.api.getState);
  const renderNode = (node: PaneNode): ReactNode => node.kind === "pane" ? (
    <PaneFrame
      pane={state.panes[node.paneId]}
      focused={state.focusedPaneId === node.paneId}
      api={props.api}
      views={props.views}
    />
  ) : (
    <SplitNode node={node} api={props.api} renderNode={renderNode} />
  );
  return (
    <PaneApiContext.Provider value={props.api}>
      <div className={`pane-workspace${props.className ? ` ${props.className}` : ""}`}>
        {state.root ? renderNode(state.root) : (
          <div className="workspace-pane__empty">This workspace has no panes.</div>
        )}
      </div>
    </PaneApiContext.Provider>
  );
}
