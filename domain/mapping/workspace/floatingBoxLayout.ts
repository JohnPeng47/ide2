import type { ResolvedGridBox, LineGridScene } from '../../core/diagrams/lineGrid';
import { updateDisplayGeometry, type DisplayState } from './displayModel';
import { layoutProjectedPanes } from './projectedPaneLayout';

/** FloatingBoxes consume final grid geometry but never become grid-layout obstacles. */
export function layoutFloatingSelections(state: DisplayState, boxes: readonly ResolvedGridBox[], scene: LineGridScene, cell: { width: number; height: number }): DisplayState {
  if (!cell.width || !cell.height) return state;
  let next = state;
  for (const id of state.rootIds) {
    const root = next.nodes[id]; if (root?.kind !== 'selection') continue;
    const box = boxes.find(box => box.box.id === root.sourceBoxId);
    if (box && !box.box.collapsed && scene.contents[root.sourceContentId]?.ascii === root.sourceAscii) {
      next = updateDisplayGeometry(next, id, {
        ...(root.geometryPolicy.placement === 'automatic' ? { position: {
          x: (box.bounds.column + root.rect.startColumn - 1) * cell.width,
          y: (box.bounds.row + root.rect.startLine - 1) * cell.height } } : {}),
        ...(root.geometryPolicy.sizing === 'content' ? { bounds: {
          width: (root.rect.endColumn - root.rect.startColumn + 1) * cell.width,
          height: (root.rect.endLine - root.rect.startLine + 1) * cell.height } } : {})
      });
    }
    next = layoutProjectedPanes(next, next.nodes[id] as typeof root).state;
  }
  return next;
}
