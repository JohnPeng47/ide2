import { expect, it } from 'vitest';
import { RevisionedDiagramService } from '../../../../../domain/core/diagrams/diagramService';
import { diffTreeNodes, diffTreeSummary, writeDiffTree } from '../../../../../domain/mapping/changes/diffTree';
import { identifyHunk } from '../../../../../domain/core/diffs/gitDiffHunk';
import { diffTreeCoverage, diagramDiffTreeNodes } from '../diffTreeCoverage';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';

it('unions parent/child hunks once, excludes non-application code, and inherits explicit destinations', () => {
  const make = (path: string) => identifyHunk({ repositoryId: 'repo', commit: 'a'.repeat(40), parent: null, path, status: 'M', kind: 'text', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, patch: '@@ -1 +1 @@\n-old\n+new\n' });
  const hunks = [make('src/app.ts'), make('src/other.ts'), make('src/__tests__/app.test.ts'), make('package-lock.json')];
  const target = { representationId: 'canvas', displayNodeId: 'grid:overview', contentNodeId: 'editor' };
  const tree = writeDiffTree(new RevisionedDiagramService(), { ascii: 'Root\n|-- Parent\n|   |-- Child\n|   `-- Inherited\n`-- Unmapped', mappings: [
    { id: 'parent', source: { line: 2 }, targets: [hunks[0], hunks[2]].map(h => ({ kind: 'diff-hunk', hunkId: h.id })), diagramTargets: [target] },
    { id: 'child', source: { line: 3 }, targets: [hunks[0], hunks[1]].map(h => ({ kind: 'diff-hunk', hunkId: h.id })) }
  ] }, hunks);
  const coverage = diffTreeCoverage({ changeSessionId: 's', title: 'Review', status: 'draft', version: 0, hunks, total: 4, nextOffset: null, unmappedNodeIds: [],
    diffTree: { ...diffTreeSummary(tree), diagram: tree.revision.diagram, nodes: diffTreeNodes(tree), mappings: tree.mappings } });
  const node = (label: string) => diffTreeNodes(tree).find(n => n.label === label)!.id;
  expect(coverage.stats(coverage.hunksFor(node('Parent')))).toEqual({ lines: 4, total: 4, hunks: 2, percent: 100 });
  expect(coverage.stats(coverage.hunksFor(node('Inherited'))).lines).toBe(2);
  expect(coverage.hunksFor(node('Unmapped')).size).toBe(0);
  expect(coverage.targetsFor(node('Child'))).toEqual([target]);
  expect(coverage.targetsFor(node('Root'))).toEqual([target]);
  expect(coverage.outlineCollapsed).toEqual([node('Parent')]);
  expect(coverage.nodesForHunk(hunks[0].id)).toHaveLength(2);
});

it('keeps nested diagram destinations and unmapped outline sections visible', () => {
  const target = { representationId: 'canvas', displayNodeId: 'grid:detail' };
  const tree = writeDiffTree(new RevisionedDiagramService(), {
    ascii: 'Review\n|-- Section\n|   `-- Nested diagram\n|       `-- Code detail\n`-- Notes',
    mappings: [2, 3].map(line => ({ id: String(line), source: { line }, targets: [], diagramTargets: [target] }))
  }, []);
  const nodes = diffTreeNodes(tree);
  const coverage = diffTreeCoverage({ changeSessionId: 's', title: 'Review', status: 'draft', version: 0,
    hunks: [], total: 0, nextOffset: null, unmappedNodeIds: [],
    diffTree: { ...diffTreeSummary(tree), diagram: tree.revision.diagram, nodes, mappings: tree.mappings } });
  expect(coverage.outlineCollapsed).toEqual([nodes.find(n => n.label === 'Nested diagram')!.id]);
  expect(coverage.targetsFor(nodes[0].id)).toEqual([target]);
  expect(coverage.targetsFor(nodes.find(n => n.label === 'Notes')!.id)).toEqual([]);
});

it('reverses section mappings without confusing exact, enclosing, unrelated or stale destinations', () => {
  const service = new RevisionedDiagramService();
  const ascii = 'Diagram\n|-- Section\n|   |-- Exact\n|   `-- Inherited\n`-- Unmapped';
  const scene = singleDiagramScene(ascii);
  scene.contents = { ...scene.contents, overview: service.create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram };
  const raw = diagramContentNodes(scene.contents.overview.content);
  const content = (label: string) => raw.find(node => node.label === label)!.id;
  const destination = (label: string) => ({ representationId: 'saved-canvas', displayNodeId: 'grid:overview', contentNodeId: content(label) });
  const tree = writeDiffTree(service, { ascii: 'Review\n|-- Section implementation\n|-- Exact implementation\n|-- Design note\n`-- Invalid', mappings: [
    { id: 'section', source: { line: 2 }, targets: [], diagramTargets: [destination('Section')] },
    { id: 'exact', source: { line: 3 }, targets: [], diagramTargets: [destination('Exact'), destination('Exact')] },
    { id: 'design', source: { line: 4 }, targets: [], diagramTargets: [destination('Exact')] },
    { id: 'invalid', source: { line: 5 }, targets: [], diagramTargets: [
      { ...destination('Unmapped'), representationId: 'other-canvas' },
      { ...destination('Unmapped'), contentNodeId: 'stale' }
    ] }
  ] }, []);
  const nodes = diffTreeNodes(tree), node = (label: string) => nodes.find(node => node.label === label)!.id;
  const coverage = diffTreeCoverage({ changeSessionId: 's', title: 'Review', status: 'draft', version: 0,
    hunks: [], total: 0, nextOffset: null, unmappedNodeIds: [],
    diffTree: { ...diffTreeSummary(tree), diagram: tree.revision.diagram, nodes, mappings: tree.mappings } });
  const doc = { id: 'proposal-canvas', representationId: 'saved-canvas', name: 'Canvas', version: 0, baseline: null,
    proposed: { document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() } };
  const reverse = diagramDiffTreeNodes(doc, coverage);
  expect(reverse('grid:overview', content('Exact'))).toEqual([node('Exact implementation'), node('Design note')]);
  expect(reverse('grid:overview', content('Inherited'))).toEqual([node('Section implementation')]);
  expect(reverse('grid:overview', content('Unmapped'))).toEqual([]);
  expect(reverse('grid:overview', 'stale')).toEqual([]);
  expect(new Set(reverse('grid:overview', content('Diagram')))).toEqual(new Set([node('Section implementation'), node('Exact implementation'), node('Design note')]));
  coverage.destinations.set(node('Invalid'), [{ representationId: doc.id, displayNodeId: 'grid:overview' }]);
  expect(diagramDiffTreeNodes(doc, coverage)('grid:overview', content('Unmapped'))).toEqual([node('Invalid')]);
});
