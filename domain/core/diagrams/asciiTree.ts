import { parseDiagram } from './interpreter';

export interface AsciiTreeNode {
  line: number;
  branchColumn: number;
  textColumn: number;
  text: string;
  parentLine?: number;
  descendantLines: number[];
}

/** Compatibility projection of the shared spatial interpreter for existing tree consumers. */
export function parseAsciiTree(ascii: string, compatibility: 'ascii-tree-1' | 'ascii-tree-2' = 'ascii-tree-2'): AsciiTreeNode[] {
  const parsed = parseDiagram(ascii, { dialect: 'tree', compatibility,
    treeTolerance: 0, wireTolerance: 0, continuation: 'separate', repairs: 'none' });
  const lines = new Map(parsed.nodes.map(node => [node.id, node.spans[0].line]));
  const nodes = parsed.nodes.map((node): AsciiTreeNode => ({
    line: node.spans[0].line, branchColumn: node.branchColumn === undefined ? -1 : node.branchColumn - 1,
    textColumn: node.spans[0].column, text: node.label,
    ...(node.parentId ? { parentLine: lines.get(node.parentId) } : {}), descendantLines: []
  }));
  const byLine = new Map(nodes.map(node => [node.line, node]));
  for (const node of nodes) {
    let parent = node.parentLine === undefined ? undefined : byLine.get(node.parentLine);
    while (parent) {
      parent.descendantLines.push(node.line);
      parent = parent.parentLine === undefined ? undefined : byLine.get(parent.parentLine);
    }
  }
  return nodes;
}

export function asciiTreeLineage(ascii: string, line: number): AsciiTreeNode[] {
  const nodes = parseAsciiTree(ascii);
  const byLine = new Map(nodes.map((node) => [node.line, node]));
  const lineage: AsciiTreeNode[] = [];
  let node = byLine.get(line);
  while (node) {
    lineage.unshift(node);
    node = node.parentLine === undefined ? undefined : byLine.get(node.parentLine);
  }
  return lineage;
}

/** Return a node and all of its descendants in display (pre-order) order. */
export function asciiTreeSubtree(ascii: string, line: number): AsciiTreeNode[] {
  const nodes = parseAsciiTree(ascii);
  const root = nodes.find((node) => node.line === line);
  if (!root) return [];
  const descendantLines = new Set(root.descendantLines);
  return nodes.filter((node) => node.line === line || descendantLines.has(node.line));
}

export function hiddenAsciiTreeLines(
  ascii: string,
  collapsedNodeLines: ReadonlySet<number>
): Set<number> {
  const lines = ascii.replace(/\r\n?/g, "\n").split("\n");
  const nodes = parseAsciiTree(ascii);
  const hidden = new Set<number>();
  for (const node of nodes) {
    if (!collapsedNodeLines.has(node.line) || node.descendantLines.length === 0) continue;
    const nextPeer = nodes.find((candidate) => (
      candidate.line > node.line && candidate.branchColumn <= node.branchColumn
    ));
    const endLine = nextPeer ? nextPeer.line - 1 : lines.length;
    for (let line = node.line + 1; line <= endLine; line += 1) hidden.add(line);
  }
  return hidden;
}
