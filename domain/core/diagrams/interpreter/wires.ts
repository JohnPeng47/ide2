import { decision, unresolved } from './layout';
import type { DiagramInterpretation, Label, WireCell } from './types';

/** All matchings maximize track count, then minimize drift. Only forced pairs survive. */
export function matchTracks(above: number[], below: number[], tolerance: number, maxCells = 100_000):
  { pairs: [number, number][]; alternatives: [number, number][] } {
  const width = below.length + 1;
  const size = (above.length + 1) * width;
  if (size > maxCells) throw new RangeError('Wire matching exceeds maxMatchingCells');
  const reward = Math.min(above.length, below.length) * tolerance + 1;
  const f = new Float64Array(size);
  const b = new Float64Array(size);
  const at = (i: number, j: number) => i * width + j;
  const value = (i: number, j: number) => Math.abs(above[i] - below[j]) <= tolerance
    ? reward - Math.abs(above[i] - below[j]) : -Infinity;
  for (let i = 0; i < above.length; i++) for (let j = 0; j < below.length; j++) {
    f[at(i + 1, j + 1)] = Math.max(f[at(i, j + 1)], f[at(i + 1, j)], f[at(i, j)] + value(i, j));
  }
  for (let i = above.length - 1; i >= 0; i--) for (let j = below.length - 1; j >= 0; j--) {
    b[at(i, j)] = Math.max(b[at(i + 1, j)], b[at(i, j + 1)], b[at(i + 1, j + 1)] + value(i, j));
  }
  const best = b[0];
  const options: [number, number][] = [];
  const freeAbove = new Set<number>();
  const freeBelow = new Set<number>();
  for (let i = 0; i < above.length; i++) {
    for (let j = 0; j <= below.length; j++) if (f[at(i, j)] + b[at(i + 1, j)] === best) freeAbove.add(above[i]);
    for (let j = 0; j < below.length; j++) if (f[at(i, j)] + value(i, j) + b[at(i + 1, j + 1)] === best) options.push([above[i], below[j]]);
  }
  for (let j = 0; j < below.length; j++) for (let i = 0; i <= above.length; i++) {
    if (f[at(i, j)] + b[at(i, j + 1)] === best) freeBelow.add(below[j]);
  }
  const pairs = options.filter(([a, z]) => !freeAbove.has(a) && !freeBelow.has(z) &&
    options.filter(([x]) => x === a).length === 1 && options.filter(([, x]) => x === z).length === 1);
  return { pairs, alternatives: options.filter(pair => !pairs.includes(pair)) };
}

class Components {
  private parents = new Map<string, string>();
  add(key: string) { if (!this.parents.has(key)) this.parents.set(key, key); }
  root(key: string): string {
    this.add(key);
    let root = key;
    while (this.parents.get(root) !== root) root = this.parents.get(root)!;
    while (key !== root) { const next = this.parents.get(key)!; this.parents.set(key, root); key = next; }
    return root;
  }
  join(a: string, b: string) { this.parents.set(this.root(a), this.root(b)); }
}
const pos = (cell: Pick<WireCell, 'line' | 'column'>) => `${cell.line}:${cell.column}`;
const channel = (cell: WireCell, axis: 'h' | 'v') => `${pos(cell)}:${axis}`;
const vertical = (cell?: WireCell) => cell && ['joint', 'vertical', 'up', 'down'].includes(cell.glyph);
const horizontal = (cell?: WireCell) => cell && ['joint', 'horizontal', 'left', 'right'].includes(cell.glyph);

