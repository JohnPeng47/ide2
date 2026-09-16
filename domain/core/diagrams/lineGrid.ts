import type { DiagramElementMapping } from "../records/domain";

/** Grid coordinates are zero-based cells; right and bottom edges are exclusive. */
export interface GridPoint { column: number; row: number }
export interface GridSize { columns: number; rows: number }
export interface GridBounds extends GridPoint, GridSize {}

export interface CanvasDiagram {
  id: string;
  revision: number;
  structureKind?: 'diagram' | 'tree';
  diagramContent?: import('./diagramContent').DiagramContent;
  ascii: string;
  mappings: readonly DiagramElementMapping[];
}

export type GridBox = {
  id: string;
  position: GridPoint;
  minimumSize?: GridSize;
  collapsed: boolean;
  collapsedContentId?: string;
} & (
  | { kind: "diagram"; contentId: string }
  | { kind: "container"; children: readonly GridBox[]; layout: { collisionPolicy: "push-right"; gap: number } }
);

export interface LineGridScene {
  contents: Readonly<Record<string, CanvasDiagram>>;
  root: GridBox;
}

export interface ResolvedGridBox {
  box: GridBox;
  /** Absolute scene coordinates. */
  bounds: GridBounds;
  contentId?: string;
  children: readonly ResolvedGridBox[];
}

// Bounds also limit accidental allocation when composing sparse text.
const MAX_EXTENT = 20000;
const MAX_CELLS = 4_000_000;

function integer(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_EXTENT) {
    throw new Error(`${label} must be an integer between 0 and ${MAX_EXTENT}`);
  }
}

export function measureContent(ascii: string): GridSize {
  if (/[^\x20-\x7e\n]/.test(ascii)) throw new Error("Grid content must be printable ASCII with LF newlines");
  const lines = ascii.split("\n");
  return { columns: Math.max(1, ...lines.map((line) => line.length)), rows: lines.length };
}

export function boxesOverlap(a: GridBounds, b: GridBounds, gap = 0): boolean {
  return a.row < b.row + b.rows && b.row < a.row + a.rows
    && a.column < b.column + b.columns + gap && b.column < a.column + a.columns + gap;
}

/** Measure without mutating input. Ancestor containment is not a collision. */
export function resolveScene(scene: LineGridScene): ResolvedGridBox {
  const ids = new Set<string>();
  function visit(box: GridBox, parent: GridPoint): ResolvedGridBox {
    if (ids.has(box.id)) throw new Error(`Duplicate GridBox id: ${box.id}`);
    ids.add(box.id);
    integer(box.position.column, "column");
    integer(box.position.row, "row");
    if (box.minimumSize) {
      integer(box.minimumSize.columns, "columns");
      integer(box.minimumSize.rows, "rows");
    }
    const origin = { column: parent.column + box.position.column, row: parent.row + box.position.row };
    integer(origin.column, "absolute column");
    integer(origin.row, "absolute row");
    if (box.kind === "container") integer(box.layout.gap, "gap");
    const contentId = box.collapsed ? box.collapsedContentId : box.kind === "diagram" ? box.contentId : undefined;
    if (box.collapsed && !contentId) throw new Error(`Collapsed box ${box.id} needs collapsed content`);
    let size: GridSize = { columns: 1, rows: 1 };
    if (contentId) {
      const content = scene.contents[contentId];
      if (!content) throw new Error(`Missing grid content: ${contentId}`);
      size = measureContent(content.ascii);
    }
    const children = box.kind === "container" && !box.collapsed
      ? box.children.map((child) => visit(child, origin)) : [];
    for (const child of children) {
      size.columns = Math.max(size.columns, child.bounds.column - origin.column + child.bounds.columns);
      size.rows = Math.max(size.rows, child.bounds.row - origin.row + child.bounds.rows);
    }
    // Reserved expanded space does not keep a collapsed box large.
    if (!box.collapsed && box.minimumSize) {
      size.columns = Math.max(size.columns, box.minimumSize.columns);
      size.rows = Math.max(size.rows, box.minimumSize.rows);
    }
    integer(origin.column + size.columns, "right edge");
    integer(origin.row + size.rows, "bottom edge");
    return { box, bounds: { ...origin, ...size }, contentId, children };
  }
  return visit(scene.root, { column: 0, row: 0 });
}

export function flattenGrid(root: ResolvedGridBox): ResolvedGridBox[] {
  return [root, ...root.children.flatMap(flattenGrid)];
}

export function findCollisions(scene: LineGridScene, parentId: string, bounds: GridBounds, excludeId?: string): string[] {
  const parent = flattenGrid(resolveScene(scene)).find((node) => node.box.id === parentId);
  if (!parent) throw new Error(`Unknown parent: ${parentId}`);
  return parent.children.filter((child) => child.box.id !== excludeId && boxesOverlap(child.bounds, bounds))
    .map((child) => child.box.id);
}

