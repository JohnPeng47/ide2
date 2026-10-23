import type { EndpointRect } from './endpointGeometry';

export interface RoutePoint { x: number; y: number }
export type EndpointSide = 'left' | 'right' | 'top' | 'bottom';
export interface RouteAnchor extends RoutePoint { side: EndpointSide }
export interface RouteObstacle extends EndpointRect { kind?: 'text' | 'guide' }
const EPS = 0.00001;
const inside = (p: RoutePoint, r: EndpointRect) => p.x > r.x + EPS && p.x < r.x + r.width - EPS
  && p.y > r.y + EPS && p.y < r.y + r.height - EPS;

/** Touching a border is allowed; crossing a rectangle's interior is not. */
export function clearSegment(a: RoutePoint, b: RoutePoint, obstacles: readonly EndpointRect[]): boolean {
  if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) return false;
  return obstacles.every(r => Math.abs(a.y - b.y) < EPS
    ? !(a.y > r.y + EPS && a.y < r.y + r.height - EPS && Math.max(a.x, b.x) > r.x + EPS && Math.min(a.x, b.x) < r.x + r.width - EPS)
    : !(a.x > r.x + EPS && a.x < r.x + r.width - EPS && Math.max(a.y, b.y) > r.y + EPS && Math.min(a.y, b.y) < r.y + r.height - EPS));
}

const BEND_COST = 32;
const GUIDE_COST_PER_PIXEL = 2;
type Interval = [number, number];
function lineIntervals(obstacles: readonly EndpointRect[], direction: number, fixed: number): Interval[] {
  const raw = obstacles.filter(r => direction === 0 ? fixed > r.y + EPS && fixed < r.y + r.height - EPS
    : fixed > r.x + EPS && fixed < r.x + r.width - EPS)
    .map(r => direction === 0 ? [r.x, r.x + r.width] as Interval : [r.y, r.y + r.height] as Interval).sort((a, b) => a[0] - b[0]);
  const intervals: Interval[] = [];
  for (const interval of raw) {
    const previous = intervals.at(-1);
    if (previous && interval[0] < previous[1] - EPS) previous[1] = Math.max(previous[1], interval[1]);
    else intervals.push([...interval]);
  }
  return intervals;
}
/** Charge for distance inside guides, so crossing a gutter is cheap but following
 * it is discouraged. Merging padded rows avoids charging overlapping guides twice. */
function guideCosts(obstacles: readonly RouteObstacle[]) {
  const guides = obstacles.filter(r => r.kind === 'guide');
  const rows = new Map<number, Interval[]>(), columns = new Map<number, Interval[]>();
  return (direction: number, fixed: number, from: number, to: number) => {
    if (!guides.length) return 0;
    const cache = direction === 0 ? rows : columns;
    let intervals = cache.get(fixed);
    if (!intervals) { intervals = lineIntervals(guides, direction, fixed); cache.set(fixed, intervals); }
    const low = Math.min(from, to), high = Math.max(from, to);
    let left = 0, right = intervals.length;
    while (left < right) { const mid = (left + right) >> 1; if (intervals[mid][1] <= low) left = mid + 1; else right = mid; }
    let length = 0;
    for (let i = left; i < intervals.length && intervals[i][0] < high; i++)
      length += Math.max(0, Math.min(high, intervals[i][1]) - Math.max(low, intervals[i][0]));
    return length * GUIDE_COST_PER_PIXEL;
  };
}
/** Use the search's length + bend + guide objective when comparing attachment candidates. */
export function routeCost(points: readonly RoutePoint[], obstacles: readonly RouteObstacle[] = []): number {
  const guideCost = guideCosts(obstacles);
  let cost = 0, previousAxis: number | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (length < EPS) continue;
    const direction = Math.abs(b.y - a.y) < EPS ? 0 : 1;
    cost += length + (previousAxis !== undefined && previousAxis !== direction ? BEND_COST : 0);
    cost += guideCost(direction, direction === 0 ? a.y : a.x, direction === 0 ? a.x : a.y, direction === 0 ? b.x : b.y);
    previousAxis = direction;
  }
  return cost;
}
interface SearchEntry { state: number; cost: number; priority: number }
class SearchQueue {
  private entries: SearchEntry[] = [];
  private before(a: SearchEntry, b: SearchEntry) { return a.priority < b.priority || a.priority === b.priority && a.cost > b.cost; }
  push(entry: SearchEntry) {
    let i = this.entries.length; this.entries.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(entry, this.entries[parent])) break;
      this.entries[i] = this.entries[parent]; i = parent;
    }
    this.entries[i] = entry;
  }
  pop(): SearchEntry | undefined {
    const first = this.entries[0], last = this.entries.pop();
    if (!this.entries.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.entries.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.entries.length && this.before(this.entries[child + 1], this.entries[child])) child++;
      if (!this.before(this.entries[child], last!)) break;
      this.entries[i] = this.entries[child]; i = child;
    }
    this.entries[i] = last!; return first;
  }
}
export function routeEnvelope(source: RoutePoint, target: RoutePoint, margin: number): EndpointRect {
  return { x: Math.min(source.x, target.x) - margin, y: Math.min(source.y, target.y) - margin,
    width: Math.abs(source.x - target.x) + margin * 2, height: Math.abs(source.y - target.y) + margin * 2 };
}
export function overlapsRoute(a: EndpointRect, b: EndpointRect) {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}
const axis = (side: EndpointSide) => side === 'left' || side === 'right' ? 0 : 1;

