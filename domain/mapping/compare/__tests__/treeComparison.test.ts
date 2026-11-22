import { describe, expect, it } from 'vitest';
import { childStep, layoutTreeComparison, treeLineDepth, treeMatchSchema, validateTreeComparison, type CompareTreeSpec, type TreeStep } from '../treeComparison';
import { comparisonReportSchema } from '../comparisonReport';

const A = ['Root A', '|', '|-- one', '|   |-- one.a', '|   `-- one.b', '|-- two', '`-- three'].join('\n');
const B = ['Root B', '|', '|-- extra', '|   `-- extra.a', '|-- one', '|   `-- one.a', '|-- three', '`-- two'].join('\n');
const lines = (side: 'A' | 'B', layout: ReturnType<typeof layoutTreeComparison>) =>
  layout.rows.map(row => row[side].kind === 'line' ? (row[side] as { line: number }).line : row[side].kind);
const step = (patch: Partial<TreeStep>): TreeStep => ({ title: 'Step', matches: [], ...patch });

describe('tree comparison layout', () => {
  it('parses node depths from tree prefixes', () => {
    expect([1, 2, 3, 4, 5].map(n => treeLineDepth(A.split('\n')[n - 1], n))).toEqual([0, undefined, 1, 2, 2]);
  });

  it('keeps source order and inserts spacers to align matched nodes', () => {
    const layout = layoutTreeComparison(A, B, step({ matches: [{ id: 'one', kind: 'same', label: 'One', A: [{ startLine: 3, endLine: 4 }], B: [{ startLine: 5, endLine: 6 }] }] }), false);
    const a = lines('A', layout), b = lines('B', layout);
    expect(a.filter(x => typeof x === 'number')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(b.filter(x => typeof x === 'number')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a.indexOf(3)).toBe(b.indexOf(5));
    expect(layout.spans[0]).toEqual({ match: 0, A: [{ top: a.indexOf(3), bottom: a.indexOf(4) }], B: [{ top: b.indexOf(5), bottom: b.indexOf(6) }] });
  });

  it('aligns the heaviest order-preserving subset and still colours crossing matches', () => {
    const layout = layoutTreeComparison(A, B, step({ root: { A: 3, B: 5 }, matches: [
      { id: 'two', kind: 'same', label: 'Two', A: [{ startLine: 6, endLine: 6 }], B: [{ startLine: 8, endLine: 8 }] },
      { id: 'three', kind: 'same', label: 'Three', A: [{ startLine: 7, endLine: 7 }], B: [{ startLine: 7, endLine: 7 }] }
    ] }), false);
    const a = lines('A', layout), b = lines('B', layout);
    expect(a.indexOf(3)).toBe(b.indexOf(5));
    expect(a.indexOf(6) === b.indexOf(8) || a.indexOf(7) === b.indexOf(7)).toBe(true);
    expect(layout.spans.every(span => span.A[0].top >= 0 && span.B[0].top >= 0)).toBe(true);
  });

  it('folds unrelated stretches but keeps ancestors of highlighted lines', () => {
    const long = ['Root', '|', '|-- p', ...Array.from({ length: 8 }, (_, i) => `|   |-- filler ${i}`), '|   `-- target', '`-- end'].join('\n');
    const layout = layoutTreeComparison(long, long, step({ matches: [{ id: 't', kind: 'same', label: 'T', A: [{ startLine: 12, endLine: 12 }], B: [{ startLine: 12, endLine: 12 }] }] }));
    const a = lines('A', layout);
    expect(a).toContain(3);
    expect(a).toContain('fold');
    expect(a).not.toContain(7);
  });

  it('places absent markers and indents roots to the same column', () => {
    const layout = layoutTreeComparison(A, B, step({ root: { A: 4, B: 5 }, absent: [{ side: 'B', afterLine: 6, text: 'one.b' }] }), false);
    expect(layout.rows.some(row => row.B.kind === 'absent')).toBe(true);
    expect(layout.indent).toEqual({ A: 0, B: 4 });
  });
});

describe('tree comparison validation', () => {
  const sources = [{ id: 'S1', label: 'A', runId: 'r1', cellKey: 'c', revisionId: 'v1', ascii: A }, { id: 'S2', label: 'B', runId: 'r2', cellKey: 'c', revisionId: 'v2', ascii: B }];
  const spec = (patch: Partial<TreeStep>): CompareTreeSpec => ({ id: 'x', title: 'X', explanation: '', A: 'S1', B: 'S2', steps: [step(patch)] });
  it('accepts in-bounds references inside a report', () => {
    expect(comparisonReportSchema.parse({ treeSources: sources, pages: [{ id: 'p', title: 'P', blocks: [{ kind: 'compare-tree', spec: spec({ root: { A: 3, B: 5 } }) }] }] }).pages).toHaveLength(1);
  });
  it('rejects out-of-bounds ranges, unknown trees and folds over evidence', () => {
    expect(validateTreeComparison(spec({ matches: [{ id: 'm', kind: 'same', label: 'M', A: [{ startLine: 1, endLine: 99 }], B: [{ startLine: 1, endLine: 1 }] }] }), sources)).toHaveLength(1);
    expect(validateTreeComparison({ ...spec({}), B: 'S3' }, sources)[0]).toMatch(/unknown tree/);
    expect(validateTreeComparison(spec({ root: { A: 3, B: 3 }, folds: [{ side: 'A', range: { startLine: 2, endLine: 4 } }] }), sources)[0]).toMatch(/folds cannot hide/);
    expect(() => comparisonReportSchema.parse({ treeSources: sources, pages: [{ id: 'p', title: 'P', blocks: [{ kind: 'compare-tree', spec: { ...spec({}), A: 'S9' } }] }] })).toThrow();
  });
});

describe('child matches inside a top-level match', () => {
  const r = (startLine: number, endLine = startLine) => ({ startLine, endLine });
  const parent = { id: 'one', kind: 'same' as const, label: 'One', A: [r(3, 5)], B: [r(5, 6)], children: {
    comment: 'Inside one', matches: [{ id: 'a', kind: 'same' as const, label: 'one.a', A: [r(4)], B: [r(6)] }], absent: [{ side: 'B' as const, afterLine: 6, text: 'one.b' }] } };
  const sources = [{ id: 'S1', label: 'A', runId: 'r1', cellKey: 'c', revisionId: 'v', ascii: A }, { id: 'S2', label: 'B', runId: 'r2', cellKey: 'c', revisionId: 'v', ascii: B }];
  const spec = (match: unknown): CompareTreeSpec => ({ id: 'x', title: 'X', explanation: '', A: 'S1', B: 'S2', steps: [{ title: 'Top', matches: [match as CompareTreeSpec['steps'][number]['matches'][number]] }] });

  it('allows one level of children and rejects grandchildren', () => {
    expect(treeMatchSchema.safeParse(parent).success).toBe(true);
    const nested = { ...parent, children: { matches: [{ ...parent.children.matches[0], children: { matches: [] } }] } };
    expect(treeMatchSchema.safeParse(nested).success).toBe(false);
  });

  it('builds a child step rooted at the parent with everything outside it folded', () => {
    const child = childStep(parent, { A: 7, B: 8 })!;
    expect(child.root).toEqual({ A: 3, B: 5 });
    expect(child.matches.map(m => m.id)).toEqual(['a']);
    expect(child.folds).toEqual([{ side: 'A', range: r(1, 2) }, { side: 'A', range: r(6, 7) }, { side: 'B', range: r(1, 4) }, { side: 'B', range: r(7, 8) }]);
    expect(validateTreeComparison({ ...spec(parent), steps: [child] }, sources)).toEqual([]);
    const layout = layoutTreeComparison(A, B, child);
    expect(lines('A', layout).filter(x => typeof x === 'number')).toEqual([3, 4, 5]);
    expect(childStep({ ...parent, children: undefined }, { A: 7, B: 8 })).toBeUndefined();
  });

  it('requires children and absent markers to lie inside the parent', () => {
    expect(validateTreeComparison(spec(parent), sources)).toEqual([]);
    const outside = { ...parent, children: { matches: [{ ...parent.children.matches[0], A: [r(6)] }], absent: [{ side: 'B' as const, afterLine: 2, text: 'x' }] } };
    const errors = validateTreeComparison(spec(outside), sources);
    expect(errors.some(e => e.includes('one/a') && e.includes('inside the parent'))).toBe(true);
    expect(errors.some(e => e.includes('absent marker line 2'))).toBe(true);
  });

  it('lets relocated children point outside the parent and keeps those lines visible', () => {
    const relocated = { ...parent, children: { matches: [{ id: 'moved', kind: 'relocated' as const, label: 'two', A: [r(4)], B: [r(8)] }] } };
    expect(validateTreeComparison(spec(relocated), sources)).toEqual([]);
    const child = childStep(relocated, { A: 7, B: 8 })!;
    expect(child.folds).toEqual([{ side: 'A', range: r(1, 2) }, { side: 'A', range: r(6, 7) }, { side: 'B', range: r(1, 4) }, { side: 'B', range: r(7, 7) }]);
    expect(lines('B', layoutTreeComparison(A, B, child)).filter(x => typeof x === 'number')).toEqual([5, 6, 8]);
  });
});
