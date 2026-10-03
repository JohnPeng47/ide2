import { CanvasRuntimeContext } from '../tldraw/CanvasRuntimeContext';
import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DetailPane, ProjectedPane } from '../../../../domain/mapping/workspace/displayModel';
export function EffectPaneHeader(props: { title: string; eyebrow?: string; metadata?: string; actions?: ReactNode; className?: string }) {
  return <header className={props.className}><div>{props.eyebrow && <span>{props.eyebrow}</span>}<strong title={props.title}>{props.title}</strong></div>
    {props.metadata && <small>{props.metadata}</small>}{props.actions}</header>;
}
/** Shared pane frame: model placement, allocation, measured content, and expansion controls. */
export function DisplayPane(props: {
  node: ProjectedPane | DetailPane; metadata?: string;
  onToggle: () => void; onRemove: () => void;
  actions?: ReactNode; children: ReactNode;
  onMeasure: (id: string, width: number, height: number) => void;
}) {
  const { node } = props;
  const native = useContext(CanvasRuntimeContext);
  const expanded = node.expansion === 'expanded';
  const fixed = node.geometryPolicy.sizing === 'fixed';
  const [element, setElement] = useState<HTMLElement | null>(null);
  const measure = useRef(props.onMeasure); measure.current = props.onMeasure;
  useLayoutEffect(() => {
    const el = element; if (!el) return;
    const report = () => measure.current(node.id, el.offsetWidth, el.offsetHeight);
    report(); const observer = new ResizeObserver(report); observer.observe(el);
    return () => observer.disconnect();
  }, [element, node.id]);
  return <aside ref={setElement} className="selection-effect-frame mapping-poc-companion" data-display-node={node.id}
    data-pane-content={node.kind === 'projection' ? node.content.kind : 'detail'}
    data-projection-id={node.kind === 'projection' ? node.projectionId : undefined} data-mapping-static-ui data-diagram-canvas-static-ui
    onPointerDown={event => { if (!(event.target as Element).closest('.selection-effect-header') || (event.target as Element).closest('button,input,select')) event.stopPropagation(); }}
    style={{ left: native ? 0 : node.position.x, top: native ? 0 : node.position.y, boxSizing: 'border-box',
      width: fixed ? native ? '100%' : node.bounds.width : undefined, height: fixed && expanded ? native ? '100%' : node.bounds.height : undefined }}>
    <EffectPaneHeader className="selection-effect-header" title={node.title} metadata={props.metadata} actions={<>
      {props.actions}
      <button type="button" onClick={props.onToggle} aria-expanded={expanded} aria-label={expanded ? 'Collapse pane' : 'Expand pane'}>{expanded ? '−' : '+'}</button>
      <button type="button" onClick={props.onRemove} aria-label="Close pane">×</button>
    </>} />
    {expanded && <div className="selection-effect-body">{props.children}</div>}
  </aside>;
}
