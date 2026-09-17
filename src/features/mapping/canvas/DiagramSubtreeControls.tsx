import type { CanvasDisplayNode } from '../../../../domain/mapping/workspace/canvasDisplayNode';
import './diagramSubtreeControls.css';

/** Controls consume the public DisplayNode capability, never parse source text. */
export function DiagramSubtreeControls(props: {
  nodes: CanvasDisplayNode[]; visibleBoxIds: ReadonlySet<string>;
  cell: { width: number; height: number }; disabled: boolean;
  onCollapse: (nodeId: string, contentNodeId: string, collapsed: boolean) => void;
}) {
  if (!props.cell.width || !props.cell.height) return null;
  return <>{props.nodes.flatMap(node => {
    if (node.layout !== 'grid' || node.kind !== 'diagram' || node.expansion === 'collapsed' || !props.visibleBoxIds.has(node.boxId)) return [];
    return node.collapsible.subtrees.filter(target => target.visibleRow !== undefined).map(target => <button
      key={`${node.id}:${target.contentNodeId}`} type="button" className="mapping-subtree-toggle"
      data-mapping-static-ui data-diagram-canvas-static-ui data-subtree-owner={node.id} data-content-node-id={target.contentNodeId}
      data-subtree-line={target.line} data-visible-row={target.visibleRow}
      disabled={props.disabled} aria-expanded={target.expansion === 'expanded'}
      aria-label={`${target.expansion === 'expanded' ? 'Collapse' : 'Expand'} subtree ${target.label}`}
      title={`${target.expansion === 'expanded' ? 'Collapse' : 'Expand'} ${target.label}`}
      style={{ left: (node.geometry.bounds.column + (target.branchColumn < 0 ? -3 : target.branchColumn)) * props.cell.width,
        top: (node.geometry.bounds.row + target.visibleRow!) * props.cell.height,
        width: props.cell.width * 3, height: props.cell.height }}
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); props.onCollapse(node.id, target.contentNodeId, target.expansion !== 'collapsed'); }}
    >{target.expansion === 'expanded' ? '[-]' : '[+]'}</button>);
  })}</>;
}
