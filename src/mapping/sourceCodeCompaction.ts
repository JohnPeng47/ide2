import type { CompactedSource, CompactedSourceNode } from '../core/domain';
import type { ProjectedFile } from './displayModel';

/** Adapt exact projection mappings to the same folding model used by Studio. */
export function sourceCodeCompaction(file: ProjectedFile) {
  const lines = file.ascii.split('\n');
  const ranges = new Map<string, { startLine: number; endLine: number; rows: number[] }>();
  file.rows.forEach((row, index) => {
    if (!row.selected) return;
    for (const range of row.sourceRanges) {
      const key = `${range.startLine}:${range.endLine}`;
      const entry = ranges.get(key) ?? { ...range, rows: [] };
      if (!entry.rows.includes(index)) entry.rows.push(index);
      ranges.set(key, entry);
    }
  });
  const entries = [...ranges.values()].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const groups: { startLine: number; endLine: number; entries: typeof entries }[] = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    // Overlapping mappings share a fold; disjoint source stays visible between folds.
    if (previous && entry.startLine <= previous.endLine) {
      previous.endLine = Math.max(previous.endLine, entry.endLine);
      previous.entries.push(entry);
    } else groups.push({ startLine: entry.startLine, endLine: entry.endLine, entries: [entry] });
  }
  const compactedSource: CompactedSource = {
    level: 'medium',
    sections: groups.map(group => {
      const nodes: CompactedSourceNode[] = [];
      const comments = group.entries.flatMap(entry => entry.rows.map(row => ({ row, entry })))
        .sort((a, b) => a.row - b.row || a.entry.startLine - b.entry.startLine)
        .map(({ row, entry }, index) => {
          nodes.push({ graphLine: index + 1, startLine: entry.startLine, endLine: entry.endLine });
          return lines[row];
        });
      return { kind: 'collapsed-comment', startLine: group.startLine, endLine: group.endLine,
        comment: comments.join('\n'), nodes };
    })
  };
  return { entries, compactedSource };
}
