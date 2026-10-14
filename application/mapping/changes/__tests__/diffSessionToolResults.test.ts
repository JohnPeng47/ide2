import { expect, it } from 'vitest';
import { compactDiffSessionToolResult } from '../diffSessionToolResults';
const anchor = { id: '@anchor', label: 'Owner', line: 2, parentId: '@root', childIds: [], foldRanges: [], startColumn: 4, endColumn: 9 };
const evidence = { source: { id: 'source', label: 'Source', category: 'code', sourceRanges: [{ path: 'owner.ts', startLine: 1, endLine: 200, originalLines: ['large source payload'] }] } };
const node = { apiFormatVersion: 1, id: 'grid:owner', layout: 'grid', kind: 'diagram', version: 8,
  content: { ascii: 'App\n`-- Owner', revisionId: 'revision', structure: { kind: 'tree', rootIds: ['@root'], nodes: { '@anchor': anchor } } },
  collapsible: { subtrees: [anchor] }, diagram: { id: 'owner', sourceContext: { binding: { sourceId: 'source' }, mappings: ['mapping'], evidence } } };
it('keeps versions and node identities in mutation receipts without repeating the canvas', () => {
  const input = { value: { created: 'grid:new' }, transaction: { version: 9, nodes: [node] } };
  const result = compactDiffSessionToolResult('exec', input) as any;
  expect(result.value).toEqual(input.value);
  expect(result.transaction).toMatchObject({ version: 9, summary: true, nodes: [{ id: 'grid:owner', revisionId: 'revision', title: 'App' }] });
  expect(result.transaction.nodes[0]).not.toHaveProperty('content');
  expect(input.transaction.nodes[0]).toBe(node);
  expect(compactDiffSessionToolResult('draw_diagram', { version: 9, nodes: [node] })).toMatchObject({ version: 9, summary: true });
});
it('preserves ASCII and current anchors while omitting render indexes and captured source lines', () => {
  const result = compactDiffSessionToolResult('diagram-search', { nodes: [node] }) as any;
  expect(result.nodes[0].content.ascii).toBe(node.content.ascii);
  expect(result.nodes[0].content.structure.nodes['@anchor']).toMatchObject({ id: '@anchor', line: 2, parentId: '@root' });
  expect(result.nodes[0].diagram.sourceContext).toMatchObject({ binding: { sourceId: 'source' }, mappings: ['mapping'], originalLinesOmitted: true });
  expect(result.nodes[0].diagram.sourceContext.evidence.source.sourceRanges[0]).not.toHaveProperty('originalLines');
  expect(result.nodes[0]).not.toHaveProperty('collapsible');
  expect(node.diagram.sourceContext.evidence.source.sourceRanges[0].originalLines).toEqual(['large source payload']);
});
it('returns explicit source-evidence selections unchanged', () => {
  expect(compactDiffSessionToolResult('exec', { value: evidence })).toEqual({ value: evidence });
});
