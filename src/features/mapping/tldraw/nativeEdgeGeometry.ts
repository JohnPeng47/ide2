import type { CanvasRuntime, LocalEndpoint } from './CanvasRuntimeContext';
import { mappingShapeId } from './shapeProjection';
import { drawResolvedEdge } from '../../../../domain/mapping/workspace/connectionLayout';
import type { DiagramConnection } from '../../../../domain/core/diagrams/diagramConnection';

/** Reactive reads are limited to the two local anchors and their native shape
 * transforms (including native parents). Camera state is deliberately absent. */
export function nativeEndpointRect(runtime: CanvasRuntime, endpoint?: LocalEndpoint) {
  const editor = runtime.editor;
  if (!editor || !endpoint) return;
  const id = mappingShapeId(endpoint.identity.displayNodeId), shape = editor.getShape(id);
  if (!shape) return;
  const rect = endpoint.identity.contentNodeId
    ? runtime.anchors.get(endpoint.identity, endpoint.layoutKey) ?? endpoint.rect
    : editor.getShapeGeometry(shape).bounds;
  const transform = editor.getShapePageTransform(shape);
  const points = transform.applyToPoints([{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), proxy: endpoint.rect.proxy };
}
export function nativeEdgeGeometry(runtime: CanvasRuntime, edge: DiagramConnection, source?: LocalEndpoint, target?: LocalEndpoint) {
  const measured = [source, target].every(endpoint => endpoint && (!endpoint.identity.contentNodeId || runtime.anchors.get(endpoint.identity, endpoint.layoutKey)));
  return drawResolvedEdge(edge, nativeEndpointRect(runtime, source), nativeEndpointRect(runtime, target), measured ? 'measured' : 'estimated');
}
