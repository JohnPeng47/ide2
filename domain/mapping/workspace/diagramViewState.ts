import { panelRows } from './diagramSidePanelLayout';
import { alternativeSelections } from '../../core/presentation/diagramAlternative';
import { getDiagramRevision } from '../../core/diagrams/diagramRevisionStore';
import { projectSelectedDiagramRows } from '../../core/presentation/diagramRevisionProjection';
import type { MappingGridDocument } from './mappingGrid';
import { visibleContentLines, type DiagramContent } from '../../core/diagrams/diagramContent';
import { layoutScene, measureContent, resolveScene, type Diagram, type GridBox, type LineGridScene, type ResolvedGridBox } from '../../core/diagrams/lineGrid';
import type { MappingPocGridRect } from '../selection/mappingPoc';

/** Presentation of one diagram instance; never part of its source content. */
export interface DiagramViewState {
  display?: 'regular' | 'diff';
  baseRevisionId?: string;
  contentRevisionId: string;
  collapsedContentNodeIds: string[];
  /** Logical identities also cover nodes introduced by a selected revision. */
  collapsedNodeRefs?: string[];
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
      if (selectedSceneContents.get(scene)?.has(node.contentId)) return node;
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
    if (content.revisionId !== view.contentRevisionId) return;
    const nodes = content.structure.kind === 'tree' ? content.structure.nodes : {};
    const ids = view.collapsedContentNodeIds.filter(id => Object.hasOwn(nodes, id) && nodes[id].childIds.length);
    valid[key] = ids.length === view.collapsedContentNodeIds.length ? view : { ...view, collapsedContentNodeIds: ids };
  };
  visit(scene.root);
  return Object.keys(valid).length === Object.keys(views).length && Object.keys(valid).every(key => valid[key] === views[key]) ? views : valid;
}

const selectedScenes = new WeakMap<MappingGridDocument, LineGridScene>();
const selectedSceneContents = new WeakMap<LineGridScene, ReadonlySet<string>>();
/** Reserve composition bounds without changing the canvas document or its content bindings. */
export function presentationScene(document: MappingGridDocument): LineGridScene {
  if (!Object.keys(document.revisionSelections ?? {}).length && !Object.keys(document.alternatives?.items ?? {}).length) return document.scene;
  const cached = selectedScenes.get(document); if (cached) return cached;
  const selectedIds = new Set(Object.values(document.revisionSelections ?? {}).map(selection => selection.contentId));
  const resize = (box: GridBox): GridBox => {
    if (box.kind === 'container') return { ...box, children: box.children.map(resize) };
    const diagram = document.scene.contents[box.contentId];
    if (!Object.keys(alternativeSelections(document, `grid:${box.id}`, box.contentId, getDiagramRevision(diagram.revisionId)).revisionSelections ?? {}).length) return box;
    selectedIds.add(box.contentId);
    const rows = projectSelectedDiagramRows(getDiagramRevision(diagram.revisionId), document, `grid:${box.id}`, getDiagramRevision, document.diagramPresentations?.[box.contentId]);
    const bounds = measureContent(rows.map(row => row.text).join('\n'));
    return { ...box, minimumSize: { columns: Math.max(box.minimumSize?.columns ?? 0, bounds.columns), rows: Math.max(box.minimumSize?.rows ?? 0, bounds.rows) } };
  };
  // Temporary envelopes reserve flow space; they are not persisted or exposed as domain nodes.
  const unwrap = new Set<string>();
  const reserve = (box: GridBox): GridBox => {
    if (box.kind === 'container') return { ...box, children: box.children.map(reserve) };
    const panels = Object.values(document.alternatives?.panels ?? {}).filter(p => p.placement === 'flow' && p.attachment.diagramPresentationId === `grid:${box.id}`);
    if (!panels.length || box.collapsed) return box;
    let left = 0, right = 0, rows = 0;
    for (const panel of panels) {
      const size = measureContent(panelRows(document, panel).map(row => row.text).join('\n'));
      const width = Math.max(38, size.columns + 2) + 6;
      if (panel.side === 'left') left += width; else right += width;
      rows = Math.max(rows, size.rows + 1);
    }
    const size = resolveScene({ ...document.scene, root: { ...box, position: { column: 0, row: 0 } } }).bounds;
    const id = `panel-envelope:${box.id}`; unwrap.add(id);
    return { id, kind: 'container', position: box.position, collapsed: false, layout: { collisionPolicy: 'push-right', gap: 0 },
      minimumSize: { columns: left + size.columns + right, rows: size.rows + rows },
      children: [{ ...box, position: { column: left, row: 0 } }] };
  };
  const reserved = reserve(resize(document.scene.root));
  const laidOut = layoutScene({ ...document.scene, root: reserved }, reserved.id);
  const release = (box: GridBox): GridBox => {
    if (box.kind !== 'container') return box;
    if (unwrap.has(box.id)) { const child = box.children[0]; return { ...child, position: { column: box.position.column + child.position.column, row: box.position.row + child.position.row } }; }
    return { ...box, children: box.children.map(release) };
  };
  const scene = { ...laidOut, root: release(laidOut.root) };
  selectedSceneContents.set(scene, selectedIds);
  selectedScenes.set(document, scene); return scene;
}
