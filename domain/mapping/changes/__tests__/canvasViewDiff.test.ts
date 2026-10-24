import { expect, it } from 'vitest';
import { MappingDocumentController, type DiagramOperation } from '../../workspace/mappingDocumentController';
import { initialCanvasState } from '../../workspace/mappingWorkspace';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import type { CanvasViewCommand } from '../../../core/diagrams/canvasView';
import { canvasViewDiff } from '../canvasViewDiff';

function fixture(ascii = 'Root\n|-- A\n`-- B') {
  const service = revisionFixture();
  const scene = singleDiagramScene(ascii);
  scene.contents = { ...scene.contents, overview: service.create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram };
  const c = new MappingDocumentController({ scene, edges: [], sections: {} }, initialCanvasState());
  const edit = (...ops: DiagramOperation[]) => c.applyUpdate(c.getSnapshot().version, ops);
  const command = (input: CanvasViewCommand) => c.canvasView(c.getSnapshot().version, input);
  const start = () => command({ operation: 'start', name: 'Changes' }).recording!.id;
  const stop = () => command({ operation: 'stop' });
  return { c, service, edit, start, stop };
}

it('compares pinned endpoints, survives later edits and reload, and never changes history', () => {
  const { c, edit, start, stop } = fixture();
  const id = start();
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'Root\n|-- A\n`-- Added', structureKind: 'tree' });
  stop();
  const saved = c.canvasViewComparison(id);
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'Later live edit', structureKind: 'tree' });
  const history = c.exportHistory(), snapshot = c.getSnapshot();
  const preview = canvasViewDiff(c.canvasViewComparison(id));
  expect(preview.doc.proposed.document.scene.contents.overview.content.ascii).toContain('Added');
  expect(preview.doc.baseline!.document.scene.contents.overview.content.ascii).toContain('B');
  expect(preview).toEqual(canvasViewDiff(saved));
  expect(c.getSnapshot()).toBe(snapshot);
  expect(c.exportHistory()).toEqual(history);
  const restored = new MappingDocumentController(snapshot.document, snapshot.canvas, 0, undefined, undefined, JSON.parse(JSON.stringify(history)));
  expect(canvasViewDiff(restored.canvasViewComparison(id))).toEqual(preview);
});

it('uses logical identity to recognize swapped labels, instead of matching the labels to each other', () => {
  const { c, service, edit, start, stop } = fixture();
  const base = c.exportRevisions([c.getSnapshot().document.scene.contents.overview.revisionId])[0];
  const correspondence = Object.fromEntries(diagramContentNodes(base.diagram.content).map(node => [base.nodeRefs[node.id], node.line]));
  const next = service.revise(base.id, { kind: 'replace', input: { ascii: 'Root\n|-- B\n`-- A', structureKind: 'tree' }, nodeCorrespondence: correspondence });
  const id = start();
  edit({ method: 'diagram-revision-apply', nodeId: 'grid:overview', expectedRevisionId: base.id, revision: next.revision });
  stop();
  const preview = canvasViewDiff(c.canvasViewComparison(id));
  expect(preview.diff.counts).toEqual({ added: 0, removed: 0, modified: 2, moved: 0 });
});

