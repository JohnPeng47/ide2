import { z } from 'zod';
import { compareRangeSchema, type CompareRange } from './comparePageSession';
import { opinionSchema } from './comparisonOpinion';

/**
 * Side-by-side evidence over two ASCII trees. Trees keep their original order;
 * alignment comes from inserted spacer rows, correspondence from colour and gutter bands.
 */
const id = z.string().min(1).max(200);
const line = z.number().int().positive();
const side = z.enum(['A', 'B']);
export const treeSourceSchema = z.object({
  id: z.string().regex(/^S[1-9]\d*$/), label: z.string().trim().min(1).max(120),
  runId: id, cellKey: id, revisionId: id, ascii: z.string().min(1)
}).strict();
export type TreeSource = z.infer<typeof treeSourceSchema>;
export const treeMatchKinds = ['same', 'depth-shift', 'implied-parent', 'relocated'] as const;
const treeMatchFields = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), kind: z.enum(treeMatchKinds),
  label: z.string().trim().min(1).max(120),
  A: z.array(compareRangeSchema).min(1).max(20), B: z.array(compareRangeSchema).min(1).max(20),
  /** False keeps the colour and band but does not insert spacers for this match. */
  align: z.boolean().optional(),
  /** The side whose ranges share a grouping that is not drawn as a node there. */
  implied: z.object({ side, label: z.string().trim().min(1).max(120) }).strict().optional(),
  comment: z.string().trim().min(1).max(2000).optional()
}).strict();
const impliedNamed = (match: { kind: string; implied?: unknown }) => match.kind !== 'implied-parent' || !!match.implied;
const absentSchema = z.array(z.object({ side, afterLine: z.number().int().min(0), text: z.string().trim().min(1).max(300) }).strict()).max(20);
/** Child matches inside one top-level match. One level only: children cannot have children. */
export const treeMatchChildrenSchema = z.object({
  comment: z.string().trim().min(1).max(5000).optional(),
  matches: z.array(treeMatchFields.refine(impliedNamed, 'Implied-parent matches name the implied grouping')).max(40),
  absent: absentSchema.optional()
}).strict().refine(children => new Set(children.matches.map(m => m.id)).size === children.matches.length, 'Child match IDs must be unique within a match');
export const treeMatchSchema = treeMatchFields.extend({ children: treeMatchChildrenSchema.optional() }).strict()
  .refine(impliedNamed, 'Implied-parent matches name the implied grouping');
export type TreeMatch = z.infer<typeof treeMatchSchema>;
export type TreeMatchChildren = z.infer<typeof treeMatchChildrenSchema>;
export const treeStepSchema = z.object({
  title: z.string().trim().min(1).max(120),
  comment: z.string().trim().min(1).max(5000).optional(),
  root: z.object({ A: line, B: line }).strict().optional(),
  matches: z.array(treeMatchSchema).max(40),
  absent: absentSchema.optional(),
  folds: z.array(z.object({ side, range: compareRangeSchema }).strict()).max(40).optional()
}).strict().refine(step => new Set(step.matches.map(m => m.id)).size === step.matches.length, 'Match IDs must be unique within a step');
export type TreeStep = z.infer<typeof treeStepSchema>;
export const compareTreeSpecSchema = z.object({
  id, title: z.string().min(1).max(200), explanation: z.string().max(10000), opinion: opinionSchema.optional(),
  A: z.string().regex(/^S[1-9]\d*$/), B: z.string().regex(/^S[1-9]\d*$/),
  steps: z.array(treeStepSchema).min(1).max(10)
}).strict().refine(spec => spec.A !== spec.B, 'Compare two different trees');
export type CompareTreeSpec = z.infer<typeof compareTreeSpecSchema>;

export const treeMatchPalette = ['#e8a33d', '#4fa3e0', '#a585ec', '#4cbf8a', '#e0607e', '#3fbfbf', '#c9b03b', '#e07a3f'];
export const treeMatchColor = (index: number) => treeMatchPalette[index % treeMatchPalette.length];

