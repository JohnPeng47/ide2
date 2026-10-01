import { expect, it, vi } from 'vitest';
import type { Diagram } from '../diagram';
import { RevisionedDiagramService } from '../diagramService';
import { singleDiagramScene } from '../projectDiagramCanvas';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';

// Compile-time contract: canvas readers cannot modify nested diagram data.
function readonlyContract(diagram: Diagram) {
  // @ts-expect-error Content is readonly.
  diagram.content.ascii = 'bypass';
  // @ts-expect-error Source mappings are readonly.
  diagram.sourceContext.mappings.push({});
  // @ts-expect-error Captured source lines are readonly.
  diagram.sourceContext.evidence.entry.sourceRanges[0].originalLines.push('bypass');
  if (diagram.content.structure.kind === 'tree') {
    // @ts-expect-error Parsed subtree membership is readonly.
    diagram.content.structure.nodes.root.childIds.push('bypass');
  }
}
void readonlyContract;

it('publishes frozen revisions and rejects a modified transport copy while allowing canvas layout changes', () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Root\n`-- Child')), initialCanvasState());
  const diagram = controller.getSnapshot().document.scene.contents.overview;
  expect(Object.isFrozen(diagram)).toBe(true);
  expect(Object.isFrozen(diagram.content)).toBe(true);
  expect(Object.isFrozen(diagram.sourceContext.evidence)).toBe(true);
  expect(() => { (diagram.content as { ascii: string }).ascii = 'bypass'; }).toThrow();
  const before = controller.exportHistory();
  const copy = structuredClone(controller.getSnapshot().document);
  copy.scene.contents = { ...copy.scene.contents, overview: { ...diagram, sourceContext: { ...diagram.sourceContext,
    evidence: { extra: { id: 'extra', handle: 'extra', label: 'Extra', category: 'operation', summary: '', sourceRanges: [] } } } } };
  expect(() => controller.commitDocument(copy)).toThrow('through DiagramService');
  expect(controller.exportHistory()).toEqual(before);
  const layout = structuredClone(controller.getSnapshot().document);
  layout.scene.root.position.column = 10;
  controller.commitDocument(layout);
  expect(controller.getSnapshot().document.scene.contents.overview.revisionId).toBe(diagram.revisionId);
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Changed' }]);
  expect(Object.isFrozen(controller.getSnapshot().document.scene.contents.overview.content)).toBe(true);
  controller.undo();
  expect(controller.getSnapshot().document.scene.contents.overview.revisionId).toBe(diagram.revisionId);
});

it('revises an explicit base without mutating it and keeps node references through a patch', () => {
  const service = new RevisionedDiagramService();
  const base = service.create({ id: crypto.randomUUID(), revision: 0, ascii: 'Root\n|-- Edit\n`-- Keep', structureKind: 'tree' });
  const next = service.revise(base.revision.id, { kind: 'patch', start: 2, end: 2, patch: '|-- Changed\n|-- Extra' });
  expect(next.revision.parentId).toBe(base.revision.id);
  expect(service.getRevision(base.revision.id).diagram.content.ascii).toContain('Edit');
  const oldNode = Object.values(base.diagram.content.structure.kind === 'tree' ? base.diagram.content.structure.nodes : {}).find(n => n.label === 'Keep')!;
  const newNode = next.nodeIds.get(oldNode.id)!;
  expect(next.revision.nodeRefs[newNode]).toBe(base.revision.nodeRefs[oldNode.id]);
  expect(service.listRevisions(base.diagram.diagramId).map(r => r.id)).toEqual([base.revision.id, next.revision.id]);
});

it('validates agent output and inserts the generated revision itself into canvas history', async () => {
  const generator = { generate: vi.fn(async () => ({ ascii: 'Generated\n`-- Child', structureKind: 'tree' as const })) };
  const service = new RevisionedDiagramService(generator), id = crypto.randomUUID();
  const generated = await service.generate({ input: { id }, instruction: 'Describe the feature' });
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Source')), initialCanvasState(), 0, undefined, undefined, undefined, service);
  controller.applyUpdate(0, [{ method: 'diagram-insert', id, revisionId: generated.revision.id }]);
  expect(controller.getSnapshot().document.scene.contents[id]).toBe(generated.diagram);
  controller.undo(); expect(controller.getSnapshot().document.scene.contents[id]).toBeUndefined();
  controller.undo(true); expect(controller.getSnapshot().document.scene.contents[id].revisionId).toBe(generated.revision.id);
  const invalid = new RevisionedDiagramService({ generate: async () => ({ ascii: '' }) });
  const beforeInvalid = invalid.listRevisions(generated.diagram.diagramId);
  await expect(invalid.generate({ input: { id }, baseRevisionId: generated.revision.id, instruction: 'invalid' })).rejects.toThrow();
  expect(invalid.listRevisions(generated.diagram.diagramId)).toEqual(beforeInvalid);
});

it('does not issue a revision when generation is cancelled or fails', async () => {
  const abort = new AbortController(), id = crypto.randomUUID();
  const service = new RevisionedDiagramService({ generate: async (_request, options) => {
    expect(options.signal).toBe(abort.signal); abort.abort(); return { ascii: 'Too late' };
  } });
  const base = service.create({ id, revision: 0, ascii: 'Before' });
  const before = service.listRevisions(base.diagram.diagramId);
  const request = { input: { id }, baseRevisionId: base.revision.id, instruction: 'Generate' };
  await expect(service.generate(request, { signal: abort.signal })).rejects.toThrow();
  expect(service.listRevisions(base.diagram.diagramId)).toEqual(before);
  const failed = new RevisionedDiagramService({ generate: async () => { throw Error('Agent failed'); } });
  await expect(failed.generate(request)).rejects.toThrow('Agent failed');
  expect(failed.listRevisions(base.diagram.diagramId)).toEqual(before);
});

it('keeps separate diagram identities when two canvases use the same local content key', () => {
  const service = new RevisionedDiagramService();
  const first = service.create({ id: 'overview', revision: 0, ascii: 'First' });
  const second = service.create({ id: 'overview', revision: 0, ascii: 'Second' });
  const edit = service.revise(first.revision.id, { kind: 'replace', input: { ascii: 'Edited first' } });
  expect(first.diagram.diagramId).not.toBe(second.diagram.diagramId);
  expect(edit.diagram.diagramId).toBe(first.diagram.diagramId);
  expect(service.listRevisions(first.diagram.diagramId).map(r => r.id)).toEqual([first.revision.id, edit.revision.id]);
  expect(service.listRevisions(second.diagram.diagramId).map(r => r.id)).toEqual([second.revision.id]);
});

it('copies between editing controllers through their shared canvas history service', async () => {
  const { DefaultCanvasHistoryService } = await import('../canvasHistoryService');
  const service = new RevisionedDiagramService(), histories = new DefaultCanvasHistoryService();
  const controller = (ascii: string) => new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene(ascii)),
    initialCanvasState(), 0, undefined, undefined, undefined, service, histories);
  const source = controller('Source'), destination = controller('Destination');
  const prepared = source.prepareTransfer({ mode: 'copy', sourceId: 'source', sourceAliases: ['source'], destinationId: 'destination',
    selectedIds: ['grid:overview'], destinationView: initialCanvasState() }, destination);
  expect(Object.values(prepared.destination.document.scene.contents).map(d => d.content.ascii)).toContain('Source');
  expect(destination.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Destination');
  expect(source.getSnapshot().document.scene.contents.overview.content.ascii).toBe('Source');
});
