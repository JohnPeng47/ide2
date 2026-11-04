/** One-based, inclusive cell bounds in raw ASCII space. */
export interface CellRect { line1: number; col1: number; line2: number; col2: number }

/** A block of text in a parsed diagram. Unrelated to canvas grid boxes. */
export interface GraphBox {
  id: string;
  /** Trimmed text lines joined with '\n'. */
  text: string;
  rect: CellRect;
  /** One span per text line, so wires that cross the rect stay distinguishable. */
  lines: { line: number; col1: number; col2: number }[];
  parentId?: string;
  childIds: string[];
}

export type EdgeDirection = '->' | '<->' | '--';
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  direction: EdgeDirection;
  label?: string;
  cells: { line: number; col: number }[];
}

export interface AsciiGraph {
  parserVersion: 'ascii-graph-1';
  boxes: GraphBox[];
  edges: GraphEdge[];
  /** Box IDs without a parent; each is a tree root or standalone box. */
  rootIds: string[];
}
