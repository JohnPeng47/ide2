import type { DiagramElementMapping, DiagramSelectionBounds } from "./domain";

export interface DiagramGridPoint {
  line: number;
  column: number;
}

export function normalizeDiagramSelection(
  anchor: DiagramGridPoint,
  focus: DiagramGridPoint
): DiagramSelectionBounds {
  return {
    startLine: Math.min(anchor.line, focus.line),
    endLine: Math.max(anchor.line, focus.line),
    startColumn: Math.min(anchor.column, focus.column),
    endColumn: Math.max(anchor.column, focus.column)
  };
}

export function mappingIntersectsSelection(
  mapping: DiagramElementMapping,
  selection: DiagramSelectionBounds
): boolean {
  return selection.startLine <= mapping.line
    && selection.endLine >= mapping.line
    && selection.startColumn <= mapping.endColumn
    && selection.endColumn >= mapping.startColumn;
}

export function mappingsForSelection(
  mappings: readonly DiagramElementMapping[],
  selection: DiagramSelectionBounds
): DiagramElementMapping[] {
  return mappings
    .filter((mapping) => mappingIntersectsSelection(mapping, selection))
    .sort((left, right) => (
      left.line - right.line
      || left.startColumn - right.startColumn
      || left.endColumn - right.endColumn
      || left.id.localeCompare(right.id)
    ));
}

/** Extracts the exact rectangular ASCII region, rebased to its left edge. */
export function asciiForSelection(
  ascii: string,
  selection: DiagramSelectionBounds
): string {
  const width = selection.endColumn - selection.startColumn + 1;
  return ascii
    .split("\n")
    .slice(selection.startLine - 1, selection.endLine)
    .map((line) => line.replace(/\r$/, "")
      .padEnd(selection.endColumn, " ")
      .slice(selection.startColumn - 1, selection.startColumn - 1 + width))
    .join("\n");
}

export function selectionContainsPoint(
  selection: DiagramSelectionBounds | null,
  line: number,
  column: number
): boolean {
  return Boolean(selection
    && line >= selection.startLine
    && line <= selection.endLine
    && column >= selection.startColumn
    && column <= selection.endColumn);
}
