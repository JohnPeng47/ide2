import { describe, expect, it } from 'vitest';
import { addDisplayNode, displayGeometry, measureDisplayNode, updateDisplayGeometry, emptyDisplayState, removeDisplayNode, setExpansion, visibleProjectionIds, type ProjectedPane, type SelectionRegion } from '../displayModel';
import { layoutProjectedPanes } from '../projectedPaneLayout';
const selection = (id: string): SelectionRegion => ({ ...displayGeometry(), id, kind: 'selection', childIds: [], expansion: 'expanded', displayMode: 'stacked', sourceBoxId: 'overview', sourceContentId: 'overview', sourceAscii: 'A', rect: { startLine: 1, endLine: 2, startColumn: 1, endColumn: 4 }, selectedIds: ['a'] });
const pane = (id: string): ProjectedPane => ({ ...displayGeometry(), id, kind: 'projection', childIds: [], expansion: 'expanded', title: id, content: { kind: 'compaction', files: [] } });
function tree() { let state = addDisplayNode(emptyDisplayState(), selection('a')); state = addDisplayNode(state, pane('b'), 'a'); return addDisplayNode(state, pane('c'), 'b'); }
describe('display ownership and presentation', () => {
  it('navigates a stack without deleting ancestors; chains retain every hop', () => {
    const state = tree(); expect(visibleProjectionIds(state, 'a', 'stacked')).toEqual(['c']);
    expect(visibleProjectionIds(state, 'a', 'chained')).toEqual(['b', 'c']); expect(state.nodes.b).toBeDefined();
  });
  it('collapses recursively, preserving descendants for expansion and other roots', () => {
    const state = addDisplayNode(tree(), selection('other'));
    const collapsed = setExpansion(state, 'a', 'collapsed');
    expect(visibleProjectionIds(collapsed, 'a', 'chained')).toEqual([]);
    expect(collapsed.nodes.c).toEqual(state.nodes.c);
    expect(setExpansion(collapsed, 'a', 'expanded')).toEqual(state);
    expect(removeDisplayNode(state, 'a')).toEqual({ rootIds: ['other'], nodes: { other: selection('other') } });
  });
  it('removing the active child returns stacked navigation to the parent', () => {
    expect(visibleProjectionIds(removeDisplayNode(tree(), 'c'), 'a', 'stacked')).toEqual(['b']);
  });
  it('returns to a remaining sibling when the active stack branch is removed', () => {
    const state = addDisplayNode(tree(), pane('other-pane'), 'a');
    expect(visibleProjectionIds(state, 'a', 'stacked')).toEqual(['other-pane']);
    expect(visibleProjectionIds(removeDisplayNode(state, 'other-pane'), 'a', 'stacked')).toEqual(['c']);
  });
  it('uses outer edges and the same axis even when measured widths change', () => {
    const state = measureDisplayNode(tree(), 'b', 340, 200);
    const root = { ...state.nodes.a, position: { x: 10, y: 100 }, bounds: { width: 120, height: 80 }, displayMode: 'chained' } as SelectionRegion;
    const layout = layoutProjectedPanes(state, root);
    expect(layout.links[0].x1).toBe(130);
    expect(layout.links[1].x1).toBe(layout.placements.b.x + 340);
    expect(layout.links[1].y).toBe(layout.links[0].y);
    expect(layout.state.nodes.b.position).toEqual({ x: 202, y: 109 });
    expect(layoutProjectedPanes(layout.state, root).state).toBe(layout.state);
  });
});

describe('authoritative display geometry', () => {
  it('preserves manual positions and fixed allocations through layout and measurement', () => {
    let state = tree();
    state.nodes.b = { ...state.nodes.b, position: { x: 850, y: 310 }, bounds: { width: 420, height: 260 },
      geometryPolicy: { placement: 'manual', sizing: 'fixed' } };
    const root = { ...state.nodes.a, displayMode: 'chained' } as SelectionRegion;
    const laidOut = layoutProjectedPanes(state, root);
    expect(laidOut.state.nodes.b.position).toEqual({ x: 850, y: 310 });
    expect(laidOut.state.nodes.c.position.x).toBe(850 + 420 + 72);
    expect(laidOut.links[0].y2).toBe(325);
    expect(measureDisplayNode(laidOut.state, 'b', 900, 800)).toBe(laidOut.state);
  });
  it('restores a fixed expanded allocation after measuring its collapsed header', () => {
    const state = tree(); state.nodes.b.geometryPolicy.sizing = 'fixed';
    const collapsed = measureDisplayNode(setExpansion(state, 'b', 'collapsed'), 'b', 500, 31);
    expect(collapsed.nodes.b.bounds.height).toBe(31);
    expect(setExpansion(collapsed, 'b', 'expanded').nodes.b.bounds).toEqual(state.nodes.b.bounds);
  });
  it('moves automatic descendants after the measured parent width changes', () => {
    const state = tree(); const root = { ...state.nodes.a, displayMode: 'chained' } as SelectionRegion;
    const initial = layoutProjectedPanes(state, root);
    const resized = layoutProjectedPanes(measureDisplayNode(initial.state, 'b', 800, 250), root);
    expect(resized.state.nodes.c.position.x - initial.state.nodes.c.position.x).toBe(300);
    expect(updateDisplayGeometry(resized.state, 'missing', { position: { x: 0, y: 0 } })).toBe(resized.state);
    expect(measureDisplayNode(resized.state, 'b', 0, 0)).toBe(resized.state); // hidden document
  });
});
