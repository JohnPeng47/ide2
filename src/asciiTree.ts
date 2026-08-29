export interface AsciiTreeNode {
  line: number;
  branchColumn: number;
  textColumn: number;
  text: string;
  parentLine?: number;
  descendantLines: number[];
}

const BRANCH_LINE = /^([| ]*)(?:\+|`)-->\s+(.*)$/;

/** Parse the indentation-based branches used by ASCII diagram trees. */
export function parseAsciiTree(ascii: string): AsciiTreeNode[] {
  const nodes: AsciiTreeNode[] = [];
  const ancestors: AsciiTreeNode[] = [];
  for (const [index, line] of ascii.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const match = BRANCH_LINE.exec(line);
    if (!match) continue;
    const branchColumn = match[1].length;
    while (ancestors.at(-1) && ancestors.at(-1)!.branchColumn >= branchColumn) ancestors.pop();
    const parent = ancestors.at(-1);
    const node: AsciiTreeNode = {
      line: index + 1,
      branchColumn,
      textColumn: branchColumn + 6,
      text: match[2].trim(),
      ...(parent ? { parentLine: parent.line } : {}),
      descendantLines: []
    };
    for (const ancestor of ancestors) ancestor.descendantLines.push(node.line);
    nodes.push(node);
    ancestors.push(node);
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