/** Immutable tree edit; use layoutScene afterward to commit the resulting positions. */
export function updateGridBox(scene: LineGridScene, id: string, update: (box: GridBox) => GridBox): LineGridScene {
  let found = false;
  function visit(box: GridBox): GridBox {
    if (box.id === id) { found = true; return update(box); }
    return box.kind === "container" ? { ...box, children: box.children.map(visit) } : box;
  }
  const root = visit(scene.root);
  if (!found) throw new Error(`Unknown GridBox: ${id}`);
  return { ...scene, root };
}

/**
 * Anchor the changed subtree at every ancestor. Settle other siblings in stable
 * spatial order, only moving right. Each settled box is an immutable obstacle,
 * so collision chains terminate without boxes repeatedly pushing each other.
 */
export function layoutScene(scene: LineGridScene, changedId: string): LineGridScene {
  function visit(box: GridBox): { box: GridBox; changed: boolean } {
    if (box.kind === "diagram") return { box, changed: box.id === changedId };
    const descendants = box.children.map(visit);
    let children = descendants.map((child) => child.box);
    const anchoredId = descendants.find((child) => child.changed)?.box.id;
    if (!box.collapsed) {
      const measure = (child: GridBox) => resolveScene({ ...scene, root: child }).bounds;
      const ordered = children.map((child, index) => ({ child, index })).sort((a, b) =>
        Number(b.child.id === anchoredId) - Number(a.child.id === anchoredId)
        || a.child.position.column - b.child.position.column
        || a.child.position.row - b.child.position.row || a.index - b.index);
      const settled: GridBounds[] = [];
      const replacements = new Map<string, GridBox>();
      for (const { child } of ordered) {
        const bounds = { ...measure(child) };
        let collisions = settled.filter((other) => boxesOverlap(bounds, other, box.layout.gap));
        while (collisions.length) {
          bounds.column = Math.max(...collisions.map((other) => other.column + other.columns + box.layout.gap));
          collisions = settled.filter((other) => boxesOverlap(bounds, other, box.layout.gap));
        }
        settled.push(bounds);
        replacements.set(child.id, { ...child, position: { column: bounds.column, row: bounds.row } });
      }
      children = children.map((child) => replacements.get(child.id)!);
    }
    return { box: { ...box, children }, changed: box.id === changedId || descendants.some((child) => child.changed) };
  }
  const result = visit(scene.root);
  if (!result.changed) throw new Error(`Unknown GridBox: ${changedId}`);
  const next = { ...scene, root: result.box };
  // Check all final bounds before publishing a transaction.
  composeScene(next);
  return next;
}

export function composeScene(scene: LineGridScene): string {
  const root = resolveScene(scene);
  const width = root.bounds.column + root.bounds.columns;
  const height = root.bounds.row + root.bounds.rows;
  if (width * height > MAX_CELLS) throw new Error("Grid exceeds the supported canvas size");
  const rows = Array.from({ length: height }, () => "");
  function paint(node: ResolvedGridBox): void {
    for (let i = 0; i < node.children.length; i++) {
      for (let j = i + 1; j < node.children.length; j++) {
        if (boxesOverlap(node.children[i].bounds, node.children[j].bounds)) {
          throw new Error(`GridBox collision: ${node.children[i].box.id} and ${node.children[j].box.id}`);
        }
      }
    }
    if (node.contentId) {
      scene.contents[node.contentId].ascii.split("\n").forEach((line, index) => {
        const row = node.bounds.row + index;
        const start = node.bounds.column;
        const existing = rows[row].padEnd(start, " ");
        rows[row] = existing.slice(0, start) + line + existing.slice(start + line.length);
      });
    }
    node.children.forEach(paint);
  }
  paint(root);
  return rows.join("\n");
}

export function hitTest(scene: LineGridScene, point: GridPoint): { boxId: string; contentId?: string; local: GridPoint } | null {
  function visit(node: ResolvedGridBox): ReturnType<typeof hitTest> {
    const b = node.bounds;
    if (point.column < b.column || point.column >= b.column + b.columns
      || point.row < b.row || point.row >= b.row + b.rows) return null;
    for (const child of node.children) {
      const hit = visit(child);
      if (hit) return hit;
    }
    return { boxId: node.box.id, contentId: node.contentId,
      local: { column: point.column - b.column, row: point.row - b.row } };
  }
  return visit(resolveScene(scene));
}

export function projectMapping(bounds: GridBounds, mapping: DiagramElementMapping): GridBounds {
  return { column: bounds.column + mapping.startColumn - 1, row: bounds.row + mapping.line - 1,
    columns: mapping.endColumn - mapping.startColumn + 1, rows: 1 };
}
