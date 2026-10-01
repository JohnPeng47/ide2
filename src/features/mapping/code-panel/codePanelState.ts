import type { PanelContent } from '../../../../domain/mapping/code-panel/codePanel';
import { addDisplayNode, displayGeometry, setExpansion, type DisplayState, type ProjectedPane, type SelectionRegion } from '../../../../domain/mapping/workspace/displayModel';

/** Open sources for this retained selection; reopening preserves pane geometry and scroll. */
export function upsertCodePanel(state: DisplayState, selection: SelectionRegion, panel: PanelContent): DisplayState {
  const existing = Object.values(state.nodes).find((node): node is ProjectedPane => node.kind === 'projection'
    && node.content.kind === 'code-panel' && node.content.selectionId === selection.id);
  if (existing && existing.content.kind === 'code-panel') {
    return setExpansion(setExpansion({ ...state, nodes: { ...state.nodes,
      [selection.id]: { ...state.nodes[selection.id], activeChildId: existing.id } as SelectionRegion,
      [existing.id]: { ...existing, content: { ...existing.content, panel } },
    } }, selection.id, 'expanded'), existing.id, 'expanded');
  }
  const pane: ProjectedPane = { ...displayGeometry({ x: 0, y: 0 }, { width: 860, height: 640 }),
    geometryPolicy: { placement: 'automatic', sizing: 'fixed' }, id: crypto.randomUUID(), kind: 'projection',
    title: 'CodePanel', childIds: [], expansion: 'expanded',
    content: { kind: 'code-panel', selectionId: selection.id, panel } };
  const withOwner = state.nodes[selection.id] ? state : addDisplayNode(state, selection);
  return setExpansion(addDisplayNode(withOwner, pane, selection.id), selection.id, 'expanded');
}
