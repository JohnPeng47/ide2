import { expect, it } from 'vitest';
import { CanvasApiProjection } from '../apiProjection';
import { shortCanvasContext } from '../../../../domain/mapping/agent/shortContext';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { canvasDisplayNodes } from '../../../../domain/mapping/workspace/canvasDisplayNode';
import { addDisplayNode, displayGeometry } from '../../../../domain/mapping/workspace/displayModel';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { asciiSha256 } from '../../../../domain/core/diagrams/asciiSha256';

function fixture(kind: 'tree' | 'diagram' = 'tree') {
  const ascii = kind === 'tree' ? 'Root\n|-- Child  \n|   `-- Leaf\n\n`-- Last\n' : '[Left] --> [Right]\n';
  const scene = singleDiagramScene(ascii);
  const diagram = revisionFixture().create({ id: 'overview', revision: 1, ascii, structureKind: kind,
    source: { sourceId: 'repo', repositoryIdentity: 'test-repo', domainProfileId: 'source-code',
      corpus: { kind: 'git-worktree', root: '/test/repo', revision: 'abc123' } },
    evidence: { e: { id: 'e', sourceId: 'repo', handle: 'src/file.ts', label: 'Root', category: 'operation', summary: 'Evidence',
      sourceRanges: [{ id: 'range', path: 'src/file.ts', symbol: 'Root', startLine: 10, endLine: 11,
        originalLines: ['captured source must remain available', 'but never in short responses'] }] } },
    mappings: [{ id: 'm', entityId: 'e', sourceRangeId: 'range', sourceRangeIndex: 0, line: 1, startColumn: 1, endColumn: 4 }] }).diagram;
  scene.contents = { overview: diagram };
  const document = mappingDocumentFromScene(scene), canvas = initialCanvasState();
  const anchor = diagramContentNodes(diagram.content)[0];
  canvas.diagramViews = { 'grid:overview': { contentRevisionId: diagram.content.revisionId, collapsedContentNodeIds: [anchor.id] } };
  for (const [id, sourceAscii] of [['current', ascii], ['historical', 'Past\n`-- Child']]) {
    canvas.display = addDisplayNode(canvas.display, { ...displayGeometry(), id, kind: 'selection', childIds: [], expansion: 'expanded',
      sourceBoxId: 'overview', sourceContentId: 'overview', sourceAscii, sourceRevisionId: id === 'current' ? diagram.content.revisionId : 'overview:0',
      rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 }, selectedIds: ['e'], displayMode: 'stacked' });
  }
  canvas.display = addDisplayNode(canvas.display, { ...displayGeometry(), id: 'detail', kind: 'detail', childIds: [],
    expansion: 'expanded', title: 'Additional detail', ascii: 'Deferred detail content' }, 'current');
  document.edges = [{ id: 'edge', source: { kind: 'content-node', displayNodeId: 'grid:overview', contentNodeId: anchor.id,
    revisionId: diagram.content.revisionId, side: 'bottom' }, target: { kind: 'box', displayNodeId: 'grid:overview', side: 'left' },
    appearance: { color: '#abcdef', lineStyle: 'dashed', label: { text: 'Owns', position: { x: 1.25, y: 3.5 } } } }];
  const projection = new CanvasApiProjection();
  const context = { ...projection.result({ version: 7, name: 'Test', nodes: canvasDisplayNodes(document, canvas, 7) }),
    edges: document.edges.map(edge => projection.edge(edge)) };
  return { context, diagram, projection, anchor };
}

