import type { DiagramContent } from '../diagrams/diagramContent';
import type { DiagramContentDiff } from '../diagrams/diagramContentDiff';
import type { Diagram } from '../diagrams/diagram';
import { diagramContentNodes } from '../diagrams/diagramContentNodes';
import { textRow, type DiagramTextRange, type DiagramTextRow, type DiagramTextRun } from './diagramText';

export interface DiagramDiffTextRun extends DiagramTextRun { diffVersion?: 'previous' | 'current'; diffStatus?: 'removed' }
export interface DiagramDiffTextRow extends DiagramTextRow { runs: DiagramDiffTextRun[] }
type PreviewTextRun = DiagramDiffTextRun;
type PreviewTextRow = DiagramDiffTextRow;
type Edit = { start: number; end: number; previous: string; current: string; contentNodeId?: string; originalContentNodeId?: string; originalLine: number };

/** Pure Diagram presentation, independent of canvas layout, storage, React and review workflows. */
export function projectDiagramDiffRows({ content, ranges, sourceLines, collapsedContentNodeIds = [], diff, enabled = true,
  previous, previousRanges, previousDecoration }: {
  content: DiagramContent; ranges: ReadonlyMap<number, readonly DiagramTextRange[]>; sourceLines: readonly number[];
  collapsedContentNodeIds?: readonly string[]; diff?: DiagramContentDiff; enabled?: boolean;
  previous?: Diagram; previousRanges?: ReadonlyMap<number, readonly DiagramTextRange[]>;
  previousDecoration?: (contentNodeId?: string) => Partial<DiagramDiffTextRun> | undefined;
}) {
    const previousLines = previous?.content.ascii.split('\n');
    const previousRuns = (line: number | undefined, start: number, end: number, target: number): PreviewTextRun[] => {
      if (!line || !previousLines?.[line - 1] || !previousRanges) return [];
      return textRow(previousLines[line - 1], previousRanges.get(line) ?? [], line).runs.flatMap(run => {
        const from = Math.max(start, run.start), to = Math.min(end, run.end);
        return from >= to ? [] : [{ ...run, start: target + from - start, end: target + to - start,
          text: run.text.slice(from - run.start, to - run.start),
          owner: run.owner ? { ...run.owner, side: 'before' as const, columnOffset: target - start } : undefined }];
      });
    };
    const source = content.ascii.split('\n'), edits = new Map<number, Edit[]>();
    if (enabled) for (const modification of diff?.modifications ?? []) {
      const selected = modification.proposed;
      const span = selected.contentNodeId
        ? ranges.get(selected.sourceLine)?.find(range => range.owner?.contentNodeId === selected.contentNodeId)
        : { start: 0, end: source[selected.sourceLine - 1]?.length ?? 0 };
      if (!span) continue;
      const edit = { start: span.start, end: span.end, previous: modification.original.text, current: modification.proposed.text, contentNodeId: selected.contentNodeId, originalContentNodeId: modification.original.contentNodeId, originalLine: modification.original.sourceLine };
      const bucket = edits.get(selected.sourceLine);
      if (bucket) bucket.push(edit); else edits.set(selected.sourceLine, [edit]);
    }
    for (const bucket of edits.values()) bucket.sort((a, b) => a.start - b.start);
    const extraWidth = (edit: Edit) => 4 + Math.max(edit.previous.length, edit.current.length) - (edit.end - edit.start);
    const rows: PreviewTextRow[] = [], rowForLine = new Map<number, number>(), prefixRowForNode = new Map<string, number>();
    const collapsed = new Set(collapsedContentNodeIds);
    const removals = enabled
      ? (diff?.removals ?? []).filter(removal => !removal.ancestorIds.some(id => collapsed.has(id))) : [];
    const pending = [...removals].sort((a, b) => a.beforeLine - b.beforeLine);
    const insertRemovals = (beforeLine: number) => {
      while (pending.length && pending[0].beforeLine <= beforeLine) {
        const { text, spans, sourceLine } = pending.shift()!;
        const runs: PreviewTextRun[] = [];
        let cursor = 0;
        for (const { start, end, contentNodeId } of [...spans].sort((a, b) => a.start - b.start)) {
          if (start > cursor) runs.push({ start: cursor, end: start, text: text.slice(cursor, start), mappings: [] });
          const decorated = previousRuns(sourceLine, start, end, start);
          runs.push(...(decorated.length ? decorated : [{ start, end, text: text.slice(start, end), mappings: [] }]).map(run => ({ ...run, diffStatus: 'removed' as const,
            ...previousDecoration?.(contentNodeId) })));
          cursor = end;
        }
        if (cursor < text.length) runs.push({ start: cursor, end: text.length, text: text.slice(cursor), mappings: [] });
        rows.push({ text, runs });
      }
    };
    for (const line of sourceLines) {
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
      const literal = (runs: PreviewTextRun[], start: number, text: string, diffVersion?: PreviewTextRun['diffVersion'], decoration?: Partial<PreviewTextRun>) => {
        if (text) runs.push({ start, end: start + text.length, text, mappings: [], diffVersion, ...decoration });
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
        literal(peer, start, '[-] ', 'previous');
        const oldNode = previous && edit.originalContentNodeId ? diagramContentNodes(previous.content).find(node => node.id === edit.originalContentNodeId) : undefined;
        const oldStart = oldNode ? oldNode.startColumn - 1 : 0;
        const decorated = previousRuns(edit.originalLine, oldStart, oldStart + edit.previous.length, start + 4);
        if (decorated.length) peer.push(...decorated.map(run => ({ ...run, diffVersion: 'previous' as const,
          ...previousDecoration?.(edit.originalContentNodeId) })));
        else literal(peer, start + 4, edit.previous, 'previous', previousDecoration?.(edit.originalContentNodeId));
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
    return { rows, ascii: rows.map(row => row.text).join('\n'), rowForLine, prefixRowForNode,
      columnForLine: (line: number, column: number) => column + (edits.get(line) ?? []).filter(edit => edit.end <= column).reduce((sum, edit) => sum + extraWidth(edit), 0) };
}
