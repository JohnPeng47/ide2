import { mutableFixture } from '../../../../tests/support/mappingDiagram';
import { expect, it } from 'vitest';
import { buildDiagramContent, type DiagramContent } from '../../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { RevisionedDiagramService } from '../../../core/diagrams/diagramService';
import { patchDiagram } from '../../../core/diagrams/patchDiagram';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../workspace/mappingDocument';
import { initialCanvasState } from '../../workspace/mappingWorkspace';
import { diffDiagramContent, type DiagramDiffSide } from '../diagramContentDiff';
import { diffChangeDocument } from '../changeDocumentDiff';
import { controllerBefore, controllerPatch, expectedAddedLabels, expectedUnchangedLabels } from './controllerDiffFixture';
import { floatingBefore, floatingAfter } from './floatingPaneDiffFixture';

const tree = (ascii: string, revision = 'new:1') => buildDiagramContent(ascii, revision, 'tree');
const node = (content: DiagramContent, label: string) => diagramContentNodes(content).find(n => n.label === label)!;
const decoration = (side: DiagramDiffSide, content: DiagramContent, label: string) => side.nodes.get(node(content, label).id);

it('recovers the renamed DisplayNodeBase inside an inserted FloatingPane', () => {
  const before = tree(floatingBefore, 'before'), after = tree(floatingAfter, 'after');
  const diff = diffDiagramContent(before, after);
  expect(diff.counts).toEqual({ added: 2, removed: 0, modified: 1, moved: 2 });
  expect(decoration(diff.proposed, after, 'DisplayNodeBase')).toEqual({ status: 'modified', moved: true, containsChanges: true });
  for (const label of ['expandedGeometry?', 'geometryPolicy', 'placement: automatic | manual', 'sizing: content | fixed']) {
    expect(decoration(diff.proposed, after, label), label).toBeUndefined();
  }
  expect(decoration(diff.proposed, after, 'FloatingPane')).toEqual({ status: 'added', containsChanges: true });
  expect(decoration(diff.proposed, after, 'SelectionRegion')).toEqual({ moved: true });
});

it('recovers several edited field labels without treating unrelated replacements as renames', () => {
  const before = tree('Root\n|-- placement: automatic | manual\n`-- sizing: content | fixed');
  const after = tree('Root\n|-- placement = automatic / manual\n`-- sizing = content / fixed');
  expect(diffDiagramContent(before, after).counts).toEqual({ added: 0, removed: 0, modified: 2, moved: 0 });
  expect(diffDiagramContent(tree('Root\n|-- A\n`-- B'), tree('Root\n|-- X\n`-- Y')).counts)
    .toEqual({ added: 2, removed: 2, modified: 0, moved: 0 });
});

it('highlights the expected text in the actual controller/session demo', () => {
  const before = new RevisionedDiagramService().create({ id: 'controller', revision: 0, ascii: controllerBefore, structureKind: 'tree' }).diagram;
  const patch = patchDiagram(before, 9, 23, controllerPatch);
  const after = patch.diagram.content;
  const diff = diffDiagramContent(before.content, after, Object.fromEntries([...patch.nodeIds].map(([a, b]) => [b, a])));
  for (const label of expectedAddedLabels) expect(decoration(diff.proposed, after, label)?.status, label).toBe('added');
  for (const label of expectedUnchangedLabels) expect(decoration(diff.proposed, after, label), label).toBeUndefined();
  expect(decoration(diff.proposed, after, 'AgentDiagrammingSessionService')).toEqual({ containsChanges: true });
  expect(decoration(diff.original, before.content, 'CanvasSessionBridge -> browser poll/reply')?.status).toBe('removed');
  expect([...diff.proposed.lines.keys()].map(line => after.ascii.split('\n')[line - 1])).toEqual([
    'Original / Proposed switches the preview snapshot.', 'Session edits persist without saving originals.', 'Acceptance into originals is a future step.'
  ]);
});

it('matches across revision IDs and colors only changed labels, with ancestor indicators', () => {
  const a = tree('Root\n|-- Original\n`-- Keep', 'old:0'), b = tree('Root\n|-- Proposed\n`-- Keep');
  const diff = diffDiagramContent(a, b);
  expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 1, moved: 0 });
  expect(decoration(diff.proposed, b, 'Proposed')).toEqual({ status: 'modified' });
  expect(decoration(diff.original, a, 'Original')).toEqual({ status: 'modified' });
  expect(decoration(diff.proposed, b, 'Root')).toEqual({ containsChanges: true });
  expect(decoration(diff.proposed, b, 'Keep')).toBeUndefined();
});

