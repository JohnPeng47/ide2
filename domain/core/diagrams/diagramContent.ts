import { asciiSha256 } from './asciiSha256';
import { parseAsciiTree } from './asciiTree';
import { validateDiagramLocalMappings } from './diagramMappings';
import type { DiagramElementMapping } from '../records/domain';

export interface DiagramContentNode {
  id: string; label: string; line: number; branchColumn: number; startColumn: number; endColumn: number;
  parentId?: string; childIds: string[]; foldRanges: { startLine: number; endLine: number }[];
}
export interface DiagramContent {
  revisionId: string; ascii: string; asciiSha256: string; mappings: readonly DiagramElementMapping[];
  structure: { kind: 'diagram' } | { kind: 'tree'; parserVersion: 'ascii-tree-1'; rootIds: string[]; nodes: Record<string, DiagramContentNode> };
}
export function buildDiagramContent(ascii: string, revisionId: string, kind: 'diagram' | 'tree' = 'diagram', mappings: readonly DiagramElementMapping[] = []): DiagramContent {
  if (!ascii.trim() || ascii.length > 20000 || /[^\x20-\x7e\n]/.test(ascii)) throw new Error('Diagram must contain 1–20000 printable ASCII characters with LF newlines');
  validateDiagramLocalMappings(ascii, mappings);
  const content: DiagramContent = { revisionId, ascii, asciiSha256: asciiSha256(ascii), mappings: structuredClone(mappings), structure: { kind: 'diagram' } };
  if (kind === 'diagram') return content;
  const parsed = parseAsciiTree(ascii);
  const ids = new Map(parsed.map(node => [node.line, `${revisionId}:${content.asciiSha256}:line-${node.line}`]));
  const nodes: Record<string, DiagramContentNode> = {};
  for (const node of parsed) {
    const id = ids.get(node.line)!;
    const peer = parsed.find(next => next.line > node.line && next.branchColumn <= node.branchColumn);
    nodes[id] = { id, label: node.text, line: node.line, branchColumn: node.branchColumn, startColumn: node.textColumn,
      endColumn: node.textColumn + Math.max(1, node.text.length) - 1,
      parentId: node.parentLine === undefined ? undefined : ids.get(node.parentLine),
      childIds: parsed.filter(child => child.parentLine === node.line).map(child => ids.get(child.line)!),
      foldRanges: node.descendantLines.length ? [{ startLine: node.line + 1, endLine: peer ? peer.line - 1 : ascii.split('\n').length }] : [] };
  }
  content.structure = { kind: 'tree', parserVersion: 'ascii-tree-1', rootIds: Object.values(nodes).filter(node => !node.parentId).map(node => node.id), nodes };
  return content;
}
export function visibleContentLines(content: DiagramContent, collapsedIds: readonly string[]): number[] {
  const hidden = new Set<number>();
  if (content.structure.kind === 'tree') for (const id of collapsedIds) {
    const node = content.structure.nodes[id];
    if (!node) throw new Error('STALE_CONTENT_NODE');
    for (const range of node.foldRanges) for (let line = range.startLine; line <= range.endLine; line++) hidden.add(line);
  }
  return content.ascii.split('\n').map((_, i) => i + 1).filter(line => !hidden.has(line));
}

export function contentTreeNodes(content: DiagramContent): import('./asciiTree').AsciiTreeNode[] {
  if (content.structure.kind !== 'tree') return [];
  const nodes = content.structure.nodes;
  return Object.values(nodes).map(node => ({ line: node.line, branchColumn: node.branchColumn, textColumn: node.startColumn, text: node.label,
    parentLine: node.parentId ? nodes[node.parentId]?.line : undefined,
    descendantLines: Object.values(nodes).filter(child => node.foldRanges.some(range => child.line >= range.startLine && child.line <= range.endLine)).map(child => child.line) }));
}
