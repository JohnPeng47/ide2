import { describe, expect, it } from 'vitest';
import { MappingDocumentController } from '../mappingDocumentController';
import { mappingDocumentFromScene } from '../mappingDocument';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../mappingWorkspace';
import { displayGeometry } from '../displayModel';
import { serializeWorkspace, deserializeWorkspace } from '../mappingWorkspaceCodec';
const setup = () => {
  const canvas = initialCanvasState();
  canvas.display = { rootIds: ['pane'], nodes: { pane: { ...displayGeometry({ x: 20, y: 10 }, { width: 5000, height: 6000 }), id: 'pane', kind: 'detail', title: 'Detail', ascii: 'Detail', childIds: [], expansion: 'expanded' } } };
  return new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('[Original]'), {}), canvas);
};
describe('shared DisplayNode controller', () => {
  it('lays out new diagrams by content size, ignoring FloatingBox occupancy; undo restores the complete state', () => {
    const controller = setup(), before = controller.getSnapshot();
    const result = controller.transact(0, [{ method: 'draw', id: 'new', ascii: '[Inserted diagram]', position: { column: 0, row: 0 } }]);
    expect(result.nodes.find(node => node.id === 'grid:overview')).toMatchObject({ geometry: { bounds: { column: 21 } } });
    expect(result.nodes.find(node => node.id === 'grid:new')).toMatchObject({ geometry: { bounds: { column: 0, columns: 18 } } });
    expect(controller.getSnapshot().canvas).toEqual(before.canvas);
    controller.undo(); expect(controller.getSnapshot().document).toEqual(before.document);
    controller.undo(true); expect(controller.nodes().some(node => node.id === 'grid:new')).toBe(true);
  });
  it('moves FloatingBoxes without changing GridBox geometry', () => {
    const controller = setup(), scene = controller.getSnapshot().document.scene;
    controller.transact(0, [{ method: 'move', nodeId: 'floating:pane', position: { x: 0, y: 0 } }]);
    expect(controller.getSnapshot().document.scene).toEqual(scene);
    expect(controller.nodes().find(node => node.id === 'floating:pane')).toMatchObject({ geometry: { units: 'pixels', position: { x: 0, y: 0 } } });
  });
  it('rejects wrong units and stale writes atomically', () => {
    const controller = setup(), before = controller.getSnapshot();
    expect(() => controller.transact(0, [{ method: 'draw', id: 'ok', ascii: 'A' }, { method: 'move', nodeId: 'floating:pane', position: { column: 4, row: 0 } }])).toThrow('pixel');
    expect(controller.getSnapshot()).toBe(before);
    expect(() => controller.transact(99, [{ method: 'remove', nodeId: 'floating:pane' }])).toThrow('VERSION_CONFLICT');
    expect(() => controller.transact(0, [{ method: 'remove', nodeId: 'grid:overview' }])).toThrow('visible diagram');
  });
  it('preserves FloatingBox placement on workspace round-trip', () => {
    const controller = setup(), state = controller.getSnapshot();
    const workspace = { schemaVersion: 3 as const, projectId: 'project', documents: [{ representationId: 'diagram', revisionId: 'revision', name: 'Test', savedName: 'Test', savedScene: JSON.stringify(state.document.scene), document: state.document, canvas: state.canvas }] };
    expect(deserializeWorkspace(serializeWorkspace(workspace)).documents[0].canvas.display).toEqual(state.canvas.display);
  });
});

it('keeps semantic attachments and existing visual placement distinct', async () => {
  const { layoutFloatingSelections } = await import('../floatingBoxLayout');
  const { flattenGrid, resolveScene } = await import('../../../core/diagrams/lineGrid');
  const controller = setup();
  const canvas = structuredClone(controller.getSnapshot().canvas);
  canvas.display.nodes.selection = { ...displayGeometry(), id:'selection', kind:'selection', childIds:[], expansion:'expanded', sourceBoxId:'overview', sourceContentId:'overview', sourceAscii:'[Original]', rect:{startLine:1,endLine:1,startColumn:1,endColumn:4}, selectedIds:[], displayMode:'stacked' };
  canvas.display.rootIds.push('selection');
  controller.updateCanvas(canvas);
  controller.transact(0,[{method:'move',nodeId:'grid:overview',position:{column:10,row:5}}]);
  const {document,canvas:next} = controller.getSnapshot();
  const placed = layoutFloatingSelections(next.display,flattenGrid(resolveScene(document.scene)),document.scene,{width:8,height:18});
  expect(placed.nodes.selection.position).toEqual({x:80,y:90});
  expect(placed.nodes.pane).toEqual(canvas.display.nodes.pane);
  expect(placed.nodes.selection.bounds).toEqual({width:32,height:18});
});
