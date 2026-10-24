import { expect, it } from 'vitest';
import { CanvasApiProjection } from '../apiProjection';
import { buildDiagramContent } from '../../../../domain/core/diagrams/diagramContent';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { canvasDisplayNodes } from '../../../../domain/mapping/workspace/canvasDisplayNode';

it.each(['tree', 'diagram'] as const)('retains every %s anchor and exactly reconstructs its identity and relationships', kind => {
  const content = buildDiagramContent(kind === 'tree' ? 'Root\n|-- Same\n|   `-- Leaf\n`-- Same\n' : '[Left] --> [Right]', 'revision:1', kind);
  const projection = new CanvasApiProjection(), result = projection.content(content);
  const original = diagramContentNodes(content);
  if (kind === 'diagram') expect(original.filter(node => node.line === 1).length).toBeGreaterThan(1);
  expect(result.ascii).toBe(content.ascii);
  expect(result.asciiSha256).toBe(content.asciiSha256);
  expect(Object.values(result.structure.nodes).map(node => ({ ...node,
    id: projection.resolveAnchorId(node.id), parentId: node.parentId && projection.resolveAnchorId(node.parentId),
    childIds: node.childIds.map(id => projection.resolveAnchorId(id))
  }))).toEqual(original);
  expect(Object.entries(result.structure.nodes).every(([key, node]) => key === node.id)).toBe(true);
  expect(new Set(Object.keys(result.structure.nodes)).size).toBe(original.length);
  if (result.structure.kind === 'tree' && content.structure.kind === 'tree')
    expect(result.structure.rootIds.map(id => projection.resolveAnchorId(id))).toEqual(content.structure.rootIds);
  expect(projection.content(content)).toEqual(result);
});

it('removes only redundant content and preserves source evidence, whitespace, metadata, layout and revision guards', () => {
  const ascii = 'Root  \n\n`-- Child\n', scene = singleDiagramScene(ascii);
  scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision: 1, ascii, structureKind: 'tree',
    evidence: { e: { id: 'e', handle: 'Root', label: 'Root', category: 'operation', summary: 'Original evidence',
      sourceRanges: [{ id: 'range', path: 'file.ts', startLine: 1, endLine: 1, originalLines: ['const raw = "@not-an-anchor";'] }] } },
    mappings: [{ id: 'm', entityId: 'e', sourceRangeIndex: 0, line: 1, startColumn: 1, endColumn: 4 }] }).diagram };
  const nodes = canvasDisplayNodes(mappingDocumentFromScene(scene), initialCanvasState(), 9);
  const before = structuredClone(nodes), projection = new CanvasApiProjection();
  const projected = projection.nodes(nodes);
  const node = nodes.find(n => n.id === 'grid:overview')!, result = projected.find(n => n.id === node.id)!;
  if (node.layout !== 'grid' || result.layout !== 'grid') throw Error('Expected diagram');
  expect(result).not.toHaveProperty('contentNodes');
  expect(result.diagram).not.toHaveProperty('content');
  expect(result.content!.ascii).toBe(ascii);
  expect(result.diagram!.sourceContext).toEqual(node.diagram!.sourceContext);
  expect(result.geometry).toEqual(node.geometry);
  expect(result.content!.revisionId).toBe(node.content!.revisionId);
  expect(result.diagram!.revisionId).toBe(node.diagram!.revisionId);
  expect(result.collapsible.subtrees.map(s => projection.resolveAnchorId(s.contentNodeId))).toEqual(node.collapsible.subtrees.map(s => s.contentNodeId));
  expect(nodes).toEqual(before);
  expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(nodes).length * .7);
});

it('never aliases different content revisions, guesses stale endpoints, or reuses handles after restart', () => {
  const projection = new CanvasApiProjection();
  const contents = [buildDiagramContent('Root\n`-- Child', 'r1', 'tree'), buildDiagramContent('Root\n`-- Changed', 'r1', 'tree'), buildDiagramContent('Root\n`-- Child', 'r2', 'tree')];
  const handles = contents.map(content => Object.keys(projection.content(content).structure.nodes)[0]);
  expect(new Set(handles).size).toBe(3);
  expect(Object.keys(projection.content(contents[0]).structure.nodes)[0]).toBe(handles[0]);
  expect(() => new CanvasApiProjection().resolveAnchorId(handles[0])).toThrow('STALE_CONTENT_NODE');
  const full = diagramContentNodes(contents[0])[0].id;
  expect(projection.resolveAnchorId(full)).toBe(full);
  const edge = { id: 'edge', source: { kind: 'content-node' as const, displayNodeId: 'grid:old', contentNodeId: full, revisionId: 'r1', side: 'auto' as const },
    target: { kind: 'box' as const, displayNodeId: 'grid:target', side: 'auto' as const }, appearance: { color: '#ffffff', lineStyle: 'solid' as const, label: full } };
  const encoded = projection.edge(edge);
  expect(encoded.source.contentNodeId).toBe(handles[0]);
  expect(encoded.appearance.label).toBe(full); // Text is never treated as an ID.
  expect(projection.resolveEdge(encoded)).toEqual(edge);
  const jump = { id: 'j', source: { contentNodeId: full, revisionId: 'r1', contentHash: contents[0].asciiSha256, line: 1, startColumn: 1, endColumn: 4 },
    target: { representationId: 'other', displayNodeId: 'grid:other', contentNodeId: diagramContentNodes(contents[2])[0].id } };
  expect(projection.resolveJump(projection.jump(jump))).toEqual(jump);
  const bounded = new CanvasApiProjection(1);
  const first = bounded.anchorId(full);
  expect(() => bounded.anchorId('other')).toThrow('ANCHOR_CAPACITY');
  expect(bounded.resolveAnchorId(first)).toBe(full);
});
