import { visibleContentLines, type DiagramContent } from '../../core/diagrams/diagramContent';
import { measureContent, resolveScene, type Diagram, type GridBox, type LineGridScene, type ResolvedGridBox } from '../../core/diagrams/lineGrid';
import type { MappingPocGridRect } from '../selection/mappingPoc';

/** Presentation of one diagram instance; never part of its source content. */
export interface DiagramViewState {
  contentRevisionId: string;
  collapsedContentNodeIds: string[];
}
export type DiagramViews = Record<string, DiagramViewState>;
export function resolveDiagramContent(diagram: Diagram): DiagramContent { return diagram.content; }
export function projectDiagramContent(content: DiagramContent, view?: DiagramViewState) {
  const collapsed = view?.contentRevisionId === content.revisionId ? view.collapsedContentNodeIds : [];
  const sourceLines = visibleContentLines(content, collapsed);
  const rows = content.ascii.split('\n');
  const rowByLine = new Map(sourceLines.map((line, row) => [line, row]));
  return {
    ascii: sourceLines.map(line => rows[line - 1]).join('\n'), sourceLines,
    rowForLine: (line: number) => rowByLine.get(line),
    lineForRow: (row: number) => sourceLines[row],
    /** Presentation can span a folded subtree; membership stays in raw node IDs. */
    selectionRect: (rect: MappingPocGridRect): MappingPocGridRect | undefined => {
      const visible = sourceLines.filter(line => line >= rect.startLine && line <= rect.endLine);
      if (!visible.length) return undefined;
      return { ...rect, startLine: rowByLine.get(visible[0])! + 1, endLine: rowByLine.get(visible.at(-1)!)! + 1 };
    },
    /** Only exact, contiguous source regions can carry an editable selection. */
    rect: (rect: MappingPocGridRect): MappingPocGridRect | undefined => {
      const start = rowByLine.get(rect.startLine), end = rowByLine.get(rect.endLine);
      if (start === undefined || end === undefined || end - start !== rect.endLine - rect.startLine) return undefined;
      return { ...rect, startLine: start + 1, endLine: end + 1 };
    }
  };
}
export function diagramProjection(scene: LineGridScene, boxId: string, contentId: string, views?: DiagramViews) {
  return projectDiagramContent(resolveDiagramContent(scene.contents[contentId]), views?.[`grid:${boxId}`]);
}

/** Folded bounds subtract hidden text cells while retaining any explicitly reserved extra space. */
export function resolveDiagramView(scene: LineGridScene, views?: DiagramViews): ResolvedGridBox {
  const resolved = resolveScene(scene);
  if (!views || !Object.keys(views).length) return resolved;
  const visit = (node: ResolvedGridBox): ResolvedGridBox => {
    if (node.box.collapsed) return node;
    if (node.contentId) {
      const content = scene.contents[node.contentId].content, view = views[`grid:${node.box.id}`];
      if (view?.contentRevisionId !== content.revisionId || !view.collapsedContentNodeIds.length) return node;
      const full = measureContent(content.ascii), visible = measureContent(projectDiagramContent(content, view).ascii);
      return { ...node, bounds: { ...node.bounds,
        columns: node.bounds.columns - full.columns + visible.columns,
        rows: node.bounds.rows - full.rows + visible.rows } };
    }
    const children = node.children.map(visit);
    return { ...node, children, bounds: { ...node.bounds,
      columns: Math.max(1, node.box.minimumSize?.columns ?? 1, ...children.map(child => child.bounds.column - node.bounds.column + child.bounds.columns)),
      rows: Math.max(1, node.box.minimumSize?.rows ?? 1, ...children.map(child => child.bounds.row - node.bounds.row + child.bounds.rows)) } };
  };
  return visit(resolved);
}
/** Prune deleted owners and revision-scoped IDs on every document mutation. */
export function normalizeDiagramViews(scene: LineGridScene, views?: DiagramViews): DiagramViews | undefined {
  if (!views || !Object.keys(views).length) return views;
  const valid: DiagramViews = {};
  const visit = (box: GridBox) => {
    const key = `grid:${box.id}`, view = views[key];
    if (box.kind === 'container') { box.children.forEach(visit); return; }
    if (!view) return;
    const content = resolveDiagramContent(scene.contents[box.contentId]);
    if (content.revisionId !== view.contentRevisionId || content.structure.kind !== 'tree') return;
    const nodes = content.structure.nodes;
    const ids = view.collapsedContentNodeIds.filter(id => Object.hasOwn(nodes, id) && nodes[id].childIds.length);
    valid[key] = ids.length === view.collapsedContentNodeIds.length ? view : { ...view, collapsedContentNodeIds: ids };
  };
  visit(scene.root);
  return Object.keys(valid).length === Object.keys(views).length && Object.keys(valid).every(key => valid[key] === views[key]) ? views : valid;
}
