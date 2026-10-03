import { expect, it, vi } from 'vitest';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { MappingDocumentController } from '../../../../../domain/mapping/workspace/mappingDocumentController';
import { diagramSelectionItem } from '../../../../../domain/mapping/selection/selectionState';

const setup = () => new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Root\n\n`-- Child\n')), initialCanvasState());
it('stores movement and its selection consequence as one checkpoint, and restores both without editing content', () => {
  const controller = setup(), before = controller.getSnapshot(), revision = before.document.scene.contents.overview.revisionId;
  controller.commitEditorGesture([{ method: 'move', nodeId: 'grid:overview', position: { column: 14, row: 8 } }],
    { ...before.canvas, selection: { items: [diagramSelectionItem('grid:overview')] } });
  const after = controller.getSnapshot();
  expect(controller.exportHistory().past).toEqual([before.canvasRevisionId]);
  expect(after.version).toBe(1);
  expect(after.document.scene.contents.overview.revisionId).toBe(revision);
  controller.restoreEditorCheckpoint(before.canvasRevisionId);
  expect(controller.getSnapshot().document).toEqual(before.document);
  expect(controller.getSnapshot().canvas.selection).toEqual(before.canvas.selection);
  controller.restoreEditorCheckpoint(after.canvasRevisionId);
  expect(controller.getSnapshot().document).toEqual(after.document);
  expect(controller.getSnapshot().canvas.selection).toEqual(after.canvas.selection);
  expect(controller.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Root\n\n`-- Child\n');
});
it('settles native input before checking the API version and delegates live undo exclusively to the editor', () => {
  const controller = setup();
  const undo = vi.fn();
  const off = controller.attachEditorDriver({ settle: () => controller.commitEditorGesture([], {
    ...controller.getSnapshot().canvas, selection: { items: [diagramSelectionItem('grid:overview')] }
  }), undo });
  expect(() => controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Unexpected' }])).toThrow('VERSION_CONFLICT');
  controller.undo(); controller.undo(true);
  expect(undo.mock.calls).toEqual([[false], [true]]);
  expect(controller.getSnapshot().document.scene.contents.overview.content.ascii).toContain('Child');
  off(); controller.undo(); expect(controller.getSnapshot().canvas.selection.items).toEqual([]);
});
it('rejects unknown checkpoint navigation without changing either document or version', () => {
  const controller = setup(), before = controller.getSnapshot();
  expect(() => controller.restoreEditorCheckpoint('missing')).toThrow('Unknown editor checkpoint');
  expect(controller.getSnapshot()).toBe(before);
});
it('duplicates a display instance while retaining its immutable content identity', () => {
  const controller = setup(), before = controller.getSnapshot();
  controller.commitEditorGesture([{ method: 'duplicate-instance', sourceNodeId: 'grid:overview', id: 'copy', position: { column: 30, row: 12 } }], before.canvas);
  const nodes = controller.nodes().filter(node => node.layout === 'grid' && node.kind === 'diagram');
  expect(nodes.map(node => node.id)).toEqual(['grid:overview', 'grid:copy']);
  const after = controller.getSnapshot();
  expect(Object.keys(after.document.scene.contents)).toEqual(Object.keys(before.document.scene.contents));
  controller.applyUpdate(after.version, [{ method: 'replace', nodeId: 'grid:copy', ascii: 'Shared revision\n\n`-- New child\n' }]);
  const texts = controller.nodes().filter(node => node.layout === 'grid' && node.kind === 'diagram').map(node => node.layout === 'grid' && node.content?.ascii);
  expect(texts).toEqual(['Shared revision\n\n`-- New child\n', 'Shared revision\n\n`-- New child\n']);
  controller.undo(); controller.undo();
  expect(controller.getSnapshot().document).toEqual(before.document);
});

import { restoreMappingCamera, saveMappingCamera } from '../cameraCompatibility';
it('preserves the screen position of content in a saved pre-tldraw viewport', () => {
  const legacy = { offset: { x: -320, y: 47 }, scale: 1.75 };
  const camera = restoreMappingCamera(legacy), pagePoint = { x: 127, y: 83 };
  expect({ x: (pagePoint.x + camera.x) * camera.z, y: (pagePoint.y + camera.y) * camera.z }).toEqual({
    x: legacy.offset.x + (pagePoint.x + 190) * legacy.scale,
    y: legacy.offset.y + (pagePoint.y + 64) * legacy.scale,
  });
  expect(saveMappingCamera(camera).offset.x).toBeCloseTo(legacy.offset.x, 10);
  expect(saveMappingCamera(camera).offset.y).toBeCloseTo(legacy.offset.y, 10);
  expect(saveMappingCamera(camera).scale).toBe(legacy.scale);
});
it('persists native movement for a legacy canvas whose root is itself a diagram', () => {
  const source = setup().getSnapshot().document;
  if (source.scene.root.kind !== 'container') throw Error('Expected fixture container');
  const document = { ...source, scene: { ...source.scene, root: source.scene.root.children[0] } };
  const controller = new MappingDocumentController(document, initialCanvasState());
  controller.commitEditorGesture([{ method: 'move', nodeId: 'grid:overview', position: { column: 9, row: 14 } }], controller.getSnapshot().canvas);
  expect(controller.getSnapshot().document.scene.root.position).toEqual({ column: 9, row: 14 });
  controller.undo(); expect(controller.getSnapshot().document).toEqual(document);
});
