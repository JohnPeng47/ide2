import { expect, it } from 'vitest';
import { buildDiagramContent, visibleContentLines } from '../diagramContent';
it('stores a revision-scoped tree and folds connector/blank lines without reparsing', () => {
  const content = buildDiagramContent('Root\n+-- Child\n|   `-- Leaf\n|\n`-- Peer', 'r1', 'tree');
  if (content.structure.kind !== 'tree') throw new Error('Expected tree');
  const child = Object.values(content.structure.nodes).find(node => node.label === 'Child')!;
  expect(visibleContentLines(content, [child.id])).toEqual([1,2,5]);
  expect(() => visibleContentLines(buildDiagramContent('Root\n`-- Changed', 'r2', 'tree'), [child.id])).toThrow('STALE');
});
