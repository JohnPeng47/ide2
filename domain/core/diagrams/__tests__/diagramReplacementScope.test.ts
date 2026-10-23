import { expect, it } from 'vitest';
import { RevisionedDiagramService, type DiagramGenerationRequest } from '../diagramService';
import { diagramContentNodes } from '../diagramContentNodes';
import { diagramReplacementRanges, scopedReplacements } from '../diagramSubtreeEdit';
import { renderDiagramEditPrompt } from '../../../../infrastructure/mapping/agents/diagram-edit/diagramEditRuntime';

const ascii = 'Root\n|-- A\n|   `-- Child\n|-- B\n|-- C\n`-- D';
function fixture() {
  const service = new RevisionedDiagramService();
  const base = service.create({ id: 'scope', ascii, revision: 0, structureKind: 'tree' }).revision;
  const nodes = diagramContentNodes(base.diagram.content);
  const target = (label: string) => ({ contentNodeId: nodes.find(node => node.label === label)!.id, revisionId: base.diagram.content.revisionId });
  return { base, target, service };
}

it('resolves every explicit scope and rejects missing, stale, overlapping, and nonadjacent targets', () => {
  const { base, target } = fixture(), d = base.diagram;
  expect(diagramReplacementRanges(d, 'diagram')).toEqual([]);
  expect(diagramReplacementRanges(d, 'subnode-single', target('A'))).toEqual([{ startLine: 2, endLine: 3 }]);
  expect(diagramReplacementRanges(d, 'multi-contiguous', undefined, [target('B'), target('A')])).toEqual([{ startLine: 2, endLine: 4 }]);
  expect(diagramReplacementRanges(d, 'multi-contiguous', undefined, [target('Child'), target('B')])).toEqual([{ startLine: 3, endLine: 4 }]);
  expect(diagramReplacementRanges(d, 'multi-disjoint', undefined, [target('C'), target('A')])).toEqual([{ startLine: 2, endLine: 3 }, { startLine: 5, endLine: 5 }]);
  expect(() => diagramReplacementRanges(d, 'diagram', target('A'))).toThrow('cannot include');
  expect(() => diagramReplacementRanges(d, 'subnode-single')).toThrow('supply subtree');
  expect(() => diagramReplacementRanges(d, 'subnode-single', { ...target('A'), revisionId: 'old' })).toThrow('VERSION_CONFLICT');
  for (const targets of [[target('A'), target('A')], [target('A'), target('Child')]])
    expect(() => diagramReplacementRanges(d, 'multi-disjoint', undefined, targets)).toThrow('overlap');
  expect(() => diagramReplacementRanges(d, 'multi-contiguous', undefined, [target('A'), target('C')])).toThrow('adjacent');
  expect(() => diagramReplacementRanges(d, 'multi-disjoint', undefined, [target('A'), target('B')])).toThrow('adjacent');
});

it('requires explicit output boundaries for disjoint edits and protects repeated intervening text', () => {
  const { base, target } = fixture();
  const ranges = diagramReplacementRanges(base.diagram, 'multi-disjoint', undefined, [target('A'), target('C')]);
  const output = 'Root\n|-- Changed A\n|-- B\n|-- Changed C\n`-- D';
  const outputs = [{ startLine: 2, endLine: 2 }, { startLine: 4, endLine: 4 }];
  expect(scopedReplacements(base.diagram, output, ranges, outputs).patches).toHaveLength(2);
  expect(() => scopedReplacements(base.diagram, output, ranges)).toThrow('one output range');
  expect(() => scopedReplacements(base.diagram, output.replace('|-- B', '|-- Tampered'), ranges, outputs)).toThrow('outside');
  expect(() => scopedReplacements(base.diagram, output, ranges, [{ startLine: 1, endLine: 2 }, outputs[1]])).toThrow('outside');
  expect(() => scopedReplacements(base.diagram, output, ranges, [outputs[0], { startLine: 2, endLine: 4 }])).toThrow('overlapping');
});

it('issues one child revision while preserving identities and highlights across growth and deletion in disjoint ranges', async () => {
  const { base: original, target, service } = fixture();
  const base = service.revise(original.id, { kind: 'highlights', highlights: [{ id: 'b', color: 'blue', contentNodeId: target('B').contentNodeId }] }).revision;
  const refA = base.nodeRefs[target('A').contentNodeId];
  const generator = new RevisionedDiagramService({ generate: async () => ({
    ascii: `Root\n|-- Renamed A [[keep:${refA}]]\n|   |-- Added\n|   \`-- Added too\n|-- B\n\`-- D`, structureKind: 'tree',
    replacementRanges: [{ startLine: 2, endLine: 4 }, { startLine: 6, endLine: 5 }]
  }) });
  const ranges = diagramReplacementRanges(base.diagram, 'multi-disjoint', undefined, [target('A'), target('C')]);
  const request: DiagramGenerationRequest = { input: { id: base.diagram.id }, baseRevisionId: base.id, instruction: 'Update A and delete C', editRanges: ranges,
    context: { diagram: base.diagram, selection: { startLine: 1, endLine: 6, startColumn: 1, endColumn: 30 } } };
  const prompt = renderDiagramEditPrompt(request);
  expect(prompt).toContain('replacementRanges'); expect(prompt).toContain('including gaps between ranges');
  const next = await generator.generate(request);
  expect(next.revision.parentId).toBe(base.id);
  expect(next.diagram.revision).toBe(base.diagram.revision + 1);
  for (const label of ['Root', 'B', 'D']) {
    const oldNode = diagramContentNodes(base.diagram.content).find(node => node.label === label)!;
    const newNode = diagramContentNodes(next.diagram.content).find(node => node.label === label)!;
    expect(next.revision.nodeRefs[newNode.id]).toBe(base.nodeRefs[oldNode.id]);
  }
  const nodes = diagramContentNodes(next.diagram.content);
  expect(next.revision.nodeRefs[nodes.find(node => node.label === 'Renamed A')!.id]).toBe(refA);
  expect(next.diagram.highlights![0].contentNodeId).toBe(nodes.find(node => node.label === 'B')!.id);
  expect(generator.listRevisions(base.diagramId)).toHaveLength(3);
});

it('distinguishes a blank replacement line from deleting the range', async () => {
  const { base, target } = fixture();
  const output = 'Root\n\n|-- B\n|-- C\n`-- D';
  const service = new RevisionedDiagramService({ generate: async () => ({ ascii: output, structureKind: 'tree' }) });
  const next = await service.generate({ input: { id: base.diagram.id }, baseRevisionId: base.id, instruction: 'Clear A',
    editRanges: diagramReplacementRanges(base.diagram, 'subnode-single', target('A')) });
  expect(next.diagram.content.ascii).toBe(output);
});
