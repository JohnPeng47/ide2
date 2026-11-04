import type { AsciiGraph, EdgeDirection, GraphBox, GraphEdge } from './types';

/**
 * Parse a free-form ASCII drawing into text boxes (with tree containment) and the wires between them.
 * Interpretation rules and their fixtures live in __tests__/fixtures/README.md.
 * Internal coordinates are zero-based; the returned model is one-based and inclusive.
 */
type Kind = 'h' | 'v' | 'j' | 'dn' | 'up' | 'rt' | 'lt' | 'mk' | 'mku' | 'md' | 'frame' | 'label';
type Dir = 'U' | 'D' | 'L' | 'R';
const STEP: Record<Dir, [number, number]> = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };
const OPPOSITE: Record<Dir, Dir> = { U: 'D', D: 'U', L: 'R', R: 'L' };
const CONNECTS: Record<Kind, Dir[]> = {
  h: ['L', 'R'], v: ['U', 'D'], j: ['U', 'D', 'L', 'R'], dn: ['U'], up: ['D'], rt: ['L'], lt: ['R'],
  mk: ['U', 'D'], mku: ['U'], md: [], frame: [], label: ['U', 'D', 'L', 'R']
};
const HEADS: Partial<Record<Kind, Dir>> = { dn: 'D', up: 'U', rt: 'R', lt: 'L' };

interface Segment { row: number; start: number; end: number; item?: { markerCol: number }; target?: boolean; frame?: { id: number; band: number; cell: number } }
interface Box {
  index: number; lines: { row: number; start: number; end: number }[]; parent?: Box; children: Box[];
  item?: { markerCol: number }; firstCol: number; flat: boolean; root: boolean; block: number; target?: boolean;
}

