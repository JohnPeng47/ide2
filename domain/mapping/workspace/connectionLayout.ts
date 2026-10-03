import { endpointKey, type EndpointBounds, type EndpointIdentity, type EndpointRect } from './endpointGeometry';
import { routeEdge, routePath } from './edgeRouting';
import { connectionBox, connectionContentNodes, getArrowLabel, type DiagramAnchor, type DiagramConnection } from '../../core/diagrams/diagramConnection';
import { flattenGrid, resolveScene, type GridBox, type LineGridScene } from '../../core/diagrams/lineGrid';
import { projectDiagramContent, type DiagramViews } from './diagramViewState';

export interface AnchorPoint { x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom'; proxy: boolean }
export interface FloatingBoxArrow {
  kind: 'arrow'; id: string; edgeId: string;
  coordinateSpace: 'canvas'; position: { x: number; y: number }; bounds: { width: number; height: number };
  source?: AnchorPoint; target?: AnchorPoint; path?: string;
  label?: { text: string; position: { x: number; y: number } };
  status: 'resolved' | 'proxy' | 'stale' | 'pending' | 'blocked';
  geometrySource: 'measured' | 'estimated';
}
type Rect = { x: number; y: number; width: number; height: number; proxy: boolean };

export function resolveEndpoint(scene: LineGridScene, views: DiagramViews | undefined, anchor: DiagramAnchor,
  cell: { width: number; height: number }): { identity: EndpointIdentity; rect: Rect } | undefined {
  const box = connectionBox(scene, anchor.displayNodeId);
  if (!box) return;
  const visible = flattenGrid(resolveScene(scene));
  const ancestry = (node: GridBox, path: GridBox[]): GridBox[] | undefined => node.id === box.id ? [...path, node]
    : node.kind === 'container' ? node.children.map(child => ancestry(child, [...path, node])).find(Boolean) : undefined;
  const path = ancestry(scene.root, [])!;
  const owner = [...path].reverse().map(parent => visible.find(item => item.box.id === parent.id)).find(Boolean)!;
  const rect: Rect = { x: owner.bounds.column * cell.width, y: owner.bounds.row * cell.height,
    width: owner.bounds.columns * cell.width, height: owner.bounds.rows * cell.height, proxy: owner.box.id !== box.id };
  const boxIdentity = { displayNodeId: `grid:${owner.box.id}` };
  if (anchor.kind === 'box') return { identity: boxIdentity, rect };
  if (box.kind !== 'diagram') return;
  const content = scene.contents[box.contentId].content;
  if (content.revisionId !== anchor.revisionId) return;
  const nodes = connectionContentNodes(content);
  let node = nodes.find(node => node.id === anchor.contentNodeId);
  if (!node) return;
  if (rect.proxy || box.collapsed) return { identity: boxIdentity, rect: { ...rect, proxy: true } };
  const projection = projectDiagramContent(content, views?.[anchor.displayNodeId]);
  while (projection.rowForLine(node.line) === undefined) {
    node = nodes.find(candidate => candidate.id === node!.parentId);
    if (!node) return;
    rect.proxy = true;
  }
  return { identity: { displayNodeId: anchor.displayNodeId, contentNodeId: node.id, revisionId: content.revisionId },
    rect: { x: rect.x + (node.startColumn - 1) * cell.width,
    y: rect.y + projection.rowForLine(node.line)! * cell.height,
    width: (node.endColumn - node.startColumn + 1) * cell.width, height: cell.height, proxy: rect.proxy } };
}
function point(rect: Rect, other: Rect, side: DiagramAnchor['side'], offset = 0.5): AnchorPoint {
  const dx = other.x + other.width / 2 - rect.x - rect.width / 2;
  const dy = other.y + other.height / 2 - rect.y - rect.height / 2;
  const resolved = side === 'auto' ? Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top' : side;
  return { x: resolved === 'left' ? rect.x : resolved === 'right' ? rect.x + rect.width : rect.x + rect.width * offset,
    y: resolved === 'top' ? rect.y : resolved === 'bottom' ? rect.y + rect.height : rect.y + rect.height * offset,
    side: resolved, proxy: rect.proxy };
}
/** Route between fixed border sides, avoiding both endpoint interiors. */
export function arrowPath(source: AnchorPoint, target: AnchorPoint, obstacles: readonly EndpointRect[] = []): string | undefined {
  const points = routeEdge(source, target, obstacles);
  return points && routePath(points);
}
export function drawEdge(edge: DiagramConnection, scene: LineGridScene, views: DiagramViews | undefined,
  cell: { width: number; height: number }, bounds?: EndpointBounds): FloatingBoxArrow {
  const a = resolveEndpoint(scene, views, edge.source, cell), b = resolveEndpoint(scene, views, edge.target, cell);
  return drawResolvedEdge(edge, a && { ...a.rect, ...(bounds ? bounds[endpointKey(a.identity)] : a.rect) },
    b && { ...b.rect, ...(bounds ? bounds[endpointKey(b.identity)] : b.rect) },
    bounds ? 'measured' : 'estimated', !a || !b ? 'stale'
      : bounds && (!bounds[endpointKey(a.identity)] || !bounds[endpointKey(b.identity)]) ? 'pending' : undefined);
}

/** Shared routing, after the renderer has resolved semantic anchors into page rectangles. */
export function drawResolvedEdge(edge: DiagramConnection, ar: Rect | undefined, br: Rect | undefined,
  geometrySource: FloatingBoxArrow['geometrySource'] = 'measured', unavailable?: 'stale' | 'pending'): FloatingBoxArrow {
  const base = { kind: 'arrow' as const, id: `edge:${edge.id}`, edgeId: edge.id, coordinateSpace: 'canvas' as const,
    geometrySource,
    position: { x: 0, y: 0 }, bounds: { width: 1, height: 1 } };
  if (unavailable || !ar || !br) return { ...base, status: unavailable ?? 'stale' };
  const sourceRect = ar, targetRect = br;
  const source = point(sourceRect, targetRect, edge.source.side, edge.source.offset);
  const target = point(targetRect, sourceRect, edge.target.side, edge.target.offset);
  const points = routeEdge(source, target, [ar, br]);
  if (!points) return { ...base, source, target, status: 'blocked' };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const label = getArrowLabel(edge.appearance);
  return { ...base, source, target, path: routePath(points), status: ar.proxy || br.proxy ? 'proxy' : 'resolved',
    label: { text: label.text, position: label.position ?? { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 - 8 } },
    position: { x: Math.min(...xs) - 6, y: Math.min(...ys) - 6 },
    bounds: { width: Math.max(...xs) - Math.min(...xs) + 12, height: Math.max(...ys) - Math.min(...ys) + 12 } };
}
