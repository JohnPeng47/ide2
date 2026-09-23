import { expect, it } from 'vitest';
import { MappingDocumentController } from '../mappingDocumentController';
import { CanvasHistory, documentFromHistory, validateCanvasHistory } from '../canvasHistory';
import { mappingDocumentFromScene } from '../mappingDocument';
import { initialCanvasState } from '../mappingWorkspace';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { createDiagram } from '../../../core/diagrams/diagram';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { defaultArrowAppearance } from '../../../core/diagrams/diagramConnection';
const setup = () => {
  const scene = singleDiagramScene('Root\n|-- Edit\n`-- Keep');
  scene.contents = { ...scene.contents, overview: createDiagram({ id: 'overview', revision: 0, ascii: scene.contents.overview.content.ascii, structureKind: 'tree' }) };
  return new MappingDocumentController(mappingDocumentFromScene(scene), initialCanvasState());
};
const patch = (c: MappingDocumentController, text = '|-- Changed') => c.applyUpdate(c.getSnapshot().version,
  [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 2, end: 2, patch: text }]);
const head = (c: MappingDocumentController) => { const h = c.exportHistory(); return h.snapshots[h.headId]; };
it('separates diagram revisions, canvas checkpoints and detached revision-free resolved views', () => {
  const c = setup(), before = head(c), view = c.resolveDiagram('overview');
  expect(view).not.toHaveProperty('revisionId'); expect(view).not.toHaveProperty('revision');
  expect(c.getCanvasSnapshot().scene).not.toHaveProperty('contents');
  c.applyUpdate(0, [{ method: 'move', nodeId: 'grid:overview', position: { column: 30, row: 3 } }]);
  expect(head(c).id).not.toBe(before.id);
  expect(head(c).diagramBindings).toEqual(before.diagramBindings);
  const keep = view.nodes.find(n => n.label === 'Keep')!.id;
  patch(c);
  expect(head(c).diagramBindings.overview).not.toBe(before.diagramBindings.overview);
  expect(c.resolveDiagram('overview').nodes.find(n => n.label === 'Keep')!.id).toBe(keep);
  (view.sourceContext.mappings as unknown as object[]).push({});
  expect(c.resolveDiagram('overview').sourceContext.mappings).toEqual([]);
});
it('retains abandoned branches and restores durable undo/redo without reusing diagram identity', () => {
  const c = setup(); patch(c, '|-- First'); const first = head(c);
  c.undo(); patch(c, '|-- Second'); const second = head(c);
  expect(second.diagramBindings.overview).not.toBe(first.diagramBindings.overview);
  const h = JSON.parse(JSON.stringify(c.exportHistory()));
  validateCanvasHistory(h);
  expect(h.snapshots[first.id]).toEqual(first);
  const restored = new MappingDocumentController(documentFromHistory(h), initialCanvasState(), 0, undefined, undefined, h);
  restored.undo(); expect(restored.resolveDiagram('overview').ascii).toContain('Edit');
  restored.undo(true); expect(restored.resolveDiagram('overview').ascii).toContain('Second');
});
it('prepares isolated changes without advancing a context and detects metadata-only concurrent revisions', () => {
  const c = setup(), original = c.exportHistory();
  const history = new CanvasHistory(c.getSnapshot().document, c.getSnapshot().canvas, original);
  const prepared = history.diagrams.prepareEdit(history.contextId, 'overview', { kind: 'patch', start: 2, end: 2, patch: '|-- Prepared' });
  expect(prepared.diagram.content.ascii).toContain('Prepared'); expect(history.export()).toEqual(original);
  const fork = c.forkHistory(); expect(fork.contextId).not.toBe(original.contextId);
  const copy = new MappingDocumentController(documentFromHistory(fork), initialCanvasState(), 0, undefined, undefined, fork);
  patch(copy); expect(c.exportHistory()).toEqual(original);
  const doc = structuredClone(c.getSnapshot().document);
  doc.scene.contents.overview.sourceContext.evidence.extra = { id: 'extra', handle: 'extra', label: 'Extra', category: 'operation', summary: '', sourceRanges: [] };
  c.commitDocument(doc);
  expect(() => history.diagrams.merge(original.snapshots[original.headId].diagramBindings, head(c).diagramBindings, {})).toThrow('MERGE_REQUIRED');
  expect(history.diagrams.merge(head(c).diagramBindings, head(c).diagramBindings, head(copy).diagramBindings)).toEqual(head(copy).diagramBindings);
});
it('coordinates anchors and content, and publishes no checkpoint for a failed batch', () => {
  const c = setup(), diagram = c.getSnapshot().document.scene.contents.overview;
  const node = diagramContentNodes(diagram.content).find(n => n.line === 3)!;
  c.applyUpdate(0, [{ method: 'edge-create', edge: { id: 'edge', source: { kind: 'content-node', displayNodeId: 'grid:overview', contentNodeId: node.id, revisionId: diagram.content.revisionId, side: 'auto' }, target: { kind: 'box', displayNodeId: 'grid:overview', side: 'auto' }, appearance: defaultArrowAppearance } }]);
  const anchor = head(c).document.edges[0].source;
  expect(anchor).not.toHaveProperty('revisionId');
  patch(c, '|-- New\n|-- Extra');
  expect(head(c).document.edges[0].source.contentNodeId).toBe(anchor.contentNodeId);
  expect(c.getSnapshot().document.edges[0].source.revisionId).toBe(c.getSnapshot().document.scene.contents.overview.content.revisionId);
  const before = c.exportHistory();
  expect(() => c.applyUpdate(c.getSnapshot().version, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 2, end: 2, patch: '|-- Staged' }, { method: 'remove', nodeId: 'grid:root' }])).toThrow();
  expect(c.exportHistory()).toEqual(before);
});
it('routes UI grouping and sized diagram creation through the same coordinated history', () => {
  const c = setup(), before = head(c);
  c.applyUpdate(0, [{ method: 'group', nodeId: 'grid:overview', id: 'group' }]);
  expect(head(c).diagramBindings.overview).toBe(before.diagramBindings.overview);
  expect(c.resolveDiagram('group-summary').ascii).toBe('[Diagram group]');
  c.applyUpdate(1, [{ method: 'diagram-create', id: 'generated', parentId: 'grid:group', ascii: '[New]', minimumSize: { columns: 40, rows: 12 } }]);
  expect(c.nodes().find(n => n.id === 'grid:generated')).toMatchObject({ geometry: { bounds: { columns: 40, rows: 12 } } });
  c.undo(); expect(() => c.resolveDiagram('generated')).toThrow('Unknown diagram');
  c.undo(); expect(c.getCanvasSnapshot()).toEqual(before.document);
});
