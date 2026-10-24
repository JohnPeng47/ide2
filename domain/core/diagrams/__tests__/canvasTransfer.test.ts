import { expect, it } from 'vitest';
import { CanvasHistory, documentFromHistory } from '../canvasHistory';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../diagramContentNodes';
import { defaultArrowAppearance, type ContentNodeAnchor } from '../diagramConnection';
import { emptyCanvasDocument, prepareCanvasTransfer, prepareTransferNavigation } from '../canvasTransfer';
import { initialCanvasState, type MappingWorkspaceSnapshot } from '../../../mapping/workspace/mappingWorkspace';
import { deserializeWorkspace, serializeWorkspace } from '../../../mapping/workspace/mappingWorkspaceCodec';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { diagramSceneText } from '../../../mapping/workspace/diagramSceneText';

function setup() {
  const document = emptyCanvasDocument();
  document.scene.contents = { shared: revisionFixture().create({ id: 'shared', revision: 0, ascii: 'Root\n|-- Branch\n`-- Tail', structureKind: 'tree' }).diagram };
  if (document.scene.root.kind !== 'container') throw Error();
  document.scene.root.children = ['a', 'b', 'c'].map((id, i) => ({ id, kind: 'diagram', contentId: 'shared', collapsed: false, position: { column: i * 24, row: i } }));
  const content = document.scene.contents.shared.content;
  const node = diagramContentNodes(content).find(node => node.line === 2)!;
  const source = (id: string): ContentNodeAnchor => ({ kind: 'content-node', displayNodeId: `grid:${id}`, contentNodeId: node.id, revisionId: content.revisionId, side: 'auto' });
  // All endpoint cases, plus fan-out on the same content node and shared content placements.
  document.edges = [['a','b'], ['b','a'], ['a','a'], ['b','c']].map(([a,b], i) => ({ id: `edge${i}`, source: source(a), target: source(b), appearance: { ...defaultArrowAppearance, label: `${a} to ${b}` } }));
  const history = new CanvasHistory(document, initialCanvasState()).export();
  const input = { mode: 'move' as const, sourceId: 'source', sourceAliases: ['source'], destinationId: 'draft-dest', selectedIds: ['grid:a'], destinationView: initialCanvasState() };
  return { document, history, input };
}
it('moves placements, converts every edge at its source, and links both CanvasHistory checkpoints without mutating input', () => {
  const { document, history, input } = setup(), saved = structuredClone(history);
  const p = prepareCanvasTransfer(history, input);
  expect(history).toEqual(saved);
  expect(p.source.document.edges).toEqual([]); expect(p.destination.document.edges).toEqual([]);
  expect(p.source.document.jumps!.map(j => [j.sourceDisplayNodeId, j.target.representationId, j.target.displayNodeId])).toEqual([
    ['grid:b', 'draft-dest', 'grid:a'], ['grid:b', 'source', 'grid:c']
  ]);
  expect(p.destination.document.jumps!.map(j => [j.sourceDisplayNodeId, j.target.representationId, j.target.displayNodeId])).toEqual([
    ['grid:a', 'source', 'grid:b'], ['grid:a', 'draft-dest', 'grid:a']
  ]);
  expect(p.source.document.scene.contents.shared).toEqual(document.scene.contents.shared);
  expect(p.source.history.snapshots[p.source.history.headId].transactionId).toBe(p.transaction.id);
  expect(p.destination.history.snapshots[p.destination.history.headId].transactionId).toBe(p.transaction.id);
  const runs = diagramSceneText(p.source.document.scene, {}, p.source.document.jumps).rows.flatMap(row => row.runs);
  expect(runs.find(run => run.owner?.displayNodeId === 'grid:b' && run.jumps)?.jumps).toHaveLength(2);
  expect(runs.filter(run => run.owner?.displayNodeId === 'grid:c' && run.jumps)).toEqual([]);
});
it.each(['copy', 'move'] as const)('round-trips %s as one undo/redo step with durable transaction IDs', mode => {
  const { history, input, document } = setup(), p = prepareCanvasTransfer(history, { ...input, mode });
  const entry = (id: string, state: typeof p.source) => ({ representationId: id, name: id, savedName: id, revisionId: id === 'source' ? 'revision-source' : '',
    savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges), document: state.document, canvas: initialCanvasState(), history: state.history });
  const workspace: MappingWorkspaceSnapshot = { schemaVersion: 3, projectId: 'project', activeDocumentId: 'draft-dest', transfers: [p.transaction],
    documents: [entry('source', p.source), entry('draft-dest', p.destination)] };
  const reloaded = deserializeWorkspace(serializeWorkspace(workspace));
  const undone = prepareTransferNavigation(reloaded.documents[0].history!, reloaded.documents[1].history!, reloaded.transfers![0]);
  expect(undone.source.document).toEqual(document);
  expect(undone.destination.document).toEqual(emptyCanvasDocument()); expect(undone.transaction.applied).toBe(false);
  const redone = prepareTransferNavigation(undone.source.history, undone.destination.history, undone.transaction, true);
  expect(redone.source.document).toEqual(p.source.document); expect(redone.destination.document).toEqual(p.destination.document);
  expect(redone.transaction.applied).toBe(true);
  if (mode === 'copy') expect(p.source.history).toEqual(history);
  const broken = structuredClone(workspace); delete broken.documents[1].history!.snapshots[p.transaction.destinationAfter];
  expect(() => deserializeWorkspace(broken)).toThrow();
});
it('copies independent diagram identities, source mappings and internal edges while leaving source history unchanged', () => {
  const { history, input, document } = setup();
  const p = prepareCanvasTransfer(history, { ...input, mode: 'copy', selectedIds: ['grid:a', 'grid:b'] });
  expect(p.source.history).toEqual(history); expect(p.destination.document.edges).toHaveLength(3);
  expect(p.selectedIds).toHaveLength(2); expect(p.selectedIds).not.toContain('grid:a');
  const copied = Object.values(p.destination.document.scene.contents)[0];
  expect(copied.id).not.toBe('shared'); expect(copied.content.ascii).toEqual(document.scene.contents.shared.content.ascii);
  expect(copied.sourceContext).toEqual(document.scene.contents.shared.sourceContext);
  const c = new MappingDocumentController(p.destination.document, initialCanvasState(), 0, undefined, undefined, p.destination.history);
  c.applyUpdate(0, [{ method: 'patchDiagram', nodeId: p.selectedIds[0], start: 3, end: 3, patch: '`-- Edited copy' }]);
  expect(c.getSnapshot().document.scene.contents[copied.id].content.ascii).toContain('Edited copy');
  expect(documentFromHistory(history)).toEqual(document);
});
it('preserves structured labels on copy and extracts their text when converting edges to jumps', () => {
  const { document, input } = setup();
  document.edges[0].appearance.label = { text: 'Calls', position: { x: 150, y: 50 } };
  const history = new CanvasHistory(document, initialCanvasState()).export();
  const copied = prepareCanvasTransfer(history, { ...input, mode: 'copy', selectedIds: ['grid:a', 'grid:b'] });
  expect(copied.destination.document.edges[0].appearance.label).toEqual(document.edges[0].appearance.label);
  const moved = prepareCanvasTransfer(history, input);
  expect(moved.destination.document.jumps!.find(j => j.target.displayNodeId === 'grid:b')?.label).toBe('Calls');
});
it('allows moving every diagram, and prevents partial undo or overwriting newer edits', () => {
  const { history, input } = setup();
  const p = prepareCanvasTransfer(history, { ...input, selectedIds: ['grid:a','grid:b','grid:c'] });
  expect(p.source.document.scene.contents).toEqual({});
  const c = new MappingDocumentController(p.source.document, initialCanvasState(), 0, undefined, undefined, p.source.history);
  expect(() => c.undo()).toThrow('workspace undo');
  const dest = new CanvasHistory(p.destination.document, initialCanvasState(), p.destination.history);
  dest.append(p.destination.document, { ...initialCanvasState(), extra: 'Newer view edit' });
  expect(() => prepareTransferNavigation(p.source.history, dest.export(), p.transaction)).toThrow('Undo newer edits');
});
it('rejects stale source anchors atomically instead of creating jumps on unrelated text', () => {
  const { history, input } = setup();
  const c = new MappingDocumentController(documentFromHistory(history), initialCanvasState(), 0, undefined, undefined, history);
  c.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:a', ascii: 'Different content' }]);
  const before = c.exportHistory();
  expect(() => c.prepareTransfer(input)).toThrow('STALE'); expect(c.exportHistory()).toEqual(before);
});
it('rebases untouched jump lines on patches, retains changed anchors as stale, and prunes removed placements', () => {
  const { history, input } = setup(), p = prepareCanvasTransfer(history, input);
  const c = new MappingDocumentController(p.source.document, initialCanvasState(), 0, undefined, undefined, p.source.history);
  c.applyUpdate(0, [{ method: 'patchDiagram', nodeId: 'grid:b', start: 1, end: 1, patch: 'New root\n|-- Extra' }]);
  expect(c.getSnapshot().document.jumps!.every(j => j.source.line === 3)).toBe(true);
  c.applyUpdate(1, [{ method: 'remove', nodeId: 'grid:b' }]);
  expect(c.getSnapshot().document.jumps).toEqual([]);
  c.undo(); expect(c.getSnapshot().document.jumps).toHaveLength(2);
});
it('rebases copied source jumps, internal targets and edge anchors to independent content-node identities', () => {
  const { document, input } = setup(), diagram = document.scene.contents.shared, node = diagramContentNodes(diagram.content)[1];
  const link = { id: 'local', source: { revisionId: diagram.content.revisionId, contentHash: diagram.content.asciiSha256,
    line: node.line, startColumn: node.startColumn, endColumn: node.endColumn, contentNodeId: node.id },
    target: { representationId: 'source', displayNodeId: 'grid:a', contentNodeId: node.id } };
  document.scene.contents = { ...document.scene.contents, shared: revisionFixture().revise(diagram.revisionId, { kind: 'jumps', jumps: [link] }).diagram };
  document.jumps = [{ ...link, id: 'placement', sourceDisplayNodeId: 'grid:b' }];
  const original = new CanvasHistory(document, initialCanvasState()).export();
  const p = prepareCanvasTransfer(original, { ...input, mode: 'copy', selectedIds: ['grid:a', 'grid:b'] });
  const copied = Object.values(p.destination.document.scene.contents)[0], copiedNode = diagramContentNodes(copied.content)[1];
  expect(copiedNode.id).not.toBe(node.id);
  expect(copied.jumps![0]).toMatchObject({ source: { revisionId: copied.content.revisionId, contentNodeId: copiedNode.id },
    target: { representationId: 'draft-dest', displayNodeId: p.selectedIds[0], contentNodeId: copiedNode.id } });
  expect(p.destination.document.jumps![0]).toMatchObject({ sourceDisplayNodeId: p.selectedIds[1], source: { contentNodeId: copiedNode.id },
    target: { displayNodeId: p.selectedIds[0], contentNodeId: copiedNode.id } });
  expect(p.destination.document.edges[0].source).toMatchObject({ displayNodeId: p.selectedIds[0], revisionId: copied.content.revisionId, contentNodeId: copiedNode.id });
  expect(documentFromHistory(original)).toEqual(document);
});
it.each(['copy','move'] as const)('%s appends to an existing canvas without moving its diagrams and restores both histories', mode => {
  const { history, input } = setup();
  const existing = emptyCanvasDocument();
  existing.scene.contents = { shared: revisionFixture().create({ id: 'shared', revision: 0, ascii: 'Existing\n`-- Keep', structureKind: 'tree' }).diagram };
  if (existing.scene.root.kind !== 'container') throw Error();
  // Both placement and content IDs collide with the incoming group.
  existing.scene.root.children = [{ id: 'a', kind: 'diagram', contentId: 'shared', collapsed: false, position: { column: 60, row: 8 } }];
  const before = new CanvasHistory(existing, initialCanvasState()).export();
  const p = prepareCanvasTransfer(history, { ...input, mode, selectedIds: ['grid:a','grid:b'] }, before);
  expect(p.transaction.destinationCreated).toBe(false);
  expect(p.destination.document.scene.root.kind).toBe('container');
  if (p.destination.document.scene.root.kind !== 'container') throw Error();
  expect(p.destination.document.scene.root.children[0]).toEqual(existing.scene.root.children[0]);
  expect(p.selectedIds).not.toContain('grid:a');
  expect(p.destination.document.scene.contents.shared).toEqual(existing.scene.contents.shared);
  expect(p.destination.document.scene.root.children).toHaveLength(3);
  const children = p.destination.document.scene.root.children;
  expect(children[2].position.column - children[1].position.column).toBe(24);
  expect(children[2].position.row - children[1].position.row).toBe(1);
  const undone = prepareTransferNavigation(p.source.history, p.destination.history, p.transaction);
  expect(undone.destination.document).toEqual(existing);
  expect(undone.destination.history.headId).toBe(before.headId);
  const redone = prepareTransferNavigation(undone.source.history, undone.destination.history, undone.transaction, true);
  expect(redone.destination.document).toEqual(p.destination.document);
  expect(before.headId).toBe(p.transaction.destinationBefore);
});
it('preserves an existing diagram root and its absolute position when adding incoming diagrams', () => {
  const { history, input } = setup();
  const existing = emptyCanvasDocument();
  existing.scene.contents = { single: revisionFixture().create({ id: 'single', revision: 0, ascii: 'Single' }).diagram };
  existing.scene.root = { id: 'single', kind: 'diagram', contentId: 'single', collapsed: false, position: { column: 20, row: 4 } };
  const destination = new CanvasHistory(existing, initialCanvasState()).export();
  const p = prepareCanvasTransfer(history, { ...input, mode: 'copy' }, destination);
  expect(p.destination.document.scene.root.kind).toBe('container');
  if (p.destination.document.scene.root.kind !== 'container') throw Error();
  expect(p.destination.document.scene.root.children[0]).toEqual(existing.scene.root);
});


