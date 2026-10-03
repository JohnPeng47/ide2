import { useContext, useMemo, useSyncExternalStore } from 'react';
import { useEditor, useValue } from 'tldraw';
import { ShapeSlotsContext } from './shapeSlots';
import { mappingShapeId } from './shapeProjection';
import { flattenGrid, resolveScene } from '../../../../domain/core/diagrams/lineGrid';
import { drawEdge } from '../../../../domain/mapping/workspace/connectionLayout';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';

/** Endpoint geometry follows native records during a drag, without publishing a
 * new application document for each pointer sample. Semantic anchors stay intact. */
export function NativeConnection({ edgeId }: { edgeId: string }) {
  const slots = useContext(ShapeSlotsContext)!, editor = useEditor(), controller = slots.controller!;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const edge = snapshot.document.edges.find(edge => edge.id === edgeId);
  const endpoints = useMemo(() => {
    if (!edge || !snapshot.cell) return [];
    const needed = new Set([edge.source.displayNodeId, edge.target.displayNodeId]);
    const visit = (box: typeof snapshot.document.scene.root): boolean => {
      const contains = (box.kind === 'container' && box.children.map(visit).some(Boolean)) || needed.has(`grid:${box.id}`);
      if (contains) needed.add(`grid:${box.id}`);
      return contains;
    };
    visit(snapshot.document.scene.root);
    const boxes = new Map(flattenGrid(resolveScene(snapshot.document.scene)).map(box => [`grid:${box.box.id}`, box]));
    return Object.entries(snapshot.endpointBounds ?? {}).flatMap(([key, rect]) => {
      const [id] = JSON.parse(key) as [string], box = boxes.get(id);
      return needed.has(id) && box ? [{ key, rect, id,
        x: box.bounds.column * snapshot.cell!.width, y: box.bounds.row * snapshot.cell!.height }] : [];
    });
  }, [edge, snapshot.document.scene, snapshot.endpointBounds, snapshot.cell]);
  const arrow = useValue('mapping connection endpoints', () => {
    if (!edge || !snapshot.cell) return;
    const cell = snapshot.cell;
    const current = new Map<string, ReturnType<typeof editor.getShapePageBounds>>();
    const bounds = Object.fromEntries(endpoints.map(({ key, rect, id, x, y }) => {
      if (!current.has(id)) current.set(id, editor.getShapePageBounds(mappingShapeId(id)));
      const shape = current.get(id);
      return [key, shape ? { ...rect, x: rect.x + shape.x - x, y: rect.y + shape.y - y } : rect];
    }));
    return drawEdge(edge, snapshot.document.scene, snapshot.canvas.diagramViews, cell, bounds);
  }, [editor, edge, snapshot, endpoints]);
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