/** A* on adjacent intersections. Coordinates and collision intervals are shared by each row/column;
 * the search allocates only visited states, with no all-pairs visibility graph. */
function searchRoute(source: RouteAnchor, target: RouteAnchor, exit: RoutePoint, entry: RoutePoint,
  obstacles: readonly RouteObstacle[], envelope: EndpointRect): RoutePoint[] | undefined {
  const hard = obstacles.filter(r => r.kind !== 'guide'), guideCost = guideCosts(obstacles);
  const xs = [...new Set([exit.x, entry.x, envelope.x, envelope.x + envelope.width,
    ...obstacles.flatMap(r => [r.x, r.x + r.width])])].filter(x => x >= envelope.x && x <= envelope.x + envelope.width).sort((a, b) => a - b);
  const ys = [...new Set([exit.y, entry.y, envelope.y, envelope.y + envelope.height,
    ...obstacles.flatMap(r => [r.y, r.y + r.height])])].filter(y => y >= envelope.y && y <= envelope.y + envelope.height).sort((a, b) => a - b);
  const nx = xs.length, start = ys.indexOf(exit.y) * nx + xs.indexOf(exit.x), end = ys.indexOf(entry.y) * nx + xs.indexOf(entry.x);
  const rows = new Map<number, Interval[]>(), columns = new Map<number, Interval[]>();
  const clear = (direction: number, fixed: number, from: number, to: number) => {
    const cache = direction === 0 ? rows : columns;
    let intervals = cache.get(fixed);
    if (!intervals) {
      intervals = lineIntervals(hard, direction, fixed);
      cache.set(fixed, intervals);
    }
    const low = Math.min(from, to), high = Math.max(from, to);
    let left = 0, right = intervals.length;
    while (left < right) { const mid = (left + right) >> 1; if (intervals[mid][1] <= low + EPS) left = mid + 1; else right = mid; }
    return left === intervals.length || intervals[left][0] >= high - EPS;
  };
  const initial = start * 2 + axis(source.side), distance = new Map([[initial, 0]]), previous = new Map<number, number>();
  const queue = new SearchQueue(); queue.push({ state: initial, cost: 0, priority: Math.abs(exit.x - entry.x) + Math.abs(exit.y - entry.y) });
  let goal: number | undefined, current: SearchEntry | undefined;
  while ((current = queue.pop())) {
    const { state, cost } = current;
    if (cost !== distance.get(state)) continue;
    const node = Math.floor(state / 2), direction = state % 2, x = node % nx, y = Math.floor(node / nx);
    if (node === end) { goal = state; break; }
    for (const [xx, yy, nextDirection] of [[x - 1, y, 0], [x + 1, y, 0], [x, y - 1, 1], [x, y + 1, 1]]) {
      if (xx < 0 || xx >= nx || yy < 0 || yy >= ys.length) continue;
      if (!clear(nextDirection, nextDirection === 0 ? ys[y] : xs[x], nextDirection === 0 ? xs[x] : ys[y], nextDirection === 0 ? xs[xx] : ys[yy])) continue;
      const next = yy * nx + xx, key = next * 2 + nextDirection;
      const nextCost = cost + Math.abs(xs[xx] - xs[x]) + Math.abs(ys[yy] - ys[y]) + (direction !== nextDirection ? BEND_COST : 0)
        + guideCost(nextDirection, nextDirection === 0 ? ys[y] : xs[x], nextDirection === 0 ? xs[x] : ys[y], nextDirection === 0 ? xs[xx] : ys[yy])
        + (next === end && nextDirection !== axis(target.side) ? BEND_COST : 0);
      if (nextCost >= (distance.get(key) ?? Infinity)) continue;
      distance.set(key, nextCost); previous.set(key, state);
      queue.push({ state: key, cost: nextCost, priority: nextCost + Math.abs(xs[xx] - entry.x) + Math.abs(ys[yy] - entry.y) });
    }
  }
  if (goal === undefined) return;
  const middle: RoutePoint[] = [];
  for (let step: number | undefined = goal; step !== undefined; step = previous.get(step)) {
    const node = Math.floor(step / 2); middle.push({ x: xs[node % nx], y: ys[Math.floor(node / nx)] });
  }
  const result: RoutePoint[] = [];
  for (const p of [source, ...middle.reverse(), target]) {
    const b = result.at(-1), a = result.at(-2);
    if (b && p.x === b.x && p.y === b.y) continue;
    if (a && b && (a.x === b.x && b.x === p.x && (b.y - a.y) * (p.y - b.y) >= 0
      || a.y === b.y && b.y === p.y && (b.x - a.x) * (p.x - b.x) >= 0)) result.pop();
    result.push(p);
  }
  return result;
}

