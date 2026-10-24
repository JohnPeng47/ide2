import { projectDiagramDiffRows } from '../../core/presentation/diagramDiffProjection';
import { analyzeDiagramSyntax } from '../../core/diagrams/diagramSyntaxAnalysis';
import { presentationHighlights, type DiagramPresentations } from '../../core/presentation/diagramPresentation';
import { getDiagramRevision } from '../../core/diagrams/diagramRevisionStore';
import type { ResolvedCanvasDocument } from '../../core/diagrams/canvasHistory';
import { migrationMarkKey, type MigrationMark } from '../changes/migrationDecoration';
import type { CanvasJump } from '../../core/diagrams/canvasJump';
import { composeScene, flattenGrid, layoutScene, measureContent, resolveScene, type GridBox, type LineGridScene } from '../../core/diagrams/lineGrid';
import { diagramTextRanges, textRow, type DiagramTextRow, type DiagramTextRun } from '../../core/presentation/diagramText';
import { projectDiagramContent, type DiagramViews } from './diagramViewState';
import type { DiagramContentDiff } from '../../core/diagrams/diagramContentDiff';

export interface PreviewTextRun extends DiagramTextRun { diffVersion?: 'previous' | 'current'; diffStatus?: 'removed'; migrations?: MigrationMark[] }
export interface PreviewTextRow extends DiagramTextRow { runs: PreviewTextRun[] }

/** Reserve the fully expanded diff once, before the preview document is frozen. */
export function layoutDiagramComparisons(scene: LineGridScene, diffs: ReadonlyMap<string, DiagramContentDiff>, modifiedDiagramIds: ReadonlySet<string>) {
  const expand = (box: GridBox): GridBox => box.kind === 'container'
    ? { ...box, collapsed: false, children: box.children.map(expand) } : { ...box, collapsed: false };
  const expanded = { ...scene, root: expand(scene.root) };
  const measured = projectDiagramComparisons(expanded, undefined, diffs, modifiedDiagramIds, [], new Map(), true);
  const reserve = (box: GridBox): GridBox => box.kind === 'container' ? { ...box, children: box.children.map(reserve) }
    : { ...box, minimumSize: { columns: (box.minimumSize?.columns ?? 1) + 16, rows: box.minimumSize?.rows ?? 1 } };
  return layoutScene({ ...measured.scene, root: reserve(measured.scene.root) }, measured.scene.root.id);
}