it('insertion shifts source lines without marking unchanged siblings as moved', () => {
  const a = tree('Root\n|-- A\n`-- B'), b = tree('Root\n|-- New\n|-- A\n`-- B');
  const diff = diffDiagramContent(a, b);
  expect(diff.counts).toEqual({ added: 1, removed: 0, modified: 0, moved: 0 });
  expect(decoration(diff.proposed, b, 'New')).toEqual({ status: 'added' });
  expect(decoration(diff.proposed, b, 'B')).toBeUndefined();
});

it('deletions appear on Original and mark the surviving parent on both versions', () => {
  const a = tree('Root\n|-- Branch\n|   `-- Gone\n`-- Keep'), b = tree('Root\n|-- Branch\n`-- Keep');
  const diff = diffDiagramContent(a, b);
  expect(diff.counts.removed).toBe(1);
  expect(decoration(diff.original, a, 'Gone')).toEqual({ status: 'removed' });
  expect(decoration(diff.proposed, b, 'Branch')).toEqual({ containsChanges: true });
});

it('identifies a moved subtree without marking its descendants as moved', () => {
  const a = tree('Root\n|-- A\n|   `-- Moving\n|       `-- Leaf\n`-- B');
  const b = tree('Root\n|-- A\n`-- B\n    `-- Moving\n        `-- Leaf');
  const diff = diffDiagramContent(a, b);
  expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 0, moved: 1 });
  expect(decoration(diff.proposed, b, 'Moving')).toEqual({ moved: true });
  expect(decoration(diff.proposed, b, 'Leaf')).toBeUndefined();
  expect(decoration(diff.proposed, b, 'A')?.containsChanges).toBe(true);
  expect(decoration(diff.proposed, b, 'B')?.containsChanges).toBe(true);
});

it('distinguishes sibling reordering from mere line shifts', () => {
  const a = tree('Root\n|-- A\n|-- B\n`-- C'), b = tree('Root\n|-- C\n|-- A\n`-- B');
  const diff = diffDiagramContent(a, b);
  expect(diff.counts.moved).toBe(1);
  expect(decoration(diff.proposed, b, 'C')?.moved).toBe(true);
});

it('does not invent matches when repeated labels lose an indistinguishable sibling', () => {
  const a = tree('Root\n|-- Same\n|-- Same\n`-- Keep'), b = tree('Root\n|-- Same\n`-- Keep');
  const diff = diffDiagramContent(a, b);
  expect(diff.counts).toEqual({ added: 1, removed: 2, modified: 0, moved: 0 });
});

it('preserves equal repeated siblings when another label changes', () => {
  const a = tree('Root\n|-- Same\n|-- Same\n`-- Old'), b = tree('Root\n|-- Same\n|-- Same\n`-- New');
  expect(diffDiagramContent(a, b).counts).toEqual({ added: 0, removed: 0, modified: 1, moved: 0 });
});

it('uses exact patch provenance to disambiguate surviving repeated nodes', () => {
  const original = new RevisionedDiagramService().create({ id: 'd', revision: 0, ascii: 'Root\n|-- Same\n|-- Same\n`-- Keep', structureKind: 'tree' }).diagram;
  const patched = patchDiagram(original, 2, 2, '');
  const origins = Object.fromEntries([...patched.nodeIds].map(([old, next]) => [next, old]));
  const diff = diffDiagramContent(original.content, patched.diagram.content, origins);
  expect(diff.counts).toEqual({ added: 0, removed: 1, modified: 0, moved: 0 });
});

it('compares cumulative edits against baseline and clears highlights on revert', () => {
  const original = new RevisionedDiagramService().create({ id: 'd', revision: 0, ascii: 'Root\n|-- A\n`-- B', structureKind: 'tree' }).diagram;
  const one = patchDiagram(original, 2, 2, '|-- X').diagram;
  const two = patchDiagram(one, 3, 3, '`-- Y').diagram;
  expect(diffDiagramContent(original.content, two.content).counts.modified).toBe(0); // multi-label gap is ambiguous
  expect(diffDiagramContent(original.content, two.content).counts.added).toBe(2);
  const partial = patchDiagram(two, 2, 2, '|-- A').diagram;
  expect(diffDiagramContent(original.content, partial.content).counts.modified).toBe(1);
  const reverted = patchDiagram(partial, 3, 3, '`-- B').diagram;
  expect(diffDiagramContent(original.content, reverted.content).proposed.nodes.size).toBe(0);
});

