import type { DeepReadonly } from '../immutability';
import { asciiSha256 } from './asciiSha256';
import { parseAsciiTree } from './asciiTree';

export type DiagramContentNodeSpan = DeepReadonly<{ line: number; startColumn: number; endColumn: number }>;
export type DiagramContentNode = DeepReadonly<{
  id: string; label: string;
  /** @deprecated As geometry: first line only (still the node's anchor for identity matching). Use `contentNodeSpans`/`contentNodeRect` from contentNodeGeometry.ts. */
  line: number;
  branchColumn: number;
  /** @deprecated As geometry: first line only (still the node's anchor for identity matching). Use `contentNodeSpans`/`contentNodeRect` from contentNodeGeometry.ts. */
  startColumn: number;
  /** @deprecated As geometry: first line only (still the node's anchor for identity matching). Use `contentNodeSpans`/`contentNodeRect` from contentNodeGeometry.ts. */
  endColumn: number;
  /** One span per text line (1-based, inclusive). Absent on single-line tree nodes stored before spans existed. */
  lines?: DiagramContentNodeSpan[];
  parentId?: string; childIds: string[]; foldRanges: { startLine: number; endLine: number }[];
}>;
export type DiagramContent = DeepReadonly<{
  revisionId: string; ascii: string; asciiSha256: string;
  /**
   * Unstructured diagrams derive their content nodes. `parserVersion` pins that derivation: stored revisions key
   * `nodeRefs` by the derived node IDs, so content without a version keeps the legacy interpreter forever.
   */
  structure: { kind: 'diagram'; parserVersion?: 'ascii-graph-1' } | { kind: 'tree'; parserVersion: 'ascii-tree-1' | 'ascii-tree-2'; rootIds: string[]; nodes: Record<string, DiagramContentNode> };
}>;
export type DiagramParserVersion = 'ascii-tree-1' | 'ascii-tree-2' | 'ascii-graph-1' | 'legacy-diagram';
/** The parser version a rebuild of this content must use to reproduce the same structure and node IDs. */
export function contentParserVersion(structure: DiagramContent['structure']): DiagramParserVersion {
  return structure.kind === 'tree' ? structure.parserVersion : structure.parserVersion ?? 'legacy-diagram';
}
/** New content uses the current parser for its kind; rebuilds pass `contentParserVersion` of the content they reproduce. */
export function buildDiagramContent(ascii: string, revisionId: string, kind: 'diagram' | 'tree' = 'diagram', version?: DiagramParserVersion): DiagramContent {
  const parserVersion = version ?? (kind === 'tree' ? 'ascii-tree-2' : 'ascii-graph-1');
  if (kind === 'tree' && parserVersion !== 'ascii-tree-1' && parserVersion !== 'ascii-tree-2') throw new Error('Unknown tree parser version');
  if (kind === 'diagram' && parserVersion !== 'ascii-graph-1' && parserVersion !== 'legacy-diagram') throw new Error('Unknown diagram parser version');
  // A blank rectangular diagram reserves editable canvas space (e.g. a generated-diagram placeholder).
  const lines = ascii.split('\n');
  const blankRectangle = kind === 'diagram' && lines.length > 1 && lines[0].length > 0
    && lines.every(line => line.length === lines[0].length && /^ +$/.test(line));
  if ((!ascii.trim() && !blankRectangle) || /[^\x20-\x7e\n]/.test(ascii)) throw new Error('Diagram must contain printable ASCII content with LF newlines');
  const content: DiagramContent = { revisionId, ascii, asciiSha256: asciiSha256(ascii),
    structure: parserVersion === 'ascii-graph-1' ? { kind: 'diagram', parserVersion } : { kind: 'diagram' } };
  if (kind === 'diagram') return content;
  const treeVersion = parserVersion as 'ascii-tree-1' | 'ascii-tree-2';
  const parsed = parseAsciiTree(ascii, treeVersion);
  const ids = new Map(parsed.map(node => [node.line, `${revisionId}:${content.asciiSha256}:line-${node.line}`]));
  const nodes: Record<string, DiagramContentNode> = {};
  for (const node of parsed) {
    const id = ids.get(node.line)!;
    const peer = parsed.find(next => next.line > node.line && next.branchColumn <= node.branchColumn);
    nodes[id] = { id, label: node.text, line: node.line, branchColumn: node.branchColumn, startColumn: node.textColumn,
      endColumn: node.textColumn + Math.max(1, node.text.length) - 1,
      parentId: node.parentLine === undefined ? undefined : ids.get(node.parentLine),
      childIds: parsed.filter(child => child.parentLine === node.line).map(child => ids.get(child.line)!),
      foldRanges: node.descendantLines.length ? [{ startLine: node.line + 1, endLine: peer ? peer.line - 1 : lines.length }] : [] };
  }
  return { ...content, structure: { kind: 'tree', parserVersion: treeVersion, rootIds: Object.values(nodes).filter(node => !node.parentId).map(node => node.id), nodes } };
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
