import { expect, it } from 'vitest';
import { RevisionedDiagramService } from '../../../core/diagrams/diagramService';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { identifyHunk } from '../../../core/diffs/gitDiffHunk';
import { initialCanvasState } from '../../workspace/mappingWorkspace';
import { buildChangeTreemaps, hunkLoc, type ChangeTreemapNode } from '../changeTreemap';
import { writeDiffTree, type DiffTreeInput } from '../diffTree';
import type { ChangePreviewDocument } from '../diagramChangeSession';

const service = new RevisionedDiagramService();
const hunk = (path: string, commit = 'a'.repeat(40)) => identifyHunk({ repositoryId: 'repo', commit, parent: 'b'.repeat(40), path,
  status: 'M', kind: 'text', oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, patch: '@@ -1,2 +1,2 @@\n context\n-old\n+new\n\\ No newline at end of file\n' });
const hunks = [hunk('src/app.ts'), hunk('tests/app.test.ts'), hunk('README.md')];
function document(id = 'doc'): ChangePreviewDocument {
  const scene = singleDiagramScene('Root\n|-- Parent\n|   `-- Leaf\n`-- Sibling');
  scene.contents = { ...scene.contents, overview: service.create({ id: 'overview', revision: 0, ascii: scene.contents.overview.content.ascii, structureKind: 'tree' }).diagram };
  return { id, representationId: `saved-${id}`, name: id, version: 0, baseline: null,
    proposed: { document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() } };
}
const target = (doc: ChangePreviewDocument, label?: string) => ({ representationId: doc.representationId!, displayNodeId: 'grid:overview',
  ...(label ? { contentNodeId: diagramContentNodes(doc.proposed.document.scene.contents.overview.content).find(n => n.label === label)!.id } : {}) });
const mapping = (id: string, doc: ChangePreviewDocument, label: string | undefined, indices: number[]): DiffTreeInput['mappings'][number] => ({
  id, source: { line: 1 }, targets: indices.map(i => ({ kind: 'diff-hunk', hunkId: hunks[i].id })), diagramTargets: [target(doc, label)] });
const flatten = (root: ChangeTreemapNode): ChangeTreemapNode[] => [root, ...root.children.flatMap(flatten)];

