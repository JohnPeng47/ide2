export interface AsciiTreeNode {
  line: number;
  branchColumn: number;
  textColumn: number;
  text: string;
  parentLine?: number;
  descendantLines: number[];
}

const BRANCH_LINE = /^([| ]*)([+`\\]--(?:>)?)(\s+)(.*)$/;

/** Plain roots belong to conventional trees, not legacy arrow-tree headings. */
function isPlainRoot(lines: string[], index: number): boolean {
  if (!/^\S/.test(lines[index]) || /^[|+`\\]/.test(lines[index])) return false;
  let next = index + 1;
  while (next < lines.length && /^[| ]+$/.test(lines[next])) next += 1;
  const branch = next < lines.length ? BRANCH_LINE.exec(lines[next]) : null;
  return Boolean(branch && !branch[2].endsWith(">"));
}

/** Parse the indentation-based branches used by ASCII diagram trees. */
export function parseAsciiTree(ascii: string): AsciiTreeNode[] {
  const nodes: AsciiTreeNode[] = [];
  const ancestors: AsciiTreeNode[] = [];
  const lines = ascii.replace(/\r\n?/g, "\n").split("\n");
  for (const [index, line] of lines.entries()) {
    const match = BRANCH_LINE.exec(line);
    const plainRoot = !match && isPlainRoot(lines, index);
    if (!match && !plainRoot) continue;
    const branchColumn = match ? match[1].length : -1;
    while (ancestors.at(-1) && ancestors.at(-1)!.branchColumn >= branchColumn) ancestors.pop();
    const parent = ancestors.at(-1);
    const node: AsciiTreeNode = {
      line: index + 1,
      branchColumn,
      // Coordinates exposed by diagram mappings are one-based and inclusive.
      textColumn: match ? branchColumn + match[2].length + match[3].length + 1 : 1,
      text: match ? match[4].trimEnd() : line.trimEnd(),
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
