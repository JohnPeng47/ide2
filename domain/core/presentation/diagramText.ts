import type { DiagramLineSyntax } from '../diagrams/diagramSyntaxAnalysis';
import type { DiagramPresentationSettings } from './diagramPresentation';
import { activeDiagramHighlights, highlightColor, highlightNodeIds } from '../diagrams/diagramHighlight';
import type { DiagramHighlight } from '../diagrams/diagramHighlight';
import { asciiSha256 } from '../diagrams/asciiSha256';
import type { DiagramContent } from '../diagrams/diagramContent';
import { diagramContentNodes } from '../diagrams/diagramContentNodes';
import { activeDiagramJumps, type DiagramJump } from '../diagrams/diagramJump';
import type { DiagramElementMapping } from '../records/domain';
import type { DiagramSourceContext } from '../diagrams/diagram';
import { diagramSyntaxLine, mappedDiagramSyntax, type DiagramSyntax } from '../diagrams/diagramSyntax';

export interface DiagramTextOwner {
  displayNodeId: string;
  side?: 'before' | 'after';
  contentNodeId?: string;
  nodeRef?: string;
  revisionId?: string;
  sourceLine: number;
  /** Zero-based offset from source columns to composed columns. */
  columnOffset: number;
}
export interface DiagramTextRange {
  start: number; end: number; owner?: DiagramTextOwner;
  mapping?: DiagramElementMapping; jump?: DiagramJump;
  syntax?: DiagramSyntax;
  semantic?: boolean;
  markerRuleId?: string;
  decoration?: { color?: string; backgroundColor?: string; textDecoration?: string };
}
export interface DiagramTextRun {
  jumps?: readonly DiagramJump[];
  start: number; end: number; text: string; owner?: DiagramTextOwner;
  mappings: readonly DiagramElementMapping[]; jump?: DiagramJump;
  syntax?: DiagramSyntax;
  markerRuleId?: string;
  decoration?: { color?: string; backgroundColor?: string; textDecoration?: string };
}
export interface DiagramTextRow { text: string; sourceLine?: number; runs: DiagramTextRun[] }