/** Use a bounded corridor first; expand it if blocked. Every explored corridor includes all intersecting obstacles. */
export function routeEdge(source: RouteAnchor, target: RouteAnchor, obstacles: readonly RouteObstacle[], envelope?: EndpointRect): RoutePoint[] | undefined {
  const hard = obstacles.filter(r => r.kind !== 'guide');
  const stub = (p: RouteAnchor): RoutePoint | undefined => {
    const dx = p.side === 'left' ? -1 : p.side === 'right' ? 1 : 0;
    const dy = p.side === 'top' ? -1 : p.side === 'bottom' ? 1 : 0;
    for (let length = 16; length >= 0.125; length /= 2) {
      const q = { x: p.x + dx * length, y: p.y + dy * length };
      if (!hard.some(r => inside(q, r)) && clearSegment(p, q, hard)) return q;
    }
  };
  const exit = stub(source), entry = stub(target);
  if (!exit || !entry) return;
  const regions = envelope ? [envelope] : [32, 128, 512].map(margin => routeEnvelope(exit, entry, margin));
  if (!envelope) {
    const x = Math.min(exit.x, entry.x, ...obstacles.map(r => r.x)) - 16;
    const y = Math.min(exit.y, entry.y, ...obstacles.map(r => r.y)) - 16;
    regions.push({ x, y, width: Math.max(exit.x, entry.x, ...obstacles.map(r => r.x + r.width)) + 16 - x,
      height: Math.max(exit.y, entry.y, ...obstacles.map(r => r.y + r.height)) + 16 - y });
  }
  for (const region of regions) {
    if (exit.x < region.x || exit.x > region.x + region.width || exit.y < region.y || exit.y > region.y + region.height
      || entry.x < region.x || entry.x > region.x + region.width || entry.y < region.y || entry.y > region.y + region.height) continue;
    const result = searchRoute(source, target, exit, entry, obstacles.filter(r => overlapsRoute(r, region)), region);
    if (result) return result;
  }
}

export const routePath = (points: readonly RoutePoint[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
