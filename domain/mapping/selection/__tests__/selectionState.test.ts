import { expect, it } from 'vitest';
import { diagramSelectionItem, regionSelectionItem, selectionCommand } from '../selectionState';
import { importLegacySelection } from '../importLegacySelection';
import { initialCanvasState } from '../../workspace/mappingWorkspace';
import { displayGeometry } from '../../workspace/displayModel';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { MappingDocumentController } from '../../workspace/mappingDocumentController';

const scene = singleDiagramScene('Root\nChild');
const rect = { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 };
const a = regionSelectionItem(scene.contents.overview, 'overview', rect, 'region-a');
const b = { ...a, id: 'region-b', displayNodeId: 'grid:other' };

it('uses one ordered collection for mixed selections and reuses repeated region identities', () => {
  const state = selectionCommand({ items: [] }, { type: 'add', items: [a, b, { ...a, id: 'another-id' }] });
  expect(state.items).toEqual([a, b]);
  expect(selectionCommand(state, { type: 'add', items: [{ ...b, id: 'new-id' }] }).items).toEqual([a, b]);
  expect(selectionCommand(state, { type: 'replace', items: [{ ...a, id: 'new-id' }] }).items).toEqual([a]);
});

it('plain double-click replaces everything while toggle preserves all regions, including those inside the diagram', () => {
  const state = { items: [a, b] };
  const diagram = diagramSelectionItem('grid:overview');
  expect(selectionCommand(state, { type: 'replace', items: [diagram] }).items).toEqual([diagram]);
  const toggled = selectionCommand(state, { type: 'toggleDiagram', displayNodeId: diagram.displayNodeId });
  expect(toggled.items).toEqual([a, b, diagram]);
  expect(selectionCommand(toggled, { type: 'toggleDiagram', displayNodeId: diagram.displayNodeId }).items).toEqual([a, b]);
  expect(selectionCommand(toggled, { type: 'add', items: [a] }).items).toEqual([a, b, diagram]);
});

it('imports old membership once and keeps inactive panel context separate', () => {
  const canvas: any = initialCanvasState(); delete canvas.selection;
  const root = { ...displayGeometry(), id: a.id, kind: 'selection', childIds: [], expansion: 'expanded', displayMode: 'stacked',
    sourceBoxId: 'overview', ...a.region };
  canvas.display = { rootIds: [a.id, b.id], nodes: { [a.id]: root, [b.id]: { ...root, id: b.id, selectionActive: false } } };
  canvas.controls = { ...canvas.controls, selectedDiagramIds: [], selectionRect: rect, selectedNodeIds: [], retainedSelectionId: a.id };
  const imported = importLegacySelection(canvas, scene);
  expect(imported.selection.items).toEqual([a]);
  expect(imported.controls.selectionFocusId).toBe(a.id);
  expect(imported.controls).not.toHaveProperty('selectedDiagramIds');
  expect(imported.controls).not.toHaveProperty('selectionRect');
  expect(imported.controls).not.toHaveProperty('retainedSelectionId');
  expect(imported.display.nodes[b.id]).not.toHaveProperty('selectionActive');
  expect(imported.display.nodes[b.id]).toBeDefined();
  const cleared = { ...imported, selection: { items: [] } };
  expect(importLegacySelection(cleared, scene).selection.items).toEqual([]);
  expect(canvas.display.nodes[b.id].selectionActive).toBe(false);
});

it('migrates an unretained rectangle with a deterministic ID and preserves mixed legacy selections', () => {
  const canvas: any = initialCanvasState(); delete canvas.selection;
  canvas.controls = { ...canvas.controls, selectionRect: rect, selectedNodeIds: [], retainedSelectionId: null };
  const first = importLegacySelection(canvas, scene), second = importLegacySelection(canvas, scene);
  expect(first.selection.items).toEqual(second.selection.items);
  expect(first.controls.selectionFocusId).toBe(first.selection.items[0].id);
  canvas.controls.selectedDiagramIds = ['grid:overview'];
  const promoted = importLegacySelection(canvas, scene);
  expect(promoted.selection.items).toEqual([...first.selection.items, diagramSelectionItem('grid:overview')]);
  expect(promoted.controls.selectionFocusId).toBe(first.controls.selectionFocusId);
});

it('undo restores canonical membership, while panel removal cannot recreate a focused region', () => {
  const canvas = initialCanvasState();
  const controller = new MappingDocumentController({ scene, edges: [], sections: {} }, canvas);
  controller.select({ type: 'add', items: [a] });
  controller.select({ type: 'replace', items: [diagramSelectionItem('grid:overview')] });
  controller.undo(); expect(controller.getSnapshot().canvas.selection.items).toEqual([a]);
  controller.undo(true); expect(controller.getSnapshot().canvas.selection.items).toEqual([diagramSelectionItem('grid:overview')]);
  controller.select({ type: 'clear' }); expect(controller.getSnapshot().canvas.selection.items).toEqual([]);
});