it('counts additions and deletions, including blank changed lines but excluding context and markers', () => {
  expect(hunkLoc(hunks[0])).toEqual({ added: 1, deleted: 1, value: 2 });
  expect(hunkLoc({ ...hunks[0], patch: '@@ -1 +1 @@\n-\n+\n context\n\\ No newline at end of file\n' }).value).toBe(2);
  expect(hunkLoc({ ...hunks[0], kind: 'binary', patch: '+not a text hunk' }).value).toBe(0);
});
it('uses all captured files and counts repeat edits in different commits independently', () => {
  const tree = writeDiffTree(service, { ascii: 'Changes', mappings: [] }, [...hunks, hunk('src/app.ts', 'c'.repeat(40))]);
  const result = buildChangeTreemaps(tree, []);
  expect(result).toMatchObject({ actual: 8, mapped: 0, covered: 0, extra: 0, unmapped: 8 });
  expect(result.diagrams.children).toHaveLength(1);
  expect(result.diagrams.children[0]).toMatchObject({ kind: 'unmapped', value: 8 });
  expect(flatten(result.files).find(n => n.label === 'app.ts')?.value).toBe(4);
  expect(flatten(result.files).find(n => n.label === 'app.test.ts')?.value).toBe(2);
});
it('splits hunks globally across distinct destinations without counting parent subtotals or duplicate links', () => {
  const doc = document(), other = document('other');
  const tree = writeDiffTree(service, { ascii: 'Changes\n|-- Parent mapping\n|-- Leaf mapping\n`-- Other mapping', mappings: [
    { ...mapping('parent', doc, 'Parent', [0, 1, 2]), source: { line: 2 } },
    { ...mapping('leaf', doc, 'Leaf', [0]), source: { line: 3 } },
    { ...mapping('duplicate', doc, 'Leaf', [0]), source: { line: 3 } },
    { ...mapping('other', other, 'Sibling', [0]), source: { line: 4 } }
  ] }, hunks);
  const result = buildChangeTreemaps(tree, [doc, other]);
  expect(result).toMatchObject({ actual: 6, mapped: 6, rawMapped: 10, covered: 6, unmapped: 0, extra: 4 });
  expect(result.diagrams.label).toBe('All canvases');
  expect(result.diagrams.children.map(n => n.kind)).toEqual(['canvas', 'canvas']);
  const canvases = result.diagrams.children;
  expect(canvases.map(n => n.label)).toEqual(['doc', 'other']);
  expect(canvases[0].value).toBeCloseTo(6 - 2 / 3);
  expect(canvases[1].value).toBeCloseTo(2 / 3);
  expect(canvases.flatMap(n => n.children).every(n => n.kind === 'diagram')).toBe(true);
  expect(canvases[1].target).toEqual({ representationId: other.id });
  const parent = flatten(result.diagrams).find(n => n.label === 'Parent')!;
  expect(parent.value).toBeCloseTo(4 + 4 / 3);
  expect(parent.children.find(n => n.kind === 'direct')?.value).toBeCloseTo(4 + 2 / 3);
  const leaf = parent.children.find(n => n.label === 'Leaf')!;
  expect(leaf.value).toBeCloseTo(2 / 3);
  expect(leaf.added).toBeCloseTo(1 / 3);
  expect(leaf.deleted).toBeCloseTo(1 / 3);
  expect(leaf.allocation).toEqual({ rawLoc: 2, sharedLoc: 2, minDestinations: 3, maxDestinations: 3 });
  expect(flatten(result.diagrams).find(n => n.label === 'Sibling')?.value).toBeCloseTo(2 / 3);
  expect(result.diagrams.value).toBeCloseTo(result.files.value);
  expect(parent.hunkIds).toHaveLength(3);
});
it('keeps unmapped area so both maps total actual LOC while reporting discounted duplication', () => {
  const doc = document();
  const tree = writeDiffTree(service, { ascii: 'Changes\n|-- One\n`-- Two', mappings: [
    { ...mapping('one', doc, 'Parent', [0, 1]), source: { line: 2 } },
    { ...mapping('two', doc, 'Leaf', [0]), source: { line: 3 } }
  ] }, hunks);
  const result = buildChangeTreemaps(tree, [doc]);
  expect(result).toMatchObject({ actual: 6, mapped: 4, rawMapped: 6, covered: 4, unmapped: 2, extra: 2, unmappedHunkIds: [hunks[2].id] });
  expect(result.diagrams.value).toBe(6);
  expect(result.diagrams.children.find(n => n.kind === 'unmapped')).toMatchObject({ value: 2, added: 1, deleted: 1, hunkIds: [hunks[2].id], children: [] });
});
it('inherits diagram destinations through DiffTree headings without spreading parent area to leaves', () => {
  const doc = document();
  const tree = writeDiffTree(service, { ascii: 'Changes\n`-- Implementation', mappings: [
    { ...mapping('destination', doc, undefined, []), source: { line: 1 } },
    { id: 'hunks', source: { line: 2 }, targets: [{ kind: 'diff-hunk', hunkId: hunks[0].id }] }
  ] }, hunks);
  const result = buildChangeTreemaps(tree, [doc]);
  expect(flatten(result.diagrams).find(n => n.kind === 'diagram')).toMatchObject({ kind: 'diagram', value: 2, children: [] });
  expect(result.unmapped).toBe(4);
});
it('retains baseline destinations without guessing new anchors; unknown targets remain unmapped', () => {
  const doc = document(), old = target(doc, 'Leaf');
  doc.baseline = doc.proposed;
  const scene = singleDiagramScene('Replacement');
  doc.proposed = { document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() };
  const tree = writeDiffTree(service, { ascii: 'Changes\n|-- Removed\n`-- Unknown', mappings: [
    { id: 'removed', source: { line: 2 }, targets: [{ kind: 'diff-hunk', hunkId: hunks[0].id }], diagramTargets: [old] },
    { id: 'stale', source: { line: 3 }, targets: [{ kind: 'diff-hunk', hunkId: hunks[1].id }], diagramTargets: [{ ...old, contentNodeId: 'unknown' }] }
  ] }, hunks);
  const result = buildChangeTreemaps(tree, [doc]);
  expect(flatten(result.diagrams).find(n => n.label === 'Leaf')).toMatchObject({ previous: true, value: 2 });
  expect(result).toMatchObject({ mapped: 2, unmapped: 4, unresolvedTargets: 1 });
});
it('has truthful empty and non-text states without inventing LOC', () => {
  expect(buildChangeTreemaps(undefined, [document()])).toMatchObject({ actual: 0, mapped: 0, extra: 0, files: { children: [] }, diagrams: { children: [] } });
  const binary = { ...hunks[0], kind: 'binary' as const };
  const tree = writeDiffTree(service, { ascii: 'Changes', mappings: [] }, [binary]);
  expect(buildChangeTreemaps(tree, [])).toMatchObject({ actual: 0, nonTextHunks: 1, files: { hunkIds: [binary.id], children: [] } });
});
