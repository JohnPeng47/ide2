import type { DiagramInterpretation, Diagnostic, SourceSpan } from './types';

export interface RenderedDiagram {
  text: string;
  /** One source range per output UTF-16 unit; inserted newlines have no range. */
  sourceMap: (Pick<SourceSpan, 'start' | 'end'> | null)[];
  diagnostics: Diagnostic[];
}

/** Optional normalized preview. Placements are transactional; collisions never overwrite text. */
export function renderCleaned(result: DiagramInterpretation): RenderedDiagram {
  type Cell = { ch: string; start: number; end: number };
  const original: Cell[][] = result.source.rows.map(row => [...Array(row.text.length)].map((_, x) => ({
    ch: row.text[x], start: row.offsets[x][0], end: row.offsets[x][1] })));
  const canvas = original.map(row => row.map(cell => ({ ...cell })));
  const placements: { line: number; column: number; cell: Cell }[] = [];
  const blank = (line: number, column: number) => { if (canvas[line - 1][column - 1]) canvas[line - 1][column - 1].ch = ' '; };
  for (const repair of result.repairs) for (const move of repair.moves) {
    const row = original[move.line - 1];
    if (repair.kind === 'tree-alignment') {
      const node = result.nodes.find(n => n.spans[0].line === move.line && n.branchColumn === move.column);
      if (!node) continue;
      for (let x = move.column; x < node.spans[0].endColumn; x++) {
        blank(move.line, x);
        placements.push({ line: move.line, column: x + move.toColumn - move.column, cell: row[x - 1] });
      }
    } else {
      const cell = row[move.column - 1];
      blank(move.line, move.column);
      placements.push({ line: move.line, column: move.toColumn, cell });
      const kind = (ch: string | undefined) => result.glyphs[ch ?? ''];
      const crossing = kind(cell.ch) === 'vertical' && kind(row[move.column - 2]?.ch) === 'horizontal' && kind(row[move.column]?.ch) === 'horizontal';
      if (kind(cell.ch) === 'joint' || crossing) {
        for (let x = move.column; x < move.toColumn; x++) {
          placements.push({ line: move.line, column: x, cell: { ...cell, ch: '-' } });
        }
        // A crossing slides along its horizontal channel.
        if (kind(canvas[move.line - 1][move.toColumn - 1]?.ch) === 'horizontal') blank(move.line, move.toColumn);
      }
    }
  }
  const serialize = (rows: Cell[][], diagnostics: Diagnostic[]): RenderedDiagram => {
    let text = '';
    const sourceMap: RenderedDiagram['sourceMap'] = [];
    rows.forEach((row, index) => {
      if (index) { text += '\n'; sourceMap.push(null); }
      for (const cell of row) { text += cell.ch; sourceMap.push({ start: cell.start, end: cell.end }); }
    });
    return { text, sourceMap, diagnostics };
  };
  for (const { line, column, cell } of placements) {
    const row = canvas[line - 1];
    while (row.length < column) row.push({ ch: ' ', start: cell.start, end: cell.start });
    if (row[column - 1].ch !== ' ' && row[column - 1].ch !== cell.ch && cell.ch !== ' ') {
      return serialize(original, [{ code: 'render-collision', severity: 'error', line,
        message: 'Repair placements overlap; the preview retains the normalized original.' }]);
    }
    if (cell.ch !== ' ') row[column - 1] = { ...cell };
  }
  return serialize(canvas, []);
}
