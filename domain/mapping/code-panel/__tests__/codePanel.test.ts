import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256 } from '../../../core/sha256';
import { asciiSha256 } from '../../../core/diagrams/asciiSha256';
import { RevisionedDiagramService } from '../../../core/diagrams/diagramService';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { handleNodeSelect, buildSourceRangeDisplayModel, type ResolvedMapping } from '../codePanel';

function fixture() {
  const diagram = new RevisionedDiagramService().create({ id: 'diagram', revision: 1, ascii: 'Root\n|-- Parent\n|   |-- Child\n|   `-- Sibling\n`-- Other', structureKind: 'tree' }).diagram;
  const context = { diagram, projectId: 'project' };
  const service = new RevisionedDiagramService();
  const nodes = diagramContentNodes(diagram.content);
  const mapped = (line: number, startLine: number, endLine = startLine) => {
    const node = nodes.find(node => node.line === line)!;
    const id = `mapping-${line}-${startLine}`;
    const evidence = { id, handle: id, label: node.label, category: 'operation' as const, summary: '',
      sourceRanges: [{ id, path: 'a.ts', startLine, endLine, originalLines: Array.from({length: endLine - startLine + 1}, () => 'source') }] };
    context.diagram = service.revise(context.diagram.revisionId, { kind: 'source-mappings', expectedContentHash: diagram.content.asciiSha256,
      evidence: { ...context.diagram.sourceContext.evidence, [id]: evidence },
      mappings: [...context.diagram.sourceContext.mappings, { id, entityId: id, sourceRangeIndex: 0, line, startColumn: node.startColumn, endColumn: node.endColumn }] }).diagram;
  };
  return { context, nodes, mapped };
}
it('prefers direct mappings and stops at the nearest mapped ancestor', () => {
  const { context, nodes, mapped } = fixture(); mapped(1, 1); mapped(2, 10); mapped(3, 30);
  const panel = handleNodeSelect(context, [nodes[2], nodes[3]]);
  expect(panel.items.map(item => item.resource.target.startLine)).toEqual([30, 10]);
  expect(panel.items[1].origins[0]).toMatchObject({ selectedNodeId: nodes[3].id, mappedNodeId: nodes[1].id });
});
it('combines shared ancestors once while retaining all selected-node provenance', () => {
  const { context, nodes, mapped } = fixture(); mapped(2, 10); mapped(2, 20);
  const panel = handleNodeSelect(context, [nodes[2], nodes[3], nodes[3]]);
  expect(panel.selectedNodeIds).toHaveLength(2); expect(panel.items).toHaveLength(2);
  expect(panel.items[0].origins.map(origin => origin.selectedNodeId)).toEqual([nodes[2].id, nodes[3].id]);
});
it('reports unmapped nodes and rejects nodes from another revision', () => {
  const { context, nodes } = fixture();
  expect(handleNodeSelect(context, [nodes[0]]).unmappedNodeIds).toEqual([nodes[0].id]);
  expect(() => handleNodeSelect(context, [{ ...nodes[0], id: 'stale' }])).toThrow(/revision/);
  context.diagram = { ...context.diagram, sourceContext: { ...context.diagram.sourceContext, contentHash: 'stale' } };
  expect(() => handleNodeSelect(context, [nodes[0]])).toThrow(/stale/);
});
it('merges overlapping presentation ranges without merging disjoint ranges or losing mappings', () => {
  const { context, nodes, mapped } = fixture(); mapped(2, 10, 20); mapped(3, 15, 30); mapped(4, 40, 42);
  const panel = handleNodeSelect(context, [nodes[1], nodes[2], nodes[3]]);
  const files = buildSourceRangeDisplayModel(panel.items);
  expect(files[0].ranges.map(({startLine, endLine}) => [startLine, endLine])).toEqual([[10, 30], [40, 42]]);
  expect(files[0].ranges[0].items).toHaveLength(2); expect(panel.items).toHaveLength(3);
});
it('keeps repositories and snapshot hashes distinct and retains previous file ordering', () => {
  const { context, nodes, mapped } = fixture(); mapped(2, 10);
  const item = handleNodeSelect(context, [nodes[1]]).items[0];
  const other: ResolvedMapping = structuredClone(item); other.resource.target.repo.sourceId = 'other';
  const files = buildSourceRangeDisplayModel([item, other]); expect(files).toHaveLength(2);
  expect(buildSourceRangeDisplayModel([item, other], [files[1].id]).map(file => file.id)).toEqual([files[1].id, files[0].id]);
});
it('hashes Unicode evidence as UTF-8 without changing ASCII artifact identities', () => {
  for (const text of ['', 'source', 'café → 🧭', '中文\n'.repeat(100), '\ud800'])
    expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
  expect(asciiSha256('source')).toBe(sha256('source'));
  expect(() => asciiSha256('é')).toThrow(/ASCII/);
  const { context, nodes, mapped } = fixture(); mapped(2, 10); mapped(3, 20);
  const evidence = context.diagram.sourceContext.evidence['mapping-2-10'];
  context.diagram = new RevisionedDiagramService().revise(context.diagram.revisionId, { kind: 'source-mappings', expectedContentHash: context.diagram.content.asciiSha256, mappings: context.diagram.sourceContext.mappings,
    evidence: { ...context.diagram.sourceContext.evidence, [evidence.id]: { ...evidence, sourceRanges: [{ ...evidence.sourceRanges[0], originalLines: ['// café → 🧭'] }] } } }).diagram;
  // Another node's Unicode evidence must not prevent opening an ASCII-only range.
  expect(handleNodeSelect(context, [nodes[2]]).items).toHaveLength(1);
  expect(handleNodeSelect(context, [nodes[1]]).items[0].resource.target.rangeSha256)
    .toBe(createHash('sha256').update('// café → 🧭').digest('hex'));
});
