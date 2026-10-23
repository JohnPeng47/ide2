import { expect, it } from 'vitest';
import { separateEdgeLanes, type LaneRoute } from '../edgeLanes';
import { clearSegment, type RoutePoint } from '../edgeRouting';
const route = (id: string, points: RoutePoint[], obstacles: LaneRoute['obstacles'] = []): LaneRoute => ({ id, points, obstacles });
const horizontal = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

it('separates shared horizontal runs into stable lanes and keeps endpoint approaches', () => {
  const routes = ['c', 'a', 'b'].map(id => route(id, horizontal));
  const lanes = separateEdgeLanes(routes);
  expect(lanes.get('a')).toBe(horizontal);
  expect(lanes.get('b')).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 92, y: 6 }, { x: 92, y: 0 }, { x: 100, y: 0 }]);
  expect(lanes.get('c')?.some(p => p.y === -6)).toBe(true);
  expect(separateEdgeLanes([...routes].reverse())).toEqual(lanes);
});
it('separates partial and reversed vertical overlaps', () => {
  const a = route('a', [{ x: 0, y: 0 }, { x: 0, y: 100 }]);
  const b = route('b', [{ x: 0, y: 150 }, { x: 0, y: 50 }]);
  const points = separateEdgeLanes([a, b]).get('b')!;
  expect(points.some(p => p.x === 6)).toBe(true);
  expect(points[0]).toEqual(b.points[0]); expect(points.at(-1)).toEqual(b.points.at(-1));
});
it('shifts an interior trunk by extending its neighbours instead of adding staircases', () => {
  const points = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 100 }, { x: 100, y: 100 }];
  const a = route('a', [{ x: 40, y: -50 }, { x: 40, y: 150 }]);
  expect(separateEdgeLanes([a, route('b', points)]).get('b')).toEqual([
    { x: 0, y: 0 }, { x: 46, y: 0 }, { x: 46, y: 100 }, { x: 100, y: 100 }
  ]);
});
it('checks joins and labels, choosing the free side or leaving a tight channel alone', () => {
  const lower = { x: 5, y: 2, width: 90, height: 30 }, upper = { ...lower, y: -32 };
  const a = route('a', horizontal), b = route('b', horizontal, [lower]);
  const points = separateEdgeLanes([a, b]).get('b')!;
  expect(points.some(p => p.y === -6)).toBe(true);
  expect(points.slice(1).every((p, i) => clearSegment(points[i], p, b.obstacles))).toBe(true);
  expect(separateEdgeLanes([a, { ...b, obstacles: [lower, upper] }]).get('b')).toBe(horizontal);
});
it('leaves simple crossings and disjoint collinear runs unchanged', () => {
  const routes = [route('a', horizontal), route('b', [{ x: 50, y: -20 }, { x: 50, y: 20 }]),
    route('c', [{ x: 100, y: 0 }, { x: 200, y: 0 }])];
  const lanes = separateEdgeLanes(routes);
  for (const r of routes) expect(lanes.get(r.id)).toBe(r.points);
});
