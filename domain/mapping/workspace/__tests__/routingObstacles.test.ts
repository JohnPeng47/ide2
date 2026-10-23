import { expect, it } from 'vitest';
import { RevisionedDiagramService } from '../../../core/diagrams/diagramService';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { connectionObstacles, diagramRoutingObstacles } from '../routingObstacles';
import { routeCost, routeEdge, type RoutePoint, type RouteObstacle } from '../edgeRouting';
import type { EndpointRect } from '../endpointGeometry';

function avoids(points: RoutePoint[], rectangles: EndpointRect[]) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    expect(a.x === b.x || a.y === b.y).toBe(true);
    for (const r of rectangles) {
      const intersects = a.y === b.y
        ? a.y > r.y && a.y < r.y + r.height && Math.min(a.x, b.x) < r.x + r.width && Math.max(a.x, b.x) > r.x
        : a.x > r.x && a.x < r.x + r.width && Math.min(a.y, b.y) < r.y + r.height && Math.max(a.y, b.y) > r.y;
      expect(intersects, JSON.stringify({ a, b, r })).toBe(false);
    }
  }
}
it('caches coarse text obstacles and retains guides when an endpoint label is excluded', () => {
  const diagram = new RevisionedDiagramService().create({ id: 'test', revision: 0, structureKind: 'tree',
    ascii: 'Root\n|-- Parent\n|   `-- Child\n`-- Tail' }).diagram;
  const nodes = diagramContentNodes(diagram.content), parent = nodes.find(n => n.label === 'Parent')!, child = nodes.find(n => n.label === 'Child')!;
  const obstacles = diagramRoutingObstacles('grid:test', diagram.content, undefined, { width: 8, height: 18 });
  expect(diagramRoutingObstacles('grid:test', diagram.content, undefined, { width: 8, height: 18 })).toBe(obstacles);
  expect(obstacles).toHaveLength(7); // Four labels and three complete guide spans.
  expect(obstacles.filter(r => r.kind === 'guide')).toHaveLength(3);
  expect(obstacles.filter(r => r.contentNodeId).every(r => r.kind === 'text')).toBe(true);
  const filtered = connectionObstacles(obstacles, { displayNodeId: 'grid:test', contentNodeId: child.id });
  expect(filtered).not.toContain(obstacles.find(r => r.contentNodeId === child.id));
  expect(filtered).toContain(obstacles.find(r => !r.contentNodeId && r.y === 33));
  const folded = diagramRoutingObstacles('grid:test', diagram.content, { contentRevisionId: diagram.content.revisionId,
    collapsedContentNodeIds: [parent.id] }, { width: 8, height: 18 });
  expect(folded.some(r => r.contentNodeId === child.id)).toBe(false);
  expect(folded.find(r => r.contentNodeId === nodes.find(n => n.label === 'Tail')!.id)!.y).toBe(33);
});
it('avoids hard text rectangles using a short orthogonal detour', () => {
  const a = { x: 0, y: 50, width: 30, height: 20 }, b = { x: 300, y: 50, width: 30, height: 20 };
  const obstacles = [a, b, { x: 130, y: 30, width: 60, height: 60 }, { x: 100, y: 30, width: 6, height: 60 }];
  const source = { x: 30, y: 60, side: 'right' as const }, target = { x: 300, y: 60, side: 'left' as const };
  const points = routeEdge(source, target, obstacles)!;
  expect(points).toBeDefined(); avoids(points, obstacles);
  expect(points.length).toBeLessThanOrEqual(6);
});
it('keeps unparsed notes and punctuation labels hard while allowing guide-only rows', () => {
  const diagram = new RevisionedDiagramService().create({ id: 'test', revision: 0, structureKind: 'tree',
    ascii: 'Root\n|\n|-- +\n`-- Tail\nUnparsed note' }).diagram;
  const obstacles = diagramRoutingObstacles('grid:test', diagram.content, undefined, { width: 8, height: 18 });
  expect(obstacles.find(r => r.y === 15)).toMatchObject({ kind: 'guide' });
  expect(obstacles.find(r => r.y === 69)).toMatchObject({ kind: 'text' });
  const punctuation = diagramContentNodes(diagram.content).find(n => n.label === '+')!;
  expect(obstacles.find(r => r.contentNodeId === punctuation.id)).toMatchObject({ kind: 'text' });
});
it('crosses a tall guide directly, including a target stub inside the guide, without crossing labels', () => {
  const hard = [{ x: -30, y: 890, width: 30, height: 20 }, { x: 200, y: 890, width: 70, height: 20 }];
  const guide: RouteObstacle = { x: 180, y: 0, width: 8, height: 2000, kind: 'guide' };
  const source = { x: 0, y: 900, side: 'right' as const }, target = { x: 200, y: 900, side: 'left' as const };
  const points = routeEdge(source, target, [...hard, guide])!;
  expect(points).toEqual([source, target]); avoids(points, hard);
  expect(routeCost(points, [guide])).toBeGreaterThan(routeCost(points));
  const blocked = routeEdge(source, target, [...hard, { ...guide, kind: 'text' }])!;
  expect(routeCost(blocked)).toBeGreaterThan(1000);
});
it('prefers a clear channel over following a guide when the detours otherwise cost the same', () => {
  const guide: RouteObstacle = { x: 50, y: -3, width: 200, height: 6, kind: 'guide' };
  const points = routeEdge({ x: 0, y: 0, side: 'right' }, { x: 300, y: 80, side: 'left' }, [guide])!;
  avoids(points, [guide]);
  expect(routeCost(points, [guide])).toBe(routeCost(points));
});
it('charges the same guide cost across grid subdivisions and overlapping padded rows', () => {
  const guide: RouteObstacle = { x: 10, y: -10, width: 10, height: 20, kind: 'guide' };
  const direct = [{ x: 0, y: 0 }, { x: 30, y: 0 }], split = [direct[0], { x: 15, y: 0 }, direct[1]];
  expect(routeCost(direct, [guide])).toBe(routeCost(split, [guide, { ...guide, y: -5 }]));
});
it('expands beyond a blocked initial corridor and never crosses obstacles outside the original search area', () => {
  const a = { x: 0, y: 0, width: 30, height: 20 }, b = { x: 300, y: 0, width: 30, height: 20 };
  const obstacles = [a, b, { x: 100, y: -600, width: 50, height: 1200 }, { x: 180, y: -630, width: 30, height: 1260 }];
  const points = routeEdge({ x: 30, y: 10, side: 'right' }, { x: 300, y: 10, side: 'left' }, obstacles)!;
  expect(points).toBeDefined(); avoids(points, obstacles);
  expect(points.some(p => p.y <= -630 || p.y >= 630)).toBe(true);
});
it('handles hundreds of row obstacles without creating all pairs of grid points', () => {
  const obstacles = Array.from({ length: 250 }, (_, i) => ({ x: 80 + i % 11, y: -500 + i * 6, width: 70 + i % 7, height: 5 }));
  const points = routeEdge({ x: 0, y: 0, side: 'right' }, { x: 300, y: 0, side: 'left' }, obstacles)!;
  expect(points).toBeDefined(); avoids(points, obstacles);
});
