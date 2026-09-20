import type { Diagnostic, Policy, SourceDocument, SourceRow, SourceSpan } from './types';

const ANSI = /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/;
const INVISIBLE = /[\ufeff\u200b\u200c\u200d]/;
const SPACE = /[\u00a0\u202f\u2007]/;
const ALLOWED_FENCES = new Set(['', 'ascii', 'text', 'txt', 'tree', 'plaintext', 'console']);

export function sourceSpan(row: SourceRow, column: number, endColumn: number): SourceSpan {
  const first = row.offsets[column - 1];
  const last = row.offsets[endColumn - 2];
  return { line: row.line, column, endColumn,
    start: first?.[0] ?? row.start + row.raw.length,
    end: last?.[1] ?? first?.[0] ?? row.start + row.raw.length };
}

export function normalizeSource(original: string, policy: Policy, diagnostics: Diagnostic[]): SourceDocument {
  const rows: { line: number; raw: string; text: string; start: number; block: number;
    kind: SourceRow['kind']; offsets: [number, number][] }[] = [];
  const lines = original.split(/\r\n|\r|\n/);
  let offset = 0;
  for (const [index, raw] of lines.entries()) {
    let text = '';
    const offsets: [number, number][] = [];
    for (let i = 0; i < raw.length;) {
      const ansi = raw[i] === '\x1b' ? ANSI.exec(raw.slice(i)) : null;
      if (ansi) { i += ansi[0].length; continue; }
      if (INVISIBLE.test(raw[i])) { i++; continue; }
      const count = raw[i] === '\t' ? policy.tabSize - text.length % policy.tabSize : 1;
      const ch = raw[i] === '\t' || SPACE.test(raw[i]) ? ' ' : raw[i];
      if (text.length + count > policy.maxColumns) throw new RangeError('Diagram exceeds maxColumns');
      text += ch.repeat(count);
      for (let k = 0; k < count; k++) offsets.push([offset + i, offset + i + 1]);
      i++;
    }
    rows.push({ line: index + 1, raw, text, start: offset, offsets, block: 0,
      kind: text.trim() ? 'content' : 'blank' });
    offset += raw.length + (original.slice(offset + raw.length, offset + raw.length + 2) === '\r\n' ? 2 : 1);
  }
  const nonblank = rows.filter(row => row.text.trim());
  if (nonblank.length && nonblank.every(row => /^\s*> ?/.test(row.text))) {
    for (const row of rows) {
      const prefix = /^\s*> ?/.exec(row.text)?.[0].length ?? 0;
      row.text = row.text.slice(prefix);
      row.offsets = row.offsets.slice(prefix);
    }
  }
  let fence: { ch: string; length: number; allowed: boolean; line: number } | undefined;
  let block = 0;
  let hasSelectedFence = false;
  const inSelected = new Set<number>();
  for (const row of rows) {
    const match = /^\s*(`{3,}|~{3,})([^`]*)$/.exec(row.text);
    if (match && !fence) {
      fence = { ch: match[1][0], length: match[1].length,
        allowed: ALLOWED_FENCES.has(match[2].trim().toLowerCase()), line: row.line };
      hasSelectedFence ||= fence.allowed;
      row.kind = 'metadata';
      row.block = ++block;
    } else if (match && fence && match[1][0] === fence.ch && match[1].length >= fence.length && !match[2].trim()) {
      row.kind = 'metadata'; row.block = block++; fence = undefined;
    } else {
      row.block = block;
      if (fence?.allowed) inSelected.add(row.line);
      else if (fence) row.kind = 'outside';
    }
  }
  if (fence) diagnostics.push({ code: 'unclosed-fence', line: fence.line,
    severity: 'warning', message: 'The code fence is not closed.' });
  if (hasSelectedFence) for (const row of rows) {
    if (!inSelected.has(row.line) && row.kind !== 'metadata') row.kind = 'outside';
  }
  // Frames are document wrappers only when both matching horizontal edges exist.
  for (let i = 0; i < rows.length; i++) {
    const top = /^( *)([+┌┏╔╭])[-─━═]{3,}([+┐┓╗╮])\s*$/.exec(rows[i].text);
    if (!top || rows[i].kind !== 'content') continue;
    const left = top[1].length;
    const right = rows[i].text.trimEnd().length - 1;
    let bottom = i + 1;
    while (bottom < rows.length && rows[bottom].block === rows[i].block &&
      /^[|│┃║]$/.test(rows[bottom].text[left] ?? '') && /^[|│┃║]$/.test(rows[bottom].text[right] ?? '')) bottom++;
    if (bottom === i + 1 || !/^[+└┗╚╰][-─━═]+[+┘┛╝╯]$/.test(rows[bottom]?.text.slice(left, right + 1) ?? '')) continue;
    rows[i].kind = rows[bottom].kind = 'metadata';
    for (let y = i + 1; y < bottom; y++) {
      const row = rows[y];
      row.text = row.text.slice(0, left) + ' ' + row.text.slice(left + 1, right) + ' ' + row.text.slice(right + 1);
    }
    i = bottom;
  }
  return Object.freeze({ original, rows: Object.freeze(rows.map(row => Object.freeze({ ...row,
    offsets: Object.freeze(row.offsets.map(pair => Object.freeze(pair))) }))) });
}
