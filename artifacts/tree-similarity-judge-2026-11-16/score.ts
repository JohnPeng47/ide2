import { z } from 'zod';

/** Deterministic re-scoring of a judge's anchor tree. No model calls. */
const range = z.tuple([z.number().int().positive(), z.number().int().positive()]);
const unmatched = z.object({ lines: range, label: z.string() }).passthrough();
export interface Level { pairs: Pair[]; unmatchedA: z.infer<typeof unmatched>[]; unmatchedB: z.infer<typeof unmatched>[]; J: number }
export interface Pair { label: string; a: [number, number][]; b: [number, number][]; grouped: boolean; relocated: boolean; offset: number; inner: Level | 'summarized' | 'leaves'; s: number }
export const levelSchema: z.ZodType<Level> = z.lazy(() => z.object({
  pairs: z.array(pairSchema), unmatchedA: z.array(unmatched), unmatchedB: z.array(unmatched), J: z.number()
}).passthrough()) as z.ZodType<Level>;
const pairSchema: z.ZodType<Pair> = z.lazy(() => z.object({
  label: z.string(), a: z.array(range).min(1), b: z.array(range).min(1), grouped: z.boolean(), relocated: z.boolean(),
  offset: z.number().int().min(0), inner: z.union([z.literal('summarized'), z.literal('leaves'), levelSchema]), s: z.number()
}).passthrough()) as z.ZodType<Pair>;
export const judgeOutputSchema = z.object({ score: z.number(), anchors: levelSchema, markdown: z.string().min(1).max(100_000) }).passthrough();
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

export interface Rescore { J: number; reportedJ: number; pairs: number; unmatchedA: number; unmatchedB: number; depth: number; maxPairError: number; rangeIssues: string[] }
export function rescore(output: JudgeOutput, lines: { A: number; B: number }): Rescore & { score: number; reportedScore: number } {
  const issues: string[] = []; let maxPairError = 0, depth = 0;
  const check = (side: 'A' | 'B', r: [number, number], where: string) => {
    if (r[0] > r[1] || r[1] > lines[side]) issues.push(`${where}: ${side} ${r[0]}–${r[1]} outside 1–${lines[side]}`);
  };
  const level = (l: Level, d: number, where: string): number => {
    depth = Math.max(depth, d);
    l.unmatchedA.forEach(u => check('A', u.lines, where)); l.unmatchedB.forEach(u => check('B', u.lines, where));
    const sum = l.pairs.reduce((total, p) => total + pair(p, d, `${where}/${p.label}`), 0);
    const denominator = l.pairs.length + l.unmatchedA.length + l.unmatchedB.length;
    return denominator ? sum / denominator : 0;
  };
  const pair = (p: Pair, d: number, where: string) => {
    p.a.forEach(r => check('A', r, where)); p.b.forEach(r => check('B', r, where));
    const inner = p.inner === 'leaves' ? 1 : p.inner === 'summarized' ? 0.8 : level(p.inner, d + 1, where);
    const s = 0.9 ** p.offset * (0.5 + 0.5 * inner) * (p.relocated ? 0.5 : 1);
    maxPairError = Math.max(maxPairError, Math.abs(s - p.s));
    return s;
  };
  const J = level(output.anchors, 1, '');
  return { score: J, reportedScore: output.score, J, reportedJ: output.anchors.J, pairs: output.anchors.pairs.length,
    unmatchedA: output.anchors.unmatchedA.length, unmatchedB: output.anchors.unmatchedB.length, depth, maxPairError, rangeIssues: issues };
}
