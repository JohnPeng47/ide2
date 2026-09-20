import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { explainNode, parseDiagram, renderCleaned, type DiagramInterpretation, type Recognizer } from '..';
import { matchTracks } from '../wires';

const corpusRoot = new URL('../../../../../tools/diagram-parser/diagram_parser/', import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, corpusRoot), 'utf8');
const parents = (p: DiagramInterpretation) => p.nodes.map(n => [n.label, p.nodes.find(x => x.id === n.parentId)?.label ?? null]);
const references = (p: DiagramInterpretation) => p.edges.filter(e => e.kind === 'references').map(e =>
  [p.nodes.find(n => n.id === e.from)!.label, p.nodes.find(n => n.id === e.to)!.label]);
const signature = (p: DiagramInterpretation) => ({ parents: parents(p), references: references(p).sort() });

describe('spatial diagram interpreter', () => {
  it('preserves original offsets through tabs, ANSI, Unicode, quotes, and CRLF', () => {
    const source = '> ```text\r\n> \ufeffRoot\r\n> │\t└── \x1b[32m日本語 🚀\x1b[0m\r\n> ```';
    const p = parseDiagram(source, { dialect: 'tree' });
    expect(p.source.original).toBe(source);
    expect(parents(p)).toEqual([['Root', null], ['日本語 🚀', 'Root']]);
    const span = p.nodes[1].spans[0];
    expect(source.slice(span.start, span.end)).toBe('日本語 🚀');
    // Tab stops are expanded before the consistent two-column quote wrapper is removed.
    expect(span.column).toBe(7);
    expect(p.lines).toHaveLength(4);
  });

  it('selects supported fences and preserves excluded text', () => {
    const p = parseDiagram('Prose\n```python\nprint(1)\n```\n```tree\nRoot\n+-- A\n```\nNotes', { dialect: 'tree' });
    expect(parents(p)).toEqual([['Root', null], ['A', 'Root']]);
    expect(p.lines[0].kind).toBe('outside');
    expect(p.lines[2].kind).toBe('outside');
    expect(p.source.rows[2].raw).toBe('print(1)');
  });

  it('keeps duplicate label occurrences distinct', () => {
    const p = parseDiagram('Root\n|-- p ----> Same\n`-- q ----> Same', { dialect: 'graph' });
    expect(references(p)).toEqual([['p', 'Same'], ['q', 'Same']]);
    expect(new Set(p.nodes.filter(n => n.label === 'Same').map(n => n.id)).size).toBe(2);
  });

  it('makes arrow-tree dialect ambiguity explicit', () => {
    const source = 'Root\n+--> A';
    const unknown = parseDiagram(source);
    expect(unknown.unresolved.some(u => u.code === 'ambiguous-connector')).toBe(true);
    expect(unknown.edges).toEqual([]);
    expect(parents(parseDiagram(source, { dialect: 'tree' }))).toEqual([['Root', null], ['A', 'Root']]);
    const graph = parseDiagram(source, { dialect: 'graph' });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved.some(u => u.code === 'unresolved-reference')).toBe(true);
  });

  it('keeps ambiguous narrow indentation unresolved and respects explicit guides', () => {
    const uncertain = parseDiagram('Root\n+-- A\n +-- B', { dialect: 'graph' });
    expect(uncertain.unresolved.map(u => u.code)).toContain('ambiguous-indentation');
    expect(uncertain.nodes.find(n => n.label === 'B')?.parentId).toBeUndefined();
    expect(parents(parseDiagram('Root\n+- A\n|+- B', { dialect: 'graph' }))).toEqual([
      ['Root', null], ['A', 'Root'], ['B', 'A']]);
    expect(parents(parseDiagram('Root\n+-- A\n +-- B', { dialect: 'graph', treeTolerance: 0 }))).toEqual([
      ['Root', null], ['A', 'Root'], ['B', 'A']]);
  });

  it('preserves protected arrows and ordinary punctuation in labels', () => {
    const p = parseDiagram('Root\n|-- map [id -> record]\n|-- status: settled | ...\n|-- horizontal --- separator\n`-- a-b { column, row }', { dialect: 'graph' });
    expect(p.nodes.map(n => n.label)).toEqual(['Root', 'map [id -> record]', 'status: settled | ...',
      'horizontal --- separator', 'a-b { column, row }']);
    expect(p.edges.filter(e => e.kind === 'references')).toEqual([]);
  });

  it('separates crossing channels and connects explicit junctions', () => {
    const source = 'A ----+\n      |\nB ----|----> C\n      |\n      v\n      D';
    expect(references(parseDiagram(source, { dialect: 'graph' })).sort()).toEqual([['A', 'D'], ['B', 'C']]);
    expect(references(parseDiagram(source.replace('B ----|', 'B ----+'), { dialect: 'graph' })).sort()).toEqual([
      ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D']]);
  });

  it.each([['A\nv\nB', [['A', 'B']]], ['A\n^\n|\nB', [['B', 'A']]], ['A <--- B', [['B', 'A']]]])(
    'resolves arrow direction: %s', (source, expected) => {
      expect(references(parseDiagram(source as string, { dialect: 'graph' }))).toEqual(expected);
    });

  it('repairs a uniquely matched wire without rewriting its original evidence', () => {
    const source = 'A ------+\n         |\n        |\n         v\n         B';
    const p = parseDiagram(source, { dialect: 'graph' });
    expect(references(p)).toEqual([['A', 'B']]);
    expect(p.source.original).toBe(source);
    const rendered = renderCleaned(p);
    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.text).toBe('A -------+\n         |\n         |\n         v\n         B');
    expect(rendered.sourceMap).toHaveLength(rendered.text.length);
    const again = parseDiagram(rendered.text, { dialect: 'graph' });
    expect(signature(again)).toEqual(signature(p));
    expect(again.repairs).toEqual([]);
    expect(explainNode(p, p.nodes[0].id)?.repairs.length).toBeGreaterThan(0);
  });

  it('does not infer continuity through a blocked repair', () => {
    const p = parseDiagram('A --+\n    |X\n      |\n      v\n      B', { dialect: 'graph' });
    expect(references(p)).toEqual([]);
    expect(p.unresolved.map(u => u.code)).toContain('blocked-wire-repair');
  });

  it('retains unsupported and incomplete drawing evidence', () => {
    const source = '???\nA --+\n    |\n    |';
    const p = parseDiagram(source, { dialect: 'graph' });
    expect(p.nodes.some(n => n.label.includes('???'))).toBe(true);
    expect(p.unresolved.map(u => u.code)).toContain('unheaded-reference');
    expect(p.source.rows.map(r => r.raw).join('\n')).toBe(source);
  });

  it('handles wrapping and detached lists through explicit policies', () => {
    const source = 'Root\n+-- Ready /\n|   Applied\n`-- End\n\nNotes:\n- explanation';
    const p = parseDiagram(source, { dialect: 'tree' });
    expect(p.nodes.map(n => n.label)).toEqual(['Root', 'Ready / Applied', 'End']);
    expect(p.nodes[1].spans).toHaveLength(2);
    expect(parseDiagram(source, { dialect: 'tree', continuation: 'separate', detachedLists: 'include' }).nodes.map(n => n.label))
      .toContain('explanation');
    expect(parents(parseDiagram('Root\n  Child\nSecond\n  Another', { dialect: 'tree' }))).toEqual([
      ['Root', null], ['Child', 'Root'], ['Second', null], ['Another', 'Second']]);
  });

  it('supports glyph aliases without changes to dispatch or topology', () => {
    const p = parseDiagram('A ~~~> B', { dialect: 'graph', glyphs: { '~': 'horizontal' } });
    expect(references(p)).toEqual([['A', 'B']]);
    expect(parseDiagram('A ~~~> B', { dialect: 'graph' }).nodes.map(n => n.label)).toEqual(['A ~~~> B']);
  });

  it('adds a recognizer without changing existing cases or depending on registration order', () => {
    const rule: Recognizer = { id: 'double-at-branch', starts: ['@'], recognize({ row, column }) {
      return row.text.startsWith('@@ ', column - 1) ? [{ kind: 'branch', endColumn: column + 2 }] : [];
    } };
    const irrelevant: Recognizer = { id: 'unused', starts: ['!'], recognize: () => [] };
    const source = 'Root\n@@ Child';
    const a = parseDiagram(source, { dialect: 'tree', recognizers: [rule, irrelevant] });
    const b = parseDiagram(source, { dialect: 'tree', recognizers: [irrelevant, rule] });
    expect(a).toEqual(b);
    expect(parents(a)).toEqual([['Root', null], ['Child', 'Root']]);
    const neighbor = 'Root\n+-- @literal';
    expect(parseDiagram(neighbor, { dialect: 'tree', recognizers: [rule] })).toEqual(parseDiagram(neighbor, { dialect: 'tree' }));
    expect(() => parseDiagram(source, { recognizers: [rule, rule] })).toThrow('unique');
  });

  it('bounds expansion, candidate production, and input size', () => {
    expect(() => parseDiagram('x', { maxChars: 0 })).toThrow();
    expect(() => parseDiagram('xx', { maxChars: 1 })).toThrow('maxChars');
    expect(() => parseDiagram('\t', { tabSize: 1000, maxColumns: 50 })).toThrow('maxColumns');
    expect(() => parseDiagram('| | |', { maxCandidates: 1 })).toThrow('maxCandidates');
    expect(() => parseDiagram('A\n+-- B', { dialect: 'tree', maxNodes: 1 })).toThrow('maxNodes');
    expect(() => matchTracks([1, 2], [1, 2], 2, 3)).toThrow('maxMatchingCells');
  });

  it('reports recognizer conflicts instead of selecting by name or registration order', () => {
    const rule = (id: string, width: number): Recognizer => ({ id, starts: ['@'],
      recognize: ({ column }) => [{ kind: 'branch', endColumn: column + width }] });
    const a = rule('short', 1), b = rule('long', 2);
    const source = 'Root\n@@ Child';
    const p = parseDiagram(source, { dialect: 'tree', recognizers: [a, b] });
    expect(p).toEqual(parseDiagram(source, { dialect: 'tree', recognizers: [b, a] }));
    expect(p.unresolved.map(u => u.code)).toContain('conflicting-recognizers');
    expect(p.edges).toEqual([]);
    expect(p.nodes.some(n => n.label === '@@ Child')).toBe(true);
  });

  it('does not let a new fenced tree or a parallel region inherit unrelated parents', () => {
    const fenced = parseDiagram('```tree\nLeft\n+-- A\n```\n```tree\nRight\n+-- B\n```', { dialect: 'tree' });
    expect(parents(fenced)).toEqual([['Left', null], ['A', 'Left'], ['Right', null], ['B', 'Right']]);
    const parallel = parseDiagram('Left        Right\n|-- a       |-- x\n|   `-- b   |   `-- y\n`-- c       `-- z', { dialect: 'graph' });
    expect(parents(parallel)).toEqual([['Left', null], ['Right', null], ['a', 'Left'], ['x', 'Right'],
      ['b', 'a'], ['y', 'x'], ['c', 'Left'], ['z', 'Right']]);
    const unicode = parseDiagram('Left🚀   Right\n|-- A    +- X\n`-- 🚀   |+- Y', { dialect: 'graph' });
    expect(parents(unicode)).toEqual([['Left🚀', null], ['Right', null], ['A', 'Left🚀'],
      ['X', 'Right'], ['🚀', 'Left🚀'], ['Y', 'X']]);
    expect(unicode.unresolved).toEqual([]);
  });

  it('matches only wire pairs present in every optimal interpretation', () => {
    // Exhaustive small independent oracle: enumerate matchings, not DP tables.
    const subsets = Array.from({ length: 16 }, (_, mask) => [0, 1, 2, 3].filter(x => mask & (1 << x)));
    for (const above of subsets) for (const below of subsets) for (const tolerance of [0, 1, 2]) {
      const all: [number, number][][] = [];
      const visit = (i: number, next: number, chosen: [number, number][]) => {
        if (i === above.length) { all.push(chosen); return; }
        visit(i + 1, next, chosen);
        for (let j = next; j < below.length; j++) if (Math.abs(above[i] - below[j]) <= tolerance) {
          visit(i + 1, j + 1, [...chosen, [above[i], below[j]]]);
        }
      };
      visit(0, 0, []);
      const drift = (pairs: [number, number][]) => pairs.reduce((sum, [a, b]) => sum + Math.abs(a - b), 0);
      all.sort((a, b) => b.length - a.length || drift(a) - drift(b));
      const best = all.filter(p => p.length === all[0].length && drift(p) === drift(all[0]));
      const forced = best[0].filter(([a, b]) => best.every(p => p.some(([x, y]) => x === a && y === b)));
      expect(matchTracks(above, below, tolerance).pairs).toEqual(forced);
    }
  });

  it('recovers independently generated trees across glyph families and indentation widths', () => {
    let seed = 7347;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const families = [['+--', '|'], ['├──', '│'], ['\\-', '|'], ['->', '|']];
    for (let trial = 0; trial < 200; trial++) {
      const [marker, guide] = families[trial % families.length];
      const width = random(4) + 2;
      const margin = ' '.repeat(random(3));
      const model = [{ label: 'Root', parent: null as string | null, depth: 0 }];
      const stack = [0];
      for (let i = 1; i < 25; i++) {
        const depth = random(stack.length) + 1;
        stack.length = depth;
        model.push({ label: `item_${i}`, parent: model[stack.at(-1)!].label, depth });
        stack.push(i);
      }
      const raw = model.map(n => margin + (n.depth ? (guide + ' '.repeat(width - 1)).repeat(n.depth - 1) + marker + ' ' : '') + n.label).join('\n');
      expect(parents(parseDiagram(raw, { dialect: 'tree' }))).toEqual(model.map(n => [n.label, n.parent]));
    }
  });

  it('handles deep ancestry without recursive traversal', () => {
    const rows = ['Root', ...Array.from({ length: 700 }, (_, i) => ' '.repeat(i * 2) + '+-- n' + i)];
    const p = parseDiagram(rows.join('\n'), { dialect: 'tree' });
    expect(p.nodes).toHaveLength(701);
    expect(p.nodes.at(-1)?.parentId).toBe(p.nodes.at(-2)?.id);
  });
});

