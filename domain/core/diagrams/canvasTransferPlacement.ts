import { boxesOverlap, flattenGrid, resolveScene, type GridBounds, type GridPoint, type LineGridScene } from './lineGrid';

export function diagramCenterOfMass(bounds: readonly GridBounds[]): GridPoint {
  const mass = bounds.reduce((sum, box) => sum + box.columns * box.rows, 0);
  if (!mass) return { column: 0, row: 0 };
  return {
    column: bounds.reduce((sum, b) => sum + (b.column + b.columns / 2) * b.columns * b.rows, 0) / mass,
    row: bounds.reduce((sum, b) => sum + (b.row + b.rows / 2) * b.columns * b.rows, 0) / mass
  };
}

/** Translate one intact group. Existing siblings are immutable obstacles, including container bounds. */
export function placeTransferredGroup(destination: LineGridScene, incoming: LineGridScene): GridPoint {
  const root = resolveScene(destination), group = resolveScene(incoming);
  const incomingBoxes = flattenGrid(group).filter(node => node.box.kind === 'diagram').map(node => node.bounds);
  const destinationBoxes = flattenGrid(root).filter(node => node.box.kind === 'diagram' || node.box.collapsed).map(node => node.bounds);
  const parent = root.box.kind === 'container' && !root.box.collapsed ? root : undefined;
  const origin = parent ? { column: root.bounds.column, row: root.bounds.row } : { column: 0, row: 0 };
  if (!destinationBoxes.length && !root.children.length && parent) return origin;
  const obstacles = parent ? root.children.map(node => node.bounds) : [root.bounds];
  const center = diagramCenterOfMass(destinationBoxes.length ? destinationBoxes : obstacles);
  const incomingCenter = diagramCenterOfMass(incomingBoxes);
  const row = Math.max(origin.row, Math.round(center.row - incomingCenter.row));
  const ideal = center.column - incomingCenter.column;
  const gap = parent?.box.kind === 'container' ? parent.box.layout.gap : 3;
  // A nearest feasible integer is either nearest to the ideal, or on an obstacle boundary.
  const candidates = new Set([origin.column, Math.floor(ideal), Math.ceil(ideal), ...obstacles.flatMap(box =>
    [box.column - group.bounds.columns - gap, box.column + box.columns + gap])]);
  const fits = [...candidates].filter(column => column >= origin.column && column + group.bounds.columns <= 20000
    && row + group.bounds.rows <= 20000 && !obstacles.some(obstacle => boxesOverlap({ ...group.bounds, column, row }, obstacle, gap)));
  fits.sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || b - a);
  if (!fits.length) throw Error('No free horizontal space within the supported canvas size');
  return { column: fits[0], row };
}
