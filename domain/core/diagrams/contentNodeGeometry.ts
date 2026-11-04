import type { DiagramContentNode, DiagramContentNodeSpan } from './diagramContent';

type NodeGeometry = Pick<DiagramContentNode, 'line' | 'startColumn' | 'endColumn' | 'lines'>;
export interface ContentRect { startLine: number; endLine: number; startColumn: number; endColumn: number }

/** Every cell span a content node occupies. Nodes stored without spans occupy their single legacy line. */
export function contentNodeSpans(node: NodeGeometry): readonly DiagramContentNodeSpan[] {
  return node.lines?.length ? node.lines : [{ line: node.line, startColumn: node.startColumn, endColumn: node.endColumn }];
}

/** The bounding rectangle of a node's spans (1-based, inclusive). */
export function contentNodeRect(node: NodeGeometry): ContentRect {
  const spans = contentNodeSpans(node);
  return {
    startLine: Math.min(...spans.map(s => s.line)), endLine: Math.max(...spans.map(s => s.line)),
    startColumn: Math.min(...spans.map(s => s.startColumn)), endColumn: Math.max(...spans.map(s => s.endColumn))
  };
}

/** A node intersects a rectangle when any of its text spans does; wires crossing its bounds do not count. */
export function contentNodeIntersectsRect(node: NodeGeometry, rect: ContentRect): boolean {
  return contentNodeSpans(node).some(span => span.line >= rect.startLine && span.line <= rect.endLine
    && span.startColumn <= rect.endColumn && span.endColumn >= rect.startColumn);
}

/** Whether a single-line range (such as a source mapping head) overlaps one of the node's spans. */
export function contentNodeOverlapsRange(node: NodeGeometry, range: { line: number; startColumn: number; endColumn: number }): boolean {
  return contentNodeSpans(node).some(span => span.line === range.line && span.startColumn <= range.endColumn && span.endColumn >= range.startColumn);
}

/** Whether a single-line range lies entirely within one of the node's spans (jump anchors, mapping heads). */
export function contentNodeContainsRange(node: NodeGeometry, range: { line: number; startColumn: number; endColumn: number }): boolean {
  return contentNodeSpans(node).some(span => span.line === range.line && span.startColumn <= range.startColumn && span.endColumn >= range.endColumn);
}

/** The node's own text, one source line per span. */
export function contentNodeText(node: NodeGeometry, asciiLines: readonly string[]): string {
  return contentNodeSpans(node).map(span => (asciiLines[span.line - 1] ?? '').slice(span.startColumn - 1, span.endColumn)).join('\n');
}