describe('reviewed diagram fixtures', () => {
  it('keeps the neighboring GridContent hierarchy distinct from its incoming arrow', () => {
    const p = parseDiagram(fixture('fixtures/mapping_graph.txt'), { dialect: 'graph' });
    const grid = p.nodes.find(n => n.label === 'GridContent')!;
    expect(parents({ ...p, nodes: p.nodes.filter(n => n.regionId === grid.regionId) })).toEqual([
      ['GridContent', null], ['id', 'GridContent'], ['ascii', 'GridContent'], ['revision', 'GridContent'],
      ['mappings: EvidenceMapping[]', 'GridContent'], ['sourceRanges[]', 'mappings: EvidenceMapping[]'],
      ['source/file identity', 'sourceRanges[]'], ['line/column range', 'sourceRanges[]']
    ]);
    expect(p.regions.filter(r => r.kind === 'tree')).toHaveLength(3);
    expect(references(p)).toHaveLength(12);
    expect(references(p)).toContainEqual(['contents: GridContent [contentId -> content]', 'GridContent']);
    expect(p.diagnostics.filter(d => d.severity !== 'info').map(d => [d.line, d.code])).toEqual([[26, 'unheaded-reference']]);
  });

  it('matches every workbench parent and all seven references', () => {
    const p = parseDiagram(fixture('fixtures/workbench_renderer.txt'), { dialect: 'graph' });
    const expected: Record<number, number | null> = {
      1: null, 3: 1, 4: 3, 5: 4, 6: 5, 7: 6, 8: 6, 10: 4, 11: 10, 12: 11, 13: 11,
      14: 13, 15: 14, 16: 15, 17: 15, 19: 10, 20: 19, 21: 20, 23: 21, 25: 21,
      26: 25, 27: 25, 28: 25, 30: 21, 31: 30, 32: 31, 34: 30, 35: 34, 36: 35,
      37: 36, 38: 36, 40: 30, 54: 1, 56: 54, 57: 54, 59: 54, 61: 59, 62: 61,
      63: 61, 64: 61, 65: 64, 67: 59, 68: 67, 69: 67, 71: 59, 72: 71, 74: 59,
      75: 74, 77: 75, 78: 77, 79: 77, 80: 77, 42: null, 44: 42, 45: 44, 46: 45,
      47: 45, 49: 42, 50: 49, 51: 50, 52: 51
    };
    const line = new Map(p.nodes.map(n => [n.id, n.spans[0].line]));
    expect(Object.fromEntries(p.nodes.filter(n => n.kind === 'tree-item').map(n => [line.get(n.id), n.parentId ? line.get(n.parentId) : null]))).toEqual(expected);
    expect(references(p).sort()).toEqual([
      ['propagate dimensions', 'layout(width, height, top, left)'], ['wrapping may change', 'ViewModel [per editor]'],
      ['ITextModel', 'TextModel [shared by editors displaying this document]'], ['no: enqueue', 'EditorRenderingCoordinator'],
      ['rendering callbacks', 'queued editor renderings'], ['disconnected DOM?', 'skip editor'], ['nothing dirty?', 'skip editor']
    ].sort());
    expect(p.diagnostics).toEqual([]);
  });

  it.each(['mapping_graph', 'misaligned_neighbor', 'workbench_renderer'])('preserves semantics and is idempotent after cleanup: %s', name => {
    const p = parseDiagram(fixture(`fixtures/${name}.txt`), { dialect: 'graph' });
    const rendered = renderCleaned(p);
    expect(rendered.diagnostics).toEqual([]);
    const again = parseDiagram(rendered.text, { dialect: 'graph' });
    expect(signature(again)).toEqual(signature(p));
    expect(again.repairs).toEqual([]);
    expect(renderCleaned(again).text).toBe(rendered.text);
  });

  const oracle = JSON.parse(fixture('corpus_expected.json')) as {
    fixtures: { name: string; path: string; sha256: string; expected: { line: number; label: string; parentLine: number | null }[] }[]
  };
  it.each(oracle.fixtures)('matches the independent tree oracle: $name', f => {
    const raw = fixture(f.path);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(f.sha256);
    const p = parseDiagram(raw, { dialect: 'tree', detachedLists: 'include' });
    const lines = new Map(p.nodes.map(n => [n.id, n.spans[0].line]));
    expect(p.nodes.map(n => ({ line: n.spans[0].line, label: n.label, parentLine: n.parentId ? lines.get(n.parentId) : null }))).toEqual(f.expected);
  });
});
