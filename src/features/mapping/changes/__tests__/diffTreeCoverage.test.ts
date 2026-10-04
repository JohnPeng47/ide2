import { expect, it } from 'vitest';
import { RevisionedDiagramService } from '../../../../../domain/core/diagrams/diagramService';
import { diffTreeNodes, diffTreeSummary, writeDiffTree } from '../../../../../domain/mapping/changes/diffTree';
import { identifyHunk } from '../../../../../domain/core/diffs/gitDiffHunk';
import { diffTreeCoverage } from '../diffTreeCoverage';

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
  expect(coverage.nodesForHunk(hunks[0].id)).toHaveLength(2);
});
