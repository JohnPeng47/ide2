import type { DiagramSourceContext } from './diagram';
import { asciiSha256 } from './asciiSha256';

export type DiagramSyntaxKind = 'type' | 'function' | 'variable' | 'keyword' | 'string' | 'number' | 'reference' | 'structure';
export interface DiagramSyntax {
  kind: DiagramSyntaxKind;
  role?: 'definition' | 'reference';
  /** Source identity, or a diagram-local lexical identity. Never a navigation target. */
  symbol?: string;
  title?: string;
}
export interface DiagramSyntaxRange { start: number; end: number; syntax: DiagramSyntax }
const identifier = '[A-Za-z_$][\\w$]*';
const primitives = new Set(['string', 'number', 'boolean', 'unknown', 'never', 'void', 'any', 'object']);
const literals = new Set(['true', 'false', 'null', 'undefined']);

/** A small diagram lexer, not a TypeScript parser: prose, paths and tree gutters
 * are protected before recognizing code fragments. All offsets address raw text. */
export function diagramSyntaxLine(text: string, scope: string): DiagramSyntaxRange[] {
  const ranges: DiagramSyntaxRange[] = [];
  const protectedSpans: { start: number; end: number }[] = [];
  const overlaps = (start: number, end: number) => protectedSpans.some(r => start < r.end && end > r.start);
  const add = (start: number, end: number, kind: DiagramSyntaxKind, role?: DiagramSyntax['role']) => {
    if (end <= start || overlaps(start, end)) return;
    ranges.push({ start, end, syntax: { kind, ...(role ? { role,
      symbol: JSON.stringify(['local', scope, text.slice(start, end)]) } : {}) } });
    protectedSpans.push({ start, end });
  };
  const protect = (start: number, end: number) => protectedSpans.push({ start, end });
  const gutter = text.match(/^[\s│┃|]*(?:(?:[|+`\\]--|[├└╰]─+)[> ]*)?/u)?.[0] ?? '';
  if (gutter.trim()) add(0, gutter.length, 'structure');
  const labelStart = gutter.length;
  // URLs, file paths and route templates contain slashes/identifiers, not TS operators.
  for (const m of text.matchAll(/(?:https?:\/\/\S+|(?:[\w.@{}<>-]+\/)+[\w.@{}<>/?=&-]+|\/[\w{][\w/{}.?=&-]*)/g)) protect(m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]+`/g)) add(m.index!, m.index! + m[0].length, 'string');
  // Bracketed prose and tuples stay plain. Short tags are diagram references,
  // never clickable unless the caller also has an explicit, valid DiagramJump.
  for (const m of text.matchAll(/\[[^\]\n]*\]/g)) {
    if (/^\[(?:[A-Z](?:\d+[a-z]?)?|MODEL|CALLS)\]$/.test(m[0])) {
      add(m.index!, m.index! + m[0].length, 'reference', m.index === labelStart ? 'definition' : 'reference');
    } else if (/\s/.test(m[0]) && !m[0].includes(',')) protect(m.index!, m.index! + m[0].length);
  }
  for (const m of text.matchAll(/(?:<-+>|-+>|<-+|=>)/g)) add(m.index!, m.index! + m[0].length, 'structure');
  // Explicit declarations establish definitions; calls and mapped source occurrences do not.
  const declaration = new RegExp(`\\b(?:export\\s+)?(?:declare\\s+)?(class|interface|type|enum|function|const|let|var)\\s+(${identifier})`, 'g');
  for (const m of text.matchAll(declaration)) {
    const start = m.index! + m[0].lastIndexOf(m[2]);
    add(start, start + m[2].length, ['class', 'interface', 'type', 'enum'].includes(m[1]) ? 'type' : m[1] === 'function' ? 'function' : 'variable', 'definition');
    for (const word of m[0].slice(0, start - m.index!).matchAll(/\w+/g)) add(m.index! + word.index!, m.index! + word.index! + word[0].length, 'keyword');
  }
  // A colon followed by a plausible type/literal is a member declaration. A
  // caption such as "History: owned by SessionManager" is ordinary prose.
  const property = new RegExp(`\\b(${identifier})(?:\\[[^\\]\\n]*\\])?\\??\\s*:\\s*([A-Za-z_$][\\w$]*|[0-9]+|["'])`, 'g');
  for (const m of text.matchAll(property)) {
    if (!/^[A-Z0-9"']/.test(m[2]) && !primitives.has(m[2]) && !literals.has(m[2])) continue;
    add(m.index!, m.index! + m[1].length, 'variable', 'definition');
    const valueStart = m.index! + m[0].lastIndexOf(m[2]);
    if (/^[A-Za-z_$]/.test(m[2])) add(valueStart, valueStart + m[2].length, literals.has(m[2]) ? 'keyword' : 'type', literals.has(m[2]) ? undefined : 'reference');
  }
  const call = new RegExp(`\\b(${identifier})\\s*\\(([^()]*)\\)(\\s*:\\s*(${identifier}))?`, 'g');
  for (const m of text.matchAll(call)) {
    if (['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) continue;
    // A sentence with parentheses is not a call: require adjacency.
    if (text[m.index! + m[1].length] !== '(') continue;
    const constructor = /\bnew\s+$/.test(text.slice(0, m.index!));
    add(m.index!, m.index! + m[1].length, constructor ? 'type' : 'function', m[3] && !constructor ? 'definition' : 'reference');
    const argsStart = m.index! + m[0].indexOf('(') + 1;
    if (/^[\w$\s.,?:<>{}\[\]|='"-]*$/.test(m[2]) && !/\b[a-z]+\s+[a-z]+\b/.test(m[2])) {
      for (const arg of m[2].matchAll(/[A-Za-z_$][\w$]*/g)) {
        const name = arg[0], start = argsStart + arg.index!;
        add(start, start + name.length, literals.has(name) ? 'keyword' : primitives.has(name) || /^[A-Z]/.test(name) ? 'type' : 'variable', literals.has(name) ? undefined : 'reference');
      }
    }
    if (m[4]) { const start = m.index! + m[0].lastIndexOf(m[4]); add(start, start + m[4].length, 'type', 'reference'); }
    const prefix = text.slice(labelStart, m.index!);
    for (const k of prefix.matchAll(/\b(?:static|async|public|private|protected|readonly|new|return|await)\b/g)) add(labelStart + k.index!, labelStart + k.index! + k[0].length, 'keyword');
  }
  // Qualified access and camel/PascalCase are useful conservative hints in prose.
  for (const m of text.matchAll(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g)) {
    for (const name of m[0].matchAll(/[A-Za-z_$][\w$]*/g)) add(m.index! + name.index!, m.index! + name.index! + name[0].length,
      /^[A-Z]/.test(name[0]) ? 'type' : 'variable', 'reference');
  }
  for (const m of text.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    if (/[a-z][A-Z]/.test(m[0])) add(m.index!, m.index! + m[0].length, /^[A-Z]/.test(m[0]) ? 'type' : 'variable', 'reference');
    else if (literals.has(m[0]) && /[:=|([{]\s*$/.test(text.slice(0, m.index!))) add(m.index!, m.index! + m[0].length, 'keyword');
  }
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    if (!/[\w/.-]/.test(text[m.index! - 1] ?? '') && !/[\w/.-]/.test(text[m.index! + m[0].length] ?? '')) add(m.index!, m.index! + m[0].length, 'number');
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** Mappings win over lexical guesses, but only exact identifier occurrences get
 * symbol semantics. A mapped sentence is not painted as one giant type name. */
export function mappedDiagramSyntax(text: string, line: number, source: DiagramSourceContext,
  lexical: readonly DiagramSyntaxRange[]): DiagramSyntaxRange[] {
  const result: DiagramSyntaxRange[] = [];
  for (const mapping of source.mappings) {
    if (mapping.line !== line || mapping.startColumn < 1 || mapping.endColumn > text.length) continue;
    const entity = source.evidence[mapping.entityId], range = entity?.sourceRanges[mapping.sourceRangeIndex];
    if (!range || mapping.sourceRangeId && mapping.sourceRangeId !== range.id) continue;
    const start = mapping.startColumn - 1, end = mapping.endColumn, label = text.slice(start, end);
    const symbols = new Set([entity.handle, range.symbol, entity.label].filter((value): value is string => !!value));
    const candidates = [...label.matchAll(/[A-Za-z_$][\w$]*/g)].filter(m => symbols.has(m[0])
      || [...symbols].some(symbol => symbol.split('.').at(-1) === m[0]));
    // Exact one-identifier mappings can use a friendly evidence label.
    if (!candidates.length && /^[A-Za-z_$][\w$]*$/.test(label)) candidates.push(...label.matchAll(/[A-Za-z_$][\w$]*/g));
    for (const match of candidates) {
      const from = start + match.index!, to = from + match[0].length;
      if (/[\w$]/.test(text[from - 1] ?? '') || /[\w$]/.test(text[to] ?? '')) continue;
      const hint = lexical.find(r => r.start === from && r.end === to);
      if (lexical.some(r => r.start < to && r.end > from && (r.syntax.kind === 'string' || r.syntax.kind === 'structure'))) continue;
      const role = hint?.syntax.role === 'definition' ? 'definition' : 'reference';
      const revision = source.binding?.corpus.kind === 'git-worktree' ? source.binding.corpus.revision : undefined;
      const kind = entity.category === 'operation' ? 'function' : entity.category === 'interface-data-struct' ? 'type' : 'variable';
      result.push({ start: from, end: to, syntax: { kind, role,
        symbol: JSON.stringify(['source', source.binding?.repositoryIdentity ?? source.binding?.sourceId ?? entity.sourceId ?? entity.id,
          revision ?? asciiSha256((range.originalLines ?? []).join('\n')), range.path, range.startLine, range.endLine, range.symbol ?? entity.handle]),
        title: `${entity.label} · ${role}\n${range.path}:${range.startLine}${range.endLine !== range.startLine ? `–${range.endLine}` : ''}\n${revision ? `Captured revision ${revision}` : 'Captured source'}\nUse the node’s source action to open code.` } });
    }
  }
  return result;
}
