import { addDisplayNode, displayGeometry, type SelectionRegion } from '../workspace/displayModel';
import { initialSelectionSurface, type MappingCanvasState } from '../workspace/mappingWorkspace';

/** Every state writer (including restore/API/history) gets the same selection presentation. */
export function syncSelectionPresentation(canvas: MappingCanvasState): MappingCanvasState {
  let display = canvas.display, surfaces = canvas.controls.surfaces;
  for (const item of canvas.selection.items) {
    if (!item.region) continue;
    const region = item.region, existing = display.nodes[item.id];
    const captured = { sourceBoxId: item.displayNodeId.slice(5), sourceContentId: region.sourceContentId,
      sourceAscii: region.sourceAscii, sourceRevisionId: region.sourceRevisionId, rect: region.rect,
      selectedIds: [...region.selectedIds], contentNodeIds: region.contentNodeIds };
    if (existing?.kind !== 'selection' || Object.entries(captured).some(([key, value]) =>
      JSON.stringify(existing[key as keyof SelectionRegion]) !== JSON.stringify(value))) {
      const node: SelectionRegion = { ...displayGeometry(), id: item.id, kind: 'selection', childIds: [],
        expansion: 'expanded', displayMode: 'stacked', ...(existing?.kind === 'selection' ? existing : {}), ...captured };
      display = existing ? { ...display, nodes: { ...display.nodes, [item.id]: node } } : addDisplayNode(display, node);
    }
    if (!surfaces[item.id]) surfaces = { ...surfaces, [item.id]: { ...initialSelectionSurface(), actionsOpen: false } };
  }
  return display === canvas.display && surfaces === canvas.controls.surfaces ? canvas : {
    ...canvas, display, controls: surfaces === canvas.controls.surfaces ? canvas.controls : { ...canvas.controls, surfaces }
  };
}
