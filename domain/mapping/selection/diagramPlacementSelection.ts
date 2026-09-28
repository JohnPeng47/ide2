export interface SelectionBounds { left: number; top: number; right: number; bottom: number }
/** At least two GridBox vertices must be inside the marquee, including its boundary. */
export function selectsDiagramVertices(box: SelectionBounds, rect: SelectionBounds): boolean {
  return [[box.left, box.top], [box.right, box.top], [box.left, box.bottom], [box.right, box.bottom]]
    .filter(([x, y]) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom).length >= 2;
}
