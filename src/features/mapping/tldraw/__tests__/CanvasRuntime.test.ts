import { toggleNodeSelection, toggleSubtreeSelection } from '../../../../../domain/mapping/selection/subtreeSelection';
import { describe, expect, it, vi } from 'vitest';
import { atom, computed, Mat, type Editor } from 'tldraw';
import { CanvasRuntime } from '../CanvasRuntimeContext';
import { nativeEndpointRect } from '../nativeEdgeGeometry';
import { revisionFixture } from '../../../../../tests/support/diagramRevisions';
import { CanvasSession } from '../../workspace/canvasSession';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';
import { mappingShapeId, projectMappingShapes } from '../shapeProjection';

function setup() {
  const scene = singleDiagramScene('Root\n|-- Branch\n|   `-- Leaf\n`-- Tail');
  scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision: 0, ascii: scene.contents.overview.content.ascii, structureKind: 'tree' }).diagram };
  const document = mappingDocumentFromScene(scene);
  const session = new CanvasSession({ name: 'Test', savedName: 'Test', savedScene: JSON.stringify(document.scene), document, canvas: initialCanvasState() });
  const controller = session.controller;
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'diagram-create', id: 'second', ascii: 'Second\n`-- Child', position: { column: 60, row: 10 } }]);
  const content = controller.getSnapshot().document.scene.contents.overview.content;
  const source = { kind: 'content-node' as const, displayNodeId: 'grid:overview', contentNodeId: diagramContentNodes(content).find(n => n.label === 'Leaf')!.id, revisionId: content.revisionId, side: 'auto' as const };
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'edge-create', edge: { id: 'edge', source,
    target: { kind: 'box', displayNodeId: 'grid:second', side: 'auto' }, appearance: { color: '#88c0d0', lineStyle: 'solid', label: '' } } }]);
  const runtime = new CanvasRuntime(session), disconnect = runtime.connect();
  return { session, controller, runtime, source, dispose: () => { disconnect(); session.dispose(); } };
}
describe('native canvas read models and local anchors', () => {
  it('keeps the rendered frame, native selection shape and box endpoints aligned after folding', () => {
    const { controller, runtime, dispose } = setup();
    controller.configureLayout({ width: 8, height: 18 }, { width: 1200, height: 900 });
    const shape = () => projectMappingShapes(controller.getSnapshot()).find(shape => shape.id === mappingShapeId('grid:overview'))!;
    const expanded = shape();
    const branch = diagramContentNodes(controller.getSnapshot().document.scene.contents.overview.content).find(node => node.label === 'Branch')!;
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'collapse', nodeId: 'grid:overview', contentNodeId: branch.id, collapsed: true }]);
    const model = runtime.grids.get('grid:overview').get()!;
    expect(model.frame.bounds).toMatchObject({ columns: 10, rows: 3 });
    expect(shape().props).toMatchObject({ w: 80, h: 54 });
    expect(runtime.resolveAnchor({ kind: 'box', displayNodeId: 'grid:overview', side: 'bottom' })!.rect).toMatchObject({ width: 80, height: 54 });
    controller.undo(); expect(shape()).toEqual(expanded);
    controller.undo(true); expect(shape().props).toMatchObject({ w: 80, h: 54 });
    dispose();
  });
  it('keeps edge focus out of history and clears it when the edge is removed', () => {
    const { runtime, controller, dispose } = setup();
    const before = controller.getSnapshot();
    runtime.focusedEdge.set({ id: 'edge', point: { x: 20, y: 30 } });
    expect(controller.getSnapshot()).toBe(before);
    controller.applyUpdate(before.version, [{ method: 'edge-remove', edgeId: 'edge' }]);
    expect(runtime.focusedEdge.get()).toBeUndefined();
    dispose();
  });
  it('focuses incoming and outgoing connections of the clicked instance and clears focus on deselection', () => {
    const { runtime, controller, source, dispose } = setup();
    const edge = controller.getSnapshot().document.edges[0];
    const second = runtime.edges.get(edge.id).get()!.target!.identity;
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'edge-create', edge: {
      ...edge, id: 'incoming', source: { ...source, displayNodeId: second.displayNodeId,
        contentNodeId: second.contentNodeId!, revisionId: second.revisionId! }, target: source,
    } }]);
    const diagram = controller.getSnapshot().document.scene.contents.overview;
    const toggle = () => controller.select({ type: 'replace', items: toggleNodeSelection(
      controller.getSnapshot().canvas.selection, diagram, 'overview', source.contentNodeId).items });
    const before = controller.getSnapshot();
    runtime.focusNode(source.displayNodeId, source.contentNodeId, source.revisionId);
    expect(runtime.nodeConnections.get()).toEqual([
      { id: 'edge', incoming: false, outgoing: true }, { id: 'incoming', incoming: true, outgoing: false },
    ]);
    expect(controller.getSnapshot()).toBe(before);
    expect(before.canvas.selection.items).toEqual([]);
    runtime.focusNode('grid:second', source.contentNodeId, source.revisionId);
    expect(runtime.nodeConnections.get()).toEqual([]);
    toggle();
    runtime.focusNode(source.displayNodeId, source.contentNodeId, source.revisionId);
    toggle();
    expect(runtime.focusedNode.get()).toBeUndefined();
    expect(runtime.nodeConnections.get()).toEqual([]);
    dispose();
  });
  it('isolates anchor updates from the document, shape content, other anchors, and history', () => {
    const { controller, runtime, dispose } = setup();
    const model = runtime.grids.get('grid:overview').get(), edge = runtime.edges.get('edge').get()!;
    const before = controller.getSnapshot(), publish = vi.fn(); controller.subscribe(publish);
    const sourceRead = vi.fn(() => runtime.anchors.get(edge.source!.identity, edge.source!.layoutKey));
    const targetRead = vi.fn(() => runtime.anchors.get(edge.target!.identity, edge.target!.layoutKey));
    const source = computed('source', sourceRead), target = computed('target', targetRead);
    source.get(); target.get();
    for (let x = 0; x < 100; x++) runtime.anchors.set(edge.source!.identity, edge.source!.layoutKey, { x, y: 20, width: 30, height: 18 });
    expect(source.get()!.x).toBe(99); target.get();
    expect(targetRead).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toBe(before); expect(publish).not.toHaveBeenCalled();
    expect(runtime.grids.get('grid:overview').get()).toBe(model);
    dispose();
  });
  it('preserves unrelated read-model identities across cloned command snapshots', () => {
    const { controller, runtime, dispose } = setup();
    const first = runtime.grids.get('grid:overview').get(), second = runtime.grids.get('grid:second').get();
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'replace', nodeId: 'grid:second', ascii: 'Changed\n`-- Child' }]);
    expect(runtime.grids.get('grid:overview').get()).toBe(first);
    expect(runtime.grids.get('grid:second').get()).not.toBe(second);
    const grid = runtime.grids.get('grid:second').get(), edge = runtime.edges.get('edge').get();
    controller.configureEndpointBounds({ legacy: { x: 0, y: 0, width: 20, height: 20 } });
    expect(runtime.grids.get('grid:second').get()).toBe(grid); expect(runtime.edges.get('edge').get()).toBe(edge);
    dispose();
  });
  it('invalidates folded/revised anchors while retaining measurements across movement', () => {
    const { controller, runtime, dispose } = setup();
    const source = runtime.edges.get('edge').get()!.source!;
    runtime.anchors.set(source.identity, source.layoutKey, { x: 42, y: 36, width: 33, height: 18 });
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'move', nodeId: 'grid:overview', position: { column: 4, row: 5 } }]);
    expect(runtime.anchors.get(source.identity, source.layoutKey)?.x).toBe(42);
    const content = controller.getSnapshot().document.scene.contents.overview.content;
    const branch = diagramContentNodes(content).find(node => node.label === 'Branch')!;
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'collapse', nodeId: 'grid:overview', contentNodeId: branch.id, collapsed: true }]);
    const folded = runtime.edges.get('edge').get()!.source!;
    expect(folded.rect.proxy).toBe(true); expect(folded.identity.contentNodeId).toBe(branch.id);
    expect(runtime.anchors.get(source.identity, source.layoutKey)).toBeUndefined();
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Replacement' }]);
    expect(runtime.resolveAnchor({ ...source.identity, kind: 'content-node', contentNodeId: source.identity.contentNodeId!, revisionId: source.identity.revisionId!, side: 'auto' })).toBeUndefined();
    dispose();
  });
  it('hides retained regions when an ancestor is collapsed without treating them as deleted sources', () => {
    const { controller, runtime, dispose } = setup();
    const content = controller.getSnapshot().document.scene.contents.overview.content;
    controller.updateCanvas(current => ({ ...current, display: { rootIds: ['region'], nodes: { region: {
      id: 'region', kind: 'selection', childIds: [], expansion: 'expanded', displayMode: 'stacked', sourceBoxId: 'overview',
      sourceContentId: 'overview', sourceAscii: content.ascii, selectedIds: [],
      rect: { startLine: 1, endLine: 2, startColumn: 1, endColumn: 10 }, coordinateSpace: 'canvas',
      position: { x: 0, y: 0 }, bounds: { width: 100, height: 36 }, geometryPolicy: { placement: 'automatic', sizing: 'content' }
    } } } }), true);
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'group', nodeId: 'grid:overview', id: 'parent' }]);
    expect(runtime.floats.get('region').get()?.visible).toBe(true);
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'collapse', nodeId: 'grid:parent', collapsed: true }]);
    expect(runtime.floats.get('region').get()?.visible).toBe(false);
    controller.applyUpdate(controller.getSnapshot().version, [{ method: 'collapse', nodeId: 'grid:parent', collapsed: false }]);
    expect(runtime.floats.get('region').get()?.visible).toBe(true);
    dispose();
  });
  it('uses fallback geometry before measurement and live page transforms without a camera dependency', () => {
    const { runtime, dispose } = setup();
    const source = runtime.edges.get('edge').get()!.source!;
    const transform = atom('native parent + child transform', Mat.Translate(200, 100));
    runtime.editor = { getShape: () => ({ id: 'test' }), getShapePageTransform: () => transform.get() } as unknown as Editor;
    const geometry = computed('page endpoint', () => nativeEndpointRect(runtime, source)!);
    const fallback = geometry.get(); expect(fallback.x).toBe(source.rect.x + 200);
    runtime.anchors.set(source.identity, source.layoutKey, { x: 40, y: 30, width: 35, height: 18 });
    expect(geometry.get()).toMatchObject({ x: 240, y: 130, width: 35 });
    // Culled/unmounted DOM does not publish a deletion; only the native transform changes.
    transform.set(Mat.Translate(700, 400));
    expect(geometry.get()).toMatchObject({ x: 740, y: 430, width: 35 });
    runtime.anchors.invalidate();
    expect(geometry.get().x).toBe(source.rect.x + 700);
    dispose();
  });
});

