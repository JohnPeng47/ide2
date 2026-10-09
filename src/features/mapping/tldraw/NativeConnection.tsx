import { useContext, useRef } from 'react';
import { useValue } from 'tldraw';
import { CanvasRuntimeContext } from './CanvasRuntimeContext';
import { nativeEdgeGeometry } from './nativeEdgeGeometry';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';

/** Each edge subscribes to its definition, its anchors and native transforms. */
export function NativeConnection({ edgeId }: { edgeId: string }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const panning = useRef(false);
  const focused = useValue(`connection focus ${edgeId}`, () => runtime.focusedEdge.get()?.id === edgeId, [runtime, edgeId]);
  const disabled = useValue('connection interaction', () => runtime.interaction.get().subtreeDisabled, [runtime]);
  const model = useValue(`connection ${edgeId}`, () => runtime.edges.get(edgeId).get(), [runtime, edgeId]);
  const edge = model?.edge;
  const arrow = useValue(`connection geometry ${edgeId}`, () => model && nativeEdgeGeometry(runtime, model.edge, model.source, model.target), [runtime, model]);
  if (!edge || !arrow?.path || !arrow.target) return null;
  const toggle = (point: { x: number; y: number }) => {
    if (!disabled) runtime.focusedEdge.set(focused ? undefined : { id: edgeId, point });
  };
  return <svg className="diagram-connections mapping-native-connection" style={{ width: 1, height: 1, color: focused ? 'var(--accent-cyan)' : edge.appearance.color, overflow: 'visible' }}>
    <g data-connection-id={edge.id} data-connection-status={arrow.status} data-geometry-source={arrow.geometrySource} data-edge-focused={focused || undefined}>
      {focused && <path className="diagram-connection-focus" d={arrow.path} />}
      <PanelConnector path={arrow.path} target={arrow.target} selected={focused} dashed={edge.appearance.lineStyle === 'dashed' || arrow.status === 'proxy'} />
      {arrow.label?.text && <text x={arrow.label.position.x} y={arrow.label.position.y} textAnchor="middle" fill="currentColor">{arrow.label.text}</text>}
      <path d={arrow.path} className="diagram-connection-hit" stroke="transparent" strokeWidth={14} fill="none"
        role="button" tabIndex={disabled ? -1 : 0} aria-pressed={focused} aria-label={`Focus connection: ${arrow.label?.text || 'Connection'}`}
        data-mapping-static-ui data-diagram-canvas-static-ui
        onPointerDown={event => {
          panning.current = event.button !== 0 || !!runtime.editor?.inputs.getIsPanning() || runtime.editor?.getCurrentToolId() === 'hand';
          if (panning.current) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
        }}
        onClick={event => { if (panning.current) return; event.stopPropagation(); if (runtime.editor) toggle(runtime.editor.screenToPage({ x: event.clientX, y: event.clientY })); }}
        onKeyDown={event => {
          // Space remains available for the canvas's temporary pan tool.
          if (event.key !== 'Enter') return;
          event.preventDefault(); event.stopPropagation();
          const point = event.currentTarget.getPointAtLength(event.currentTarget.getTotalLength() / 2); toggle(point);
        }} />
    </g>
  </svg>;
}
