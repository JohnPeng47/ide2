import { describe, expect, it } from "vitest";
import {
  asciiForSelection,
  mappingIntersectsSelection,
  mappingsForSelection,
  normalizeDiagramSelection,
  selectionContainsPoint
} from "./diagramSelection";
import type { DiagramElementMapping } from "./domain";

const mapping = (id: string, line: number, startColumn: number, endColumn: number): DiagramElementMapping => ({
  id,
  entityId: `entity-${id}`,
  sourceRangeIndex: 0,
  line,
  startColumn,
  endColumn
});

describe("diagram rectangle selection", () => {
  it("normalizes drags in every direction", () => {
    const expected = { startLine: 2, endLine: 8, startColumn: 3, endColumn: 12 };
    expect(normalizeDiagramSelection({ line: 2, column: 3 }, { line: 8, column: 12 })).toEqual(expected);
    expect(normalizeDiagramSelection({ line: 8, column: 12 }, { line: 2, column: 3 })).toEqual(expected);
    expect(normalizeDiagramSelection({ line: 2, column: 12 }, { line: 8, column: 3 })).toEqual(expected);
    expect(normalizeDiagramSelection({ line: 8, column: 3 }, { line: 2, column: 12 })).toEqual(expected);
  });

  it("uses inclusive rectangle intersection", () => {
    const selection = { startLine: 3, endLine: 5, startColumn: 10, endColumn: 20 };
    expect(mappingIntersectsSelection(mapping("left-edge", 3, 5, 10), selection)).toBe(true);
    expect(mappingIntersectsSelection(mapping("right-edge", 5, 20, 25), selection)).toBe(true);
    expect(mappingIntersectsSelection(mapping("left-out", 4, 1, 9), selection)).toBe(false);
    expect(mappingIntersectsSelection(mapping("line-out", 6, 12, 14), selection)).toBe(false);
  });

  it("returns mappings in stable visual order", () => {
    const selection = { startLine: 1, endLine: 8, startColumn: 1, endColumn: 30 };
    expect(mappingsForSelection([
      mapping("third", 4, 10, 12),
      mapping("first", 2, 3, 7),
      mapping("second", 2, 12, 18)
    ], selection).map(({ id }) => id)).toEqual(["first", "second", "third"]);
    expect(selectionContainsPoint(selection, 8, 30)).toBe(true);
    expect(selectionContainsPoint(selection, 9, 30)).toBe(false);
  });

  it("extracts the exact ASCII characters beneath the rectangle", () => {
    expect(asciiForSelection(
      "+-----+\n| AB  |\n+--+",
      { startLine: 1, endLine: 3, startColumn: 2, endColumn: 6 }
    )).toBe("-----\n AB  \n--+  ");
  });
});
