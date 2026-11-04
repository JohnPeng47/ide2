import { expect, it } from 'vitest';
import { alignedComparisonRows } from '../alignedComparisonRows';
import { diagramJudgementSchema, canvasJudgementSchema } from '../../evals/judgement';
import { validateOpinions } from '../comparisonOpinion';
const rows = Array.from({ length: 12 }, (_, i) => ({ text: `Line ${i + 1}`, sourceLine: i + 1, runs: [] }));
it.each([true, false])('aligns corresponding ranges while preserving every source line (expanded=%s)', expanded => {
  const A = [{ startLine: 2, endLine: 3 }, { startLine: 7, endLine: 8 }], B = [{ startLine: 4, endLine: 6 }, { startLine: 8, endLine: 11 }];
  const selected = (ranges: typeof A) => expanded ? rows : rows.filter(row => ranges.some(range => row.sourceLine >= range.startLine && row.sourceLine <= range.endLine));
  const a = alignedComparisonRows(selected(A), A, B, expanded), b = alignedComparisonRows(selected(B), B, A, expanded);
  A.forEach((range, i) => expect(a.findIndex(row => row.sourceLine === range.startLine)).toBe(b.findIndex(row => row.sourceLine === B[i].startLine)));
  expect(a.filter(row => row.sourceLine)).toEqual(selected(A));
  expect(b.filter(row => row.sourceLine)).toEqual(selected(B));
});
it('allows a justified custom scale with consistent rating references', () => {
  expect(() => validateOpinions({ kind: 'custom', title: 'Mechanism explicitness', reason: 'This report isolates how responsibilities are made explicit.', levels: [
    { id: 'implicit', label: 'Implicit', meaning: 'Responsibility must be inferred.' }, { id: 'explicit', label: 'Explicit', meaning: 'Responsibility is stated.' }
  ] }, [{ level: 'explicit', attributionConfidence: 'low', rationale: 'Single pair only.' }])).not.toThrow();
});
it('restricts Diagram judgements to diagrams while Canvas judgements can contain both kinds', () => {
  const diagram = { kind: 'diagram', canvasCopyId: 'copy', diagramId: 'tree', revisionId: 'revision', ranges: [{ startLine: 1, endLine: 2 }] };
  const canvas = { kind: 'canvas', canvasCopyId: 'copy', camera: { transform: { offset: { x: 0, y: 0 }, scale: 1 } } };
  const items = [{ id: 'd', title: 'Diagram', A: diagram, B: diagram }, { id: 'c', title: 'Canvas', A: canvas, B: canvas }];
  expect(canvasJudgementSchema.safeParse({ comparisons: items }).success).toBe(true);
  expect(diagramJudgementSchema.safeParse({ comparisons: items }).success).toBe(false);
});
