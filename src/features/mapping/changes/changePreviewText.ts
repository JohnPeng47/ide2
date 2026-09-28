import type { CanvasJump } from '../../../../domain/core/diagrams/canvasJump';
import { composeScene, flattenGrid, layoutScene, measureContent, resolveScene, type GridBox, type LineGridScene } from '../../../../domain/core/diagrams/lineGrid';
import { diagramTextRanges, textRow, type DiagramTextRow, type DiagramTextRun } from '../../../../domain/core/diagrams/diagramText';
import { projectDiagramContent, type DiagramViews } from '../../../../domain/mapping/workspace/diagramViewState';
import type { DiagramContentDiff } from '../../../../domain/mapping/changes/diagramContentDiff';

export interface PreviewTextRun extends DiagramTextRun { diffVersion?: 'previous' | 'current'; diffStatus?: 'removed' }
export interface PreviewTextRow extends DiagramTextRow { runs: PreviewTextRun[] }
type Edit = { start: number; end: number; previous: string; current: string; contentNodeId?: string };

/** Display-only rows. Source content, IDs, jumps, mappings and provenance stay intact. */
export function changePreviewText(scene: LineGridScene, views: DiagramViews | undefined,
  diffs: ReadonlyMap<string, DiagramContentDiff>, modifiedDiagramIds: ReadonlySet<string>, jumps: readonly CanvasJump[] = []) {
  const projections = new Map<string, {
    rows: PreviewTextRow[]; ascii: string; rowForLine: Map<number, number>; prefixRowForNode: Map<string, number>;
    columnForLine: (line: number, column: number) => number;
  }>();
  for (const { box } of flattenGrid(resolveScene(scene))) {
    if (box.kind !== 'diagram') continue;
    const displayNodeId = `grid:${box.id}`, diagram = scene.contents[box.contentId], content = diagram.content;
    const visible = projectDiagramContent(content, views?.[displayNodeId]);
    const ranges = diagramTextRanges({ ascii: content.ascii, content, displayNodeId, mappings: diagram.sourceContext.mappings, jumps: [...(diagram.jumps ?? []), ...jumps.filter(jump => jump.sourceDisplayNodeId === displayNodeId)] });
    const source = content.ascii.split('\n'), edits = new Map<number, Edit[]>();
    if (modifiedDiagramIds.has(displayNodeId)) for (const modification of diffs.get(displayNodeId)?.modifications ?? []) {
      const selected = modification.proposed;
      const span = selected.contentNodeId
        ? ranges.get(selected.sourceLine)?.find(range => range.owner?.contentNodeId === selected.contentNodeId)
        : { start: 0, end: source[selected.sourceLine - 1]?.length ?? 0 };
      if (!span) continue;
      const edit = { start: span.start, end: span.end, previous: modification.original.text, current: modification.proposed.text, contentNodeId: selected.contentNodeId };
      const bucket = edits.get(selected.sourceLine);
      if (bucket) bucket.push(edit); else edits.set(selected.sourceLine, [edit]);
    }
    for (const bucket of edits.values()) bucket.sort((a, b) => a.start - b.start);
    const extraWidth = (edit: Edit) => 4 + Math.max(edit.previous.length, edit.current.length) - (edit.end - edit.start);
    const rows: PreviewTextRow[] = [], rowForLine = new Map<number, number>(), prefixRowForNode = new Map<string, number>();
    const view = views?.[displayNodeId];
    const collapsed = new Set(view?.contentRevisionId === content.revisionId ? view.collapsedContentNodeIds : []);
    const removals = modifiedDiagramIds.has(displayNodeId)
      ? (diffs.get(displayNodeId)?.removals ?? []).filter(removal => !removal.ancestorIds.some(id => collapsed.has(id))) : [];
    const pending = [...removals].sort((a, b) => a.beforeLine - b.beforeLine);
    const insertRemovals = (beforeLine: number) => {
      while (pending.length && pending[0].beforeLine <= beforeLine) {
        const { text, spans } = pending.shift()!;
        const runs: PreviewTextRun[] = [];
        let cursor = 0;
        for (const { start, end } of [...spans].sort((a, b) => a.start - b.start)) {
          if (start > cursor) runs.push({ start: cursor, end: start, text: text.slice(cursor, start), mappings: [] });
          runs.push({ start, end, text: text.slice(start, end), mappings: [], diffStatus: 'removed' });
          cursor = end;
        }
        if (cursor < text.length) runs.push({ start: cursor, end: text.length, text: text.slice(cursor), mappings: [] });
        rows.push({ text, runs });
      }
    };
    for (const line of visible.sourceLines) {
      insertRemovals(line);
      const original = textRow(source[line - 1], ranges.get(line) ?? [], line), changes = edits.get(line) ?? [];
      if (!changes.length) { rowForLine.set(line, rows.length); rows.push(original); continue; }
      const primary: PreviewTextRun[] = [], peer: PreviewTextRun[] = [];
      let offset = 0, cursor = 0;
      const copy = (start: number, end: number) => {
        for (const run of original.runs) {
          const from = Math.max(start, run.start), to = Math.min(end, run.end);
          if (from >= to) continue;
          primary.push({ ...run, start: from + offset, end: to + offset, text: run.text.slice(from - run.start, to - run.start),
            owner: run.owner ? { ...run.owner, columnOffset: run.owner.columnOffset + offset } : undefined });
        }
      };
      const literal = (runs: PreviewTextRun[], start: number, text: string, diffVersion?: PreviewTextRun['diffVersion']) => {
        if (text) runs.push({ start, end: start + text.length, text, mappings: [], diffVersion });
      };
      for (const edit of changes) {
        const start = edit.start + offset;
        // The tree branch and fold control introduce the pair on its first row.
        // The selected current label still owns its endpoint on the second row.
        if (edit.contentNodeId) prefixRowForNode.set(edit.contentNodeId, rows.length);
        const prefix = edit.contentNodeId
          ? original.text.slice(cursor, edit.start).match(/[ |]*[|+`\\]--(?:>)? *$/)?.[0] : undefined;
        if (prefix) {
          const prefixStart = edit.start - prefix.length;
          copy(cursor, prefixStart);
          literal(primary, prefixStart + offset, prefix.replace(/[|+`\\]--(?:>)?/, branch =>
            (branch[0] === '|' ? '|' : ' ') + ' '.repeat(branch.length - 1)));
          const end = peer.at(-1)?.end ?? 0;
          literal(peer, end, ' '.repeat(prefixStart + offset - end));
          literal(peer, prefixStart + offset, prefix);
        } else copy(cursor, edit.start);
        literal(primary, start, '[+] ', 'current');
        const peerStart = peer.at(-1)?.end ?? 0;
        literal(peer, peerStart, ' '.repeat(start - peerStart));
        literal(peer, start, `[-] ${edit.previous}`, 'previous');
        offset += 4;
        copy(edit.start, edit.end);
        const padding = extraWidth(edit) - 4;
        literal(primary, edit.end + offset, ' '.repeat(padding));
        offset += padding; cursor = edit.end;
      }
      copy(cursor, original.text.length);
      const mainRow = { text: primary.map(run => run.text).join(''), sourceLine: line, runs: primary };
      const peerRow = { text: peer.map(run => run.text).join(''), runs: peer };
      rowForLine.set(line, rows.length + 1);
      rows.push(peerRow, mainRow);
    }
    insertRemovals(Infinity);
    projections.set(displayNodeId, { rows, ascii: rows.map(row => row.text).join('\n'), rowForLine, prefixRowForNode,
      columnForLine: (line, column) => column + (edits.get(line) ?? []).filter(edit => edit.end <= column).reduce((sum, edit) => sum + extraWidth(edit), 0) });
  }

  // Reserve space and settle collisions on a temporary view of the grid. Content
  // remains the original parsed content; only this renderer's bounds are expanded.
  const resize = (box: GridBox): GridBox => {
    if (box.kind === 'container') return { ...box, children: box.children.map(resize) };
    const size = measureContent(projections.get(`grid:${box.id}`)!.ascii);
    return { ...box, minimumSize: { columns: Math.max(box.minimumSize?.columns ?? 0, size.columns), rows: Math.max(box.minimumSize?.rows ?? 0, size.rows) } };
  };
  const display = layoutScene({ ...scene, root: resize(scene.root) }, scene.root.id);
  const resolved = resolveScene(display), boxes = flattenGrid(resolved);
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
  return { rows, resolved, boxes, projections };
}
