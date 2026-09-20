import type { EndpointRect } from './endpointGeometry';

export interface RoutePoint { x: number; y: number }
export type EndpointSide = 'left' | 'right' | 'top' | 'bottom';
export interface RouteAnchor extends RoutePoint { side: EndpointSide }
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

/** Small orthogonal visibility graph around the two endpoint rectangles. */
export function routeEdge(source: RouteAnchor, target: RouteAnchor, obstacles: readonly EndpointRect[]): RoutePoint[] | undefined {
  const gap = 16;
  const stub = (p: RouteAnchor): RoutePoint | undefined => {
    const dx = p.side === 'left' ? -1 : p.side === 'right' ? 1 : 0;
    const dy = p.side === 'top' ? -1 : p.side === 'bottom' ? 1 : 0;
    // Close neighbors may leave less than the preferred outward clearance.
    for (let length = gap; length >= 0.125; length /= 2) {
      const q = { x: p.x + dx * length, y: p.y + dy * length };
      if (clearSegment(p, q, obstacles)) return q;
    }
  };
  const exit = stub(source), entry = stub(target);
  if (!exit || !entry) return;
  const xs = [...new Set([exit.x, entry.x, ...obstacles.flatMap(r => [r.x - gap, r.x + r.width + gap])])].sort((a, b) => a - b);
  const ys = [...new Set([exit.y, entry.y, ...obstacles.flatMap(r => [r.y - gap, r.y + r.height + gap])])].sort((a, b) => a - b);
  const points = xs.flatMap(x => ys.map(y => ({ x, y }))).filter(p => !obstacles.some(r => inside(p, r)));
  const start = points.findIndex(p => p.x === exit.x && p.y === exit.y);
  const end = points.findIndex(p => p.x === entry.x && p.y === entry.y);
  if (start < 0 || end < 0) return;
  const neighbors = points.map((a, i) => points.flatMap((b, j) => i !== j && clearSegment(a, b, obstacles)
    ? [{ node: j, length: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), direction: a.x === b.x ? 2 : 1 }] : []));
  const distance = new Map<number, number>([[start * 3, 0]]), previous = new Map<number, number>();
  const pending = new Set([start * 3]);
  let goal: number | undefined;
  while (pending.size) {
    const state = [...pending].reduce((a, b) => distance.get(a)! <= distance.get(b)! ? a : b);
    pending.delete(state);
    const node = Math.floor(state / 3), direction = state % 3;
    if (node === end) { goal = state; break; }
    for (const next of neighbors[node]) {
      const key = next.node * 3 + next.direction;
      const cost = distance.get(state)! + next.length + (direction && direction !== next.direction ? 4 : 0);
      if (cost >= (distance.get(key) ?? Infinity)) continue;
      distance.set(key, cost); previous.set(key, state); pending.add(key);
    }
  }
  if (goal === undefined) return;
  const middle: RoutePoint[] = [];
  for (let step: number | undefined = goal; step !== undefined; step = previous.get(step)) middle.unshift(points[Math.floor(step / 3)]);
  return [source, ...middle, target];
}

export const routePath = (points: readonly RoutePoint[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
