import { diagramSelectionItem, selectedDiagramIds } from '../selectionState';
import { updateSelection } from '../canvasSelection';
import { expect, it } from 'vitest';
import { deselectCanvas, enclosesDiagram, selectCanvasMarquee, selectWholeDiagrams } from '../canvasSelection';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { RevisionedDiagramService } from '../../../core/diagrams/diagramService';
import { initialCanvasState } from '../../workspace/mappingWorkspace';
import { displayGeometry, type SelectionRegion } from '../../workspace/displayModel';

it('requires full enclosure; touching two corners does not promote a partial region', () => {
  const box = { left: 10, top: 10, right: 30, bottom: 30 };
  expect(enclosesDiagram(box, box)).toBe(true);
  expect(enclosesDiagram(box, { left: 0, top: 0, right: 40, bottom: 40 })).toBe(true);
  expect(enclosesDiagram(box, { left: 0, top: 0, right: 30, bottom: 20 })).toBe(false);
});

it('selects partial regions across diagrams, promotes whole diagrams, and preserves promotion while shrinking', () => {
  const scene = singleDiagramScene('Root\nEnd');
  if (scene.root.kind !== 'container') throw Error('Expected container');
  scene.root.children = [
    { id: 'a', kind: 'diagram', contentId: 'overview', position: { column: 0, row: 0 }, collapsed: false },
    { id: 'b', kind: 'diagram', contentId: 'b', position: { column: 10, row: 0 }, collapsed: false }
  ];
  scene.contents = { ...scene.contents, b: new RevisionedDiagramService().create({ id: 'b', revision: 0, ascii: 'Other\nEnd' }).diagram };
  const partial = selectCanvasMarquee(scene, undefined, { left: -.2, top: -.2, right: 12.2, bottom: .2 });
  expect(partial.diagramIds).toEqual([]);
  expect(partial.regions).toEqual([
    { boxId: 'a', rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 } },
    { boxId: 'b', rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 3 } }
  ]);
  const mixed = selectCanvasMarquee(scene, undefined, { left: -.2, top: -.2, right: 12.2, bottom: 2.2 });
  expect(mixed.diagramIds).toEqual(['grid:a']);
  expect(mixed.regions.map(region => region.boxId)).toEqual(['b']);
  const shrunk = selectCanvasMarquee(scene, undefined, { left: -.2, top: -.2, right: 2, bottom: .2 }, mixed.diagramIds);
  expect(shrunk).toEqual({ diagramIds: ['grid:a'], regions: [] });
});

it('rejects a region crossing folded lines, but still allows selecting the whole folded diagram', () => {
  const ascii = 'Root\n|-- Parent\n|   `-- Child\n`-- End';
  const scene = singleDiagramScene(ascii);
  scene.contents = { ...scene.contents, overview: new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram };
  const content = scene.contents.overview.content;
  if (content.structure.kind !== 'tree') throw Error('Expected tree');
  const parent = Object.values(content.structure.nodes).find(node => node.line === 2)!;
  const views = { 'grid:overview': { contentRevisionId: content.revisionId, collapsedContentNodeIds: [parent.id] } };
  expect(selectCanvasMarquee(scene, views, { left: .2, top: 1.2, right: 8.2, bottom: 2.2 }).regions).toEqual([]);
  expect(selectCanvasMarquee(scene, views, { left: -1, top: -1, right: 100, bottom: 100 }).diagramIds).toEqual(['grid:overview']);
});

it('promotion clears its regions and focus without deleting panel context or regions on other diagrams', () => {
  const state = initialCanvasState();
  const a: SelectionRegion = { ...displayGeometry(), id: 'a', kind: 'selection', childIds: [], expansion: 'expanded',
    sourceBoxId: 'overview', sourceContentId: 'overview', sourceAscii: 'Root', displayMode: 'stacked', selectedIds: [],
    rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 } };
  const b = { ...a, id: 'b', sourceBoxId: 'other' };
  state.display = { rootIds: ['a', 'b'], nodes: { a, b } };
  state.controls.selectionFocusId = 'a';
  state.selection = { items: [a, b].map(node => ({ id: node.id, displayNodeId: `grid:${node.sourceBoxId}`, region: { sourceContentId: node.sourceContentId, sourceAscii: node.sourceAscii, rect: node.rect, selectedIds: node.selectedIds } })) };
  const promoted = updateSelection(state, { type: 'add', items: [diagramSelectionItem('grid:overview')] });
  expect(promoted.display.nodes.a).toBe(a);
  expect(promoted.selection.items.map(item => item.id)).toEqual(['b', 'grid:overview']);
  expect(promoted.display.nodes.b).toBe(b);
  expect(promoted.controls.selectionFocusId).toBeNull();
  expect(selectedDiagramIds(promoted.selection)).toEqual(['grid:overview']);
  const cleared = deselectCanvas(promoted);
  expect(cleared.selection.items).toEqual([]);
  expect(cleared.display.nodes.b).toBe(b);
  expect(selectWholeDiagrams(state, ['grid:overview']).selection.items).toEqual([diagramSelectionItem('grid:overview')]);
});
