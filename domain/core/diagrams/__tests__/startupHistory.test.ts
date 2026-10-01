import { afterEach, expect, it, vi } from 'vitest';
import { CanvasHistory, documentFromHistory, validateCanvasHistory } from '../canvasHistory';
import { DefaultCanvasHistoryService } from '../canvasHistoryService';
import * as content from '../diagramContent';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';
import { deserializeWorkspace } from '../../../mapping/workspace/mappingWorkspaceCodec';
import { singleDiagramScene } from '../projectDiagramCanvas';
import { DiagramPersistence } from '../diagramPersistence';
import { RevisionedDiagramService } from '../diagramService';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const controller = new MappingDocumentController({ scene: singleDiagramScene('Before'), edges: [], sections: {} }, initialCanvasState());
  controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'After' }]);
  for (let i = 0; i < 8; i++) controller.applyUpdate(controller.getSnapshot().version, [{ method: 'move', nodeId: 'grid:overview', position: { column: i + 2, row: 0 } }]);
  return { controller, history: controller.exportHistory() };
}
it('validates each unique diagram once instead of rebuilding it for every checkpoint', () => {
  const { history } = fixture();
  const parse = vi.spyOn(content, 'buildDiagramContent');
  validateCanvasHistory(history);
  expect(parse).toHaveBeenCalledTimes(Object.keys(history.diagramRevisions).length);
});
it('preserves complete history while deferring validation of older checkpoints until navigation', () => {
  const { controller, history } = fixture();
  const target = history.past.at(-1)!;
  history.snapshots[target].document.scene.root = { ...history.snapshots[target].document.scene.root, kind: 'invalid' } as never;
  const lazy = new CanvasHistory(controller.getSnapshot().document, controller.getSnapshot().canvas, history, 'current');
  expect(lazy.export()).toEqual(history);
  expect(() => lazy.navigate()).toThrow('Invalid canvas box kind');
  // Failure must not pop the undo stack or advance the current checkpoint.
  expect(lazy.export()).toEqual(history);
  expect(() => new CanvasHistory(controller.getSnapshot().document, controller.getSnapshot().canvas, history)).toThrow('Invalid canvas box kind');
});
it('keeps undo/redo and editing functional after an on-demand restore', () => {
  const { controller, history } = fixture();
  const reopened = new MappingDocumentController(controller.getSnapshot().document, controller.getSnapshot().canvas, 0, undefined, undefined, history, undefined, new DefaultCanvasHistoryService('current'));
  for (let i = 0; i < 9; i++) reopened.undo();
  expect(reopened.resolveDiagram('overview').ascii).toBe('Before');
  reopened.undo(true);
  expect(reopened.resolveDiagram('overview').ascii).toBe('After');
  reopened.applyUpdate(reopened.getSnapshot().version, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Edited after restore' }]);
  validateCanvasHistory(reopened.exportHistory());
  expect(reopened.resolveDiagram('overview').ascii).toBe('Edited after restore');
});
it('still fully validates imported workspaces and rejects a bad current checkpoint at startup', () => {
  const { controller, history } = fixture();
  const document = controller.getSnapshot().document;
  const workspace = { schemaVersion: 3, projectId: 'project', documents: [{ representationId: 'draft-startup', revisionId: '', name: 'Canvas', savedName: 'Canvas', savedScene: JSON.stringify(document.scene), document, canvas: initialCanvasState(), history }] };
  history.snapshots[history.past.at(-1)!].document.scene.root = { ...history.snapshots[history.headId].document.scene.root, kind: 'invalid' } as never;
  expect(() => deserializeWorkspace(workspace, 'current')).not.toThrow();
  expect(() => deserializeWorkspace(workspace)).toThrow('Invalid canvas box kind');
  history.snapshots[history.headId].document.scene.root = { ...history.snapshots[history.headId].document.scene.root, kind: 'invalid' } as never;
  expect(() => new CanvasHistory(documentFromHistory(history), initialCanvasState(), history, 'current')).toThrow('Invalid canvas box kind');
});

it('validates deferred diagram revisions when accessed through DiagramService', async () => {
  const { history } = fixture();
  const original = Object.values(history.diagramRevisions)[0];
  const id = `diagram-revision-${crypto.randomUUID()}`;
  const invalid = structuredClone({ ...original, id, diagram: { ...original.diagram, revisionId: id } });
  (invalid.diagram.content as { ascii: string }).ascii = 'Corrupted parsed content';
  history.diagramRevisions[id] = invalid;
  const persistence = new DiagramPersistence({ get: async () => { throw Error('Unexpected record read'); }, put: async () => { throw Error('Unexpected write'); } });
  await persistence.restore(history, 'current');
  const service = new RevisionedDiagramService();
  expect(service.listRevisions(invalid.diagramId).some(r => r.id === id)).toBe(true);
  expect(() => service.getRevision(id)).toThrow('Invalid diagram content');
  expect(() => service.getRevision(id)).toThrow('Invalid diagram content');
  await expect(persistence.restore(history)).rejects.toThrow('Invalid diagram content');
});