/** Display-only rows. Source content, IDs, jumps, mappings and provenance stay intact. */
export function projectDiagramComparisons(scene: LineGridScene, views: DiagramViews | undefined,
  diffs: ReadonlyMap<string, DiagramContentDiff>, modifiedDiagramIds: ReadonlySet<string>, jumps: readonly CanvasJump[] = [], baselineMigrations: ReadonlyMap<string, MigrationMark[]> = new Map(), preservePositions = false, presentations?: DiagramPresentations, baseline?: ResolvedCanvasDocument) {
  const projections = new Map<string, {
    rows: PreviewTextRow[]; ascii: string; rowForLine: Map<number, number>; prefixRowForNode: Map<string, number>;
    columnForLine: (line: number, column: number) => number;
  }>();
  for (const { box } of flattenGrid(resolveScene(scene))) {
    if (box.kind !== 'diagram') continue;
    const displayNodeId = `grid:${box.id}`, diagram = scene.contents[box.contentId], content = diagram.content;
    const visible = projectDiagramContent(content, views?.[displayNodeId]);
    const settings = presentations?.[box.contentId];
    const refs = getDiagramRevision(diagram.revisionId).nodeRefs;
    const ranges = diagramTextRanges({ revisionId: diagram.revisionId, syntax: analyzeDiagramSyntax(diagram, settings?.markerRules), presentation: settings, highlights: presentationHighlights(diagram, settings, refs), ascii: content.ascii, content, displayNodeId, mappings: diagram.sourceContext.mappings, sourceContext: diagram.sourceContext, jumps: [...(diagram.jumps ?? []), ...jumps.filter(jump => jump.sourceDisplayNodeId === displayNodeId)] });
    const find = (root: GridBox): GridBox | undefined => root.id === box.id ? root : root.kind === 'container' ? root.children.map(find).find(Boolean) : undefined;
    const oldBox = baseline && find(baseline.scene.root);
    const previous = oldBox?.kind === 'diagram' ? baseline!.scene.contents[oldBox.contentId] : undefined;
    const previousSettings = oldBox?.kind === 'diagram' ? baseline?.diagramPresentations?.[oldBox.contentId] : undefined;
    const previousRanges = previous ? diagramTextRanges({ revisionId: previous.revisionId, ascii: previous.content.ascii, content: previous.content, displayNodeId,
      mappings: previous.sourceContext.mappings, sourceContext: previous.sourceContext,
      syntax: analyzeDiagramSyntax(previous, previousSettings?.markerRules), presentation: previousSettings,
      highlights: presentationHighlights(previous, previousSettings, getDiagramRevision(previous.revisionId).nodeRefs) }) : undefined;
    projections.set(displayNodeId, projectDiagramDiffRows({ content, ranges, sourceLines: visible.sourceLines,
      collapsedContentNodeIds: views?.[displayNodeId]?.contentRevisionId === content.revisionId ? views[displayNodeId].collapsedContentNodeIds : [],
      diff: diffs.get(displayNodeId), enabled: modifiedDiagramIds.has(displayNodeId), previous, previousRanges,
      previousDecoration: contentNodeId => contentNodeId ? { migrations: baselineMigrations.get(migrationMarkKey(displayNodeId, contentNodeId)) } as Partial<PreviewTextRun> : undefined }));
  }

  // Reserve space and settle collisions on a temporary view of the grid. Content
  // remains the original parsed content; only this renderer's bounds are expanded.
  const resize = (box: GridBox): GridBox => {
    if (box.kind === 'container') return { ...box, children: box.children.map(resize) };
    const size = measureContent(projections.get(`grid:${box.id}`)!.ascii);
    return { ...box, minimumSize: { columns: Math.max(box.minimumSize?.columns ?? 0, size.columns), rows: Math.max(box.minimumSize?.rows ?? 0, size.rows) } };
  };
  const sized = { ...scene, root: resize(scene.root) };
  const display = preservePositions ? sized : layoutScene(sized, scene.root.id);
  const resolved = resolveScene(display), boxes = flattenGrid(resolved);
  // Once layout is prepared, folds and rendering retain its reserved bounds and
  // positions. Callers render each diagram locally without recomposing the grid.
  if (preservePositions) return { scene: display, rows: [] as PreviewTextRow[], resolved, boxes, projections };
  const ascii = composeScene(display, (_diagram, box) => projections.get(`grid:${box.id}`)?.ascii ?? _diagram.content.ascii);
  const rows: PreviewTextRow[] = ascii.split('\n').map(text => ({ text, runs: [] }));
  for (const { box, bounds } of boxes) {
    if (box.kind !== 'diagram') continue;
    projections.get(`grid:${box.id}`)!.rows.forEach((row, i) => {
      rows[bounds.row + i].runs.push(...row.runs.map(run => ({ ...run, start: run.start + bounds.column, end: run.end + bounds.column,
        owner: run.owner ? { ...run.owner, columnOffset: run.owner.columnOffset + bounds.column } : undefined })));
    });
  }
  for (const row of rows) {
    const runs: PreviewTextRun[] = [];
    let end = 0;
    for (const run of row.runs.sort((a, b) => a.start - b.start)) {
      if (run.start > end) runs.push({ start: end, end: run.start, text: row.text.slice(end, run.start), mappings: [] });
      runs.push(run); end = run.end;
    }
    if (end < row.text.length) runs.push({ start: end, end: row.text.length, text: row.text.slice(end), mappings: [] });
    row.runs = runs;
  }
  return { scene: display, rows, resolved, boxes, projections };
}
