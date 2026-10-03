import { useContext } from 'react';
import { useValue } from 'tldraw';
import { CanvasRuntimeContext } from './CanvasRuntimeContext';
import { nativeEdgeGeometry } from './nativeEdgeGeometry';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';

/** Each edge subscribes to its definition, its anchors and native transforms. */
export function NativeConnection({ edgeId }: { edgeId: string }) {
  const runtime = useContext(CanvasRuntimeContext)!, controller = runtime.controller;
  const model = useValue(`connection ${edgeId}`, () => runtime.edges.get(edgeId).get(), [runtime, edgeId]);
  const edge = model?.edge;
  const arrow = useValue(`connection geometry ${edgeId}`, () => model && nativeEdgeGeometry(runtime, model.edge, model.source, model.target), [runtime, model]);
  if (!edge || !arrow?.path || !arrow.target) return null;
  return <svg className="diagram-connections mapping-native-connection" style={{ width: 1, height: 1, color: edge.appearance.color, overflow: 'visible' }}>
    <g data-connection-id={edge.id} data-connection-status={arrow.status}>
      <PanelConnector path={arrow.path} target={arrow.target} dashed={edge.appearance.lineStyle === 'dashed' || arrow.status === 'proxy'} />
      {arrow.label?.text && <text x={arrow.label.position.x} y={arrow.label.position.y} textAnchor="middle" fill="currentColor">{arrow.label.text}</text>}
      <path d={arrow.path} className="diagram-connection-hit" stroke="transparent" strokeWidth={14} fill="none"
        role="button" aria-label={`Edit connection: ${arrow.label?.text || 'Connection'}`}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); window.dispatchEvent(new CustomEvent('mapping-edit-connection', { detail: { controller, edgeId } })); }} />
    </g>
  </svg>;
}
