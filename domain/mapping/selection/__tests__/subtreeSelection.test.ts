import { expect, it } from 'vitest';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { diagramSelectionItem, regionSelectionItem, selectionContentNodes, syncNativeDiagramSelection, type SelectionState } from '../selectionState';
import { toggleNodeSelection, toggleSubtreeSelection } from '../subtreeSelection';

const diagram = revisionFixture().create({ id: 'tree', revision: 0,
  ascii: 'Root\n+-- Branch\n|   +-- Leaf\n|   `-- Peer\n`-- Sibling', structureKind: 'tree' }).diagram;
const nodes = diagramContentNodes(diagram.content);
const node = (label: string) => nodes.find(node => node.label === label)!;
const toggle = (state: SelectionState, label: string) => toggleSubtreeSelection(state, diagram, 'tree', node(label).id);
const selected = (state: SelectionState) => nodes.filter(node => state.items.some(item => item.displayNodeId === 'grid:tree'
  && selectionContentNodes(diagram, item.region).some(selected => selected.id === node.id))).map(node => node.label);

it('toggles a single node without selecting or removing its descendants', () => {
  const single = toggleNodeSelection({ items: [] }, diagram, 'tree', node('Branch').id);
  expect(selected(single)).toEqual(['Branch']);
  expect(toggleNodeSelection(single, diagram, 'tree', node('Branch').id).items).toEqual([]);
  const all = toggle({ items: [] }, 'Root');
  const withoutBranch = toggleNodeSelection(all, diagram, 'tree', node('Branch').id);
  expect(selected(withoutBranch)).toEqual(['Root', 'Leaf', 'Peer', 'Sibling']);
  expect(withoutBranch.items[0].id).toBe(all.items[0].id);
});

it('selects and deselects the complete subtree using canonical child relationships', () => {
  const state = toggle({ items: [] }, 'Branch');
  expect(selected(state)).toEqual(['Branch', 'Leaf', 'Peer']);
  expect(toggle(state, 'Branch').items).toEqual([]);
});

it('cuts a nested subtree from a larger selection while preserving its parent and sibling', () => {
  const all = toggle({ items: [] }, 'Root');
  const cut = toggle(all, 'Branch');
  expect(selected(cut)).toEqual(['Root', 'Sibling']);
  expect(selected(toggle(cut, 'Branch'))).toEqual(['Root', 'Branch', 'Leaf', 'Peer', 'Sibling']);
  const withoutLeaf = toggle(all, 'Leaf');
  expect(selected(withoutLeaf)).toEqual(['Root', 'Branch', 'Peer', 'Sibling']);
  expect(selected(toggle(withoutLeaf, 'Branch'))).toEqual(['Root', 'Sibling']);
});

it('subtracts from whole diagrams and every overlapping region without touching other instances', () => {
  const other = diagramSelectionItem('grid:other');
  const overlapping = regionSelectionItem(diagram, 'tree', { startLine: 3, endLine: 4, startColumn: 1, endColumn: 30 });
  const state = { items: [diagramSelectionItem('grid:tree'), overlapping, other] };
  const cut = toggle(state, 'Branch');
  expect(selected(cut)).toEqual(['Root', 'Sibling']);
  expect(cut.items).toContain(other);
  expect(cut.items.some(item => item.displayNodeId === 'grid:tree' && !item.region)).toBe(false);
  expect(toggle(cut, 'Root').items).toEqual([other]);
});

it('does not reinterpret saved regions from older content or unknown node IDs', () => {
  const saved = { ...regionSelectionItem(diagram, 'tree', { startLine: 1, endLine: 5, startColumn: 1, endColumn: 30 }), id: 'saved' };
  const stale = { ...saved, region: { ...saved.region!, sourceAscii: 'older content' } };
  const state = { items: [stale] };
  expect(toggle(state, 'Branch').items).toContain(stale);
  expect(toggleSubtreeSelection(state, diagram, 'tree', 'missing')).toBe(state);
});

it('keeps one envelope, identity and chronological position when removing interior or bottom branches', () => {
  const initial = toggle({ items: [diagramSelectionItem('grid:other')] }, 'Root');
  const cut = toggle(initial, 'Branch');
  expect(cut.items.map(item => item.id)).toEqual(initial.items.map(item => item.id));
  expect(cut.items[1].region!.rect).toEqual(initial.items[1].region!.rect);
  expect(cut.items[1].region!.contentNodeIds).toEqual([node('Root').id, node('Sibling').id]);
  const bottom = toggle(initial, 'Sibling');
  expect(bottom.items[1].id).toBe(initial.items[1].id);
  expect(bottom.items[1].region!.rect).toEqual(initial.items[1].region!.rect);
  expect(selected(bottom)).toEqual(['Root', 'Branch', 'Leaf', 'Peer']);
});

it('preserves node membership and its order when native whole-shape selection changes', () => {
  const region = toggle({ items: [] }, 'Branch').items[0];
  const initial = { items: [region, diagramSelectionItem('grid:other')] };
  const added = syncNativeDiagramSelection(initial, ['grid:tree', 'grid:other']);
  expect(added.items.slice(0, 2)).toEqual(initial.items);
  expect(syncNativeDiagramSelection(added, ['grid:other', 'grid:tree'])).toBe(added);
  expect(syncNativeDiagramSelection(added, []).items).toEqual([region]);
});
