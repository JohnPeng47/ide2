import { clearSegment, type RouteObstacle, type RoutePoint } from './edgeRouting';

export interface LaneRoute { id: string; points: readonly RoutePoint[]; obstacles: readonly RouteObstacle[] }
const spacing = 6, stub = 8, epsilon = 0.001;
type Segment = { horizontal: boolean; fixed: number; low: number; high: number };
function segment(a: RoutePoint, b: RoutePoint): Segment {
  const horizontal = Math.abs(a.y - b.y) < epsilon;
  return { horizontal, fixed: horizontal ? a.y : a.x,
    low: Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
    high: Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y) };
}
const key = (s: Segment) => `${s.horizontal ? 'h' : 'v'}:${Math.round(s.fixed / epsilon)}`;
function segments(points: readonly RoutePoint[]) { return points.slice(1).map((b, i) => segment(points[i], b)); }
function compact(points: RoutePoint[]) {
  const result: RoutePoint[] = [];
  for (const p of points) {
    const b = result.at(-1), a = result.at(-2);
    if (b && p.x === b.x && p.y === b.y) continue;
    if (a && b && ((a.x === b.x && b.x === p.x && (b.y - a.y) * (p.y - b.y) >= 0)
      || (a.y === b.y && b.y === p.y && (b.x - a.x) * (p.x - b.x) >= 0))) result.pop();
    result.push(p);
  }
  return result;
}
function shift(points: readonly RoutePoint[], index: number, offset: number) {
  const a = points[index], b = points[index + 1], s = segment(a, b);
  const first = index === 0, last = index === points.length - 2;
  if (s.high - s.low <= (Number(first) + Number(last)) * stub + epsilon) return;
  const axis = s.horizontal ? 'x' : 'y', normal = s.horizontal ? 'y' : 'x';
  const direction = Math.sign(b[axis] - a[axis]);
  const start = first ? { ...a, [axis]: a[axis] + direction * stub } : a;
  const end = last ? { ...b, [axis]: b[axis] - direction * stub } : b;
  return compact([...points.slice(0, index), ...(first ? [a, start] : []),
    { ...start, [normal]: start[normal] + offset }, { ...end, [normal]: end[normal] + offset },
    ...(last ? [end, b] : []), ...points.slice(index + 2)]);
}
function sameApproach(before: readonly RoutePoint[], after: readonly RoutePoint[]) {
  const direction = (a: RoutePoint, b: RoutePoint) => `${Math.sign(b.x - a.x)},${Math.sign(b.y - a.y)}`;
  return direction(before[0], before[1]) === direction(after[0], after[1])
    && direction(before.at(-2)!, before.at(-1)!) === direction(after.at(-2)!, after.at(-1)!);
}

/** Space only collinear overlaps. Perpendicular crossings are deliberately ignored.
 * Stable ID ordering makes lanes independent of component render order. The channel
 * index avoids comparing every edge pair; bounded attempts keep congested cases cheap.
 */
export function separateEdgeLanes(routes: readonly LaneRoute[]): Map<string, readonly RoutePoint[]> {
  const channels = new Map<string, Segment[]>(), result = new Map<string, readonly RoutePoint[]>();
  const overlap = (s: Segment) => (channels.get(key(s)) ?? []).reduce((sum, other) =>
    sum + Math.max(0, Math.min(s.high, other.high) - Math.max(s.low, other.low)), 0);
  const score = (points: readonly RoutePoint[]) => segments(points).reduce((sum, s) => sum + overlap(s), 0);
  for (const route of [...routes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    let points = route.points;
    const blockers = route.obstacles.filter(rect => rect.kind !== 'guide');
    for (let pass = 0; pass < Math.min(48, route.points.length * 2); pass++) {
      let best = points, bestScore = score(points);
      if (bestScore < epsilon) break;
      for (let i = 0; i < points.length - 1; i++) {
        if (overlap(segment(points[i], points[i + 1])) < epsilon) continue;
        for (const offset of [spacing, -spacing, spacing * 2, -spacing * 2, spacing * 3, -spacing * 3]) {
          const candidate = shift(points, i, offset);
          if (!candidate || !sameApproach(route.points, candidate)) continue;
          const cost = score(candidate);
          if (cost >= bestScore - epsilon) continue;
          if (!candidate.slice(1).every((b, j) => clearSegment(candidate[j], b, blockers))) continue;
          best = candidate; bestScore = cost;
          if (cost < epsilon) break;
        }
        if (bestScore < epsilon) break;
      }
      if (best === points) break;
      points = best;
    }
    result.set(route.id, points);
    for (const s of segments(points)) {
      const channel = key(s), list = channels.get(channel) ?? [];
      list.push(s); channels.set(channel, list);
    }
  }
  return result;
}
