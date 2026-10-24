import { expect, it } from 'vitest';
import { revisionFixture } from '../../../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { boxesOverlap } from '../../../../../domain/core/diagrams/lineGrid';
import { diffDiagramContent } from '../../../../../domain/core/diagrams/diagramContentDiff';
import { projectDiagramComparisons, layoutDiagramComparisons } from '../../../../../domain/mapping/workspace/diagramDiffProjection';
import { ChangePreviewState } from '../changePreviewState';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';

function fixture(before: string, after: string, kind: 'tree' | 'diagram' = 'tree') {
  const old = revisionFixture().create({ id: 'overview', revision: 0, ascii: before, structureKind: kind }).diagram;
  const next = revisionFixture().create({ id: 'overview', revision: 1, ascii: after, structureKind: kind }).diagram;
  const scene = singleDiagramScene(after);
  scene.contents = { ...scene.contents, overview: next };
  const diffs = new Map([['grid:overview', diffDiagramContent(old.content, next.content)]]);
  return { old, next, scene, diffs, enabled: new Set(['grid:overview']) };
}

it('shows previous/current rows in order, with only current labels owning anchors', () => {
  const f = fixture('Root\n|-- Old label\n`-- Keep', 'Root\n|-- New label\n`-- Keep');
  const snapshot = structuredClone(f);
  const result = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled);
  const local = result.projections.get('grid:overview')!;
  expect(local.rows.map(row => row.text)).toEqual(['Root', '|-- [-] Old label', '|   [+] New label', '`-- Keep']);
  expect(local.rowForLine.get(2)).toBe(2);
  expect(local.rowForLine.get(3)).toBe(3);
  const run = local.rows.flatMap(row => row.runs).find(run => run.text === 'New label')!;
  expect(local.prefixRowForNode.get(run.owner!.contentNodeId!)).toBe(1);
  expect(run.owner?.contentNodeId).toBe(diagramContentNodes(f.next.content).find(node => node.label === 'New label')!.id);
  expect(run.start - run.owner!.columnOffset + 1).toBe(5);
  expect(run.end - run.owner!.columnOffset).toBe(13);
  expect(local.rows[1].runs.every(run => !run.owner)).toBe(true);
  expect(f).toEqual(snapshot);
});

it('reserves the longer old label width and reflows neighboring boxes without changing the document', () => {
  const f = fixture('Root\n`-- A very long previous label', 'Root\n`-- Short');
  if (f.scene.root.kind !== 'container') throw Error();
  f.scene.contents = { ...f.scene.contents, other: revisionFixture().create({ id: 'other', revision: 0, ascii: 'Neighbor' }).diagram };
  f.scene.root = { ...f.scene.root, children: [...f.scene.root.children,
    { kind: 'diagram', id: 'other', contentId: 'other', collapsed: false, position: { column: 15, row: 0 } }] };
  const snapshot = structuredClone(f.scene);
  const result = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled);
  const first = result.boxes.find(box => box.box.id === 'overview')!.bounds;
  const second = result.boxes.find(box => box.box.id === 'other')!.bounds;
  expect(boxesOverlap(first, second)).toBe(false);
  expect(second.column).toBeGreaterThan(15);
  expect(first.columns).toBeGreaterThanOrEqual('    [-] A very long previous label'.length);
  expect(f.scene).toEqual(snapshot);
});

it('renders edits on both columns of one row without duplicating unchanged nodes or losing source columns', () => {
  const f = fixture('Left    Right\n|-- OldLeft    |-- OldRight\n`-- KeepL      `-- KeepR',
    'Left    Right\n|-- NewLeft    |-- NewRight\n`-- KeepL      `-- KeepR', 'diagram');
  expect(f.diffs.get('grid:overview')!.counts.modified).toBe(2);
  const result = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled);
  const local = result.projections.get('grid:overview')!;
  expect(local.rows[1].text).toContain('[-] OldLeft');
  expect(local.rows[1].text).toContain('[-] OldRight');
  expect(local.rows[2].text).toContain('[+] NewLeft');
  expect(local.rows[2].text).toContain('[+] NewRight');
  for (const label of ['NewLeft', 'NewRight', 'KeepL', 'KeepR']) {
    const node = diagramContentNodes(f.next.content).find(node => node.label === label)!;
    const runs = local.rows.flatMap(row => row.runs).filter(run => run.owner?.contentNodeId === node.id);
    expect(runs.map(run => run.text).join('')).toBe(label);
    expect(runs[0].start - runs[0].owner!.columnOffset + 1).toBe(node.startColumn);
  }
});