it('compares unparsed notes without leaking highlighting into another diagram', () => {
  // Legacy trees can have prose outside their structural node index.
  const prose = (ascii: string): DiagramContent => ({ ...tree(ascii), structure: { kind: 'tree', parserVersion: 'ascii-tree-1', rootIds: [], nodes: {} } });
  const a = prose('Unchanged note\nOld note\nFinal note'), b = prose('Unchanged note\nNew note\nFinal note');
  const diff = diffDiagramContent(a, b);
  expect([...diff.original.lines]).toEqual([[2, 'modified']]);
  expect([...diff.proposed.lines]).toEqual([[2, 'modified']]);
  const scene = singleDiagramScene(a.ascii);
  scene.contents = { overview: new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii: a.ascii }).diagram };
  scene.contents = { ...scene.contents, overview: { ...scene.contents.overview, content: a } };
  const baseline = { document: mappingDocumentFromScene(scene), canvas: initialCanvasState() };
  const proposed = structuredClone(baseline); proposed.document.scene.contents = { ...proposed.document.scene.contents, overview: { ...proposed.document.scene.contents.overview, content: b } };
  if (proposed.document.scene.root.kind !== 'container') throw Error();
  proposed.document.scene.root.children = [...proposed.document.scene.root.children,
    { id: 'added', kind: 'diagram', contentId: 'added', collapsed: false, position: { column: 40, row: 0 } }];
  proposed.document.scene.contents = { ...proposed.document.scene.contents,
    added: new RevisionedDiagramService().create({ id: 'added', revision: 0, ascii: 'Added\n`-- Child', structureKind: 'tree' }).diagram };
  const doc = { id: 'doc', name: 'Canvas', baseline, proposed, version: 1, past: [], future: [] };
  const both = diffChangeDocument(doc);
  expect(both.diagrams.get('grid:overview')?.proposed.lines.get(2)).toBe('modified');
  expect(both.diagrams.get('grid:added')?.counts.added).toBe(2);
  expect(both.counts).toEqual({ added: 2, removed: 0, modified: 1, moved: 0 });
});

it('marks every node in a new or removed diagram and supports a renamed parent with unchanged children', () => {
  const a = tree('Old parent\n`-- Child'), b = tree('New parent\n`-- Child');
  expect(diffDiagramContent(undefined, b).counts.added).toBe(2);
  expect(diffDiagramContent(a, undefined).counts.removed).toBe(2);
  const diff = diffDiagramContent(a, b);
  expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 1, moved: 0 });
});

it('shows independent modifications on two diagrams in the same canvas', () => {
  const scene = singleDiagramScene('First\n`-- Before');
  scene.contents = { overview: new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii: 'First\n`-- Before', structureKind: 'tree' }).diagram,
    second: new RevisionedDiagramService().create({ id: 'second', revision: 0, ascii: 'Second\n`-- Before', structureKind: 'tree' }).diagram };
  if (scene.root.kind !== 'container') throw Error();
  scene.root.children = [...scene.root.children, { id: 'second', kind: 'diagram', contentId: 'second', position: { column: 30, row: 0 }, collapsed: false }];
  const baseline = { document: mappingDocumentFromScene(scene), canvas: initialCanvasState() }, proposed = structuredClone(baseline);
  proposed.document.scene.contents = Object.fromEntries(Object.entries(scene.contents).map(([id, d]) => [id, patchDiagram(d, 2, 2, '`-- After').diagram]));
  const result = diffChangeDocument({ id: 'doc', name: 'Canvas', baseline, proposed, version: 1, past: [], future: [] });
  expect(result.counts.modified).toBe(2);
  expect(result.diagrams.get('grid:overview')?.counts.modified).toBe(1);
  expect(result.diagrams.get('grid:second')?.counts.modified).toBe(1);
});

it('flags folded unparsed notes and moving a node out of a removed parent', () => {
  const a = mutableFixture(tree('Root\n`-- Child\nOld note', 'old')), b = mutableFixture(tree('Root\n`-- Child\nNew note'));
  // Model a parser that leaves the final line as prose in Root's fold range.
  for (const c of [a, b]) if (c.structure.kind === 'tree') {
    c.structure.nodes = Object.fromEntries(Object.entries(c.structure.nodes).filter(([, n]) => n.line < 3));
    c.structure.nodes[node(c, 'Root').id].foldRanges = [{ startLine: 2, endLine: 3 }];
  }
  const result = diffDiagramContent(a, b);
  expect(result.proposed.lines.get(3)).toBe('modified');
  expect(decoration(result.proposed, b, 'Root')?.containsChanges).toBe(true);
  const moved = diffDiagramContent(tree('Removed parent\n`-- Surviving\n    `-- Grandchild'), tree('Surviving\n`-- Grandchild'));
  expect(moved.counts).toEqual({ added: 0, removed: 1, modified: 0, moved: 1 });
});