it('copies colored highlights onto independent content anchors and preserves them through workspace persistence', () => {
  const f = setup(), controller = new MappingDocumentController(f.document, initialCanvasState());
  const anchor = diagramContentNodes(f.document.scene.contents.shared.content)[1];
  controller.applyUpdate(0, [{ method: 'highlight', nodeId: 'grid:a', contentNodeId: anchor.id, color: 'orange', highlightId: 'saved-highlight' }]);
  const p = prepareCanvasTransfer(controller.exportHistory(), { ...f.input, mode: 'copy' });
  const diagram = Object.values(p.destination.document.scene.contents).find(diagram => p.destination.document.diagramPresentations?.[diagram.id]?.highlights?.length)!;
  const next = diagramContentNodes(diagram.content).find(node => node.label === anchor.label)!;
  expect(p.destination.document.diagramPresentations?.[diagram.id]?.highlights).toMatchObject([{ id: 'saved-highlight', contentNodeId: next.id, color: 'orange' }]);
  expect(next.id).not.toBe(anchor.id);
  const restored = new MappingDocumentController(p.destination.document, p.destination.view as ReturnType<typeof initialCanvasState>, 0, undefined, undefined, p.destination.history);
  expect(restored.getSnapshot().document.diagramPresentations?.[diagram.id]?.highlights).toEqual(p.destination.document.diagramPresentations?.[diagram.id]?.highlights);
});


