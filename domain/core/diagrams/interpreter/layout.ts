import { sourceSpan } from './source';
import type { Candidate, DiagramInterpretation, GlyphKind, Label, SourceSpan, WireCell } from './types';

export function decision(result: DiagramInterpretation, ruleId: string, reason: string,
  evidence: SourceSpan[], candidateIds: string[] = [], repairIds: string[] = []): string {
  const id = `decision-${result.decisions.length}`;
  result.decisions.push({ id, ruleId, reason, evidence, candidateIds, repairIds });
  return id;
}

export function unresolved(result: DiagramInterpretation, code: string, reason: string, spans: SourceSpan[],
  alternatives: DiagramInterpretation['unresolved'][number]['alternatives']): void {
  result.unresolved.push({ id: `unresolved-${result.unresolved.length}`, code, reason, spans, alternatives });
  result.diagnostics.push({ code, severity: 'warning', line: spans[0]?.line ?? 1, message: reason });
}

/** Choose structural roles before splitting labels; recognition never consumes source. */
export function interpretLayout(result: DiagramInterpretation, glyphs: Readonly<Record<string, GlyphKind>>):
  { labels: Label[]; wires: WireCell[] } {
  const { source, policy } = result;
  const labels: Label[] = [];
  const wires: WireCell[] = [];
  const byLine = new Map<number, Candidate[]>();
  for (const candidate of result.candidates) {
    if (!byLine.has(candidate.span.line)) byLine.set(candidate.span.line, []);
    byLine.get(candidate.span.line)!.push(candidate);
  }
  for (const row of source.rows) {
    if (row.kind !== 'content') continue;
    if (/^[ +\-_=─━═┌┐└┘┏┓┗┛╔╗╚╝╭╮╰╯┬┴┼]+$/.test(row.text) && row.text.trim().length >= 3) {
      result.lines[row.line - 1].kind = 'metadata'; continue;
    }
    const choices = byLine.get(row.line) ?? [];
    let prefixEnd = 0;
    while (prefixEnd < row.text.length && (row.text[prefixEnd] === ' ' || glyphs[row.text[prefixEnd]] === 'vertical')) prefixEnd++;
    const prefixOnly = (column: number) => column - 1 <= prefixEnd;
    const branches = choices.filter(c => {
      if (c.kind !== 'branch') return false;
      if (policy.dialect === 'graph' && ['horizontal', 'right'].includes(glyphs[row.text[c.span.column - 1]])) return false;
      if (prefixOnly(c.span.column)) return true;
      if (policy.dialect === 'tree') return false;
      let before = c.span.column - 2;
      while (before >= 0 && (row.text[before] === ' ' || glyphs[row.text[before]] === 'vertical')) before--;
      const localPrefix = row.text.slice(before + 1, c.span.column - 1);
      return localPrefix.includes('   ') || choices.some(other => other.kind === 'route' &&
        other.span.endColumn >= before + 2 && other.span.endColumn <= c.span.column);
    });
    const selected: Candidate[] = [];
    const uncertain: Candidate[] = [];
    const byColumn = new Map<number, Candidate[]>();
    for (const c of choices) {
      if (!byColumn.has(c.span.column)) byColumn.set(c.span.column, []);
      byColumn.get(c.span.column)!.push(c);
    }
    const branchesAt = new Map(branches.map(c => [c.span.column, c]));
    for (const [column, options] of byColumn) {
      if (selected.some(c => c.kind !== 'vertical' && column < c.span.endColumn) ||
        uncertain.some(c => column < c.span.endColumn)) continue;
      const branch = branchesAt.get(column);
      const route = options.filter(c => c.kind === 'route').sort((a, b) => b.span.endColumn - a.span.endColumn)[0];
      const applicable = options.filter(c => c.kind === 'route' && policy.dialect !== 'tree' || c.kind === 'branch' && branches.includes(c));
      const conflicting = (['branch', 'route'] as const).some(kind => new Set(applicable.filter(c => c.kind === kind)
        .map(c => `${c.span.endColumn}:${!!c.bullet}:${!!c.headed}`)).size > 1);
      if (conflicting) {
        uncertain.push(...applicable);
        unresolved(result, 'conflicting-recognizers', 'Recognizers disagree about this shape; registration order cannot settle it.',
          applicable.map(c => c.span), applicable.map(c => ({ description: `${c.ruleId}: ${c.kind} through column ${c.span.endColumn - 1}`,
            candidateIds: [c.id] })));
        continue;
      }
      if (branch && route && prefixOnly(column) && (policy.dialect === 'mixed' || policy.dialect === 'unknown')) {
        uncertain.push(branch, route);
        unresolved(result, 'ambiguous-connector', 'This marker can mean containment or a reference; select a diagram convention.',
          [route.span], [{ description: 'Containment branch', candidateIds: [branch.id] },
            { description: 'Reference wire', candidateIds: [route.id] }]);
        continue;
      }
      const chosen = policy.dialect === 'tree' ? branch : route ?? branch;
      if (chosen) {
        selected.push(chosen);
        decision(result, 'connector-convention', `${policy.dialect} convention selects ${chosen.kind}.`,
          [chosen.span], options.map(c => c.id));
        continue;
      }
      if (policy.dialect === 'tree') continue;
      const stroke = options.find(c => c.kind === 'vertical');
      if (!stroke) continue;
      const ch = row.text[column - 1];
      const guide = branches.some(c => c.span.column > column) && prefixOnly(column);
      if (guide) continue;
      const suffixPipes = [...row.text.slice(column - 1)].every(c => c === ' ' || glyphs[c] === 'vertical');
      const neighbors = [source.rows[row.line - 2], source.rows[row.line]].filter(other => other?.block === row.block);
      const supported = neighbors.some(other => {
        const near = other.text.slice(Math.max(0, column - 1 - policy.wireTolerance), column + policy.wireTolerance);
        return [...near].some(c => glyphs[c] === 'vertical' || glyphs[c] === 'joint' || glyphs[c] === 'down' || glyphs[c] === 'up');
      });
      if (prefixOnly(column) || ['up', 'down'].includes(glyphs[ch]) ||
        (suffixPipes && supported) || row.text.slice(Math.max(0, column - 4), column - 1) === '   ') selected.push(stroke);
    }
    // Graph runs own their cells; guide candidates remain visible in the evidence.
    for (const item of selected) {
      if (item.kind === 'branch') continue;
      for (let column = item.span.column; column < item.span.endColumn; column++) {
        const raw = row.text[column - 1];
        if (glyphs[raw]) wires.push({ line: row.line, column, raw, glyph: glyphs[raw],
          candidateId: item.id, span: sourceSpan(row, column, column + 1) });
      }
    }
    const selectedAt = new Map(selected.map(c => [c.span.column, c]));
    let pending: Candidate | undefined;
    let x = 0;
    const labelsBefore = labels.length;
    while (x < row.text.length) {
      const item = selectedAt.get(x + 1);
      if (item) {
        if (item.kind === 'branch') pending = item;
        x = item.span.endColumn - 1; continue;
      }
      if (row.text[x] === ' ' || (glyphs[row.text[x]] === 'vertical' && prefixOnly(x + 1))) { x++; continue; }
      const start = x;
      const closing: string[] = [];
      while (x < row.text.length) {
        const ch = row.text[x];
        if (!closing.length && x > start && selectedAt.has(x + 1)) break;
        if (!closing.length && policy.dialect !== 'tree' && row.text.startsWith('   ', x)) break;
        if ('[{('.includes(ch)) closing.push(({ '[': ']', '{': '}', '(': ')' } as Record<string, string>)[ch]);
        else if (closing.at(-1) === ch) closing.pop();
        x++;
      }
      const text = row.text.slice(start, x).trimEnd();
      if (text) {
        const span = sourceSpan(row, start + 1, start + text.length + 1);
        const guideEnd = pending ? pending.span.column - 1 : start;
        const guides: number[] = [];
        for (let col = 0; col < guideEnd; col++) if (glyphs[row.text[col]] === 'vertical') guides.push(col + 1);
        labels.push({ span, text, branch: pending, guides, block: row.block,
          column: span.column, anchor: pending?.span.column,
          uncertain: uncertain.some(c => c.span.column < span.endColumn && span.column < c.span.endColumn) });
      }
      pending = undefined;
      if (policy.dialect === 'tree') break;
      if (x === start) x++;
    }
    if (labels.length === labelsBefore) result.lines[row.line - 1].kind = 'drawing';
  }
  return { labels, wires };
}