it.each(['tree', 'diagram'] as const)('preserves exact %s content, relationships and source file references without evidence text', kind => {
  const { context, diagram, projection, anchor } = fixture(kind), before = structuredClone(context);
  const short = shortCanvasContext(context), node = short.diagrams[0];
  expect(node.ascii).toBe(diagram.content.ascii);
  expect(node.asciiSha256).toBe(diagram.content.asciiSha256);
  expect(node.revisionId).toBe(diagram.content.revisionId);
  expect(node.sourceReferences.binding).toEqual(diagram.sourceContext.binding);
  expect(node.sourceReferences.mappings).toEqual(diagram.sourceContext.mappings);
  expect(node.sourceReferences.entities[0]).toMatchObject({ id: 'e', sourceId: 'repo', label: 'Root',
    sourceRanges: [{ id: 'range', path: 'src/file.ts', symbol: 'Root', startLine: 10, endLine: 11 }] });
  expect(JSON.stringify(short)).not.toContain('originalLines');
  expect(JSON.stringify(short)).not.toContain('captured source must remain available');
  expect(node).not.toHaveProperty('content');
  expect(short.edges[0]).toMatchObject({ ...context.edges[0], source: { ...context.edges[0].source, status: 'resolved',
    line: anchor.line, startColumn: anchor.startColumn, endColumn: anchor.endColumn }, target: { status: 'resolved' } });
  expect(projection.resolveAnchorId(short.edges[0].source.contentNodeId!)).toBe(anchor.id);
  if (kind === 'tree') expect(node.collapsedAnchorIds).toEqual([short.edges[0].source.contentNodeId]);
  expect(short.groups[0].childIds).toContain(node.id);
  expect(short.selections).toMatchObject([
    { matchesCurrentSource: true, sourceRevisionId: diagram.content.revisionId, selectedIds: ['e'], childIds: ['floating:detail'] },
    { matchesCurrentSource: false, sourceRevisionId: 'overview:0', sourceAsciiSha256: asciiSha256('Past\n`-- Child') }
  ]);
  expect(short.selections[0]).not.toHaveProperty('sourceAscii');
  expect(short.otherNodes).toMatchObject([{ id: 'floating:detail', kind: 'detail', title: 'Additional detail' }]);
  expect(JSON.stringify(short)).not.toContain('Deferred detail content');
  expect(context).toEqual(before);
});

it('never resolves stale, wrong-instance or missing edge endpoints against current text', () => {
  const { context } = fixture();
  const edge = context.edges[0];
  context.edges = [
    { ...edge, id: 'stale', source: { ...edge.source, revisionId: 'old' } },
    { ...edge, id: 'wrong-instance', source: { ...edge.source, displayNodeId: 'grid:root' } },
    { ...edge, id: 'missing', target: { ...edge.target, displayNodeId: 'grid:missing' } },
    { ...edge, id: 'missing-anchor', source: { ...edge.source, contentNodeId: 'old-handle' } }
  ];
  const short = shortCanvasContext(context);
  expect(short.edges.map(edge => [edge.source.status, edge.target.status])).toEqual([
    ['stale', 'resolved'], ['stale', 'resolved'], ['resolved', 'missing'], ['stale', 'resolved']
  ]);
  expect(short.edges[0].source).not.toHaveProperty('line');
  expect(short.edges[1].source).not.toHaveProperty('line');
  expect(short.edges[3].source).not.toHaveProperty('line');
  context.nodes = context.nodes.filter(node => node.id !== 'grid:overview');
  expect(shortCanvasContext(context).selections.every(selection => !selection.matchesCurrentSource)).toBe(true);
});

it('retains cross-canvas jumps and distinguishes stale source ranges', () => {
  const { context, diagram } = fixture();
  const node = context.nodes.find(node => node.id === 'grid:overview')!;
  if (node.layout !== 'grid' || !node.diagram) throw Error('Expected diagram');
  const jump = { id: 'jump', source: { revisionId: diagram.content.revisionId, contentHash: diagram.content.asciiSha256,
    line: 1, startColumn: 1, endColumn: 4 }, target: { representationId: 'other-canvas', displayNodeId: 'grid:target' } };
  node.diagram = { ...node.diagram, jumps: [jump, { ...jump, id: 'stale', source: { ...jump.source, revisionId: 'old' } }] };
  expect(shortCanvasContext(context).diagrams[0].jumps).toEqual([
    { ...jump, sourceStatus: 'current' }, { ...jump, id: 'stale', source: { ...jump.source, revisionId: 'old' }, sourceStatus: 'stale' }
  ]);
});
