import { expect, it, vi } from 'vitest';
import { HandTool, type Editor } from 'tldraw';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../../domain/mapping/workspace/mappingDocument';
import { MappingDocumentController } from '../../../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { completeMarquee } from '../../../../../domain/mapping/selection/completeMarquee';
import { flattenGrid, resolveScene } from '../../../../../domain/core/diagrams/lineGrid';
import { NativeSelectionOwnership } from '../../../../../domain/mapping/selection/selectionGesture';
import { MappingEditorRuntime } from '../MappingEditorRuntime';
import { projectMappingShapes } from '../shapeProjection';
import { MappingHandTool, SelectionToolBridge, selectionTools } from '../SelectionTools';

/** Test the real settlement against native shape/selection snapshots; the SDK
 * camera/event loop is exercised separately by the browser integration suite. */
function setup() {
  const scene = singleDiagramScene('Root\nChild');
  const canvas = completeMarquee(initialCanvasState(), { diagramIds: [], regions: [{ boxId: 'overview',
    rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 } }] }, scene, flattenGrid(resolveScene(scene)), 'replace');
  const controller = new MappingDocumentController(mappingDocumentFromScene(scene), canvas);
  const projected = projectMappingShapes(controller.getSnapshot());
  const shapes = structuredClone(projected);
  let selected = shapes.filter(shape => shape.props?.kind === 'diagram');
  const editor = {
    inputs: { getIsPointing: () => false }, getSelectedShapes: () => selected,
    getCurrentPageShapes: () => shapes, getShape: (id: string) => shapes.find(shape => shape.id === id),
    getSelectedShapeIds: () => selected.map(shape => shape.id),
    getShapePageBounds: (shape: { x: number; y: number }) => ({ x: shape.x, y: shape.y }),
    run: (fn: () => void) => fn(),
    setSelectedShapes: (ids: string[]) => { selected = shapes.filter(shape => ids.includes(shape.id)); },
  };
  const ownership = new NativeSelectionOwnership();
  const runtime: MappingEditorRuntime = Object.assign(Object.create(MappingEditorRuntime.prototype), {
    editor, controller, selectionOwnership: ownership, projected: new Map(projected.map(shape => [shape.props!.nodeId, shape])),
  });
  return { controller, runtime, ownership, shapes, editor };
}
it('native final and delayed camera settlements cannot erase region membership or create checkpoints', () => {
  const { controller, runtime, editor } = setup();
  const before = controller.getSnapshot();
  runtime.settle(); runtime.settle(true);
  expect(controller.getSnapshot()).toBe(before);
  expect(editor.getSelectedShapes()).toEqual([]);
  expect(controller.exportHistory().past).toEqual([]);
});
it('an intended native selection still imports desktop shape membership', () => {
  const { controller, runtime, ownership } = setup();
  ownership.claim('native'); runtime.settle();
  expect(controller.getSnapshot().canvas.selection.items).toEqual([{ id: 'grid:overview', displayNodeId: 'grid:overview' }]);
  expect(controller.exportHistory().past).toHaveLength(1);
});
it('native move geometry commits once with application membership retained and undoable', () => {
  const { controller, runtime, shapes } = setup();
  const before = controller.getSnapshot();
  const diagram = shapes.find(shape => shape.props?.kind === 'diagram')!;
  diagram.x = (diagram.x ?? 0) + 180;
  runtime.settle();
  const after = controller.getSnapshot();
  expect(after.document).not.toEqual(before.document);
  expect(after.canvas.selection).toEqual(before.canvas.selection);
  expect(controller.exportHistory().past).toEqual([before.canvasRevisionId]);
  controller.undo();
  expect(controller.getSnapshot().document).toEqual(before.document);
  expect(controller.getSnapshot().canvas.selection).toEqual(before.canvas.selection);
});
it('suppresses every native touch doubleclick phase including delayed one-finger zoom, while preserving mouse zoom', () => {
  const editor = {} as Editor, bridge = new SelectionToolBridge();
  selectionTools.set(editor, bridge);
  const native = vi.spyOn(HandTool.prototype, 'handleEvent').mockImplementation(() => {});
  try {
    bridge.pointerType = 'touch';
    for (const phase of ['down', 'up', 'settle-down', 'settle-up'] as const)
      MappingHandTool.prototype.handleEvent.call({ editor } as MappingHandTool, { type: 'click', name: 'double_click', phase } as Parameters<HandTool['handleEvent']>[0]);
    expect(native).not.toHaveBeenCalled();
    bridge.pointerType = 'mouse';
    MappingHandTool.prototype.handleEvent.call({ editor } as MappingHandTool, { type: 'click', name: 'double_click', phase: 'settle-up' } as Parameters<HandTool['handleEvent']>[0]);
    expect(native).toHaveBeenCalledOnce();
  } finally { native.mockRestore(); selectionTools.delete(editor); }
});
