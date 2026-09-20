import { createDiagram } from '../diagram';
import { describe, expect, it } from "vitest";
import {
  boxesOverlap,
  composeScene,
  flattenGrid,
  hitTest,
  layoutScene,
  measureContent,
  projectMapping,
  resolveScene,
  updateGridBox,
  type GridBox,
  type LineGridScene
} from "../lineGrid";

function diagram(id: string, column: number, row = 0): GridBox {
  return { id, contentId: id, kind: "diagram", position: { column, row }, collapsed: false, collapsedContentId: `${id}-summary` };
}
function fixture(children: GridBox[], texts: Record<string, string>): LineGridScene {
  return { root: { id: "root", kind: "container", position: { column: 0, row: 0 }, collapsed: false,
    children, layout: { collisionPolicy: "push-right", gap: 2 } },
  contents: Object.fromEntries(Object.entries(texts).map(([id, ascii]) => [id, createDiagram({ id, ascii, revision: 0 })])) };
}
function bounds(scene: LineGridScene, id: string) {
  return flattenGrid(resolveScene(scene)).find((node) => node.box.id === id)!.bounds;
}

describe("line grid composition", () => {
  it("places multiple fragments per row, independent of traversal order and preceding text length", () => {
    const scene = fixture([diagram("b", 12), diagram("a", 0)], { a: "  A\n    a", b: " B\n  b" });
    expect(composeScene(scene).split("\n")).toEqual(["  A          B", "    a         b"]);
    expect(hitTest(scene, { column: 14, row: 1 })).toEqual({ boxId: "b", contentId: "b", local: { column: 2, row: 1 } });
    expect(hitTest(scene, { column: 15, row: 1 })?.boxId).not.toBe("b");
  });

  it("accumulates nested origins and converts existing one-based inclusive mappings", () => {
    const group: GridBox = { id: "group", kind: "container", position: { column: 10, row: 3 }, collapsed: false,
      layout: { collisionPolicy: "push-right", gap: 2 }, children: [diagram("a", 4, 2)] };
    const scene = fixture([group], { a: "  ABC" });
    const b = bounds(scene, "a");
    expect(composeScene(scene).split("\n")[5]).toBe("                ABC");
    expect(projectMapping(b, { id: "m", entityId: "e", sourceRangeIndex: 0, line: 1, startColumn: 3, endColumn: 5 }))
      .toEqual({ column: 16, row: 5, columns: 3, rows: 1 });
    expect(hitTest(scene, { column: 17, row: 5 })?.local).toEqual({ column: 3, row: 0 });
  });

  it("reserves blank space and rejects overlaps, invalid cells, and excessive allocations", () => {
    const a = { ...diagram("a", 0), minimumSize: { columns: 12, rows: 4 } };
    expect(() => composeScene(fixture([a, diagram("b", 6, 2)], { a: "A", b: "B" }))).toThrow("collision");
    expect(boxesOverlap({ column: 0, row: 0, columns: 4, rows: 2 }, { column: 4, row: 0, columns: 4, rows: 2 })).toBe(false);
    expect(() => measureContent("A\tB")).toThrow("ASCII");
    expect(() => resolveScene(fixture([diagram("a", -1)], { a: "A" }))).toThrow("integer");
    expect(() => composeScene(fixture([{ ...a, minimumSize: { columns: 20000, rows: 20000 } }], { a: "A" }))).toThrow("canvas size");
  });
});

describe("rightward layout transactions", () => {
  it("anchors an insertion, propagates a collision chain, and leaves unrelated rows untouched", () => {
    const scene = fixture([diagram("a", 0), diagram("b", 8), diagram("d", 14), diagram("c", 5), diagram("e", 8, 4)],
      { a: "AAA", b: "BBBB", c: "CCCCCC", d: "DDDD", e: "EEEE" });
    const before = JSON.stringify(scene);
    const next = layoutScene(scene, "c");
    expect(bounds(next, "a").column).toBe(0);
    expect(bounds(next, "c").column).toBe(5);
    expect(bounds(next, "b").column).toBe(13);
    expect(bounds(next, "d").column).toBe(19);
    expect(bounds(next, "e").column).toBe(8);
    expect(JSON.stringify(scene)).toBe(before);
    expect(layoutScene(next, "c")).toEqual(next);
  });

  it("propagates nested growth to ancestor siblings and moves whole subtrees", () => {
    const inner: GridBox = { id: "inner", kind: "container", position: { column: 0, row: 0 }, collapsed: false,
      layout: { collisionPolicy: "push-right", gap: 2 }, children: [diagram("a", 0), diagram("b", 5)] };
    const scene = fixture([inner, diagram("c", 10)], { a: "AAAAAAAA", b: "BB", c: "CC" });
    const next = layoutScene(scene, "a");
    expect(bounds(next, "b").column).toBe(10);
    expect(bounds(next, "inner").columns).toBe(12);
    expect(bounds(next, "c").column).toBe(14);
    const moved = layoutScene(updateGridBox(next, "inner", (box) => ({ ...box, position: { column: 4, row: 2 } })), "inner");
    expect(bounds(moved, "b")).toMatchObject({ column: 14, row: 2 });
  });

  it("retains hidden child positions, releases reserved space, and resolves expansion without packing on collapse", () => {
    const group: GridBox = { id: "group", kind: "container", position: { column: 0, row: 0 }, collapsed: true,
      collapsedContentId: "summary", minimumSize: { columns: 20, rows: 10 },
      layout: { collisionPolicy: "push-right", gap: 2 }, children: [diagram("a", 5)] };
    const scene = fixture([group, diagram("b", 8)], { a: "AAAAA", b: "BB", summary: "[+]" });
    expect(bounds(scene, "group")).toMatchObject({ columns: 3, rows: 1 });
    expect(flattenGrid(resolveScene(scene)).some((node) => node.box.id === "a")).toBe(false);
    const expanded = layoutScene(updateGridBox(scene, "group", (box) => ({ ...box, collapsed: false })), "group");
    expect(bounds(expanded, "a").column).toBe(5);
    expect(bounds(expanded, "b").column).toBe(22);
    const collapsed = layoutScene(updateGridBox(expanded, "group", (box) => ({ ...box, collapsed: true })), "group");
    expect(bounds(collapsed, "b").column).toBe(22);
  });
});