it('hides both versions beneath collapsed ancestors and restores the original source-line mapping', () => {
  const f = fixture('Root\n|-- Parent\n|   `-- Old\n`-- Keep', 'Root\n|-- Parent\n|   `-- New\n`-- Keep');
  const parent = diagramContentNodes(f.next.content).find(node => node.label === 'Parent')!;
  const views = { 'grid:overview': { contentRevisionId: f.next.content.revisionId, collapsedContentNodeIds: [parent.id] } };
  const folded = projectDiagramComparisons(f.scene, views, f.diffs, f.enabled).projections.get('grid:overview')!;
  expect(folded.rows.map(row => row.text)).toEqual(['Root', '|-- Parent', '`-- Keep']);
  expect(folded.rowForLine.has(3)).toBe(false);
  expect(folded.rowForLine.get(4)).toBe(2);
  const expanded = projectDiagramComparisons(f.scene, {}, f.diffs, f.enabled).projections.get('grid:overview')!;
  expect(expanded.rowForLine.get(3)).toBe(3);
  expect(expanded.rowForLine.get(4)).toBe(4);
});

it('uses occurrence matches for repeated labels under different parents', () => {
  const f = fixture('Root\n|-- A\n|   `-- Old\n`-- B\n    `-- Old', 'Root\n|-- A\n|   `-- New\n`-- B\n    `-- Old');
  const result = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled);
  const rows = result.projections.get('grid:overview')!.rows;
  expect(rows.filter(row => row.text.includes('[-] Old'))).toHaveLength(1);
  expect(rows.filter(row => row.text.includes('[+] New'))).toHaveLength(1);
  expect(rows.at(-1)!.text).toBe('    `-- Old');
});

it('shows paired loose-text edits and leaves additions and excluded diagram types alone', () => {
  const f = fixture('Root\n`-- Keep\n\nOld note', 'Root\n`-- Keep\n\nNew note');
  const pair = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled);
  expect(pair.projections.get('grid:overview')!.rows.slice(-2).map(row => row.text)).toEqual(['[-] Old note', '[+] New note']);
  const excluded = projectDiagramComparisons(f.scene, undefined, f.diffs, new Set());
  expect(excluded.projections.get('grid:overview')!.ascii).toBe(f.next.content.ascii);
  const additions = fixture('Root\n`-- Keep', 'Root\n|-- Added\n`-- Keep');
  expect(projectDiagramComparisons(additions.scene, undefined, additions.diffs, additions.enabled).projections.get('grid:overview')!.ascii)
    .toBe(additions.next.content.ascii);
});

it('keeps per-instance folds separate when two boxes share content', () => {
  const f = fixture('Root\n`-- Old', 'Root\n`-- New');
  if (f.scene.root.kind !== 'container') throw Error();
  f.scene.root = { ...f.scene.root, children: [...f.scene.root.children,
    { ...f.scene.root.children[0], id: 'copy', position: { column: 30, row: 0 } }] };
  f.diffs.set('grid:copy', f.diffs.get('grid:overview')!); f.enabled.add('grid:copy');
  const root = diagramContentNodes(f.next.content).find(node => node.label === 'Root')!;
  const result = projectDiagramComparisons(f.scene, { 'grid:copy': { contentRevisionId: f.next.content.revisionId, collapsedContentNodeIds: [root.id] } }, f.diffs, f.enabled);
  expect(result.projections.get('grid:overview')!.rows).toHaveLength(3);
  expect(result.projections.get('grid:copy')!.rows).toHaveLength(1);
});

it('inserts deleted rows alongside edits without giving them live anchors', () => {
  const f = fixture('Root\n|-- Gone\n|-- Keep\n`-- Old label', 'Root\n|-- Keep\n`-- New label');
  const snapshot = structuredClone(f);
  const local = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled).projections.get('grid:overview')!;
  expect(local.rows.map(row => row.text)).toEqual(['Root', '|-- Gone', '|-- Keep', '`-- [-] Old label', '    [+] New label']);
  expect(local.rows[1].runs).toEqual([
    { start: 0, end: 4, text: '|-- ', mappings: [] },
    { start: 4, end: 8, text: 'Gone', mappings: [], diffStatus: 'removed' }
  ]);
  expect(local.rowForLine.get(2)).toBe(2);
  expect(local.rowForLine.get(3)).toBe(4);
  expect(local.rows.flatMap(row => row.runs).filter(run => run.owner?.contentNodeId).map(run => run.text)).not.toContain('Gone');
  expect(f).toEqual(snapshot);
});

it('keeps deleted final children inside their surviving branch and hides them when folded', () => {
  const f = fixture('Root\n|-- Parent\n|   |-- Keep\n|   `-- Gone\n`-- Sibling', 'Root\n|-- Parent\n|   `-- Keep\n`-- Sibling');
  const local = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled).projections.get('grid:overview')!;
  expect(local.rows.map(row => row.text)).toEqual(['Root', '|-- Parent', '|   `-- Keep', '|   `-- Gone', '`-- Sibling']);
  const parent = diagramContentNodes(f.next.content).find(node => node.label === 'Parent')!;
  const views = { 'grid:overview': { contentRevisionId: f.next.content.revisionId, collapsedContentNodeIds: [parent.id] } };
  const folded = projectDiagramComparisons(f.scene, views, f.diffs, f.enabled).projections.get('grid:overview')!;
  expect(folded.rows.map(row => row.text)).toEqual(['Root', '|-- Parent', '`-- Sibling']);
  expect(folded.rowForLine.get(4)).toBe(2);
});