it('copies a multi-node highlight as one saved annotation and round-trips its targets', () => {
  const f = setup(), controller = new MappingDocumentController(f.document, initialCanvasState());
  const anchors = diagramContentNodes(f.document.scene.contents.shared.content).slice(0, 2);
  controller.applyUpdate(0, [{ method: 'highlight', nodeId: 'grid:a', contentNodeIds: anchors.map(node => node.id), color: 'blue', highlightId: 'group-highlight' }]);
  const p = prepareCanvasTransfer(controller.exportHistory(), { ...f.input, mode: 'copy' });
  const diagram = Object.values(p.destination.document.scene.contents).find(diagram => p.destination.document.diagramPresentations?.[diagram.id]?.highlights?.length)!;
  const targets = anchors.map(anchor => diagramContentNodes(diagram.content).find(node => node.label === anchor.label)!.id);
  expect(targets).not.toEqual(anchors.map(node => node.id));
  expect(p.destination.document.diagramPresentations?.[diagram.id]?.highlights).toMatchObject([{ id: 'group-highlight', contentNodeIds: targets, color: 'blue' }]);
  const saved = JSON.parse(JSON.stringify(p.destination));
  const restored = new MappingDocumentController(saved.document, saved.view, 0, undefined, undefined, saved.history);
  expect(restored.getSnapshot().document.diagramPresentations?.[diagram.id]?.highlights).toEqual(p.destination.document.diagramPresentations?.[diagram.id]?.highlights);
});
