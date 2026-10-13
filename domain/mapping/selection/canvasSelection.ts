import { selectionCommand, diagramSelectionItem, type SelectionCommand } from './selectionState';
import { flattenGrid, resolveScene, type ResolvedGridBox, type LineGridScene } from '../../core/diagrams/lineGrid';
import { diagramProjection, type DiagramViews } from '../workspace/diagramViewState';
import type { MappingCanvasState } from '../workspace/mappingWorkspace';
import type { MappingPocGridRect } from './mappingPoc';

export interface SelectionBounds { left: number; top: number; right: number; bottom: number }
export interface CanvasMarqueeSelection { diagramIds: string[]; regions: { boxId: string; rect: MappingPocGridRect }[] }

/** A whole diagram requires complete enclosure, including the boundary. */
export function enclosesDiagram(box: SelectionBounds, marquee: SelectionBounds): boolean {
  return marquee.left <= box.left && marquee.top <= box.top && marquee.right >= box.right && marquee.bottom >= box.bottom;
}

/** Canvas cell coordinates (fractional at the pointer), projected back to raw ASCII. */
export function selectCanvasMarquee(scene: LineGridScene, views: DiagramViews | undefined, bounds: SelectionBounds,
  promoted: readonly string[] = [], boxes: readonly ResolvedGridBox[] = flattenGrid(resolveScene(scene))): CanvasMarqueeSelection {
  const diagramIds = new Set(promoted), regions: CanvasMarqueeSelection['regions'] = [];
  for (const box of boxes) {
    if (box.box.kind !== 'diagram' || !box.contentId) continue;
    const { column: left, row: top, columns, rows } = box.bounds;
    const right = left + columns, bottom = top + rows, id = `grid:${box.box.id}`;
    if (enclosesDiagram({ left, top, right, bottom }, bounds)) diagramIds.add(id);
    if (diagramIds.has(id) || box.box.collapsed || bounds.right < left || bounds.bottom < top || bounds.left >= right || bounds.top >= bottom) continue;
    const projection = diagramProjection(scene, box.box.id, box.contentId, views);
    const firstRow = Math.max(0, Math.floor(bounds.top - top));
    const lastRow = Math.min(projection.sourceLines.length - 1, Math.floor(bounds.bottom - top));
    const startLine = projection.lineForRow(firstRow), endLine = projection.lineForRow(lastRow);
    if (startLine === undefined || endLine === undefined) continue;
    const rect = { startLine, endLine, startColumn: Math.max(1, Math.floor(bounds.left - left) + 1),
      endColumn: Math.min(columns, Math.floor(bounds.right - left) + 1) };
    // Do not silently include hidden source lines in an editable rectangle.
    if (projection.rect(rect)) regions.push({ boxId: box.box.id, rect });
  }
  return { diagramIds: [...diagramIds], regions };
}

/** Canvas integration keeps UI focus valid without giving it ownership of membership. */
export function updateSelection(state: MappingCanvasState, command: SelectionCommand): MappingCanvasState {
  const selection = selectionCommand(state.selection, command);
  const added = selection.items.filter(item => item.region && !state.selection.items.some(old => old.id === item.id)).at(-1);
  const focused = selection.items.find(item => item.region && item.id === state.controls.selectionFocusId);
  const nextFocus = added ?? focused ?? selection.items.filter(item => item.region).at(-1);
  return { ...state, selection, controls: nextFocus?.id === state.controls.selectionFocusId ? state.controls
    : { ...state.controls, selectionFocusId: nextFocus?.id ?? null, ...(nextFocus ? { activeBoxId: nextFocus.displayNodeId.slice(5) } : {}) } };
}

export function selectWholeDiagrams(state: MappingCanvasState, diagramIds: readonly string[]): MappingCanvasState {
  return updateSelection(state, { type: 'replace', items: diagramIds.map(diagramSelectionItem) });
}

export function deselectCanvas(state: MappingCanvasState): MappingCanvasState {
  return updateSelection(state, { type: 'clear' });
}