it('resolves selected subtree and nested variants at each endpoint, without applying a variant', () => {
  const { c, service, edit, start, stop } = fixture('Root\n|-- Branch\n|   `-- Child\n`-- Other');
  const base = c.exportRevisions([c.getSnapshot().document.scene.contents.overview.revisionId])[0];
  const refs = Object.fromEntries(diagramContentNodes(base.diagram.content).map(n => [n.label, base.nodeRefs[n.id]]));
  const keep = Object.fromEntries(diagramContentNodes(base.diagram.content).map(n => [base.nodeRefs[n.id], n.line]));
  const next = service.revise(base.id, { kind: 'replace', input: { ascii: base.diagram.content.ascii.replace('Child', 'First'), structureKind: 'tree' }, nodeCorrespondence: keep }).revision;
  const nested = service.revise(next.id, { kind: 'replace', input: { ascii: next.diagram.content.ascii.replace('First', 'Nested'), structureKind: 'tree' }, nodeCorrespondence: keep }).revision;
  const variant = { id: 'v1', name: 'First', diagramId: base.diagramId, contentId: base.diagram.id, ownerNodeId: refs.Branch,
    baseRevisionId: base.id, headRevisionId: next.id, revisionIds: [next.id], decisions: {}, prompt: '' };
  const child = { ...variant, id: 'v2', name: 'Nested', contextVariantId: variant.id, ownerNodeId: refs.Child,
    baseRevisionId: next.id, headRevisionId: nested.id, revisionIds: [nested.id] };
  edit({ method: 'variant-store', nodeId: 'grid:overview', expectedRevisionId: base.id, variants: [{ variant, revision: next }, { variant: child, revision: nested }] });
  const id = start();
  edit({ method: 'variant-select', nodeId: 'grid:overview', ownerNodeId: refs.Branch, contextVariantId: null, variantId: variant.id },
    { method: 'variant-select', nodeId: 'grid:overview', ownerNodeId: refs.Child, contextVariantId: variant.id, variantId: child.id });
  stop();
  const preview = canvasViewDiff(c.canvasViewComparison(id));
  expect(preview.doc.proposed.document.scene.contents.overview.content.ascii).toContain('Nested');
  expect(preview.doc.baseline!.document.scene.contents.overview.content.ascii).toContain('Child');
  expect(preview.diff.counts).toEqual({ added: 0, removed: 0, modified: 1, moved: 0 });
  expect(c.getSnapshot().document.scene.contents.overview.content.ascii).toContain('Child');
});

it('retains deleted diagrams as preview ghosts and leaves the live scene empty', () => {
  const { c, edit, start, stop } = fixture();
  const id = start(); edit({ method: 'delete-diagrams', nodeIds: ['grid:overview'] }); stop();
  const preview = canvasViewDiff(c.canvasViewComparison(id));
  expect(preview.removedDiagramIds).toEqual(new Set(['grid:overview']));
  expect(preview.diff.counts.removed).toBe(3);
  expect(Object.values(preview.doc.proposed.document.scene.contents).some(d => d.content.ascii.includes('Root'))).toBe(true);
  expect(c.getSnapshot().document.scene.root).not.toEqual(preview.doc.proposed.document.scene.root);
});

it('shows no diagram content changes for a move or for edits reversed during recording', () => {
  const { c, edit, start, stop } = fixture();
  const id = start();
  edit({ method: 'replace', nodeId: 'grid:overview', ascii: 'Temporary', structureKind: 'tree' }); c.undo();
  edit({ method: 'move', nodeId: 'grid:overview', position: { column: 30, row: 20 } }); stop();
  expect(canvasViewDiff(c.canvasViewComparison(id)).diff.counts).toEqual({ added: 0, removed: 0, modified: 0, moved: 0 });
});

it('places deleted diagrams at their absolute baseline position, including group offsets', () => {
  const { c, edit, start, stop } = fixture();
  const id = start(); edit({ method: 'delete-diagrams', nodeIds: ['grid:overview'] }); stop();
  const comparison = c.canvasViewComparison(id);
  const root = comparison.baseline.document.scene.root;
  if (root.kind !== 'container') throw Error();
  comparison.baseline.document.scene.root = { ...root, position: { column: 10, row: 20 }, children:
    root.children.map(child => ({ ...child, position: { column: 5, row: 7 } })) };
  const preview = canvasViewDiff(comparison);
  const result = preview.doc.proposed.document.scene.root;
  if (result.kind !== 'container') throw Error();
  expect(result.children.find(box => box.id === 'overview')!.position).toEqual({ column: 15, row: 27 });
});