it('synchronizes explicit membership, envelopes and history from controller state without pointer callbacks', () => {
  const { controller, runtime, dispose } = setup();
  const diagram = controller.getSnapshot().document.scene.contents.overview;
  const nodes = diagramContentNodes(diagram.content);
  const root = nodes.find(node => node.label === 'Root')!, branch = nodes.find(node => node.label === 'Branch')!;
  controller.configureLayout({ width: 8, height: 18 }, { width: 1200, height: 900 });
  controller.select({ type: 'replace', items: toggleSubtreeSelection({ items: [] }, diagram, 'overview', root.id).items });
  const item = controller.getSnapshot().canvas.selection.items[0];
  const first = runtime.floats.get(item.id).get()!;
  expect(first.selected).toBe(true);
  expect(first.node.bounds).toEqual({ width: item.region!.rect.endColumn * 8, height: 72 });
  const cut = toggleSubtreeSelection(controller.getSnapshot().canvas.selection, diagram, 'overview', branch.id);
  controller.select({ type: 'replace', items: cut.items });
  expect(runtime.grids.get('grid:overview').get()!.selectedContent).toEqual(cut.items[0].region!.contentNodeIds);
  expect(runtime.floats.get(item.id).get()!.node.bounds).toEqual(first.node.bounds);
  expect(runtime.floats.get(item.id).get()!.selected).toBe(true);
  controller.undo();
  expect(runtime.grids.get('grid:overview').get()!.selectedContent).toEqual(item.region!.contentNodeIds);
  controller.undo(true);
  expect(runtime.grids.get('grid:overview').get()!.selectedContent).toEqual(cut.items[0].region!.contentNodeIds);
  controller.select({ type: 'clear' });
  expect(runtime.floats.get(item.id).get()!.selected).toBe(false);
  expect(runtime.grids.get('grid:overview').get()!.selectedContent).toEqual([]);
  dispose();
});


it('shares one lane computation across edges and ignores camera changes', () => {
  const { runtime, controller, dispose } = setup();
  const edge = controller.getSnapshot().document.edges[0];
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'edge-create', edge: { ...edge, id: 'duplicate' } }]);
  const camera = atom('test camera', { x: 0, y: 0 }), position = atom('target position', Mat.Translate(480, 180));
  runtime.editor = { getShape: (id: string) => ({ id }), getShapePageTransform: (shape: string | { id: string }) =>
    (typeof shape === 'string' ? shape : shape.id) === mappingShapeId('grid:second') ? position.get() : Mat.Identity(),
    getCamera: () => camera.get() } as unknown as Editor;
  const draw = vi.spyOn(runtime.routing, 'drawAll');
  const before = runtime.routedEdges.get();
  expect(before.size).toBe(2);
  expect(before.get(edge.id)!.path).not.toBe(before.get('duplicate')!.path);
  camera.set({ x: 50, y: 80 });
  expect(runtime.routedEdges.get()).toBe(before); expect(draw).toHaveBeenCalledTimes(1);
  position.set(Mat.Translate(600, 180));
  expect(runtime.routedEdges.get()).not.toBe(before); expect(draw).toHaveBeenCalledTimes(2);
  dispose();
});
