import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { contentNodeSpans } from '../../core/diagrams/contentNodeGeometry';
import type { DiagramContent, DiagramContentNode } from '../../core/diagrams/diagramContent';
import { projectDiagramContent, resolveDiagramView, type DiagramViewState, type DiagramViews } from './diagramViewState';
import { flattenGrid, type LineGridScene } from '../../core/diagrams/lineGrid';
import type { EndpointIdentity, EndpointRect } from './endpointGeometry';
import type { RouteObstacle } from './edgeRouting';

export interface RoutingObstacle extends RouteObstacle {
  displayNodeId: string;
  contentNodeId?: string;
}
export const ROUTING_PADDING = 3;
export const DIAGRAM_ROUTING_CLEARANCE = 24;

/** Soft border bands leave space for parallel runs while allowing endpoint crossings. */
export function diagramBoundaryObstacles(displayNodeId: string, bounds: EndpointRect): RoutingObstacle[] {
  const pad = DIAGRAM_ROUTING_CLEARANCE, { x, y, width, height } = bounds;
  return [
    { x: x - pad, y: y - pad, width: pad * 2, height: height + pad * 2 },
    { x: x + width - pad, y: y - pad, width: pad * 2, height: height + pad * 2 },
    { x: x - pad, y: y - pad, width: width + pad * 2, height: pad * 2 },
    { x: x - pad, y: y + height - pad, width: width + pad * 2, height: pad * 2 },
  ].map(rect => ({ ...rect, displayNodeId, kind: 'clearance' }));
}
const localCache = new WeakMap<DiagramContent, Map<string, RoutingObstacle[]>>();
// Only unlabelled spans composed entirely of tree connectors are soft. Other
// unparsed text (notes, punctuation labels, etc.) remains a hard obstacle.
const treeGuide = /^[\s|│┃┆┊┇┋╎╏├└┌┐┘┤┬┴┼─━┏┓┗┛┣┫┳┻╋+`\\-]+$/u;

/** Local cell geometry: one rectangle per label and per remaining text span (including tree guides). */
export function diagramRoutingObstacles(displayNodeId: string, content: DiagramContent, view: DiagramViewState | undefined,
  cell: { width: number; height: number }, measureSpan?: (row: number, start: number, end: number) => EndpointRect | undefined): RoutingObstacle[] {
  const key = JSON.stringify([displayNodeId, view, cell]);
  let cached = localCache.get(content);
  if (!measureSpan && cached?.has(key)) return cached.get(key)!;
  const projection = projectDiagramContent(content, view);
  // One obstacle per text span: multi-line nodes block each of their rows, not the wires inside their bounds.
  const byLine = new Map<number, { id: string; startColumn: number; endColumn: number }[]>();
  for (const node of diagramContentNodes(content)) for (const span of contentNodeSpans(node)) {
    const row = byLine.get(span.line) ?? []; row.push({ id: node.id, ...span }); byLine.set(span.line, row);
  }
  const obstacles: RoutingObstacle[] = [];
  projection.ascii.split('\n').forEach((text, row) => {
    const add = (start: number, end: number, contentNodeId?: string) => {
      const span = text.slice(start, end), leading = span.search(/\S/);
      if (leading < 0) return;
      const left = start + leading, right = start + span.trimEnd().length;
      const rect = measureSpan?.(row, left, right) ?? { x: left * cell.width, y: row * cell.height,
        width: (right - left) * cell.width, height: cell.height };
      obstacles.push({ displayNodeId, ...(contentNodeId ? { contentNodeId } : {}),
        kind: !contentNodeId && treeGuide.test(span) ? 'guide' : 'text',
        x: rect.x - ROUTING_PADDING, y: rect.y - ROUTING_PADDING,
        width: rect.width + ROUTING_PADDING * 2, height: rect.height + ROUTING_PADDING * 2 });
    };
    let cursor = 0;
    for (const node of (byLine.get(projection.sourceLines[row]) ?? []).sort((a, b) => a.startColumn - b.startColumn)) {
      const start = Math.max(cursor, node.startColumn - 1), end = Math.max(start, node.endColumn);
      add(cursor, start); add(start, end, node.id); cursor = end;
    }
    add(cursor, text.length);
  });
  if (obstacles.length) {
    const x = Math.min(...obstacles.map(r => r.x)) + ROUTING_PADDING;
    const y = Math.min(...obstacles.map(r => r.y)) + ROUTING_PADDING;
    const right = Math.max(...obstacles.map(r => r.x + r.width)) - ROUTING_PADDING;
    const bottom = Math.max(...obstacles.map(r => r.y + r.height)) - ROUTING_PADDING;
    obstacles.push(...diagramBoundaryObstacles(displayNodeId, { x, y, width: right - x, height: bottom - y }));
  }
  if (measureSpan) return obstacles;
  if (!cached) { cached = new Map(); localCache.set(content, cached); }
  if (cached.size >= 16) cached.delete(cached.keys().next().value!);
  cached.set(key, obstacles);
  return obstacles;
}

export function sceneRoutingObstacles(scene: LineGridScene, views: DiagramViews | undefined, cell: { width: number; height: number }): RoutingObstacle[] {
  return flattenGrid(resolveDiagramView(scene, views)).flatMap(box => box.contentId
    ? diagramRoutingObstacles(`grid:${box.box.id}`, scene.contents[box.contentId].content, box.box.collapsed ? undefined : views?.[`grid:${box.box.id}`], cell)
      .map(rect => ({ ...rect, x: rect.x + box.bounds.column * cell.width, y: rect.y + box.bounds.row * cell.height })) : []);
}

/** Endpoint rectangles replace their own padded labels; guide costs are retained. */
export function connectionObstacles(obstacles: readonly RoutingObstacle[], source?: EndpointIdentity, target?: EndpointIdentity): RoutingObstacle[] {
  return obstacles.filter(obstacle => obstacle.kind === 'clearance' || ![source, target].some(endpoint => endpoint?.displayNodeId === obstacle.displayNodeId
    && (!endpoint.contentNodeId || endpoint.contentNodeId === obstacle.contentNodeId)));
}
