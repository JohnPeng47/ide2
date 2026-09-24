import { expect, it, vi } from 'vitest';
import { RevisionedDiagramService } from '../diagramService';
import { singleDiagramScene } from '../projectDiagramCanvas';
import { documentFromHistory } from '../canvasHistory';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';

it('injects one service into independent canvases with the same local diagram IDs', () => {
  const service = new RevisionedDiagramService();
  const open = vi.spyOn(service, 'openContext'), edits = vi.spyOn(service, 'prepareEdit');
  const controller = (ascii: string) => new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene(ascii)),
    initialCanvasState(), 0, undefined, undefined, undefined, service);
  const first = controller('First'), second = controller('Second');
  expect(open).toHaveBeenCalledTimes(2);
  first.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Changed' }]);
  expect(edits).toHaveBeenCalledTimes(1);
  expect(first.resolveDiagram('overview').ascii).toBe('Changed');
  expect(second.resolveDiagram('overview').ascii).toBe('Second');
  first.undo(); expect(first.resolveDiagram('overview').ascii).toBe('First');
  first.undo(true); expect(first.resolveDiagram('overview').ascii).toBe('Changed');
});

it('isolates restored viewers of the same context and stages batches without publishing failures', () => {
  const service = new RevisionedDiagramService();
  const original = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('A\nB')), initialCanvasState(), 0, undefined, undefined, undefined, service);
  const history = original.exportHistory();
  const restored = new MappingDocumentController(documentFromHistory(history), initialCanvasState(), 0, undefined, undefined, history, service);
  expect(original.getSnapshot().contextId).toBe(restored.getSnapshot().contextId);
  restored.applyUpdate(0, [
    { method: 'patchDiagram', nodeId: 'grid:overview', start: 2, end: 2, patch: 'C\nD' },
    { method: 'patchDiagram', nodeId: 'grid:overview', start: 3, end: 3, patch: 'E' }
  ]);
  expect(restored.resolveDiagram('overview').ascii).toBe('A\nC\nE');
  expect(original.resolveDiagram('overview').ascii).toBe('A\nB');
  const before = restored.exportHistory();
  expect(() => restored.applyUpdate(1, [
    { method: 'replace', nodeId: 'grid:overview', ascii: 'Not published' },
    { method: 'remove', nodeId: 'grid:root' }
  ])).toThrow();
  expect(restored.exportHistory()).toEqual(before);
});
