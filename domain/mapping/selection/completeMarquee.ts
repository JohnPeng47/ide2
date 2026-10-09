import type { LineGridScene, ResolvedGridBox } from '../../core/diagrams/lineGrid';
import { diagramSelectionItem, regionSelectionItem } from './selectionState';
import { updateSelection, type CanvasMarqueeSelection } from './canvasSelection';
import type { SelectionPolicy } from './selectionGesture';
import { addDisplayNode, displayGeometry, type SelectionRegion } from '../workspace/displayModel';
import { initialSelectionSurface, type MappingCanvasState } from '../workspace/mappingWorkspace';

/** Commit membership and retain reusable region identities and their display surfaces. */
export function completeMarquee(current: MappingCanvasState, marquee: CanvasMarqueeSelection,
  scene: LineGridScene, boxes: readonly ResolvedGridBox[], policy: SelectionPolicy): MappingCanvasState {
  const items = marquee.diagramIds.map(diagramSelectionItem);
  for (const { boxId, rect } of marquee.regions) {
    if (marquee.diagramIds.includes(`grid:${boxId}`)) continue;
    const box = boxes.find(box => box.box.id === boxId), diagram = box?.contentId && scene.contents[box.contentId];
    if (!diagram) continue;
    const existing = Object.values(current.display.nodes).find((node): node is SelectionRegion => node.kind === 'selection'
      && node.sourceBoxId === boxId && node.sourceAscii === diagram.content.ascii
      && JSON.stringify(node.rect) === JSON.stringify(rect));
    items.push(regionSelectionItem(diagram, boxId, rect, existing?.id));
  }
  let next = updateSelection(current, { type: policy, items });
  const surfaces = { ...next.controls.surfaces };
  let last: SelectionRegion | undefined;
  for (const requested of items.filter(item => item.region)) {
    // The reducer may reuse an existing identity for a repeated gesture.
    const item = next.selection.items.find(item => item.region && item.displayNodeId === requested.displayNodeId
      && JSON.stringify(item.region.rect) === JSON.stringify(requested.region!.rect))!;
    const region = item.region!, existing = next.display.nodes[item.id];
    last = { ...displayGeometry(), id: item.id, kind: 'selection', childIds: [], expansion: 'expanded', displayMode: 'stacked',
      ...(existing?.kind === 'selection' ? existing : {}), sourceBoxId: item.displayNodeId.slice(5),
      sourceContentId: region.sourceContentId, sourceAscii: region.sourceAscii, sourceRevisionId: region.sourceRevisionId,
      rect: region.rect, selectedIds: [...region.selectedIds] };
    next = { ...next, display: existing ? { ...next.display, nodes: { ...next.display.nodes, [last.id]: last } }
      : addDisplayNode(next.display, last) };
    surfaces[last.id] = { ...surfaces[last.id] ?? initialSelectionSurface(), actionsOpen: false };
  }
  return { ...next, controls: { ...next.controls, surfaces, selectionFocusId: last?.id ?? null,
    ...(last ? { activeBoxId: last.sourceBoxId } : {}) } };
}
