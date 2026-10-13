import { expect, it } from 'vitest';
import { MappingDocumentController } from '../mappingDocumentController';
import { mappingDocumentFromScene } from '../mappingDocument';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../mappingWorkspace';
import { displayGeometry } from '../displayModel';
import { diagramSelectionItem, regionSelectionItem } from '../../selection/selectionState';
import { defaultArrowAppearance } from '../../../core/diagrams/diagramConnection';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';

const setup = () => new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Root\n`-- Child')), initialCanvasState());
it('deletes selected diagrams, incident edges, selection and owned panes in one undo step', () => {
  const controller = setup();
  controller.applyUpdate(0, [{ method: 'diagram-create', id: 'other', ascii: 'Other' }]);
  const diagram = controller.getSnapshot().document.scene.contents.overview;
  controller.applyUpdate(1, [{ method: 'edge-create', edge: { id: 'link', source: {
    kind: 'content-node', displayNodeId: 'grid:overview', revisionId: diagram.content.revisionId,
    contentNodeId: diagramContentNodes(diagram.content)[0].id, side: 'auto'
  }, target: { kind: 'box', displayNodeId: 'grid:other', side: 'auto' }, appearance: defaultArrowAppearance } }]);
  controller.updateCanvas(canvas => ({ ...canvas, display: { rootIds: ['selection'], nodes: {
    selection: { ...displayGeometry(), id: 'selection', kind: 'selection', sourceBoxId: 'overview', sourceContentId: diagram.id,
      sourceAscii: diagram.content.ascii, rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 }, selectedIds: [],
      childIds: ['pane'], expansion: 'expanded', displayMode: 'stacked' },
    pane: { ...displayGeometry(), id: 'pane', kind: 'detail', title: 'Captured context', ascii: 'Context', childIds: [], expansion: 'expanded' }
  } } }), true);
  const other = controller.getSnapshot().document.scene.contents.other;
  controller.select({ type: 'replace', items: [diagramSelectionItem('grid:overview'),
    regionSelectionItem(other, 'other', { startLine: 1, endLine: 1, startColumn: 1, endColumn: 5 })] });
  const before = controller.getSnapshot();
  controller.applyUpdate(before.version, [{ method: 'delete-diagrams', nodeIds: ['grid:overview'] }]);
  const after = controller.getSnapshot();
  expect(after.version).toBe(before.version + 1);
  expect(after.document.edges).toEqual([]);
  expect(after.document.scene.contents.overview).toBeUndefined();
  const remaining = after.canvas.selection.items[0];
  expect(after.canvas.display.rootIds).toEqual([remaining.id]);
  expect(after.canvas.display.nodes[remaining.id]).toMatchObject({ kind: 'selection', sourceBoxId: 'other' });
  expect(after.canvas.display.nodes.selection).toBeUndefined();
  expect(after.canvas.display.nodes.pane).toBeUndefined();
  expect(after.canvas.selection.items.map(item => item.displayNodeId)).toEqual(['grid:other']);
  controller.undo();
  expect(controller.getSnapshot().document).toEqual(before.document);
  expect(controller.getSnapshot().canvas).toEqual(before.canvas);
  controller.undo(true);
  expect(controller.getSnapshot().document).toEqual(after.document);
});

it('deletes all diagrams, supports an empty canvas, and restores the group together', () => {
  const controller = setup();
  controller.applyUpdate(0, [{ method: 'diagram-create', id: 'other', ascii: 'Other' }]);
  const before = controller.getSnapshot();
  controller.applyUpdate(before.version, [{ method: 'delete-diagrams', nodeIds: ['grid:overview', 'grid:other'] }]);
  expect(controller.nodes().filter(node => node.kind === 'diagram')).toEqual([]);
  expect(controller.getSnapshot().document.scene.contents).toEqual({});
  controller.undo();
  expect(controller.getSnapshot().document).toEqual(before.document);
  controller.undo(true);
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'diagram-create', id: 'new', ascii: 'New' }]);
  expect(controller.nodes().some(node => node.id === 'grid:new')).toBe(true);
});

it('rejects stale or invalid selections atomically and allows deleting a root diagram', () => {
  const controller = setup(), before = controller.getSnapshot();
  expect(() => controller.applyUpdate(100, [{ method: 'delete-diagrams', nodeIds: ['grid:overview'] }])).toThrow('VERSION_CONFLICT');
  for (const nodeIds of [[], ['grid:root'], ['grid:overview', 'grid:missing']]) {
    expect(() => controller.applyUpdate(0, [{ method: 'delete-diagrams', nodeIds }])).toThrow();
    expect(controller.getSnapshot()).toBe(before);
  }
  const scene = before.document.scene;
  if (scene.root.kind !== 'container') throw Error();
  const root = new MappingDocumentController(mappingDocumentFromScene({ ...scene, root: scene.root.children[0] }), initialCanvasState());
  root.applyUpdate(0, [{ method: 'delete-diagrams', nodeIds: ['grid:overview'] }]);
  expect(root.getSnapshot().document.scene.root).toMatchObject({ kind: 'container', children: [] });
  root.undo();
  expect(root.getSnapshot().document.scene.root.kind).toBe('diagram');
});
