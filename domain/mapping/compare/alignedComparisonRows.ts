import type { DiagramTextRow } from '../../core/presentation/diagramText';
import type { CompareRange } from './comparePageSession';

/** Display-only padding aligns corresponding excerpts without changing source line identities. */
export function alignedComparisonRows(rows: DiagramTextRow[], own: CompareRange[], other: CompareRange[], expanded: boolean): DiagramTextRow[] {
  if (own.length !== other.length) return rows;
  const before = new Map<number, number>(), after = new Map<number, number>();
  own.forEach((range, i) => {
    const counterpart = other[i];
    const context = range.startLine - (i ? own[i - 1].endLine : 0) - 1;
    const otherContext = counterpart.startLine - (i ? other[i - 1].endLine : 0) - 1;
    before.set(range.startLine, expanded ? Math.max(0, otherContext - context) : 0);
    after.set(range.endLine, Math.max(0, counterpart.endLine - counterpart.startLine - (range.endLine - range.startLine)));
  });
  const blanks = (count: number) => Array.from({ length: count }, (): DiagramTextRow => ({ text: '', runs: [] }));
  return rows.flatMap(row => row.sourceLine === undefined ? [row] : [...blanks(before.get(row.sourceLine) ?? 0), row, ...blanks(after.get(row.sourceLine) ?? 0)]);
}
