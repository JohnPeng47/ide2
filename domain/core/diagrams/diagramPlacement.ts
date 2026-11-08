import type { GridBox, GridPoint, LineGridScene } from './lineGrid';

/** Identity is the displayed instance, not shared diagram content or its editable name. */
export interface DiagramPlacement extends GridPoint {
  canvasId: string;
  diagramId: string;
  contentId: string;
  revisionId: string;
}
export interface PlacementSnapshot {
  schemaVersion: 1;
  coordinateSpace: 'canvas-grid';
  diagrams: DiagramPlacement[];
}

/** Absolute, zero-based grid coordinates, including hidden descendants. Camera/fold state is irrelevant. */
export function diagramPlacements(scene: LineGridScene, canvasId: string): DiagramPlacement[] {
  const placements: DiagramPlacement[] = [];
  const visit = (box: GridBox, parent: GridPoint) => {
    const position = { column: parent.column + box.position.column, row: parent.row + box.position.row };
    if (box.kind === 'container') box.children.forEach(child => visit(child, position));
    else {
      const diagram = scene.contents[box.contentId];
      if (!diagram) throw Error('Diagram placement has no content');
      placements.push({ canvasId, diagramId: `grid:${box.id}`, contentId: box.contentId, revisionId: diagram.revisionId, ...position });
    }
  };
  visit(scene.root, { column: 0, row: 0 });
  return placements;
}

export function placementSnapshot(canvases: readonly { id: string; scene: LineGridScene }[]): PlacementSnapshot {
  return { schemaVersion: 1, coordinateSpace: 'canvas-grid', diagrams: canvases.flatMap(c => diagramPlacements(c.scene, c.id)) };
}