export function interpretWires(result: DiagramInterpretation, labels: Label[], input: WireCell[]): void {
  if (result.policy.dialect === 'tree') return;
  const cells = new Map(input.map(cell => [pos(cell), cell]));
  const connected = new Components();
  const entries: { key: string; cell: WireCell; axis: 'h' | 'v' }[] = [];
  const crossing = (cell: WireCell) => cell.glyph === 'vertical' &&
    horizontal(cells.get(`${cell.line}:${cell.column - 1}`)) && horizontal(cells.get(`${cell.line}:${cell.column + 1}`));
  const hasH = (cell?: WireCell) => cell && (horizontal(cell) || crossing(cell));
  for (const cell of cells.values()) {
    if (hasH(cell)) entries.push({ key: channel(cell, 'h'), cell, axis: 'h' });
    if (vertical(cell)) entries.push({ key: channel(cell, 'v'), cell, axis: 'v' });
    if (cell.glyph === 'joint') connected.join(channel(cell, 'h'), channel(cell, 'v'));
    const right = cells.get(`${cell.line}:${cell.column + 1}`);
    if (hasH(cell) && hasH(right) && cell.glyph !== 'right' && right!.glyph !== 'left') connected.join(channel(cell, 'h'), channel(right!, 'h'));
  }
  const byLine = new Map<number, WireCell[]>();
  for (const cell of cells.values()) if (vertical(cell)) byLine.set(cell.line, [...(byLine.get(cell.line) ?? []), cell]);
  const links: [WireCell, WireCell][] = [];
  for (const [line, row] of byLine) {
    if (result.source.rows[line - 1].block !== result.source.rows[line]?.block) continue;
    const above = row.filter(c => c.glyph !== 'down').sort((a, b) => a.column - b.column);
    const below = (byLine.get(line + 1) ?? []).filter(c => c.glyph !== 'up').sort((a, b) => a.column - b.column);
    const tolerance = result.policy.repairs === 'none' ? 0 : result.policy.wireTolerance;
    // Spatially disconnected bundles cannot affect each other's matching.
    const columns = [...new Set([...above, ...below].map(c => c.column))].sort((a, b) => a - b);
    const bundles: number[][] = [];
    for (const x of columns) {
      if (!bundles.length || x - bundles.at(-1)!.at(-1)! > tolerance) bundles.push([]);
      bundles.at(-1)!.push(x);
    }
    for (const bundle of bundles) {
      const xs = above.filter(c => bundle.includes(c.column));
      const ys = below.filter(c => bundle.includes(c.column));
      const matching = matchTracks(xs.map(c => c.column), ys.map(c => c.column), tolerance, result.policy.maxMatchingCells);
      for (const [x, y] of matching.pairs) links.push([xs.find(c => c.column === x)!, ys.find(c => c.column === y)!]);
      if (matching.alternatives.length) unresolved(result, 'ambiguous-wire-continuation',
        'Several equally good wire continuations exist; ambiguous tracks remain disconnected.', [...xs, ...ys].map(c => c.span),
        matching.alternatives.map(([x, y]) => ({ description: `Column ${x} continues at column ${y}.` })));
    }
  }
  // Repairs are evaluated as entire vertical runs, including corners and crossings.
  const runs = new Components();
  for (const [a, b] of links) runs.join(pos(a), pos(b));
  const grouped = new Map<string, WireCell[]>();
  for (const cell of cells.values()) if (vertical(cell)) {
    const key = runs.root(pos(cell)); grouped.set(key, [...(grouped.get(key) ?? []), cell]);
  }
  const blocked = new Set<string>();
  const repairFor = new Map<string, string>();
  const labelsByLine = new Map<number, Label[]>();
  for (const label of labels) if (label.node) labelsByLine.set(label.span.line, [...(labelsByLine.get(label.span.line) ?? []), label]);
  for (const [key, run] of grouped) {
    const target = Math.max(...run.map(c => c.column));
    if (run.every(c => c.column === target)) continue;
    const occupied = run.some(cell => {
      for (let column = cell.column + 1; column <= target; column++) {
        if ((labelsByLine.get(cell.line) ?? []).some(l => column >= (l.anchor ?? l.column) && column < l.span.endColumn)) return true;
        const other = cells.get(`${cell.line}:${column}`);
        if (other && !run.includes(other) && !(other.glyph === 'horizontal' && (cell.glyph === 'joint' || crossing(cell)))) return true;
      }
      return false;
    });
    if (occupied) {
      blocked.add(key);
      unresolved(result, 'blocked-wire-repair', 'Aligning this wire would cross text or another wire.', run.map(c => c.span),
        [{ description: 'Keep the original positions without inferring continuity across the drift.' }]);
    } else {
      const id = `repair-${result.repairs.length}`;
      result.repairs.push({ id, kind: 'wire-alignment', reason: 'A unique ordered track match connects this drifting wire.',
        spans: run.map(c => c.span), moves: run.filter(c => c.column !== target).map(c => ({ line: c.line, column: c.column, toColumn: target })), changesStructure: true });
      for (const cell of run) repairFor.set(pos(cell), id);
    }
  }
  for (const [a, b] of links) if (a.column === b.column || !blocked.has(runs.root(pos(a)))) connected.join(channel(a, 'v'), channel(b, 'v'));
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = connected.root(entry.key); groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const nodeById = new Map(result.nodes.map(n => [n.id, n]));
  const regionById = new Map(result.regions.map(r => [r.id, r]));
  for (const group of groups.values()) {
    const routeCells = [...new Map(group.map(e => [pos(e.cell), e.cell])).values()];
    const heads = routeCells.filter(c => ['left', 'right', 'up', 'down'].includes(c.glyph));
    if (!heads.length && !routeCells.some(c => c.glyph === 'horizontal')) continue;
    const keys = new Set(group.map(e => e.key));
    const sources = new Set<string>();
    for (const { cell, axis } of group) {
      const { line, column, glyph } = cell;
      if (['left', 'right', 'up', 'down'].includes(glyph)) continue;
      if (axis === 'h') {
        for (const label of labelsByLine.get(line) ?? []) {
          const end = label.span.endColumn;
          if (!keys.has(`${line}:${column - 1}:h`) && column - end >= 0 && column - end <= 2) sources.add(label.node!.id);
          if (!keys.has(`${line}:${column + 1}:h`) && label.column - column > 0 && label.column - column <= 2) sources.add(label.node!.id);
        }
        if (['`', '\\'].includes(cell.raw) && !keys.has(`${line}:${column - 1}:h`)) {
          const above = (labelsByLine.get(line - 1) ?? []).filter(l => l.anchor !== undefined && l.anchor < column && l.column <= column)
            .sort((a, b) => b.column - a.column);
          if (above.length) sources.add(above[0].node!.id);
        }
      } else if (glyph === 'vertical') {
        for (const direction of [-1, 1]) {
          const nearby = cells.get(`${line + direction}:${column}`);
          const inRoute = nearby && keys.has(channel(nearby, 'v'));
          if (!inRoute) {
            const touching = (labelsByLine.get(line + direction) ?? []).filter(l => l.column <= column && column < l.span.endColumn);
            if (touching.length === 1) sources.add(touching[0].node!.id);
          }
        }
      }
    }
    // A direct vertical head can have its source immediately above/below it.
    for (const head of heads) if (head.glyph === 'down' || head.glyph === 'up') {
      const fromLine = head.line + (head.glyph === 'down' ? -1 : 1);
      const touching = (labelsByLine.get(fromLine) ?? []).filter(l => l.column <= head.column && head.column < l.span.endColumn);
      if (touching.length === 1) sources.add(touching[0].node!.id);
    }
    if (!heads.length) {
      unresolved(result, 'unheaded-reference', 'A routed wire has no arrowhead; its direction remains unresolved.', routeCells.map(c => c.span),
        [{ description: 'Undirected or incomplete connector' }]); continue;
    }
    if (sources.size > 1) result.diagnostics.push({ code: 'shared-reference-bus', severity: 'info', line: routeCells[0].line,
      message: 'The joined bus connects each explicit source to each resolved arrowhead.' });
    for (const head of heads) {
      const targets = new Map<string, { id: string; kind: 'node' | 'region' }>();
      const line = head.line + (head.glyph === 'down' ? 1 : head.glyph === 'up' ? -1 : 0);
      for (const label of labelsByLine.get(line) ?? []) {
        const start = label.anchor ?? label.column;
        const end = label.span.endColumn;
        const tolerance = result.policy.wireTolerance;
        const found = head.glyph === 'right' ? start > head.column && start - head.column <= tolerance + 2
          : head.glyph === 'left' ? head.column >= end && head.column - end <= tolerance + 1
            : head.column >= start - tolerance && head.column < end + tolerance;
        if (!found) continue;
        const wholeTree = head.glyph === 'right' && label.anchor !== undefined;
        const target = wholeTree ? regionById.get(label.node!.regionId)!.rootIds[0] : label.node!.id;
        if (target) targets.set(target, { id: target, kind: wholeTree ? 'region' : 'node' });
      }
      if (targets.size !== 1 || !sources.size) {
        unresolved(result, 'unresolved-reference', `Arrow has ${sources.size} source(s) and ${targets.size} target candidate(s).`, [head.span],
          [...targets.values()].map(t => ({ description: `Possible target: ${nodeById.get(t.id)?.label}`, nodeIds: [t.id] })));
        continue;
      }
      const target = [...targets.values()][0];
      const repairs = [...new Set(routeCells.flatMap(c => repairFor.get(pos(c)) ?? []))];
      const id = decision(result, 'wire-connectivity', 'Connected wire channels reach one geometrically resolved target.',
        routeCells.map(c => c.span), [...new Set(routeCells.map(c => c.candidateId))], repairs);
      for (const source of [...sources].sort()) result.edges.push({ id: `reference-${result.edges.length}`, kind: 'references',
        from: source, to: target.id, targetKind: target.kind, decisionId: id,
        wireCells: routeCells.map(c => ({ line: c.line, column: c.column })).sort((a, b) => a.line - b.line || a.column - b.column) });
    }
  }
}
