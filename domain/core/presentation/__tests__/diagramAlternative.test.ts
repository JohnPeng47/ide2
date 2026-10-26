import { expect, it } from 'vitest';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../../diagrams/diagramContentNodes';
import { singleDiagramScene } from '../../diagrams/projectDiagramCanvas';
import { MappingDocumentController, type DiagramOperation } from '../../../mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';
import { projectSelectedDiagramRows } from '../diagramRevisionProjection';
import { migrateDiagramAlternatives, ownerScope } from '../diagramAlternative';
import { documentFromHistory, validateCanvasHistory } from '../../diagrams/canvasHistory';
import { projectSidePanels, choosePanelSide } from '../../../mapping/workspace/diagramSidePanelLayout';
import { presentationScene, resolveDiagramView } from '../../../mapping/workspace/diagramViewState';
import { flattenGrid } from '../../diagrams/lineGrid';
import { migrateAlternativeHistory } from '../../../../scripts/migrations/migrate-diagram-alternatives';
import { canvasViewDiff } from '../../../mapping/changes/canvasViewDiff';
import { CanvasCheckpointEncoder, restoreCanvasCheckpoints } from '../../diagrams/canvasCheckpointRecords';
import { canvasDisplayNodes } from '../../../mapping/workspace/canvasDisplayNode';
function fixture() {
  const revisions = revisionFixture(), ascii = 'Root\n|-- Branch\n|   `-- Child\n`-- Other';
  const base = revisions.create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).revision;
  const nodes = diagramContentNodes(base.diagram.content), refs = Object.fromEntries(nodes.map(n => [n.label, base.nodeRefs[n.id]]));
  const next = revisions.revise(base.id, { kind: 'replace', input: { ascii: ascii.replace('Child', 'Changed').replace('Other', 'Alternative'), structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(nodes.map(n => [base.nodeRefs[n.id], n.line])) }).revision;
  const scene = singleDiagramScene(ascii); scene.contents = { ...scene.contents, overview: base.diagram };
  const c = new MappingDocumentController({ scene, edges: [], sections: {} }, initialCanvasState());
  const edit = (...ops: DiagramOperation[]) => c.applyUpdate(c.getSnapshot().version, ops);
  const parts = [refs.Branch, refs.Other].map(owner => ({ target: ownerScope(owner), source: { revisionId: next.id, scope: ownerScope(owner) }, baseRevisionId: base.id }));
  const promote = (select = false) => edit({ method: 'alternative-promote', nodeId: 'grid:overview', alternativeId: 'group', name: 'Grouped alternative', parts, select });
  const text = (id = 'grid:overview') => projectSelectedDiagramRows(base, c.getSnapshot().document, id, revisions.getRevision).map(row => row.text).join('\n');
  return { c, revisions, base, next, refs, edit, promote, text, parts };
}
it('promotes saved CanvasView diffs at every diagram root, shared by inline and panel displays and retained on apply/reload', () => {
  const f = fixture();
  f.edit({ method: 'diagram-create', id: 'unchanged', ascii: 'Unchanged', position: { column: 60, row: 0 } });
  const viewId = f.c.canvasView(f.c.getSnapshot().version, { operation: 'start', name: 'Recorded edit' }).recording!.id;
  f.edit({ method: 'patchDiagram', nodeId: 'grid:overview', start: 3, end: 3, patch: '|   `-- Changed' });
  f.c.canvasView(f.c.getSnapshot().version, { operation: 'stop' });
  const before = f.c.exportHistory(), original = f.c.canvasViewComparison(viewId);
  f.c.canvasView(f.c.getSnapshot().version, { operation: 'promote-diffs', viewId });
  const items = Object.values(f.c.getSnapshot().document.alternatives!.items);
  expect(items).toHaveLength(2);
  expect(items.every(item => item.display === 'diff' && item.parts[0].target.kind === 'diagram')).toBe(true);
  const diff = items.find(item => item.presentationId === 'grid:overview')!;
  expect(diff.parts[0].baseRevisionId).toBe(f.base.id);
  const promoted = f.c.exportHistory();
  expect(promoted.diagramRevisions).toEqual(before.diagramRevisions);
  expect(promoted.snapshots[original.proposed.checkpointId]).toEqual(before.snapshots[original.proposed.checkpointId]);
  f.c.canvasView(f.c.getSnapshot().version, { operation: 'promote-diffs', viewId });
  expect(f.c.exportHistory().headId).toBe(promoted.headId);
  expect(f.c.canvasViewComparison(viewId).proposed.checkpointId).toBe(promoted.canvasViews!.saved[viewId].finalCheckpointId);
  f.edit({ method: 'alternative-select', nodeId: 'grid:overview', alternativeId: diff.id, selected: true },
    { method: 'side-panel', nodeId: 'grid:overview', alternativeId: diff.id, partIndex: 0 });
  const s = f.c.getSnapshot();
  const inline = canvasDisplayNodes(s.document, s.canvas, s.version).find(node => node.id === 'grid:overview')!;
  const panel = projectSidePanels(s.document, resolveDiagramView(presentationScene(s.document)))[0];
  expect(panel.panel.display).toBe('diff');
  expect(panel.panel.attachment.nodeRef).toBe('root');
  expect(JSON.parse(JSON.stringify(inline.textRows), (key, value) => key === 'displayNodeId' ? undefined : value))
    .toEqual(JSON.parse(JSON.stringify(panel.rows), (key, value) => key === 'displayNodeId' ? undefined : value));
  const text = inline.textRows!.map(row => row.text).join('\n');
  expect(text).toContain('Child'); expect(text).toContain('Changed');
  expect(inline.textRows!.flatMap(row => row.runs).some(run => run.decoration?.backgroundColor === 'var(--diff-deleted-fill)')).toBe(true);
  expect(inline.collapsible.subtrees).toEqual([]);
  f.edit({ method: 'alternative-select', nodeId: 'grid:overview', alternativeId: diff.id, selected: false });
  const regular = f.c.getSnapshot();
  expect(canvasDisplayNodes(regular.document, regular.canvas, regular.version).find(node => node.id === 'grid:overview')!.textRows).toBeUndefined();
  f.c.canvasView(f.c.getSnapshot().version, { operation: 'apply', viewId });
  expect(Object.keys(f.c.getSnapshot().document.alternatives!.items)).toHaveLength(2);
  const history = f.c.exportHistory(); validateCanvasHistory(history);
  const restored = new MappingDocumentController(documentFromHistory(history), f.c.getSnapshot().canvas, 0, undefined, undefined, history);
  expect(restored.getSnapshot().document.alternatives).toEqual(f.c.getSnapshot().document.alternatives);
});
it('atomically swaps disjoint parts per placement, retains lineage and survives undo/reload', () => {
  const f = fixture();
  f.edit({ method: 'duplicate-instance', sourceNodeId: 'grid:overview', id: 'copy', position: { column: 60, row: 0 } });
  f.promote(true);
  expect(f.text()).toContain('Changed'); expect(f.text()).toContain('Alternative'); expect(f.text('grid:copy')).toBe(f.base.diagram.content.ascii);
  expect(f.c.getSnapshot().document.scene.contents.overview.revisionId).toBe(f.base.id);
  const history = f.c.exportHistory(); validateCanvasHistory(history);
  expect(history.diagramRevisions[f.next.id].parentId).toBe(f.base.id);
  const restored = new MappingDocumentController(documentFromHistory(history), f.c.getSnapshot().canvas, 0, undefined, undefined, history);
  restored.undo(); expect(restored.getSnapshot().document.alternatives?.items.group).toBeUndefined();
  restored.undo(true); expect(restored.getSnapshot().document.alternatives?.selected['grid:overview']).toEqual(['group']);
});
it('rejects overlapping parts and conflicting selected alternatives without committing', () => {
  const f = fixture(); f.promote(true); const before = f.c.exportHistory();
  expect(() => f.edit({ method: 'alternative-promote', nodeId: 'grid:overview', alternativeId: 'bad', name: 'bad', parts: [f.parts[0], f.parts[0]] })).toThrow('disjoint');
  expect(() => f.edit({ method: 'alternative-promote', nodeId: 'grid:overview', alternativeId: 'conflict', name: 'conflict', parts: [f.parts[0]], select: true })).toThrow('ALTERNATIVE_CONFLICT');
  expect(f.c.exportHistory()).toEqual(before);
});
it('persists alternatives and panels in CanvasViews and checkpoint records', () => {
  const f = fixture(); const viewId = f.c.canvasView(f.c.getSnapshot().version, { operation: 'start', name: 'Choices' }).recording!.id;
  f.promote(true); f.edit({ method: 'side-panel', nodeId: 'grid:overview', alternativeId: 'group', partIndex: 0, display: 'diff', placement: 'flow' });
  f.c.canvasView(f.c.getSnapshot().version, { operation: 'stop' });
  const saved = f.c.getSnapshot().document.alternatives;
  f.edit({ method: 'alternative-select', nodeId: 'grid:overview', alternativeId: 'group', selected: false });
  f.c.canvasView(f.c.getSnapshot().version, { operation: 'apply', viewId });
  expect(f.c.getSnapshot().document.alternatives).toEqual(saved);
  const history = f.c.exportHistory(), encoded = new CanvasCheckpointEncoder().encode(history.snapshots, true, history.headId);
  expect(restoreCanvasCheckpoints(encoded.checkpoints, encoded.items, encoded.head, true)).toEqual(history.snapshots);
  expect(canvasViewDiff(f.c.canvasViewComparison(viewId)).doc.proposed.document.scene.contents.overview.content.ascii).toContain('Changed');
});
it('chooses the least obstructed side and keeps panel content aligned with its live logical attachment', () => {
  const f = fixture(); f.promote();
  f.edit({ method: 'diagram-create', id: 'obstacle', ascii: 'Obstacle', position: { column: 25, row: 0 }, minimumSize: { columns: 50, rows: 15 } });
  f.edit({ method: 'side-panel', nodeId: 'grid:overview', alternativeId: 'group', partIndex: 0 });
  const projections = () => { const s = f.c.getSnapshot(); return projectSidePanels(s.document, resolveDiagramView(presentationScene(s.document), s.canvas.diagramViews), s.canvas.diagramViews); };
  const first = projections()[0]; expect(first.panel.side).toBe('left'); expect(first.bounds.row).toBe(first.anchor.row);
  f.edit({ method: 'move', nodeId: 'grid:overview', position: { column: 3, row: 20 } });
  expect(projections()[0].panel.side).toBe('left'); expect(projections()[0].bounds.row).toBe(21);
  const node = diagramContentNodes(f.base.diagram.content).find(n => n.label === 'Root')!;
  f.edit({ method: 'collapse', nodeId: 'grid:overview', contentNodeId: node.id, collapsed: true });
  expect(projections()).toEqual([]);
  expect(Object.keys(f.c.getSnapshot().document.alternatives!.panels)).toHaveLength(1);
});
it('flow reserves space while overlay leaves neighboring geometry unchanged', () => {
  const f = fixture(); f.promote();
  f.edit({ method: 'diagram-create', id: 'neighbor', ascii: 'Neighbor', position: { column: 30, row: 0 } });
  const col = () => flattenGrid(resolveDiagramView(presentationScene(f.c.getSnapshot().document))).find(n => n.box.id === 'neighbor')!.bounds.column;
  const before = col();
  f.edit({ method: 'side-panel', nodeId: 'grid:overview', alternativeId: 'group', partIndex: 0, side: 'right' }); expect(col()).toBe(before);
  f.edit({ method: 'side-panel', nodeId: 'grid:overview', alternativeId: 'group', partIndex: 0, placement: 'flow' }); expect(col()).toBeGreaterThan(before);
});
it('migration is deterministic across checkpoints, expands placements and does not promote ordinary history', () => {
  const f = fixture(); f.edit({ method: 'duplicate-instance', sourceNodeId: 'grid:overview', id: 'copy', position: { column: 60, row: 0 } });
  const input = { ...f.c.getSnapshot().document, revisionReviews: { review: { id: 'review', name: 'Legacy candidate', diagramId: f.base.diagramId, contentId: 'overview', ownerNodeId: 'root',
    baseRevisionId: f.base.id, headRevisionId: f.next.id, revisionIds: [f.next.id], decisions: {} } } };
  const a = migrateDiagramAlternatives(input, f.revisions.getRevision), b = migrateDiagramAlternatives(structuredClone(input), f.revisions.getRevision);
  expect(a).toEqual(b); expect(Object.values(a.alternatives!.items).map(i => i.presentationId).sort()).toEqual(['grid:copy', 'grid:overview']);
  expect(input).not.toHaveProperty('alternatives');
  const old = f.c.exportHistory(); old.diagramRevisions[f.next.id] = f.next;
  for (const snapshot of Object.values(old.snapshots)) snapshot.document.revisionReviews = input.revisionReviews;
  const migrated = migrateAlternativeHistory(old);
  expect(migrateAlternativeHistory(migrated)).toEqual(migrated); expect(migrated.diagramRevisions).toEqual(old.diagramRevisions);
  const keys = Object.values(migrated.snapshots).map(s => Object.keys(s.document.alternatives!.items).find(id => s.document.alternatives!.items[id].presentationId === 'grid:overview'));
  expect(new Set(keys).size).toBe(1);
  expect(migrateAlternativeHistory(f.c.exportHistory()).snapshots[f.c.exportHistory().headId].document.alternatives!.items).toEqual({});
});
it('right wins ties; connector intersections break otherwise equal placement scores', () => {
  const box = { column: 50, row: 0, columns: 10, rows: 5 }, size = { columns: 20, rows: 5 };
  expect(choosePanelSide(box, size, 0, [])).toBe('right');
  expect(choosePanelSide(box, size, 2, [], [{ from: { column: 63, row: 0 }, to: { column: 63, row: 10 } }])).toBe('left');
});
it('keeps a grouped choice dormant if a live edit removes any target', () => {
  const f = fixture(); f.promote(true);
  f.edit({ method: 'patchDiagram', nodeId: 'grid:overview', start: 4, end: 4, patch: '' });
  const current = f.revisions.getRevision(f.c.getSnapshot().document.scene.contents.overview.revisionId);
  const rows = projectSelectedDiagramRows(current, f.c.getSnapshot().document, 'grid:overview', f.revisions.getRevision);
  expect(rows.map(row => row.text).join('\n')).not.toContain('Changed');
  expect(() => f.edit({ method: 'alternative-select', nodeId: 'grid:overview', alternativeId: 'group', selected: true })).toThrow('STALE_ALTERNATIVE');
});
it('migrates an anonymous dormant nested choice without activating it at the root', () => {
  const f = fixture();
  const { revisionSelections, ...document } = f.c.getSnapshot().document;
  const selection = { contentId: 'overview', ownerNodeId: f.refs.Branch, contextRevisionId: f.next.id, revisionId: f.next.id };
  const migrated = migrateDiagramAlternatives({ ...document, revisionSelections: { [JSON.stringify(['overview', f.refs.Branch, f.next.id])]: selection } }, f.revisions.getRevision, { overview: f.base.id });
  expect(Object.values(migrated.alternatives!.items)).toHaveLength(2);
  expect(projectSelectedDiagramRows(f.base, migrated, 'grid:overview', f.revisions.getRevision).map(row => row.text).join('\n')).toBe(f.base.diagram.content.ascii);
});
it('CanvasView diff composes different selections of two placements independently', () => {
  const f = fixture(); f.edit({ method: 'duplicate-instance', sourceNodeId: 'grid:overview', id: 'copy', position: { column: 60, row: 0 } });
  const viewId = f.c.canvasView(f.c.getSnapshot().version, { operation: 'start', name: 'One placement' }).recording!.id;
  f.promote(true); f.c.canvasView(f.c.getSnapshot().version, { operation: 'stop' });
  const preview = canvasViewDiff(f.c.canvasViewComparison(viewId));
  const contents = preview.doc.proposed.document.scene.contents;
  expect(contents['placement:overview:overview'].content.ascii).toContain('Changed');
  expect(contents['placement:copy:overview'].content.ascii).toBe(f.base.diagram.content.ascii);
});
