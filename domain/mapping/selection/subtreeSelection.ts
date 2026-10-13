import type { Diagram } from '../../core/diagrams/diagram';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { regionSelectionItem, selectionCommand, selectionContentNodes, withSelectionNodes, type SelectionItem, type SelectionState } from './selectionState';

/** The clicked root decides the direction; descendants always follow it, including folded ones. */
export function toggleSubtreeSelection(state: SelectionState, diagram: Diagram, boxId: string, nodeId: string): SelectionState {
  const nodes = diagramContentNodes(diagram.content);
  const byId = new Map(nodes.map(node => [node.id, node])), root = byId.get(nodeId);
  if (!root) return state;
  const subtree = new Set<string>();
  const visit = (id: string) => {
    if (subtree.has(id)) return;
    const node = byId.get(id); if (!node) return;
    subtree.add(id); node.childIds.forEach(visit);
  };
  visit(root.id);
  const current = (item: SelectionItem) => item.displayNodeId === `grid:${boxId}`
    && (!item.region || item.region.sourceContentId === diagram.id && item.region.sourceAscii === diagram.content.ascii);
  const selected = state.items.some(item => current(item) && selectionContentNodes(diagram, item.region).some(node => node.id === root.id));
  if (!selected) {
    const members = [...subtree].map(id => byId.get(id)!);
    const item = regionSelectionItem(diagram, boxId, {
      startLine: Math.min(...members.map(node => node.line)), endLine: Math.max(...members.map(node => node.line)),
      startColumn: Math.min(...members.map(node => node.startColumn)), endColumn: Math.max(...members.map(node => node.endColumn))
    });
    return selectionCommand(state, { type: 'add', items: [withSelectionNodes(item, diagram, [...subtree])] });
  }
  return { items: state.items.flatMap(item => {
    if (!current(item)) return [item];
    const members = selectionContentNodes(diagram, item.region);
    const remaining = members.filter(node => !subtree.has(node.id));
    if (remaining.length === members.length) return [item];
    return remaining.length ? [withSelectionNodes(item, diagram, remaining.map(node => node.id))] : [];
  }) };
}
