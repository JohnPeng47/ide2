import { sourceSpan } from './source';
import type { Candidate, Diagnostic, GlyphKind, Policy, RecognitionContext, Recognizer, SourceDocument } from './types';

export const DEFAULT_GLYPHS: Readonly<Record<string, GlyphKind>> = Object.freeze(Object.fromEntries(
  Object.entries({ horizontal: '-─━═╌╍┄┅┈┉–—_', vertical: '|│┃┆┊║¦╎╏:',
    joint: "+\\`'├└┝┞┟┠┡┢┣┗┖╠╚╟╙╰╘╞┌╭┐┘┬┴┼", left: '<←', right: '>→›',
    up: '^↑', down: 'v↓' }).flatMap(([kind, chars]) => [...chars].map(ch => [ch, kind as GlyphKind]))));

const branch: Recognizer = {
  id: 'branch-marker', starts: ['joint', 'vertical', 'horizontal', 'right', '↳', '↪', '➜', '➝', '➞'],
  recognize({ row, column, glyphs, policy }) {
    const start = column - 1;
    if (policy.compatibility) {
      const marker = policy.compatibility === 'ascii-tree-1'
        ? /^([+`\\]--(?:>)?)(?=\s+\S)/ : /^([+`\\|]--(?:>)?)(?=\s+\S)/;
      const match = marker.exec(row.text.slice(start));
      return match ? [{ kind: 'branch', endColumn: column + match[0].length, headed: match[0].endsWith('>') }] : [];
    }
    let x = start;
    if (glyphs[row.text[x]] === 'joint' || glyphs[row.text[x]] === 'vertical') x++;
    const dashStart = x;
    while (glyphs[row.text[x]] === 'horizontal') x++;
    const dashes = x - dashStart;
    if (glyphs[row.text[x]] === 'right') x++;
    const standalone = /[├└┣┗╠╚╰→↳↪➜➝➞]/.test(row.text[start]) && row.text[start + 1] === ' ';
    if (standalone && x <= start + 1) x = start + 1;
    else if (!dashes || (dashStart === start && dashes < 2 && x === start + dashes)) return [];
    if (x === start || x >= row.text.length || glyphs[row.text[x]] === 'joint') return [];
    return [{ kind: 'branch', endColumn: x + 1, headed: glyphs[row.text[x - 1]] === 'right' }];
  }
};
const bullet: Recognizer = {
  id: 'list-marker', starts: ['-', '+', '*', '•', '●', '◦', '▪', '▸', '▹', 'digit'],
  recognize({ row, column, policy }) {
    if (policy.compatibility || policy.dialect === 'graph') return [];
    if (!/^[ |│┃║:]*$/.test(row.text.slice(0, column - 1))) return [];
    const match = /^(?:[-+*•●◦▪▸▹]|\d+[.)])(?= +\S)/.exec(row.text.slice(column - 1));
    return match ? [{ kind: 'branch', endColumn: column + match[0].length, bullet: true }] : [];
  }
};
const route: Recognizer = {
  id: 'reference-run', starts: ['horizontal', 'joint', 'left'],
  recognize({ row, column, glyphs }) {
    const start = column - 1;
    let x = start;
    if (glyphs[row.text[x]] === 'left' || glyphs[row.text[x]] === 'joint') x++;
    const dashStart = x;
    while (x < row.text.length) {
      if (glyphs[row.text[x]] === 'horizontal') x++;
      else if ((glyphs[row.text[x]] === 'joint' || glyphs[row.text[x]] === 'vertical') && glyphs[row.text[x + 1]] === 'horizontal') x++;
      else break;
    }
    if (x === dashStart) return [];
    if (['joint', 'right'].includes(glyphs[row.text[x]])) x++;
    const last = glyphs[row.text[x - 1]];
    if (glyphs[row.text[start]] !== 'left' && last !== 'joint' && last !== 'right') return [];
    return [{ kind: 'route', endColumn: x + 1, headed: last === 'right' || glyphs[row.text[start]] === 'left' }];
  }
};
const vertical: Recognizer = {
  id: 'vertical-stroke', starts: ['vertical', 'up', 'down'],
  recognize({ row, column, glyphs }) {
    const ch = row.text[column - 1];
    if (glyphs[ch] === 'vertical' && ch !== ':') return [{ kind: 'vertical', endColumn: column + 1 }];
    if (['up', 'down'].includes(glyphs[ch]) && (column === row.text.length || row.text[column] === ' ') &&
      (column === 1 || row.text[column - 2] === ' ')) return [{ kind: 'vertical', endColumn: column + 1 }];
    return [];
  }
};
export const DEFAULT_RECOGNIZERS: readonly Recognizer[] = Object.freeze([branch, bullet, route, vertical]);

export function recognize(source: SourceDocument, policy: Policy, glyphs: Readonly<Record<string, GlyphKind>>,
  additions: readonly Recognizer[], diagnostics: Diagnostic[]): Candidate[] {
  const rules = [...DEFAULT_RECOGNIZERS, ...additions];
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new Error('Recognizer IDs must be unique');
  const dispatch = new Map<string, Recognizer[]>();
  for (const rule of rules) for (const feature of new Set(rule.starts)) {
    dispatch.set(feature, [...(dispatch.get(feature) ?? []), rule]);
  }
  const result: Candidate[] = [];
  for (const row of source.rows) {
    if (row.kind !== 'content') continue;
    const closing: string[] = [];
    for (let x = 0; x < row.text.length; x++) {
      const ch = row.text[x];
      if (ch in { '[': 1, '{': 1, '(': 1 }) closing.push(({ '[': ']', '{': '}', '(': ')' } as Record<string, string>)[ch]);
      else if (closing.length && ch === closing.at(-1)) { closing.pop(); continue; }
      if (closing.length) continue;
      // Start a horizontal/jointed run once, while retaining branch/route overlap.
      if (x && glyphs[row.text[x - 1]] === 'horizontal' && ['horizontal', 'joint', 'right'].includes(glyphs[ch])) continue;
      const features = [ch, glyphs[ch], /\d/.test(ch) ? 'digit' : ''];
      const applicable = new Set(features.flatMap(feature => dispatch.get(feature) ?? []));
      const context: RecognitionContext = Object.freeze({ source, row, column: x + 1, glyphs, policy });
      for (const rule of [...applicable].sort((a, b) => a.id.localeCompare(b.id))) {
        for (const proposal of rule.recognize(context)) {
          if (!['branch', 'route', 'vertical'].includes(proposal.kind) || !Number.isInteger(proposal.endColumn) ||
            proposal.endColumn <= x + 1 || proposal.endColumn > row.text.length + 1) throw new Error(`Invalid candidate from ${rule.id}`);
          const span = sourceSpan(row, x + 1, proposal.endColumn);
          const id = `${rule.id}:${row.line}:${x + 1}:${proposal.endColumn}:${proposal.kind}`;
          if (result.length >= policy.maxCandidates) throw new RangeError('Diagram exceeds maxCandidates');
          const { endColumn: _, ...details } = proposal;
          result.push({ ...details, id, ruleId: rule.id, span });
        }
      }
    }
    if (closing.length) diagnostics.push({ code: 'unclosed-label-delimiter', line: row.line,
      severity: 'warning', message: 'An unclosed label delimiter protects the remaining text from connector recognition.' });
  }
  return result.sort((a, b) => a.span.line - b.span.line || a.span.column - b.span.column || a.id.localeCompare(b.id));
}