const splitLines = (ascii: string) => ascii.split('\n');
const nodePrefix = /^((?:[|`\s] {3})*)[|`]-- /;
/** Depth 0 is the title line; undefined marks connector-only or blank lines. */
export function treeLineDepth(text: string, lineNumber: number) {
  if (lineNumber === 1) return 0;
  const match = nodePrefix.exec(text);
  return match ? match[1].length / 4 + 1 : undefined;
}
/** Column where the node's own text starts. */
export function treeLineIndent(text: string) {
  const match = nodePrefix.exec(text);
  return match ? match[0].length : 0;
}

export function validateTreeComparison(spec: CompareTreeSpec, sources: readonly TreeSource[]) {
  const errors: string[] = [];
  const lengths = { A: 0, B: 0 };
  for (const s of ['A', 'B'] as const) {
    const source = sources.find(item => item.id === spec[s]);
    if (!source) errors.push(`${spec.title}: unknown tree ${spec[s]}`);
    else lengths[s] = splitLines(source.ascii).length;
  }
  if (errors.length) return errors;
  const inBounds = (s: 'A' | 'B', range: CompareRange, where: string) => {
    if (range.endLine > lengths[s]) errors.push(`${spec.title} · ${where}: ${s} range ${range.startLine}-${range.endLine} exceeds ${lengths[s]} lines`);
  };
  spec.steps.forEach(step => {
    const where = (detail: string) => `${step.title} · ${detail}`;
    if (step.root) for (const s of ['A', 'B'] as const) if (step.root[s] > lengths[s]) errors.push(`${spec.title} · ${where('root')}: ${s} line ${step.root[s]} out of bounds`);
    const ordered = (match: { id: string; A: CompareRange[]; B: CompareRange[] }, label: string) => {
      for (const s of ['A', 'B'] as const) {
        match[s].forEach(range => inBounds(s, range, where(label)));
        if (match[s].some((range, i) => i && range.startLine <= match[s][i - 1].endLine)) errors.push(`${spec.title} · ${where(label)}: ${s} ranges must be ordered and non-overlapping`);
      }
    };
    for (const match of step.matches) {
      ordered(match, match.id);
      if (!match.children) continue;
      const inside = (s: 'A' | 'B', line: number) => match[s].some(r => line >= r.startLine && line <= r.endLine);
      for (const child of match.children.matches) {
        ordered(child, `${match.id}/${child.id}`);
        // A relocated child's counterpart sits under another anchor, so it may point outside the parent.
        if (child.kind !== 'relocated') for (const s of ['A', 'B'] as const) if (child[s].some(r => !match[s].some(p => r.startLine >= p.startLine && r.endLine <= p.endLine)))
          errors.push(`${spec.title} · ${where(`${match.id}/${child.id}`)}: ${s} ranges must lie inside the parent match`);
      }
      for (const item of match.children.absent ?? []) if (!inside(item.side, item.afterLine))
        errors.push(`${spec.title} · ${where(`${match.id} children`)}: absent marker line ${item.afterLine} must lie inside the parent match`);
    }
    for (const item of step.absent ?? []) if (item.afterLine > lengths[item.side]) errors.push(`${spec.title} · ${where('absent')}: line ${item.afterLine} out of bounds`);
    for (const fold of step.folds ?? []) {
      inBounds(fold.side, fold.range, where('fold'));
      const kept = keptLines(step, fold.side);
      if ([...kept].some(n => n >= fold.range.startLine && n <= fold.range.endLine)) errors.push(`${spec.title} · ${where('fold')}: folds cannot hide matched, root or absent-anchor lines`);
    }
  });
  return errors;
}

function keptLines(step: TreeStep, s: 'A' | 'B') {
  const kept = new Set<number>();
  for (const match of step.matches) for (const range of match[s]) for (let n = range.startLine; n <= range.endLine; n++) kept.add(n);
  if (step.root) kept.add(step.root[s]);
  for (const item of step.absent ?? []) if (item.side === s && item.afterLine) kept.add(item.afterLine);
  return kept;
}

/**
 * The view inside one top-level match: its children as matches, with every line outside
 * the parent's ranges folded away, except lines of relocated children placed elsewhere.
 * The parent's first line on each side is the root.
 */
export function childStep(match: TreeMatch, lineCounts: { A: number; B: number }): TreeStep | undefined {
  if (!match.children) return undefined;
  const folds = (['A', 'B'] as const).flatMap(s => {
    const out: { side: 'A' | 'B'; range: CompareRange }[] = [];
    const shown = [...match[s], ...match.children!.matches.flatMap(child => child[s])].sort((x, y) => x.startLine - y.startLine);
    let next = 1;
    for (const r of shown) { if (r.startLine > next) out.push({ side: s, range: { startLine: next, endLine: r.startLine - 1 } }); next = Math.max(next, r.endLine + 1); }
    if (next <= lineCounts[s]) out.push({ side: s, range: { startLine: next, endLine: lineCounts[s] } });
    return out;
  });
  return { title: match.label, ...(match.children.comment ? { comment: match.children.comment } : {}),
    root: { A: match.A[0].startLine, B: match.B[0].startLine },
    matches: match.children.matches, ...(match.children.absent ? { absent: match.children.absent } : {}), folds };
}

export type TreeCell =
  | { kind: 'line'; line: number; text: string; matches: number[]; root: boolean; context: boolean }
  | { kind: 'spacer' }
  | { kind: 'absent'; text: string }
  | { kind: 'fold'; from: number; to: number };
export interface TreeLayout {
  rows: { A: TreeCell; B: TreeCell }[];
  /** Extra left padding (in characters) so the two root nodes start in the same column. */
  indent: { A: number; B: number };
  /** Row spans of each match's ranges, for bands and highlights. */
  spans: { match: number; A: { top: number; bottom: number }[]; B: { top: number; bottom: number }[] }[];
}

/**
 * Deterministic layout: the judge supplies line references only.
 * `fold` collapses unrelated stretches, keeping ancestors of highlighted nodes for context.
 */
export function layoutTreeComparison(asciiA: string, asciiB: string, step: TreeStep, fold = true): TreeLayout {
  const texts = { A: splitLines(asciiA), B: splitLines(asciiB) };
  const streams = { A: stream('A'), B: stream('B') };
  function stream(s: 'A' | 'B') {
    const lines = texts[s], kept = keptLines(step, s), context = new Set<number>();
    // Ancestors of every highlighted line remain visible, so placement can be read from the excerpt.
    for (const n of kept) {
      let depth = treeLineDepth(lines[n - 1] ?? '', n) ?? Infinity;
      for (let p = n - 1; p >= 1 && depth > 0; p--) {
        const d = treeLineDepth(lines[p - 1], p);
        if (d !== undefined && d < depth) { context.add(p); depth = d; }
      }
    }
    const hidden = new Set<number>();
    for (const item of step.folds ?? []) if (item.side === s) for (let n = item.range.startLine; n <= item.range.endLine; n++) hidden.add(n);
    if (fold) {
      let start = 0;
      const flush = (end: number) => { // [start, end) is a run of unrelated lines; keep one line of context at each edge
        if (end - start > 3) for (let n = start + 1; n < end - 1; n++) hidden.add(n);
      };
      for (let n = 1; n <= lines.length + 1; n++) {
        const visible = n > lines.length || kept.has(n) || context.has(n);
        if (visible) { if (start) flush(n); start = 0; } else if (!start) start = n;
      }
    }
    const cells: TreeCell[] = [];
    const absentAfter = (n: number) => (step.absent ?? []).filter(item => item.side === s && item.afterLine === n)
      .forEach(item => cells.push({ kind: 'absent', text: item.text }));
    absentAfter(0);
    for (let n = 1; n <= lines.length; n++) {
      if (hidden.has(n)) {
        const last = cells[cells.length - 1];
        if (last?.kind === 'fold' && last.to === n - 1) last.to = n; else cells.push({ kind: 'fold', from: n, to: n });
      } else {
        const matches = step.matches.flatMap((match, i) => match[s].some(r => n >= r.startLine && n <= r.endLine) ? [i] : []);
        cells.push({ kind: 'line', line: n, text: lines[n - 1], matches, root: step.root?.[s] === n, context: !kept.has(n) });
      }
      absentAfter(n);
    }
    return cells;
  }
  const position = (s: 'A' | 'B', n: number) => streams[s].findIndex(cell => cell.kind === 'line' && cell.line === n);

  // Candidate anchors; the heaviest order-preserving subset is aligned (the root always wins).
  const candidates: { a: number; b: number; weight: number }[] = [];
  if (step.root) candidates.push({ a: position('A', step.root.A), b: position('B', step.root.B), weight: 1000 });
  for (const match of step.matches) {
    if (match.align === false) continue;
    const pairs = match.A.length === match.B.length ? match.A.map((range, i) => [range, match.B[i]] as const) : [[match.A[0], match.B[0]] as const];
    for (const [ra, rb] of pairs) candidates.push({ a: position('A', ra.startLine), b: position('B', rb.startLine), weight: 1 });
  }
  const anchors = heaviestChain(candidates.filter(c => c.a >= 0 && c.b >= 0));

  const rows: TreeLayout['rows'] = [];
  let pa = 0, pb = 0;
  const emit = (ea: number, eb: number) => {
    const count = Math.max(ea - pa, eb - pb);
    for (let i = 0; i < count; i++) rows.push({ A: pa + i < ea ? streams.A[pa + i] : { kind: 'spacer' }, B: pb + i < eb ? streams.B[pb + i] : { kind: 'spacer' } });
    pa = ea; pb = eb;
  };
  for (const anchor of anchors) emit(anchor.a, anchor.b);
  emit(streams.A.length, streams.B.length);

  const rootIndent = (s: 'A' | 'B') => step.root ? treeLineIndent(texts[s][step.root[s] - 1]) : 0;
  const shift = rootIndent('A') - rootIndent('B');
  const rowOf = (s: 'A' | 'B', n: number) => rows.findIndex(row => row[s].kind === 'line' && (row[s] as { line: number }).line === n);
  const spans = step.matches.map((match, i) => ({ match: i,
    A: match.A.map(r => ({ top: rowOf('A', r.startLine), bottom: rowOf('A', r.endLine) })),
    B: match.B.map(r => ({ top: rowOf('B', r.startLine), bottom: rowOf('B', r.endLine) })) }));
  return { rows, indent: { A: Math.max(0, -shift), B: Math.max(0, shift) }, spans };
}

/** Weighted longest chain increasing on both sides (small n; O(n²)). */
function heaviestChain(candidates: { a: number; b: number; weight: number }[]) {
  const sorted = [...candidates].sort((x, y) => x.a - y.a || x.b - y.b);
  const best = sorted.map(c => c.weight), previous = sorted.map(() => -1);
  for (let i = 0; i < sorted.length; i++) for (let j = 0; j < i; j++)
    if (sorted[j].a < sorted[i].a && sorted[j].b < sorted[i].b && best[j] + sorted[i].weight > best[i]) { best[i] = best[j] + sorted[i].weight; previous[i] = j; }
  let end = best.indexOf(Math.max(...best, -Infinity));
  const chain: typeof sorted = [];
  while (end >= 0) { chain.unshift(sorted[end]); end = previous[end]; }
  return chain;
}

/** Agent-authored evidence. ASCII is copied server-side from each pinned run output. */
export const treeComparisonRequestSchema = z.object({
  requestId: z.string().uuid(), title: z.string().trim().min(1).max(160),
  experimentId: id.optional(),
  evaluator: z.object({ model: z.string().trim().min(1).max(100), effort: z.string().trim().min(1).max(40), prompt: z.string().max(200_000).optional() }).strict(),
  sources: z.array(z.object({ id: z.string().regex(/^S[1-9]\d*$/), label: z.string().trim().min(1).max(120).optional(), runId: id, cellKey: id, revisionId: id }).strict()).min(2).max(10)
    .refine(sources => new Set(sources.map(s => s.id)).size === sources.length, 'Tree IDs must be unique'),
  /** Report pages; treeSources is filled by the server. */
  pages: z.array(z.unknown()).min(1).max(20)
}).strict();
export type TreeComparisonRequest = z.infer<typeof treeComparisonRequestSchema>;
