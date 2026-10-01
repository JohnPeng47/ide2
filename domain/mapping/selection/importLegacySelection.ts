import type { LineGridScene } from '../../core/diagrams/lineGrid';
import type { MappingCanvasState } from '../workspace/mappingWorkspace';
import type { SelectionRegion } from '../workspace/displayModel';
import type { MappingPocGridRect } from './mappingPoc';
import { diagramSelectionItem, regionSelectionItem, selectionCommand, type SelectionItem } from './selectionState';

/** Read old workspaces/checkpoints once. Runtime consumers never consult legacy membership fields. */
export function importLegacySelection(canvas: MappingCanvasState, scene: LineGridScene): MappingCanvasState {
  if (canvas.selection) return canvas;
  const legacy = canvas.controls as typeof canvas.controls & {
    selectedDiagramIds?: string[]; selectionRect?: MappingPocGridRect | null;
    selectedNodeIds?: string[]; retainedSelectionId?: string | null;
  };
  const { selectedDiagramIds, selectionRect, selectedNodeIds, retainedSelectionId, ...controls } = legacy;
  const items: SelectionItem[] = [];
  const nodes = Object.fromEntries(Object.entries(canvas.display.nodes).map(([id, node]) => {
    if (node.kind !== 'selection') return [id, node];
    const { selectionActive, ...context } = node as SelectionRegion & { selectionActive?: boolean };
    if (selectionActive !== false) items.push({ id, displayNodeId: `grid:${node.sourceBoxId}`, region: {
      sourceContentId: node.sourceContentId, sourceRevisionId: node.sourceRevisionId, sourceAscii: node.sourceAscii,
      rect: node.rect, selectedIds: node.selectedIds
    } });
    return [id, context];
  }));
  let focusId = retainedSelectionId ?? null;
  if (selectionRect && !items.some(item => item.id === focusId)) {
    const find = (box: LineGridScene['root']): string | undefined => box.id === controls.activeBoxId && box.kind === 'diagram'
      ? box.contentId : box.kind === 'container' ? box.children.map(find).find(Boolean) : undefined;
    const contentId = find(scene.root), diagram = contentId && scene.contents[contentId];
    if (diagram) {
      const item = regionSelectionItem(diagram, controls.activeBoxId, selectionRect,
        `legacy-selection:${controls.activeBoxId}:${selectionRect.startLine}:${selectionRect.startColumn}:${selectionRect.endLine}:${selectionRect.endColumn}`);
      items.push({ ...item, region: { ...item.region!, selectedIds: selectedNodeIds ?? [] } }); focusId = item.id;
    }
  }
  const selection = selectionCommand({ items: [] }, { type: 'add', items: [...items, ...(selectedDiagramIds ?? []).map(diagramSelectionItem)] });
  return { ...canvas, display: { ...canvas.display, nodes }, selection,
    controls: { ...controls, selectionFocusId: selection.items.some(item => item.id === focusId) ? focusId : null } };
}
