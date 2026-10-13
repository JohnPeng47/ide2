import { diagramProjection, type DiagramViews } from './diagramViewState';
import type { ResolvedGridBox, LineGridScene } from '../../core/diagrams/lineGrid';
import { updateDisplayGeometry, type DisplayState } from './displayModel';
import { layoutProjectedPanes } from './projectedPaneLayout';

/** FloatingBoxes consume final grid geometry but never become grid-layout obstacles. */
export function layoutFloatingSelections(state: DisplayState, boxes: readonly ResolvedGridBox[], scene: LineGridScene, cell: { width: number; height: number }, views?: DiagramViews): DisplayState {
  if (!cell.width || !cell.height) return state;
  let next = state;
  for (const id of state.rootIds) {
    const root = next.nodes[id]; if (root?.kind !== 'selection') continue;
    const box = boxes.find(box => box.box.id === root.sourceBoxId);
    if (box && !box.box.collapsed && scene.contents[root.sourceContentId]?.content.ascii === root.sourceAscii) {
      const rect = diagramProjection(scene, root.sourceBoxId, root.sourceContentId, views).selectionRect(root.rect);
      if (!rect) continue;
      next = updateDisplayGeometry(next, id, {
        ...(root.geometryPolicy.placement === 'automatic' ? { position: {
          x: (box.bounds.column + root.rect.startColumn - 1) * cell.width,
          y: (box.bounds.row + rect.startLine - 1) * cell.height } } : {}),
        ...(root.geometryPolicy.sizing === 'content' ? { bounds: {
          width: (root.rect.endColumn - root.rect.startColumn + 1) * cell.width,
          height: (rect.endLine - rect.startLine + 1) * cell.height } } : {})
      });
    }
    next = layoutProjectedPanes(next, next.nodes[id] as typeof root).state;
  }
  return next;
}