/** Each interval is emitted once, including overlaps between mappings and labels. */
export function textRow(text: string, ranges: readonly DiagramTextRange[], sourceLine?: number): DiagramTextRow {
  const valid = ranges.filter(range => range.start >= 0 && range.end <= text.length && range.end > range.start);
  const boundaries = [...new Set([0, text.length, ...valid.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
  const runs: DiagramTextRun[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i], end = boundaries[i + 1];
    const covering = valid.filter(range => range.start <= start && range.end >= end);
    const labels = covering.filter(range => range.owner?.contentNodeId);
    const base = covering.find(range => range.owner && !range.owner.contentNodeId)?.owner;
    const owner = labels.length === 1 ? labels[0].owner : base;
    const jumps = covering.flatMap(range => range.jump ? [range.jump] : []);
    const semantic = covering.filter(range => range.semantic && range.syntax);
    const identities = new Set(semantic.map(range => range.syntax!.symbol));
    // Ambiguous mappings retain all navigation choices, without inventing a single symbol.
    const syntax = semantic.length ? identities.size === 1 ? semantic[0].syntax : undefined
      : covering.find(range => range.syntax)?.syntax;
    runs.push({ start, end, text: text.slice(start, end), owner,
      mappings: covering.flatMap(range => range.mapping ? [range.mapping] : []),
      ...(syntax ? { syntax } : {}),
      ...(covering.some(range => range.markerRuleId) ? { markerRuleId: covering.find(range => range.markerRuleId)!.markerRuleId } : {}),
      ...(covering.some(range => range.decoration) ? { decoration: Object.assign({}, ...covering.map(range => range.decoration)) } : {}),
      ...(jumps.length ? { jump: jumps[0], jumps } : {}) });
  }
  return { text, sourceLine, runs };
}

/** No loose/prose representation-index entries are promoted to structural nodes. */
export function diagramTextRanges(input: {
  ascii: string; content?: DiagramContent; revisionId?: string; displayNodeId: string;
  mappings?: readonly DiagramElementMapping[]; jumps?: readonly DiagramJump[];
  sourceContext?: DiagramSourceContext;
  syntax?: ReadonlyMap<number, DiagramLineSyntax>;
  presentation?: DiagramPresentationSettings;
  highlights?: readonly DiagramHighlight[];
}): Map<number, DiagramTextRange[]> {
  const lines = input.ascii.split('\n');
  const current = input.content?.ascii === input.ascii && input.content.asciiSha256 === asciiSha256(input.ascii)
    ? input.content : undefined;
  const result = new Map<number, DiagramTextRange[]>();
  lines.forEach((line, index) => result.set(index + 1, [{ start: 0, end: line.length,
    owner: { displayNodeId: input.displayNodeId, revisionId: current?.revisionId, sourceLine: index + 1, columnOffset: 0 } }]));
  const nodes = current ? diagramContentNodes(current).filter(node => node.startColumn >= 1
    && node.endColumn >= node.startColumn && node.endColumn <= (lines[node.line - 1]?.length ?? 0)
    && lines[node.line - 1].slice(node.startColumn - 1, node.endColumn) === node.label) : [];
  const unambiguous = nodes.filter(node => !nodes.some(other => other !== node && other.line === node.line
    && other.startColumn <= node.endColumn && other.endColumn >= node.startColumn));
  for (const node of unambiguous) result.get(node.line)!.push({ start: node.startColumn - 1, end: node.endColumn,
    owner: { displayNodeId: input.displayNodeId, contentNodeId: node.id, revisionId: current!.revisionId,
      sourceLine: node.line, columnOffset: 0 } });
  for (const mapping of input.mappings ?? []) result.get(mapping.line)?.push({ start: mapping.startColumn - 1, end: mapping.endColumn, mapping });
  for (const jump of current ? activeDiagramJumps(current, input.jumps) : []) result.get(jump.source.line)?.push({
    start: jump.source.startColumn - 1, end: jump.source.endColumn, jump });
  if (current) {
    const source = input.sourceContext?.contentHash === current.asciiSha256 ? input.sourceContext : undefined;
    lines.forEach((line, index) => {
      const analyzed = input.syntax?.get(index + 1);
      const syntax = analyzed?.lexical ?? diagramSyntaxLine(line, JSON.stringify([input.displayNodeId, current.revisionId]));
      result.get(index + 1)!.push(...syntax);
      if (source) result.get(index + 1)!.push(...(analyzed?.semantic ?? mappedDiagramSyntax(line, index + 1, source, syntax)).map(range => ({ ...range, semantic: true })));
      for (const marker of analyzed?.markers ?? []) {
        const style = input.presentation?.markerStyles?.[marker.markerRuleId];
        result.get(index + 1)!.push({ ...marker, decoration: { color: style?.color ? highlightColor(style.color) : 'var(--diagram-marker-color, #ebcb8b)', ...(style?.underline ? { textDecoration: 'underline' } : {}) } });
      }
    });
  }
  if (current) for (const highlight of activeDiagramHighlights(current, input.highlights, input.revisionId)) {
    const targets = highlightNodeIds(highlight);
    const selected = targets.length ? nodes.filter(node => targets.includes(node.id)) : [];
    const spans = highlight.textRange ? lines.flatMap((line, index) => {
      const n = index + 1, range = highlight.textRange!;
      return n < range.startLine || n > range.endLine ? [] : [{ line: n, start: n === range.startLine ? range.startColumn - 1 : 0, end: n === range.endLine ? range.endColumn : line.length }];
    }) : targets.length ? selected.map(node => ({ line: node.line, start: node.startColumn - 1, end: node.endColumn }))
      : lines.map((line, index) => ({ line: index + 1, start: 0, end: line.length }));
    for (const span of spans) result.get(span.line)?.push({ start: span.start, end: span.end, decoration: { backgroundColor: `${highlightColor(highlight.color)}55` } });
  }
  return result;
}

/** Whole-range containment, never label equality or mere overlap. */
export function mappingContentNodeId(content: DiagramContent, mapping: DiagramElementMapping): string | undefined {
  if (content.asciiSha256 !== asciiSha256(content.ascii) || mapping.startColumn < 1 || mapping.endColumn < mapping.startColumn) return;
  const nodes = diagramContentNodes(content).filter(node => node.line === mapping.line
    && node.startColumn <= mapping.startColumn && node.endColumn >= mapping.endColumn);
  return nodes.length === 1 ? nodes[0].id : undefined;
}
