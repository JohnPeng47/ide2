import type { AsciiGraph, CellRect, EdgeDirection } from '../types';

export interface ExpectedBox { id: string; text: string; rect: CellRect; parent?: string }
export interface ExpectedEdge { from: string; to: string; direction: EdgeDirection; label?: string }
export interface Expectation { boxes: ExpectedBox[]; edges: ExpectedEdge[] }

const rectKey = (r: CellRect) => `${r.line1}:${r.col1}-${r.line2}:${r.col2}`;

function occurrences(line: string, text: string): number[] {
  const found: number[] = [];
  for (let i = line.indexOf(text); i >= 0; i = line.indexOf(text, i + 1)) {
    const before = line[i - 1], after = line[i + text.length];
    if ((before === undefined || /[\s|'`+>v^-]/.test(before)) && (after === undefined || /[\s|<-]/.test(after))) found.push(i + 1);
  }
  return found;
}

/** Resolve the hand-written DSL against the source drawing. Throws on any text it cannot place. */
export function resolveExpectation(ascii: string, dsl: string): Expectation {
  const grid = ascii.split('\n');
  const boxes: (ExpectedBox & { indent: number; spans: { line: number; col: number; len: number }[]; tag?: string; detached?: boolean })[] = [];
  const pendingEdges: { from: string; to: string; direction: EdgeDirection; label?: string }[] = [];
  let cursorLine = 1;
  for (const [index, raw] of dsl.split('\n').entries()) {
    const where = `DSL line ${index + 1}`;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const edge = /^edge\s+("[^"]+"|#\S+)\s+(->|<->|--)\s+("[^"]+"|#\S+)(?:\s+:\s+(.+))?$/.exec(raw.trim());
    if (edge) { pendingEdges.push({ from: edge[1], direction: edge[2] as EdgeDirection, to: edge[3], label: edge[4]?.trim() }); continue; }
    const indent = raw.length - raw.trimStart().length;
    let body = raw.trim();
    if (body.startsWith('+ ')) {
      const box = boxes.at(-1);
      if (!box || (box.indent !== indent && !box.detached)) throw new Error(`${where}: continuation must follow a box at the same indent`);
      const text = body.slice(2).trim();
      const last = box.spans.at(-1)!;
      // Arrow-only rows may sit between continuation lines; look up to three rows ahead.
      const near = (row: number) => occurrences(grid[row - 1] ?? '', text).filter(col => !boxes.some(b => b !== box &&
        b.spans.some(s => s.line === row && col < s.col + s.len && s.col < col + text.length)));
      let line = last.line + 1, cols = near(line);
      while (cols.length !== 1 && line < last.line + 3) cols = near(++line);
      if (cols.length !== 1) throw new Error(`${where}: continuation "${text}" not found once below line ${last.line}`);
      box.spans.push({ line, col: cols[0], len: text.length });
      cursorLine = line;
      continue;
    }
    const detached = body.startsWith('^ ');
    if (detached) body = body.slice(2);
    let tag: string | undefined, hint: number | undefined;
    for (;;) {
      const m = /\s+(#[\w-]+|@L\d+)$/.exec(body);
      if (!m) break;
      if (m[1].startsWith('#')) tag = m[1]; else hint = Number(m[1].slice(2));
      body = body.slice(0, m.index);
    }
    const all: { line: number; col: number }[] = [];
    grid.forEach((row, i) => { for (const col of occurrences(row, body)) all.push({ line: i + 1, col }); });
    const free = all.filter(o => !boxes.some(b => b.spans.some(s => s.line === o.line && o.col < s.col + s.len && s.col < o.col + body.length)));
    let pick = hint !== undefined ? free.filter(o => o.line === hint) : free.length === 1 ? free : free.filter(o => o.line >= cursorLine).slice(0, 1);
    if (pick.length !== 1) throw new Error(`${where}: "${body}" resolved ${pick.length} times (${all.length} occurrences)`);
    cursorLine = pick[0].line;
    const parent = [...boxes].reverse().find(b => !b.detached && b.indent < indent);
    if (!detached && indent > 0 && (!parent || parent.indent !== indent - 2)) throw new Error(`${where}: indent must be parent + 2`);
    boxes.push({ id: '', text: body, rect: { line1: 0, col1: 0, line2: 0, col2: 0 }, indent, tag, detached,
      parent: indent && !detached ? `__${boxes.indexOf(parent!)}` : undefined,
      spans: [{ line: pick[0].line, col: pick[0].col, len: body.length }] });
  }
  for (const box of boxes) {
    box.rect = { line1: box.spans[0].line, col1: Math.min(...box.spans.map(s => s.col)),
      line2: box.spans.at(-1)!.line, col2: Math.max(...box.spans.map(s => s.col + s.len - 1)) };
    box.text = box.spans.map(s => grid[s.line - 1].slice(s.col - 1, s.col - 1 + s.len)).join('\n');
    box.id = rectKey(box.rect);
  }
  for (const box of boxes) if (box.parent) box.parent = boxes[Number(box.parent.slice(2))].id;
  const ref = (token: string): string => {
    const matches = token.startsWith('#') ? boxes.filter(b => b.tag === token) : boxes.filter(b => b.text.split('\n')[0] === token.slice(1, -1));
    if (matches.length !== 1) throw new Error(`Edge endpoint ${token} matched ${matches.length} boxes`);
    return matches[0].id;
  };
  return {
    boxes: boxes.map(({ id, text, rect, parent }) => ({ id, text, rect, ...(parent ? { parent } : {}) })),
    edges: pendingEdges.map(e => ({ from: ref(e.from), to: ref(e.to), direction: e.direction, ...(e.label ? { label: e.label } : {}) }))
  };
}

export interface Score { boxes: number; boxesMatched: number; parentsMatched: number; edges: number; edgesMatched: number; edgesPredicted: number;
  missing: ExpectedBox[]; extra: { text: string; rect: CellRect }[]; wrongParents: string[]; missingEdges: string[]; extraEdges: string[] }

export function scoreGraph(expected: Expectation, actual: AsciiGraph): Score {
  const actualByKey = new Map(actual.boxes.map(b => [rectKey(b.rect), b]));
  const actualKeyById = new Map(actual.boxes.map(b => [b.id, rectKey(b.rect)]));
  const expectedKeys = new Set(expected.boxes.map(b => b.id));
  const missing = expected.boxes.filter(b => actualByKey.get(b.id)?.text !== b.text);
  const wrongParents: string[] = [];
  let parentsMatched = 0;
  for (const box of expected.boxes) {
    const found = actualByKey.get(box.id);
    if (!found || found.text !== box.text) continue;
    const parent = found.parentId ? actualKeyById.get(found.parentId) : undefined;
    if (parent === box.parent) parentsMatched++;
    else wrongParents.push(`${JSON.stringify(box.text.split('\n')[0])}: expected ${box.parent ?? 'root'}, got ${parent ?? 'root'}`);
  }
  const edgeKey = (from: string, to: string, d: string) => d === '->' ? `${from} -> ${to}` : [from, to].sort().join(` ${d} `);
  const textOf = new Map(expected.boxes.map(b => [b.id, b.text.split('\n')[0]]));
  for (const b of actual.boxes) if (!textOf.has(rectKey(b.rect))) textOf.set(rectKey(b.rect), b.text.split('\n')[0]);
  const show = (key: string) => key.replace(/\d+:\d+-\d+:\d+/g, id => JSON.stringify(textOf.get(id) ?? id));
  const want = new Set(expected.edges.map(e => edgeKey(e.from, e.to, e.direction)));
  const got = new Set(actual.edges.map(e => edgeKey(actualKeyById.get(e.from)!, actualKeyById.get(e.to)!, e.direction)));
  return {
    boxes: expected.boxes.length, boxesMatched: expected.boxes.length - missing.length, parentsMatched,
    edges: want.size, edgesMatched: [...want].filter(k => got.has(k)).length, edgesPredicted: got.size,
    missing, extra: actual.boxes.filter(b => !expectedKeys.has(rectKey(b.rect))).map(b => ({ text: b.text, rect: b.rect })),
    wrongParents, missingEdges: [...want].filter(k => !got.has(k)).map(show), extraEdges: [...got].filter(k => !want.has(k)).map(show)
  };
}
