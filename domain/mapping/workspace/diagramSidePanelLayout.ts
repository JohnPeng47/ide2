import { getDiagramRevision } from '../../core/diagrams/diagramRevisionStore';
import { alternativeSelections, type DiagramSidePanel } from '../../core/presentation/diagramAlternative';
import { projectAlternativePart } from '../../core/presentation/diagramAlternativeProjection';
import { resolveRevisionLines } from '../../core/diagrams/diagramRevisionSelection';
import { flattenGrid, measureContent, type GridBounds, type ResolvedGridBox } from '../../core/diagrams/lineGrid';
import type { DiagramTextRow } from '../../core/presentation/diagramText';
import type { MappingGridDocument } from './mappingGrid';
import type { DiagramViews } from './diagramViewState';
export interface SidePanelProjection { panel: DiagramSidePanel; name: string; partCount: number; rows: DiagramTextRow[]; bounds: GridBounds; anchor: { column: number; row: number } }
const GAP = 6;
const rowCache = new WeakMap<MappingGridDocument, Map<string, DiagramTextRow[]>>();
export function panelRows(document: MappingGridDocument, panel: DiagramSidePanel) {
  const key = JSON.stringify([panel.id, panel.display, panel.partIndex]);
  let cache = rowCache.get(document); if (!cache) { cache = new Map(); rowCache.set(document, cache); }
  const cached = cache.get(key); if (cached) return cached;
  const item = document.alternatives!.items[panel.alternativeId], part = item.parts[panel.partIndex];
  const revision = getDiagramRevision(part.source.revisionId);
  const rows = projectAlternativePart(part, panel.id, panel.display, getDiagramRevision, document.diagramPresentations?.[revision.diagram.id]);
  cache.set(key, rows); return rows;
}
export function projectSidePanels(document: MappingGridDocument, resolved: ResolvedGridBox, views?: DiagramViews): SidePanelProjection[] {
  const boxes = flattenGrid(resolved);
  const placed: SidePanelProjection[] = [];
  for (const panel of Object.values(document.alternatives?.panels ?? {})) {
    const box = boxes.find(box => `grid:${box.box.id}` === panel.attachment.diagramPresentationId);
    if (!box?.contentId || box.box.collapsed) continue;
    const diagram = document.scene.contents[box.contentId], base = getDiagramRevision(diagram.revisionId);
    const view = views?.[panel.attachment.diagramPresentationId];
    const folded = new Set([...(view?.collapsedNodeRefs ?? []), ...(view?.contentRevisionId === diagram.content.revisionId ? view.collapsedContentNodeIds.flatMap(id => base.nodeRefs[id] ? [base.nodeRefs[id]] : []) : [])]);
    const lines = resolveRevisionLines(base, alternativeSelections(document, panel.attachment.diagramPresentationId, box.contentId, base), getDiagramRevision, folded);
    const index = panel.attachment.nodeRef === 'root' ? 0 : lines.findIndex(line => line.nodeRef === panel.attachment.nodeRef || line.ownerNodeId === panel.attachment.nodeRef);
    if (index < 0) continue; // hidden or stale logical attachment; never retarget another node
    const rows = panelRows(document, panel), size = measureContent(rows.map(row => row.text).join('\n'));
    const columns = Math.max(38, size.columns + 2), row = box.bounds.row + index;
    let column = panel.side === 'right' ? box.bounds.column + box.bounds.columns + GAP : box.bounds.column - columns - GAP;
    if (panel.placement === 'flow') for (const other of placed.filter(p => p.panel.placement === 'flow' && p.panel.attachment.diagramPresentationId === panel.attachment.diagramPresentationId && p.panel.side === panel.side)) {
      if (row < other.bounds.row + other.bounds.rows && other.bounds.row < row + size.rows + 1)
        column = panel.side === 'right' ? Math.max(column, other.bounds.column + other.bounds.columns + GAP) : Math.min(column, other.bounds.column - columns - GAP);
    }
    const item = document.alternatives!.items[panel.alternativeId];
    placed.push({ panel, name: item.name, partCount: item.parts.length, rows, bounds: { column, row, columns, rows: size.rows + 1 },
      anchor: { column: panel.side === 'right' ? box.bounds.column + box.bounds.columns : box.bounds.column, row } });
  }
  return placed;
}
/** Compare overlap area first, number of collisions second, connector crossings third. */
export function choosePanelSide(bounds: GridBounds, size: { columns: number; rows: number }, row: number,
  obstacles: readonly GridBounds[], connectors: readonly { from: { column: number; row: number }; to: { column: number; row: number } }[] = []): 'left' | 'right' {
  const score = (side: 'left' | 'right') => {
    const column = side === 'right' ? bounds.column + bounds.columns + GAP : bounds.column - size.columns - GAP;
    const areas = obstacles.map(other => Math.max(0, Math.min(column + size.columns, other.column + other.columns) - Math.max(column, other.column))
      * Math.max(0, Math.min(row + size.rows, other.row + other.rows) - Math.max(row, other.row)));
    const x1 = side === 'right' ? bounds.column + bounds.columns : column + size.columns, x2 = x1 + GAP;
    const crossings = connectors.filter(({ from: a, to: b }) => {
      if ((a.row < row) === (b.row < row) || a.row === b.row) return false;
      const x = a.column + (row - a.row) * (b.column - a.column) / (b.row - a.row);
      return x >= x1 && x <= x2;
    }).length;
    return [areas.reduce((a, b) => a + b, 0), areas.filter(Boolean).length, crossings];
  };
  const left = score('left'), right = score('right');
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] < right[i] ? 'left' : 'right';
  return 'right';
}