it('shows removed subtrees and loose text, including end-of-document deletions', () => {
  const f = fixture('Root\n|-- Gone\n|   `-- Child\n`-- Keep\n\nDeleted note', 'Root\n`-- Keep');
  const local = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled).projections.get('grid:overview')!;
  expect(local.rows.map(row => row.text)).toEqual(['Root', '|-- Gone', '|   `-- Child', '`-- Keep', 'Deleted note']);
  expect(local.rows.filter(row => row.runs.some(run => run.diffStatus === 'removed'))).toHaveLength(3);
  const excluded = projectDiagramComparisons(f.scene, undefined, f.diffs, new Set()).projections.get('grid:overview')!;
  expect(excluded.ascii).toBe(f.next.content.ascii);
});

it('does not repeat surviving labels when only one column is removed', () => {
  const f = fixture('Left    Right\n|-- Gone      |-- Keep\n`-- EndL      `-- EndR', 'Left    Right\n              |-- Keep\n`-- EndL      `-- EndR', 'diagram');
  const local = projectDiagramComparisons(f.scene, undefined, f.diffs, f.enabled).projections.get('grid:overview')!;
  expect(local.rows.filter(row => row.text.includes('Keep'))).toHaveLength(1);
  expect(local.rows.filter(row => row.text.includes('Gone'))).toHaveLength(1);
  expect(local.rows.find(row => row.text.includes('Gone'))!.runs.filter(run => run.diffStatus === 'removed').map(run => run.text)).toEqual(['Gone']);
});

it('lays out expanded diff bounds before freezing, then keeps positions stable through folds', () => {
  const f = fixture('Root\n`-- A very long previous label', 'Root\n`-- Short');
  if (f.scene.root.kind !== 'container') throw Error();
  const service = revisionFixture();
  f.scene.contents = { ...f.scene.contents,
    other: service.create({ id: 'other', revision: 0, ascii: 'Neighbor' }).diagram,
    below: service.create({ id: 'below', revision: 0, ascii: 'Below' }).diagram };
  f.scene.root = { ...f.scene.root, collapsed: true, collapsedContentId: 'overview-summary', position: { column: 9, row: 4 }, children: [...f.scene.root.children,
    { kind: 'diagram', id: 'other', contentId: 'other', collapsed: false, position: { column: 15, row: 0 } },
    { kind: 'diagram', id: 'below', contentId: 'below', collapsed: false, position: { column: 0, row: 2 } }] };
  const snapshot = structuredClone(f.scene);
  const scene = layoutDiagramComparisons(f.scene, f.diffs, f.enabled);
  expect(layoutDiagramComparisons(f.scene, f.diffs, f.enabled)).toEqual(scene);
  const preview = new ChangePreviewState({ document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() }, 0);
  const text = () => projectDiagramComparisons(preview.getSnapshot().document.scene, preview.getSnapshot().canvas.diagramViews, f.diffs, f.enabled, [], new Map(), true);
  const result = text(), diagrams = result.boxes.filter(box => box.box.kind === 'diagram');
  for (let i = 0; i < diagrams.length; i++) for (const other of diagrams.slice(i + 1))
    expect(boxesOverlap(diagrams[i].bounds, other.bounds)).toBe(false);
  expect(diagrams.find(box => box.box.id === 'overview')!.bounds).toMatchObject({ column: 9, row: 4 });
  expect(diagrams.find(box => box.box.id === 'other')!.bounds.column).toBeGreaterThan(24);
  expect(diagrams.find(box => box.box.id === 'below')!.bounds.column).toBeGreaterThan(9);
  expect(result.projections.get('grid:overview')!.ascii).toContain('A very long previous label');
  const positions = result.boxes.map(box => ({ id: box.box.id, bounds: box.bounds }));
  const root = diagramContentNodes(f.next.content)[0];
  preview.collapse('grid:overview', root.id, true);
  expect(text().projections.get('grid:overview')!.ascii).toBe('Root');
  expect(text().boxes.map(box => ({ id: box.box.id, bounds: box.bounds }))).toEqual(positions);
  preview.collapse('grid:overview', root.id, false);
  expect(text().boxes.map(box => ({ id: box.box.id, bounds: box.bounds }))).toEqual(positions);
  expect(Object.isFrozen(preview.getSnapshot().document.scene.root)).toBe(true);
  expect(f.scene).toEqual(snapshot);
});
