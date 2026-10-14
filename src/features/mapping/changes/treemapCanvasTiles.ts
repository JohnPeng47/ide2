import type { DiagramContent } from '../../../../domain/core/diagrams/diagramContent';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import type { TreemapDiagramColor } from './treemapDiagramColors';

interface Projection { rows: readonly unknown[]; rowForLine: ReadonlyMap<number, number>; prefixRowForNode: ReadonlyMap<string, number>; columnForLine: (line: number, column: number) => number }
interface Tile { identity: TreemapDiagramColor; column: number; row: number; columns: number; rows: number }

/** Partition the entire diagram into non-overlapping tints. Visible child regions
 * replace their parent's tint; hidden treemap descendants cannot obscure a tile's color. */
export function treemapCanvasRegions(content: DiagramContent, projection: Projection,
  bounds: { columns: number; rows: number }, colors: readonly TreemapDiagramColor[]): Tile[] {
  const nodes = new Map(diagramContentNodes(content).map(node => [node.id, node]));
  const regions: Tile[] = [];
  for (const identity of colors) {
    if (!identity.contentNodeId) {
      // Bounds may also carry the scene origin. Tiles stay local until placement.
      const row = identity.direct ? 1 : 0;
      if (bounds.rows > row) regions.push({ identity, column: 0, row, columns: bounds.columns, rows: bounds.rows - row });
      continue;
    }
    const node = nodes.get(identity.contentNodeId);
    if (!node) continue;
    const row = projection.prefixRowForNode.get(node.id) ?? projection.rowForLine.get(node.line);
    if (row === undefined) continue; // Locally folded under an ancestor.
    let endLine = node.line;
    const visit = (id: string) => {
      const child = nodes.get(id);
      if (!child) return;
      endLine = Math.max(endLine, child.line, ...child.foldRanges.map(range => range.endLine));
      child.childIds.forEach(visit);
    };
    visit(node.id);
    const nextLine = [...projection.rowForLine.keys()].find(line => line > endLine);
    const nextNode = nextLine === undefined ? undefined : [...nodes.values()].find(node => node.line === nextLine);
    const end = nextLine === undefined ? projection.rows.length
      : (nextNode && projection.prefixRowForNode.get(nextNode.id)) ?? projection.rowForLine.get(nextLine)!;
    const column = Math.max(0, Math.min(bounds.columns, projection.columnForLine(node.line, node.branchColumn)));
    // Aggregate headings keep their own shade; directly mapped code fills the
    // remaining parent region, before deeper child regions replace it.
    const start = row + (identity.direct ? 1 : 0);
    if (end > start) regions.push({ identity, column, row: start, columns: bounds.columns - column, rows: end - start });
  }
  return regions;
}

export function treemapCanvasTiles(content: DiagramContent, projection: Projection,
  bounds: { columns: number; rows: number }, colors: readonly TreemapDiagramColor[]): Tile[] {
  const regions = treemapCanvasRegions(content, projection, bounds, colors);
  // Partition at rectangle edges, then merge identical vertical runs. This avoids
  // stacking translucent ancestor fills and changing the child's apparent color.
  const edges = [...new Set(regions.flatMap(region => [region.row, region.row + region.rows]))].sort((a, b) => a - b);
  const tiles: Tile[] = [], last = new Map<string, Tile>();
  for (let i = 0; i < edges.length - 1; i++) {
    const row = edges[i], rows = edges[i + 1] - row;
    const active = regions.filter(region => region.row <= row && region.row + region.rows > row);
    const columns = [...new Set(active.flatMap(region => [region.column, region.column + region.columns]))].sort((a, b) => a - b);
    for (let j = 0; j < columns.length - 1; j++) {
      const column = columns[j], width = columns[j + 1] - column;
      const region = [...active].reverse().find(region => region.column <= column && region.column + region.columns > column);
      if (!region) continue;
      const key = `${region.identity.position}:${!!region.identity.direct}:${column}:${width}`, previous = last.get(key);
      if (previous && previous.row + previous.rows === row) previous.rows += rows;
      else {
        const tile = { identity: region.identity, column, row, columns: width, rows };
        tiles.push(tile); last.set(key, tile);
      }
    }
  }
  return tiles;
}
