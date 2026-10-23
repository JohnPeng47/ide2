import { expect, it } from 'vitest';
import { RevisionedDiagramService } from '../diagramService';
import { diagramContentNodes } from '../diagramContentNodes';

function fixture() {
  const service = new RevisionedDiagramService();
  const base = service.create({ id: 'mapping-test', revision: 0, ascii: 'Parent\n`-- Child', structureKind: 'tree',
    evidence: { e: { id: 'e', handle: 'e', label: 'Evidence', category: 'operation', summary: '', sourceRanges: [{ id: 'range', path: 'x.ts', startLine: 1, endLine: 1, originalLines: ['x'] }] } },
    mappings: [{ id: 'parent', entityId: 'e', sourceRangeIndex: 0, line: 1, startColumn: 1, endColumn: 6 },
      { id: 'child', entityId: 'e', sourceRangeIndex: 0, line: 2, startColumn: 5, endColumn: 9 }] });
  const refs = Object.fromEntries(diagramContentNodes(base.diagram.content).map(node => [node.label, base.revision.nodeRefs[node.id]]));
  const request = { baseRevisionId: base.revision.id, input: { id: base.diagram.id }, instruction: 'Edit' };
  return { service, base, refs, request };
}
it('retains a preserved parent mapping but drops replaced child mappings', () => {
  const f = fixture();
  const next = f.service.submit(f.request, { ascii: `Parent [[keep:${f.refs.Parent}]]\n\`-- New child`, structureKind: 'tree' });
  expect(next.diagram.sourceContext.mappings.map(mapping => mapping.id)).toEqual(['parent']);
});
it('retains a child mapping independently when the parent identity is replaced', () => {
  const f = fixture();
  const next = f.service.submit(f.request, { ascii: `New parent\n\`-- Child [[keep:${f.refs.Child}]]`, structureKind: 'tree' });
  expect(next.diagram.sourceContext.mappings).toEqual([f.base.diagram.sourceContext.mappings[1]]);
  expect(Object.values(next.revision.nodeRefs)).toContain(f.refs.Child);
  expect(Object.values(next.revision.nodeRefs)).not.toContain(f.refs.Parent);
});
it('moves retained spans and drops changed or ambiguous spans even with a retained identity', () => {
  const f = fixture();
  const next = f.service.submit(f.request, { ascii: `Parent renamed [[keep:${f.refs.Parent}]]\n|-- New\n\`-- The Child [[keep:${f.refs.Child}]]`, structureKind: 'tree' });
  expect(next.diagram.sourceContext.mappings).toEqual([
    f.base.diagram.sourceContext.mappings[0], { ...f.base.diagram.sourceContext.mappings[1], line: 3, startColumn: 9, endColumn: 13 }
  ]);
  for (const label of ['Renamed', 'Child Child']) {
    const dropped = f.service.submit(f.request, { ascii: `Root\n\`-- ${label} [[keep:${f.refs.Child}]]`, structureKind: 'tree' });
    expect(dropped.diagram.sourceContext.mappings).toEqual([]);
  }
});
it('requires explicit opt-in and a complete mapping array for new source mappings', () => {
  const f = fixture(), edit = { ascii: 'Parent\n`-- Child', structureKind: 'tree' as const };
  expect(() => f.service.submit(f.request, { ...edit, mappings: [...f.base.diagram.sourceContext.mappings] })).toThrow('SOURCE_MAPPINGS_DISABLED');
  expect(() => f.service.submit({ ...f.request, sourceMappings: true }, edit)).toThrow('SOURCE_MAPPINGS_REQUIRED');
  const next = f.service.submit({ ...f.request, sourceMappings: true }, { ...edit, mappings: [f.base.diagram.sourceContext.mappings[1]] });
  expect(next.diagram.sourceContext.mappings).toEqual([f.base.diagram.sourceContext.mappings[1]]);
  expect(() => f.service.submit({ ...f.request, sourceMappings: true }, { ...edit, mappings: [{ ...f.base.diagram.sourceContext.mappings[0], entityId: 'invented' }] })).toThrow();
});
it('preserves mapping coordinates outside a changed subtree', () => {
  const f = fixture();
  const next = f.service.submit({ ...f.request, editRanges: [{ startLine: 2, endLine: 2 }] }, { ascii: 'Parent\n`-- Replaced', structureKind: 'tree' });
  expect(next.diagram.sourceContext.mappings).toEqual([f.base.diagram.sourceContext.mappings[0]]);
});
it('rejects continuity annotations and replacement boundaries when creating new diagrams', () => {
  const f = fixture(), request = { input: { id: 'new' }, instruction: 'Create', context: { diagram: f.base.diagram, selection: { startLine: 1, endLine: 2, startColumn: 1, endColumn: 9 } } };
  expect(() => f.service.submit(request, { ascii: `Parent [[keep:${f.refs.Parent}]]`, structureKind: 'tree' })).toThrow('CONTINUITY');
  expect(() => f.service.submit(request, { ascii: 'New', structureKind: 'tree', replacementRanges: [{ startLine: 1, endLine: 1 }] })).toThrow('REPLACEMENT_SCOPE');
});
