import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { DetailPane, ProjectedPane } from '../displayModel';
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
  const expanded = node.expansion === 'expanded';
  const fixed = node.geometryPolicy.sizing === 'fixed';
  const ref = useRef<HTMLElement>(null);
  const measure = useRef(props.onMeasure); measure.current = props.onMeasure;
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const report = () => measure.current(node.id, el.offsetWidth, el.offsetHeight);
    report(); const observer = new ResizeObserver(report); observer.observe(el);
    return () => observer.disconnect();
  }, [node.id]);
  return <aside ref={ref} className="selection-effect-frame mapping-poc-companion" data-display-node={node.id}
    data-pane-content={node.kind === 'projection' ? node.content.kind : 'detail'}
    data-projection-id={node.kind === 'projection' ? node.projectionId : undefined} data-mapping-static-ui data-diagram-canvas-static-ui
    style={{ left: node.position.x, top: node.position.y, boxSizing: 'border-box',
      width: fixed ? node.bounds.width : undefined, height: fixed && expanded ? node.bounds.height : undefined }}>
    <EffectPaneHeader className="selection-effect-header" title={node.title} metadata={props.metadata} actions={<>
      {props.actions}
      <button type="button" onClick={props.onToggle} aria-expanded={expanded} aria-label={expanded ? 'Collapse pane' : 'Expand pane'}>{expanded ? '−' : '+'}</button>
      <button type="button" onClick={props.onRemove} aria-label="Close pane">×</button>
    </>} />
    {expanded && <div className="selection-effect-body">{props.children}</div>}
  </aside>;
}
