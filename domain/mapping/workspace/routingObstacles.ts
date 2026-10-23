import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import type { DiagramContent, DiagramContentNode } from '../../core/diagrams/diagramContent';
import { projectDiagramContent, resolveDiagramView, type DiagramViewState, type DiagramViews } from './diagramViewState';
import { flattenGrid, type LineGridScene } from '../../core/diagrams/lineGrid';
import type { EndpointIdentity } from './endpointGeometry';
import type { RouteObstacle } from './edgeRouting';

export interface RoutingObstacle extends RouteObstacle {
  displayNodeId: string;
  contentNodeId?: string;
}
export const ROUTING_PADDING = 3;
const localCache = new WeakMap<DiagramContent, Map<string, RoutingObstacle[]>>();
// Only unlabelled spans composed entirely of tree connectors are soft. Other
// unparsed text (notes, punctuation labels, etc.) remains a hard obstacle.
const treeGuide = /^[\s|│┃┆┊┇┋╎╏├└┌┐┘┤┬┴┼─━┏┓┗┛┣┫┳┻╋+`\\-]+$/u;

/** Local cell geometry: one rectangle per label and per remaining text span (including tree guides). */
export function diagramRoutingObstacles(displayNodeId: string, content: DiagramContent, view: DiagramViewState | undefined,
  cell: { width: number; height: number }): RoutingObstacle[] {
  const key = JSON.stringify([displayNodeId, view, cell]);
  let cached = localCache.get(content);
  if (cached?.has(key)) return cached.get(key)!;
  const projection = projectDiagramContent(content, view);
  const byLine = new Map<number, DiagramContentNode[]>();
  for (const node of diagramContentNodes(content)) {
    const row = byLine.get(node.line) ?? []; row.push(node); byLine.set(node.line, row);
  }
  const obstacles: RoutingObstacle[] = [];
  projection.ascii.split('\n').forEach((text, row) => {
    const add = (start: number, end: number, contentNodeId?: string) => {
      const span = text.slice(start, end), leading = span.search(/\S/);
      if (leading < 0) return;
      const left = start + leading, right = start + span.trimEnd().length;
      obstacles.push({ displayNodeId, ...(contentNodeId ? { contentNodeId } : {}),
        kind: !contentNodeId && treeGuide.test(span) ? 'guide' : 'text',
        x: left * cell.width - ROUTING_PADDING, y: row * cell.height - ROUTING_PADDING,
        width: (right - left) * cell.width + ROUTING_PADDING * 2, height: cell.height + ROUTING_PADDING * 2 });
    };
    let cursor = 0;
    for (const node of (byLine.get(projection.sourceLines[row]) ?? []).sort((a, b) => a.startColumn - b.startColumn)) {
      const start = Math.max(cursor, node.startColumn - 1), end = Math.max(start, node.endColumn);
      add(cursor, start); add(start, end, node.id); cursor = end;
    }
    add(cursor, text.length);
  });
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
  return obstacles.filter(obstacle => ![source, target].some(endpoint => endpoint?.displayNodeId === obstacle.displayNodeId
    && (!endpoint.contentNodeId || endpoint.contentNodeId === obstacle.contentNodeId)));
}
