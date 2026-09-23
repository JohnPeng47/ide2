import { useId, useState, type ReactNode } from "react";
export function FloatingPane(props: { children: ReactNode }) {
  const [minimized, setMinimized] = useState(false);
  const contentId = useId();
  return <aside className={`mapping-floating-pane${minimized ? " is-minimized" : ""}`} aria-label="Project diagram explorer" data-diagram-canvas-static-ui>
    <button type="button" className="mapping-explorer-toggle" aria-label={minimized ? "Restore explorer" : "Minimize explorer"}
      title={minimized ? "Restore explorer" : "Minimize explorer"} aria-expanded={!minimized} aria-controls={contentId}
      onClick={() => setMinimized(value => !value)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {minimized ? <><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M6 3v10" /></> : <path d="M3 11.5h10" />}
      </svg>
      {minimized && <span>Explorer</span>}
    </button>
    <div id={contentId} className="mapping-floating-pane-content" hidden={minimized}>{props.children}</div>
  </aside>;
}
