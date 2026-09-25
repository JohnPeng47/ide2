import { expect, it } from 'vitest';
import { buildDiagramContent } from '../../../core/diagrams/diagramContent';
import { DiagramSearchIndex, type SearchPlacement } from '../diagramSearch';

const placement = (id: string, contentKey: string, scope: SearchPlacement['scope'] = 'project'): SearchPlacement => ({
  canvasDocumentId: id, canvasName: id, diagramId: 'diagram', displayNodeId: 'grid:diagram', diagramName: 'Root', contentKey, scope
});
const query = { text: 'needle', caseSensitive: false, scope: { kind: 'global' as const } };

it('returns raw line coordinates and revision-scoped nodes, with all matches on one line', () => {
  const index = new DiagramSearchIndex(), content = buildDiagramContent('Root\n|-- Needle needle\n`-- Other', 'revision', 'tree');
  index.update({ generation: 1, upsert: [{ key: 'content', content }], remove: [], placements: [placement('canvas', 'content')] });
  const results = [...index.search(query)].flatMap(batch => batch.results);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ line: 2, text: '|-- Needle needle', revisionId: content.revisionId, asciiSha256: content.asciiSha256,
    matches: [{ startColumn: 5, endColumn: 10 }, { startColumn: 12, endColumn: 17 }] });
  expect(results[0].contentNodes).toHaveLength(1);
  expect(results[0].matches.every(match => match.contentNodeIds[0] === results[0].contentNodes[0].id)).toBe(true);
  expect([...index.search({ ...query, caseSensitive: true })][0].results[0].matches).toHaveLength(1);
});

it('keeps proposal scope isolated and returns shared content separately for every placement', () => {
  const index = new DiagramSearchIndex(), content = buildDiagramContent('needle', 'r');
  index.update({ generation: 1, upsert: [{ key: 'shared', content }], remove: [], placements: [
    placement('a', 'shared'), { ...placement('a', 'shared'), displayNodeId: 'grid:second' }, placement('b', 'shared'), placement('proposal', 'shared', 'proposal')
  ] });
  expect([...index.search(query)].flatMap(batch => batch.results)).toHaveLength(3);
  expect([...index.search({ ...query, scope: { kind: 'canvas', documentId: 'a' } })].flatMap(batch => batch.results)).toHaveLength(2);
  expect([...index.search({ ...query, scope: { kind: 'canvas', documentId: 'proposal' } })][0].results[0].canvasDocumentId).toBe('proposal');
});

it('keeps whitespace-only matches without inventing node IDs and treats regex characters literally', () => {
  const index = new DiagramSearchIndex(), content = buildDiagramContent('Root\n   \n`-- [a.*]', 'r', 'tree');
  index.update({ generation: 1, upsert: [{ key: 'content', content }], remove: [], placements: [placement('a', 'content')] });
  const whitespace = [...index.search({ ...query, text: '   ' })][0].results[0];
  expect(whitespace.line).toBe(2); expect(whitespace.contentNodes).toEqual([]); expect(whitespace.matches[0].contentNodeIds).toEqual([]);
  expect([...index.search({ ...query, text: '[a.*]' })][0].results[0].line).toBe(3);
  expect([...index.search({ ...query, text: '' })][0].results).toEqual([]);
});

it('removes superseded content and yields during scans with no matches', () => {
  const index = new DiagramSearchIndex();
  index.update({ generation: 1, upsert: [{ key: 'old', content: buildDiagramContent('needle', 'old') }], remove: [], placements: [placement('a', 'old')] });
  index.update({ generation: 2, upsert: [{ key: 'new', content: buildDiagramContent(Array(600).fill('other').join('\n'), 'new') }], remove: ['old'], placements: [placement('a', 'new')] });
  const batches = [...index.search(query)];
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.flatMap(batch => batch.results)).toEqual([]);
  expect(batches.at(-1)?.done).toBe(true);
});

it('reports truncation only when additional matching lines exist', () => {
  const index = new DiagramSearchIndex();
  index.update({ generation: 1, upsert: [{ key: 'a', content: buildDiagramContent('needle\nneedle\nneedle', 'r') }], remove: [], placements: [placement('a', 'a')] });
  expect([...index.search(query, 2)].at(-1)).toMatchObject({ done: true, truncated: true });
  expect([...index.search(query, 3)].at(-1)).toMatchObject({ done: true, truncated: false });
});
