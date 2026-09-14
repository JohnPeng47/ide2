import { updateDisplayGeometry, visibleProjectionIds, type DisplayState, type SelectionRegion } from './displayModel';
export interface Bounds { x: number; y: number; width: number; height: number }
export const PROJECTION_GAP = 72;
/** Automatic panes share an axis. Manual panes retain their saved pose and get routed connectors. */
export function layoutProjectedPanes(state: DisplayState, root: SelectionRegion) {
  const ids = visibleProjectionIds(state, root.id, root.displayMode);
  const source = { ...root.position, ...root.bounds };
  const placements: Record<string, Bounds> = {};
  const parents = new Map<string, string>();
  Object.values(state.nodes).forEach(node => node.childIds.forEach(id => parents.set(id, node.id)));
  const axisY = source.y + Math.min(24, source.height / 2);
  const links: { id: string; x1: number; x2: number; y: number; y2: number }[] = [];
  let next = state;
  for (const id of ids) {
    const node = next.nodes[id];
    const parent = placements[parents.get(id) ?? ''] ?? source;
    const x1 = parent.x + parent.width;
    const parentY = parent === source ? axisY : parent.y + Math.min(15, parent.height / 2);
    const position = node.geometryPolicy.placement === 'automatic'
      ? { x: x1 + PROJECTION_GAP, y: axisY - 15 } : node.position;
    next = updateDisplayGeometry(next, id, { position });
    placements[id] = { ...position, ...node.bounds };
    links.push({ id, x1, x2: position.x, y: parentY, y2: position.y + Math.min(15, node.bounds.height / 2) });
  }
  return { state: next, placements, links, axisY };
}
