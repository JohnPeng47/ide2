import { useCallback, useState, type ReactNode } from 'react';
import { WindowPanel, type WindowPanelLayout } from '../window-panel/WindowPanel';

/** Shared resizable reader for outputs that do not need a canvas. */
export function ExperimentOutputPanel({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [layout, setLayout] = useState<WindowPanelLayout<'output'>>({ mode: 'full-single', pane: 'output', focusedPane: 'output', minimized: false, ratio: .5, minimizedWidth: .4 });
  const update = useCallback((patch: Partial<WindowPanelLayout<'output'>>) => setLayout(value => ({ ...value, ...patch })), []);
  return <div className="experiment-output-panel">
    {open ? <WindowPanel title={title} canvasId="experiment-output" sizeStorageKey="experiment-output" state={layout}
      onChange={update} onClose={() => setOpen(false)} canvas={null} modes={['full-single']} allowBrowserZoom
      panes={[{ id: 'output', title: 'Output content', content: <div className="experiment-output-scroll" tabIndex={0}>{children}</div> }]} />
      : <button type="button" className="experiment-output-reopen" onClick={() => setOpen(true)}>Open {title}</button>}
  </div>;
}