export function parseAsciiGraph(ascii: string): AsciiGraph {
  const rows = ascii.replace(/\r\n?/g, '\n').split('\n');
  const width = Math.max(1, ...rows.map(r => r.length)) + 2;
  const ch = (r: number, c: number) => (r >= 0 && r < rows.length && c >= 0 ? rows[r][c] ?? ' ' : ' ');
  const key = (r: number, c: number) => r * width + c;
  const kinds = new Map<number, Kind>();
  const kindAt = (r: number, c: number) => kinds.get(key(r, c));
  const isWire = (r: number, c: number) => { const k = kindAt(r, c); return k !== undefined && k !== 'label'; };
  const set = (r: number, c: number, k: Kind) => kinds.set(key(r, c), k);
  const separator = rows.map(r => /^\s*(?:=+|-+)\s*$/.test(r) && r.trim().length >= 5);
  const blank = rows.map(r => !r.trim());

  // Frames: border rows of "+---+---+" with "|" sides. Their glyphs separate cells but never carry edges.
  const frames: { id: number; top: number; bottom: number; cols: number[]; borders: number[] }[] = [];
  const borderRow = (r: number) => /^\s*\+(?:-+\+)+\s*$/.test(rows[r] ?? '');
  for (let r = 0; r < rows.length; r++) {
    if (!borderRow(r) || frames.some(f => r >= f.top && r <= f.bottom)) continue;
    const cols = [...rows[r]].flatMap((c, i) => (c === '+' ? [i] : []));
    let bottom = r, borders = [r];
    for (let x = r + 1; x < rows.length; x++) {
      if (borderRow(x)) { borders.push(x); bottom = x; continue; }
      if (!cols.every(c => [c - 2, c - 1, c, c + 1, c + 2].some(cc => ch(x, cc) === '|'))) break;
    }
    if (bottom === r) continue;
    const frame = { id: frames.length, top: r, bottom, cols, borders };
    frames.push(frame);
    for (let x = r; x <= bottom; x++) for (let c = cols[0]; c <= cols.at(-1)! + 2; c++) {
      const g = ch(x, c);
      if (borders.includes(x) ? g === '+' || g === '-' : g === '|' && cols.some(cc => Math.abs(cc - c) <= 2)) set(x, c, 'frame');
    }
  }
  const frameAt = (r: number) => frames.find(f => r > f.top && r < f.bottom && !f.borders.includes(r));

  // Branch markers: "+-- text", "'-- text", "|-- text", "+-> text".
  for (let r = 0; r < rows.length; r++) {
    if (separator[r]) continue;
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      if (!"+'`\\|".includes(row[c]) || kindAt(r, c) || (c > 0 && row[c - 1] !== ' ')) continue;
      const m = /^[+'`\\|](-{1,3}>?)(?= +\S)/.exec(row.slice(c));
      if (!m) continue;
      set(r, c, row[c] === '+' || row[c] === '|' ? 'mk' : 'mku');
      for (let i = 1; i < m[0].length; i++) set(r, c + i, 'md');
    }
  }

  // Horizontal runs: three or more dashes (with joints and heads), and labelled "--label--->" arrows.
  for (let r = 0; r < rows.length; r++) {
    if (separator[r]) continue;
    const row = rows[r];
    for (const m of row.matchAll(/--([A-Za-z][^-|]*?[^-\s])(-{3,}>)/g)) {
      const at = m.index!;
      set(r, at, 'h'); set(r, at + 1, 'h');
      for (let i = 0; i < m[1].length; i++) set(r, at + 2 + i, 'label');
    }
    // Bracketed boxes: any arrow between "]" and "[" is a wire ("[A] --> [B]", "[A] <-> [B]").
    for (const m of row.matchAll(/\] ?(<?-+>?) ?\[/g)) {
      const at = m.index! + m[0].indexOf(m[1]);
      for (let i = 0; i < m[1].length; i++) set(r, at + i, m[1][i] === '>' ? 'rt' : m[1][i] === '<' ? 'lt' : 'h');
    }
    for (const m of row.matchAll(/<?[-+]*-{3,}[-+]*>?/g)) {
      let at = m.index!, text = m[0];
      if (text.startsWith('+') && kindAt(r, at) === 'mk') { at += 1; text = text.slice(1); }
      for (let i = 0; i < text.length; i++) {
        if (kindAt(r, at + i) === 'frame' || kindAt(r, at + i) === 'md') continue;
        const g = text[i];
        set(r, at + i, g === '+' ? 'j' : g === '>' ? 'rt' : g === '<' ? 'lt' : 'h');
      }
    }
  }

  // Vertical strokes: "|" that is not between two word characters, seeded by wire-only rows or wire neighbours.
  const standaloneHead = (r: number, c: number) => (ch(r, c) === 'v' || ch(r, c) === '^') && ch(r, c - 1) === ' ' && ch(r, c + 1) === ' ';
  const wireish = (r: number, c: number) => isWire(r, c) || standaloneHead(r, c);
  const pipe = (r: number, c: number) => ch(r, c) === '|' && !kindAt(r, c) && !(ch(r, c - 1) !== ' ' && ch(r, c + 1) !== ' ' && c > 0);
  const wireOnlyRow = rows.map(r => /^[\s|+v^'`<>-]+$/.test(r) && /[|+v^]/.test(r));
  let changed = true;
  const verticals = new Set<number>();
  while (changed) {
    changed = false;
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      if (!pipe(r, c) || verticals.has(key(r, c))) continue;
      const linked = [-1, 1].some(d => [c, c - 1, c + 1].some(cc => verticals.has(key(r + d, cc)) || (wireish(r + d, cc) && ch(r + d, cc) !== '|')));
      const prefix = /^[\s|]*$/.test(rows[r].slice(0, c));
      if (wireOnlyRow[r] || linked || (prefix && [-1, 1].some(d => pipe(r + d, c) || pipe(r + d, c - 1) || pipe(r + d, c + 1)))) {
        verticals.add(key(r, c)); changed = true;
      }
    }
  }
  for (const k of verticals) kinds.set(k, 'v');
  // Joints, arrowheads and dashes that hook onto vertical wires ("--+").
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const g = ch(r, c);
    if (kindAt(r, c)) continue;
    const vertNear = (d: number) => [c, c - 1, c + 1].some(cc => { const k = kindAt(r + d, cc); return k === 'v' || k === 'j' || k === 'mk'; });
    if ((g === 'v' || g === '^') && ch(r, c - 1) === ' ' && ch(r, c + 1) === ' ' && (g === 'v' ? vertNear(-1) || ch(r - 1, c) !== ' ' : vertNear(1))) set(r, c, g === 'v' ? 'dn' : 'up');
    else if (g === '+' && (vertNear(-1) || vertNear(1))) {
      set(r, c, 'j');
      for (const d of [-1, 1]) for (let x = c + d; ch(r, x) === '-' && !kindAt(r, x); x += d) set(r, x, 'h');
      if (ch(r, c - 1) === '<' || ch(r, c + 1) === '>') set(r, c + (ch(r, c - 1) === '<' ? -1 : 1), ch(r, c - 1) === '<' ? 'lt' : 'rt');
    }
  }

  // Row segmentation into text runs; wires and markers bound them.
  const rawSegments = (r: number, splitGaps: (start: number) => boolean): Segment[] => {
    const out: Segment[] = [];
    const row = rows[r];
    let c = 0, item: Segment['item'];
    while (c < row.length) {
      const k = kindAt(r, c);
      if (k === 'mk' || k === 'mku') { item = { markerCol: c }; c++; continue; }
      if (k !== undefined || row[c] === ' ') { c++; continue; }
      const start = c;
      let end = c;
      const thisItem = item;
      item = undefined;
      const split = !thisItem || splitGaps(start);
      while (c < row.length && !kindAt(r, c)) {
        if (row[c] !== ' ') end = c;
        // A wide gap splits segments, unless the next text starts with '=', ':', '<' or '-' (aligned operators).
        else if (split && row.startsWith('   ', c) && !/^ +[=<:-]/.test(row.slice(c))) break;
        c++;
      }
      out.push({ row: r, start, end, ...(thisItem ? { item: thisItem } : {}) });
    }
    return out;
  };

  // Rows where several vertical heads land on one segment: split that segment at short arrows.
  for (let r = 1; r < rows.length; r++) {
    const heads = [...rows[r - 1]].flatMap((_, c) => (kindAt(r - 1, c) === 'dn' ? [c] : []));
    if (heads.length < 2) continue;
    for (const seg of rawSegments(r, () => false)) {
      const landing = heads.filter(c => c >= seg.start && c <= seg.end);
      if (landing.length < 2) continue;
      for (const m of rows[r].slice(seg.start, seg.end + 1).matchAll(/ (<?-{2}>) /g)) {
        for (let i = 0; i < m[1].length; i++) { const c = seg.start + m.index! + 1 + i; set(r, c, rows[r][c] === '>' ? 'rt' : rows[r][c] === '<' ? 'lt' : 'h'); }
      }
    }
  }

  // Edge labels: text sitting on a vertical wire, or ending one space before a "v" head.
  const labelCells = new Set<number>();
  for (let r = 0; r < rows.length; r++) for (const seg of rawSegments(r, () => true)) {
    const onWire = Array.from({ length: seg.end - seg.start + 1 }, (_, i) => seg.start + i).some(c => {
      const above = kindAt(r - 1, c), below = kindAt(r + 1, c);
      if (!(above === 'v' || above === 'j') || !(below === 'v' || below === 'dn' || below === 'j')) return false;
      // Walk up the wire to the text it leaves; a box aligned with that text is a chained box, not a label.
      let x = r - 1;
      while (x > 0 && (kindAt(x, c) !== undefined || ch(x, c) === ' ') && !blank[x]) x--;
      const starts = new Set<number>();
      for (let y = x; y >= Math.max(0, x - 3) && rows[y].trim(); y--) for (const s of rawSegments(y, () => true)) starts.add(s.start);
      return !starts.has(seg.start);
    });
    const beforeHead = kindAt(r, seg.end + 2) === 'dn' && rows[r].slice(seg.end + 3).trim() === '';
    if (onWire || beforeHead) for (let c = seg.start; c <= seg.end; c++) { set(r, c, 'label'); labelCells.add(key(r, c)); }
  }

  // Box assembly, top to bottom.
  const boxes: Box[] = [];
  const owner = new Map<number, Box>();
  const addLine = (box: Box, seg: Segment) => {
    const line = box.lines.find(l => l.row === seg.row);
    if (line) { line.start = Math.min(line.start, seg.start); line.end = Math.max(line.end, seg.end); }
    else {
      if (seg.start !== box.firstCol) box.flat = false;
      box.lines.push({ row: seg.row, start: seg.start, end: seg.end });
    }
    for (let c = seg.start; c <= seg.end; c++) if (!kindAt(seg.row, c)) owner.set(key(seg.row, c), box);
  };
  const newBox = (seg: Segment, block: number, parent?: Box): Box => {
    const box: Box = { index: boxes.length, lines: [], children: [], firstCol: seg.start, flat: true, root: !parent, block,
      ...(seg.item ? { item: seg.item } : {}) };
    if (parent) { box.parent = parent; parent.children.push(box); }
    boxes.push(box);
    addLine(box, seg);
    return box;
  };
  const headLands = (r: number, seg: Segment) => {
    for (let c = seg.start - 1; c <= seg.end + 1; c++) {
      for (let x = r - 1; x >= 0; x--) {
        const k = kindAt(x, c);
        if (k === 'dn') return true;
        if (k !== undefined || ch(x, c) !== ' ') break;
      }
    }
    return [seg.start - 1, seg.start - 2].some(c => kindAt(r, c) === 'rt');
  };

  // Key/value tables: a row whose later columns start where words start in an adjacent row.
  const aligned = (r: number) => {
    const segs = rawSegments(r, () => true);
    if (segs.length < 2) return false;
    return [r - 1, r + 1].some(n => {
      const other = rows[n];
      if (!other?.trim() || other.search(/\S/) !== segs[0].start || [...other].some((_, c) => kindAt(n, c) && kindAt(n, c) !== 'label')) return false;
      return segs.slice(1).every(sg => other.slice(sg.start - 2, sg.start) === '  ' && other[sg.start] !== ' ' && other[sg.start] !== undefined);
    });
  };
  const treeRootOf = (box: Box) => { let b = box; while (b.parent) b = b.parent; return b; };
  let block = 0;
  let stack: { key: number; box: Box }[] = [];
  let prev: { row: number; boxes: { seg: Segment; box: Box }[] } | undefined;
  const frameParents = new Map<number, Box | undefined>();
  const frameCells = new Map<string, Box>();
  for (let r = 0; r < rows.length; r++) {
    if (separator[r]) { block++; stack = []; prev = undefined; continue; }
    if (blank[r]) { stack = []; prev = undefined; continue; }
    const frame = frameAt(r);
    if (frames.some(f => f.top === r)) {
      frameParents.set(frames.find(f => f.top === r)!.id, prev && prev.boxes.length === 1 ? prev.boxes[0].box : prev?.boxes[0]?.box);
    }
    const columnAbove = (prev?.boxes.length ?? 0) >= 2;
    const segs = rawSegments(r, () => columnAbove).filter(s => !labelCells.has(key(r, s.start)));
    if (!segs.length) {
      // A wire-only row ends continuation. Rows holding only an arrow and its target keep it open.
      if (!rows[r].trim().match(/^[-<]/)) prev = undefined;
      continue;
    }
    const rowHasWire = [...rows[r]].some((_, c) => { const k = kindAt(r, c); return k === 'v' || k === 'dn' || k === 'j'; });
    const arrowRow = /^\s*<?-/.test(rows[r]) && segs.every(s => [s.start - 1, s.start - 2].some(c => kindAt(r, c) === 'rt'));
    const placed: { seg: Segment; box: Box }[] = [];
    const plain = segs.filter(s => !s.item && ![s.start - 1, s.start - 2].some(c => kindAt(r, c) === 'rt'));
    for (const seg of segs) {
      const target = [seg.start - 1, seg.start - 2].some(c => kindAt(r, c) === 'rt');
      if (frame) {
        const cell = frame.cols.filter(c => c < seg.start).length - 1;
        const band = frame.borders.filter(b => b < r).length;
        const id = `${frame.id}:${band}:${cell}`;
        const existing = frameCells.get(id);
        if (existing) addLine(existing, seg);
        else frameCells.set(id, newBox(seg, block, frameParents.get(frame.id)));
        placed.push({ seg, box: frameCells.get(id)! });
        continue;
      }
      if (seg.item) {
        const markerCol = seg.item.markerCol;
        // The deepest open entry left of the marker is the parent; side-by-side trees keep separate entries.
        const candidates = stack.filter(e => e.key < markerCol);
        let parent = candidates.reduce<{ key: number; box: Box } | undefined>((best, e) => (!best || e.key >= best.key ? e : best), undefined)?.box;
        for (let x = r - 1; x >= 0 && !blank[x] && !separator[x]; x--) {
          const k = kindAt(x, markerCol);
          if (k === 'v' || k === 'mk' || k === 'mku' || k === 'j') continue;
          const found = owner.get(key(x, markerCol));
          if (found && found.block === block) parent = found;
          break;
        }
        const box = newBox(seg, block, parent);
        const tree = parent && treeRootOf(parent);
        stack = stack.filter(e => e.key < markerCol || (tree !== undefined && treeRootOf(e.box) !== tree));
        stack.push({ key: markerCol, box });
        placed.push({ seg, box });
        continue;
      }
      if (target) { const box = newBox(seg, block); box.target = true; placed.push({ seg, box }); continue; }
      // Continuation of a box on the previous row.
      let host: Box | undefined;
      if (prev) {
        // Arrow targets end where the arrow lands; they never host continuation lines.
        const above = prev.boxes.filter(p => !p.box.target);
        const overlapping = above.filter(p => {
          const line = p.box.lines.find(l => l.row === prev!.row)!;
          return seg.start <= line.end && seg.end >= line.start;
        });
        const uniqueBoxes = [...new Set(above.map(p => p.box))];
        const columnContext = columnAbove || rowHasWire || plain.length >= 2 && uniqueBoxes.length >= 2;
        if (plain.length >= 2 && uniqueBoxes.length === 1 && !columnAbove && !rowHasWire && !aligned(r)) {
          // Several segments indented below one box: one child per segment.
          const parent = uniqueBoxes[0];
          if (plain[0].start > parent.firstCol) { placed.push({ seg, box: newBox(seg, block, parent) }); continue; }
        }
        const overlapAll = prev.boxes.filter(p => {
          const line = p.box.lines.find(l => l.row === prev!.row)!;
          return seg.start <= line.end && seg.end >= line.start;
        });
        if (columnContext && prev.boxes.length >= 2) {
          // The overlapping box that starts nearest to this segment's left hosts it; a segment spanning
          // several ordinary boxes starts a new one.
          if (new Set(overlapAll.filter(p => !p.box.target).map(p => p.box)).size <= 1) {
            const line = (b: Box) => b.lines.find(l => l.row === prev!.row)!;
            const best = [...new Set(overlapAll.map(p => p.box))].filter(b => Math.min(line(b).start, b.firstCol) <= seg.start + 2 && !(b.children.length && !b.item))
              .sort((a, z) => line(z).start - line(a).start)[0];
            if (best) host = best;
          }
        }
        if (!host && !(columnContext && prev.boxes.length >= 2 && overlapAll.length) && uniqueBoxes.length >= 1) {
          const b = uniqueBoxes.at(-1)!;
          const lastLine = b.lines.at(-1)!;
          const textCol = b.firstCol;
          const wordLabel = /^[A-Z][A-Za-z]*:/.test(rows[r].slice(seg.start));
          const first = seg === plain[0];
          if (first && !b.children.length && (b.item ? seg.start >= textCol : seg.start > textCol)) host = b;
          else if (first && !wordLabel && !b.children.length && seg.start === textCol && (b.flat || /[;,]$/.test(rows[lastLine.row].slice(0, lastLine.end + 1)))) host = b;
          else if (columnContext && overlapping.length === 1 && overlapping[0].box === b && seg.start >= b.firstCol - 2 && !b.children.length) host = b;
          else if (aligned(r) && seg !== plain[0] && placed.some(p => p.box === b)) host = b;
        }
      }
      if (host) { addLine(host, seg); placed.push({ seg, box: host }); continue; }
      // New box: an arrow target is a root; otherwise it may be an unmarked child of an open tree.
      let parent: Box | undefined;
      if (!headLands(r, seg)) {
        parent = [...boxes].reverse().find(b => b.block === block && b.firstCol < seg.start && b.children.length > 0 &&
          b.lines[0].row >= (stack[0]?.box.lines[0].row ?? Infinity));
      }
      placed.push({ seg, box: newBox(seg, block, parent) });
    }
    const roots = placed.filter(p => !p.box.item && p.box.root && !p.box.lines.some(l => l.row < r) && !frame &&
      ![p.seg.start - 1, p.seg.start - 2].some(c => kindAt(r, c) === 'rt'));
    if (roots.length) stack = roots.map(p => ({ key: p.box.firstCol - 1, box: p.box }));
    prev = arrowRow && prev ? prev : { row: r, boxes: placed };
  }

  // Wires: connected components of wire cells.
  const parentOf = new Map<number, number>();
  const find = (k: number): number => { while (parentOf.get(k) !== k) { const p = parentOf.get(parentOf.get(k)!)!; parentOf.set(k, p); k = p; } return k; };
  const join = (a: number, b: number) => parentOf.set(find(a), find(b));
  const wireCells: [number, number, Kind][] = [];
  for (const [k, kind] of kinds) if (kind !== 'md' && kind !== 'frame') { parentOf.set(k, k); wireCells.push([Math.floor(k / width), k % width, kind]); }
  const neighbour = (r: number, c: number, kind: Kind, dir: Dir): [number, number] | undefined => {
    const [dr, dc] = STEP[dir];
    const options = dir === 'U' || dir === 'D' ? [c, c - 1, c + 1] : [c + dc];
    for (const cc of options) {
      const other = kindAt(r + dr, cc);
      if (other === undefined || other === 'md' || other === 'frame') continue;
      if (other === 'label' && kind === 'label' && dr === 0) return [r, cc];
      if (CONNECTS[other].includes(OPPOSITE[dir])) return [r + dr, cc];
      if (cc === c) break;
    }
    if ((dir === 'U' || dir === 'D') && (kind === 'v' || kind === 'j') && ch(r + dr, c) === ' ') {
      const far = kindAt(r + 2 * dr, c);
      if (far === 'v' || far === 'j' || (dir === 'D' && far === 'dn')) return [r + 2 * dr, c];
    }
    return undefined;
  };
  for (const [r, c, kind] of wireCells) for (const dir of CONNECTS[kind]) {
    const n = neighbour(r, c, kind, dir);
    if (n) join(key(r, c), key(n[0], n[1]));
  }
  const components = new Map<number, [number, number, Kind][]>();
  for (const cell of wireCells) {
    const root = find(key(cell[0], cell[1]));
    components.set(root, [...(components.get(root) ?? []), cell]);
  }

  const treeRoot = (box: Box) => { let b = box; while (b.parent) b = b.parent; return b; };
  const treeRows = new Map<Box, number>();
  for (const b of boxes) { const root = treeRoot(b); treeRows.set(root, Math.max(treeRows.get(root) ?? 0, b.lines.at(-1)!.row)); }
  const boxAtText = (r: number, c: number) => owner.get(key(r, c));
  const scan = (r: number, c: number, dr: number, far: boolean): Box | undefined => {
    for (let x = r + dr, steps = 0; x >= 0 && x < rows.length; x += dr, steps++) {
      for (const cc of steps === 0 ? [c, c - 1, c + 1] : [c]) { const b = boxAtText(x, cc); if (b) return b; }
      const k = kindAt(x, c);
      if (!far || (k !== undefined && k !== 'frame') || (k === undefined && ch(x, c) !== ' ') || separator[x] || blank[x] && steps > 6) return undefined;
    }
    return undefined;
  };
  const rectTarget = (r: number, c: number) => {
    const starting = boxes.filter(b => b.lines.some(l => l.row === r || l.row === r - 1) && [r - 1, r].includes(Math.min(...b.lines.map(l => l.row))));
    return starting.find(b => b.lines.some(l => l.start <= c && c <= l.end)) ??
      starting.find(b => Math.min(...b.lines.map(l => l.start)) - 2 <= c && c <= Math.max(...b.lines.map(l => l.end)) + 2) ??
      starting.map(b => ({ b, gap: Math.max(0, Math.min(...b.lines.map(l => l.start)) - c, c - Math.max(...b.lines.map(l => l.end))) }))
        .filter(x => x.gap <= 8).sort((x, y) => x.gap - y.gap)[0]?.b;
  };
  const edges: GraphEdge[] = [];
  const seen = new Map<string, GraphEdge>();
  const sourcesByComponent = new Map<number, Box[]>();
  const pending: { comp: number; cells: [number, number, Kind][]; targets: Box[]; ins: Box[]; label?: string }[] = [];
  for (const [comp, cells] of components) {
    const outs = new Set<Box>(), ins = new Set<Box>(), targets = new Set<Box>();
    for (const [r, c, kind] of cells) {
      const head = HEADS[kind];
      for (const dir of kind === 'label' ? [] : CONNECTS[kind].concat(head ? [head] : [])) {
        if (dir !== head && neighbour(r, c, kind, dir)) continue;
        if (kind === 'mk' && dir === 'D') continue;
        let found: Box | undefined;
        if (dir === head && (dir === 'U' || dir === 'D')) found = rectTarget(r + (dir === 'D' ? 1 : -1), c);
        if (!found && (dir === 'U' || dir === 'D')) found = scan(r, c, dir === 'U' ? -1 : 1, kind === 'v' || kind === 'dn' || kind === 'up');
        else for (const d of [1, 2]) { found ??= boxAtText(r, c + (dir === 'L' ? -d : d)); if (ch(r, c + (dir === 'L' ? -1 : 1)) !== ' ') break; }
        if (!found) continue;
        if (dir === head) targets.add(found);
        else if (dir === 'U' || dir === 'L') {
          const root = treeRoot(found);
          outs.add(dir === 'U' && found.item && found.lines.at(-1)!.row === treeRows.get(root) ? root : found);
        } else ins.add(found);
      }
    }
    const labelText = [...new Set(cells.filter(([, , k]) => k === 'label').map(([r]) => r))].map(r =>
      rows[r].slice(Math.min(...cells.filter(x => x[0] === r && x[2] === 'label').map(x => x[1])),
        Math.max(...cells.filter(x => x[0] === r && x[2] === 'label').map(x => x[1])) + 1)).join(' ');
    // Text ending one space before a "v" head labels that wire.
    const headLabel = cells.filter(([, , k]) => k === 'dn').map(([r, c]) => {
      const left = rows[r].slice(0, c - 1).trimEnd();
      return left && rows[r][c - 1] === ' ' && labelCells.has(key(r, left.length - 1)) ? left.trim() : '';
    }).find(Boolean);
    sourcesByComponent.set(comp, [...outs]);
    pending.push({ comp, cells, targets: [...targets], ins: [...ins], label: headLabel || labelText || undefined });
  }
  for (const p of pending) {
    let sources = sourcesByComponent.get(p.comp)!;
    if (!sources.length) {
      // A row that starts with an arrow continues the source of the arrow above it.
      const [r, c] = p.cells.reduce((a, b) => (b[1] < a[1] ? b : a));
      for (let x = r - 1; x >= Math.max(0, r - 3) && !sources.length; x--) {
        const above = [c - 1, c, c + 1].map(cc => kinds.has(key(x, cc)) ? find(key(x, cc)) : undefined).find(k => k !== undefined && sourcesByComponent.get(k)?.length);
        if (above !== undefined) sources = sourcesByComponent.get(above)!;
      }
    }
    if (!sources.length && p.ins.length && p.targets.length) sources = p.ins;
    const add = (from: Box, to: Box, direction: EdgeDirection) => {
      if (from === to) return;
      const id = direction === '->' ? `${from.index}>${to.index}` : [from.index, to.index].sort().join('-');
      const reverse = `${to.index}>${from.index}`;
      if (seen.has(id) || (direction === '--' && (seen.has(`${from.index}>${to.index}`) || seen.has(reverse)))) return;
      const edge: GraphEdge = { id: `edge-${edges.length}`, from: `box-${from.index}`, to: `box-${to.index}`, direction,
        ...(p.label ? { label: p.label } : {}), cells: p.cells.map(([r, c]) => ({ line: r + 1, col: c + 1 })) };
      seen.set(id, edge); edges.push(edge);
    };
    for (const s of sources) {
      for (const t of p.targets) add(s, t, '->');
      for (const i of p.ins) if (!sources.includes(i) && !p.targets.includes(i)) add(s, i, '--');
    }
  }

  const graphBoxes: GraphBox[] = boxes.map(b => {
    const lines = [...b.lines].sort((a, z) => a.row - z.row);
    return {
      id: `box-${b.index}`,
      text: lines.map(l => rows[l.row].slice(l.start, l.end + 1)).join('\n'),
      rect: { line1: lines[0].row + 1, col1: Math.min(...lines.map(l => l.start)) + 1, line2: lines.at(-1)!.row + 1, col2: Math.max(...lines.map(l => l.end)) + 1 },
      lines: lines.map(l => ({ line: l.row + 1, col1: l.start + 1, col2: l.end + 1 })),
      ...(b.parent ? { parentId: `box-${b.parent.index}` } : {}),
      childIds: b.children.map(c => `box-${c.index}`)
    };
  });
  return { parserVersion: 'ascii-graph-1', boxes: graphBoxes, edges, rootIds: graphBoxes.filter(b => !b.parentId).map(b => b.id) };
}
