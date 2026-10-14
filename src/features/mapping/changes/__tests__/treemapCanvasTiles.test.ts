import { expect, it } from 'vitest';
import { RevisionedDiagramService } from '../../../../../domain/core/diagrams/diagramService';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { diffDiagramContent } from '../../../../../domain/mapping/changes/diagramContentDiff';
import { changePreviewText } from '../changePreviewText';
import { treemapCanvasTiles } from '../treemapCanvasTiles';
import { treemapLocColor, type TreemapDiagramColor } from '../treemapDiagramColors';

it('tiles full subtree ranges, preserving siblings and both diff rows without overlapping fills', () => {
  const before = 'Root\n|-- Parent\n|   `-- Old\n`-- Sibling';
  const after = 'Root\n|-- Parent\n|   `-- New\n`-- Sibling';
  const service = new RevisionedDiagramService();
  const old = service.create({ id: 'overview', revision: 0, ascii: before, structureKind: 'tree' }).diagram;
  const next = service.create({ id: 'overview', revision: 1, ascii: after, structureKind: 'tree' }).diagram;
  const scene = singleDiagramScene(after);
  scene.contents = { ...scene.contents, overview: next };
  const nodes = diagramContentNodes(next.content);
  const identity = (position: number, label?: string): TreemapDiagramColor => ({ documentId: 'doc', displayNodeId: 'grid:overview',
    contentNodeId: nodes.find(node => node.label === label)?.id, position, color: treemapLocColor(position, 4) });
  const colors = [identity(0), identity(1, 'Parent'), identity(2, 'New'), identity(3, 'Sibling')];
  const diffs = new Map([['grid:overview', diffDiagramContent(old.content, next.content)]]);
  const text = changePreviewText(scene, undefined, diffs, new Set(['grid:overview']));
  const projection = text.projections.get('grid:overview')!;
  const bounds = text.boxes.find(box => box.box.id === 'overview')!.bounds;
  const check = (active: TreemapDiagramColor[], views?: Parameters<typeof changePreviewText>[1]) => {
    const result = views ? changePreviewText(scene, views, diffs, new Set(['grid:overview'])) : text;
    const p = result.projections.get('grid:overview')!, b = result.boxes.find(box => box.box.id === 'overview')!.bounds;
    // Scene bounds carry a nonzero origin; partitioning must use only their size.
    const positionedBounds = { ...b, column: 17, row: 9 };
    const tiles = treemapCanvasTiles(next.content, p, positionedBounds, active);
    expect(tiles.reduce((sum, tile) => sum + tile.columns * tile.rows, 0)).toBe(b.columns * b.rows);
    for (let row = 0; row < b.rows; row++) for (let col = 0; col < b.columns; col++)
      expect(tiles.filter(tile => row >= tile.row && row < tile.row + tile.rows && col >= tile.column && col < tile.column + tile.columns)).toHaveLength(1);
    return { tiles, p, b };
  };
  const { tiles } = check(colors);
  const at = (row: number) => tiles.find(tile => tile.row <= row && tile.row + tile.rows > row && tile.column + tile.columns === bounds.columns)!;
  expect(at(projection.rowForLine.get(2)!).identity).toBe(colors[1]);
  expect(at(projection.prefixRowForNode.get(colors[2].contentNodeId!)!).identity).toBe(colors[2]);
  expect(at(projection.rowForLine.get(3)!).identity).toBe(colors[2]);
  expect(at(projection.rowForLine.get(4)!).identity).toBe(colors[3]);
  const hiddenChild = check(colors.filter(color => color !== colors[2]));
  expect(hiddenChild.tiles.filter(tile => tile.identity === colors[1]).some(tile => tile.row <= projection.rowForLine.get(3)! && tile.row + tile.rows > projection.rowForLine.get(3)!)).toBe(true);
  const folded = check(colors, { 'grid:overview': { contentRevisionId: next.content.revisionId, collapsedContentNodeIds: [colors[1].contentNodeId!] } });
  expect(folded.tiles.some(tile => tile.identity === colors[2])).toBe(false);
});
