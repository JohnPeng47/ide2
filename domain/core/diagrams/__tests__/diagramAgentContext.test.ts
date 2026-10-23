import { expect, it } from 'vitest';
import { compileDiagramAgentContext, diagramContextSourceFingerprint, loadDiagramAgentContext } from '../diagramAgentContext';
import { singleDiagramScene } from '../projectDiagramCanvas';
import { CanvasHistory, validateCanvasHistory } from '../canvasHistory';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';

it('stores a compiled context on the stable diagram identity through revisions and undo', () => {
  const controller = new MappingDocumentController({ scene: singleDiagramScene('Before'), edges: [], sections: {} }, initialCanvasState());
  const base = controller.getSnapshot().document.scene.contents.overview;
  const context = compileDiagramAgentContext(base);
  expect(context.sourceFingerprint).toBe(diagramContextSourceFingerprint(base));
  controller.applyUpdate(0, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: base.revisionId, context }]);
  expect(controller.getSnapshot().document.diagramContexts?.[base.diagramId]).toEqual(context);
  controller.applyUpdate(1, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'After' }]);
  const current = controller.getSnapshot();
  expect(current.document.diagramContexts?.[base.diagramId]).toEqual(context);
  const history = JSON.parse(JSON.stringify(controller.exportHistory()));
  validateCanvasHistory(history);
  expect(new CanvasHistory(current.document, current.canvas, history).document().diagramContexts?.[base.diagramId]).toEqual(context);
  controller.applyUpdate(2, [{ method: 'diagram-context-delete', nodeId: 'grid:overview', expectedRevisionId: current.document.scene.contents.overview.revisionId }]);
  expect(controller.getSnapshot().document.diagramContexts?.[base.diagramId]).toBeUndefined();
  controller.undo();
  expect(controller.getSnapshot().document.diagramContexts?.[base.diagramId]).toEqual(context);
});

it('rejects stale and mismatched diagram context updates', () => {
  const controller = new MappingDocumentController({ scene: singleDiagramScene('Before'), edges: [], sections: {} }, initialCanvasState());
  const base = controller.getSnapshot().document.scene.contents.overview;
  const context = compileDiagramAgentContext(base);
  expect(() => controller.applyUpdate(0, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: 'diagram-revision-old', context }])).toThrow('VERSION_CONFLICT');
  expect(() => controller.applyUpdate(0, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: base.revisionId,
    context: { ...context, diagramId: 'diagram-other' } }])).toThrow('Diagram agent context belongs to another diagram');
});

it('reads an inline context saved before backing record metadata was added', async () => {
  const diagram = singleDiagramScene('Before').contents.overview;
  const { contentHash: _, ...legacy } = compileDiagramAgentContext(diagram);
  expect(await loadDiagramAgentContext(legacy)).toEqual(legacy.snapshot);
});

it('removes a context when its diagram is removed from the canvas', () => {
  const controller = new MappingDocumentController({ scene: singleDiagramScene('Before'), edges: [], sections: {} }, initialCanvasState());
  const base = controller.getSnapshot().document.scene.contents.overview;
  controller.applyUpdate(0, [{ method: 'diagram-create', id: 'other', ascii: 'Other' }]);
  controller.applyUpdate(1, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: base.revisionId,
    context: compileDiagramAgentContext(base) }]);
  controller.applyUpdate(2, [{ method: 'remove', nodeId: 'grid:overview' }]);
  expect(controller.getSnapshot().document.diagramContexts?.[base.diagramId]).toBeUndefined();
  controller.undo();
  expect(controller.getSnapshot().document.diagramContexts?.[base.diagramId]).toBeDefined();
});
