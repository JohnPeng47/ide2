import type { CanvasRuntime, LocalEndpoint } from './CanvasRuntimeContext';
import { mappingShapeId } from './shapeProjection';
import type { DiagramConnection } from '../../../../domain/core/diagrams/diagramConnection';

/** Anchors and obstacles use native page transforms (including parents), independent of the camera. */
export function nativeEndpointRect(runtime: CanvasRuntime, endpoint?: LocalEndpoint) {
  const editor = runtime.editor;
  if (!editor || !endpoint) return;
  const id = mappingShapeId(endpoint.identity.displayNodeId), shape = editor.getShape(id);
  if (!shape) return;
  const rect = endpoint.identity.contentNodeId
    ? runtime.anchors.get(endpoint.identity, endpoint.layoutKey) ?? endpoint.rect
    : endpoint.labelRect ? endpoint.rect : editor.getShapeGeometry(shape).bounds;
  const transform = editor.getShapePageTransform(shape);
  const points = transform.applyToPoints([{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), proxy: endpoint.rect.proxy };
}
export function nativeEdgeInput(runtime: CanvasRuntime, edge: DiagramConnection, source?: LocalEndpoint, target?: LocalEndpoint) {
  const measured = [source, target].every(endpoint => endpoint && !endpoint.labelRect && (!endpoint.identity.contentNodeId || runtime.anchors.get(endpoint.identity, endpoint.layoutKey)));
  return [edge, nativeEndpointRect(runtime, source), nativeEndpointRect(runtime, target),
    source?.identity, target?.identity, measured ? 'measured' : 'estimated'] as const;
}

export function nativeEdgeGeometry(runtime: CanvasRuntime, edge: DiagramConnection, source?: LocalEndpoint, target?: LocalEndpoint) {
  return runtime.routedEdges.get().get(edge.id) ?? runtime.routing.draw(...nativeEdgeInput(runtime, edge, source, target));
}
