import { describe, expect, it } from "vitest";
import {
  activatePaneTab,
  addPane,
  addPaneTab,
  clampPaneRatioToSizes,
  closePaneTab,
  createPaneLayout,
  findPaneSplit,
  movePaneTab,
  parsePaneLayout,
  paneIds,
  removePane,
  resizePaneSplit
} from "./model";

function initial() {
  return createPaneLayout({
    id: "main",
    tabs: [{ id: "diagram", label: "Diagram" }]
  });
}

describe("pane layout engine", () => {
  it("creates nested BSP splits around any existing pane", () => {
    const withContext = addPane(initial(), {
      id: "context",
      tabs: [{ id: "entities", label: "Code entities" }]
    }, "main", { placement: "right", ratio: 0.62, splitId: "root" });
    const nested = addPane(withContext, {
      id: "preview",
      tabs: [{ id: "source", label: "Source" }]
    }, "context", { placement: "bottom", ratio: 0.7, splitId: "context-split" });

    expect(paneIds(nested.root)).toEqual(["main", "context", "preview"]);
    expect(findPaneSplit(nested.root, "root")).toMatchObject({ orientation: "horizontal", ratio: 0.62 });
    expect(findPaneSplit(nested.root, "context-split")).toMatchObject({ orientation: "vertical", ratio: 0.7 });
  });

  it("collapses a split when its pane is closed", () => {
    const split = addPane(initial(), {
      id: "context",
      tabs: [{ id: "entities", label: "Code entities" }]
    }, "main", { splitId: "root" });
    const closed = removePane(split, "context");

    expect(closed.root).toEqual({ kind: "pane", paneId: "main" });
    expect(closed.focusedPaneId).toBe("main");
  });

  it("owns tab activation, movement, and last-tab pane closure", () => {
    let state = addPane(initial(), {
      id: "context",
      tabs: [{ id: "entities", label: "Code entities" }]
    }, "main");
    state = addPaneTab(state, "main", { id: "call-graph", label: "Call graph" });
    state = activatePaneTab(state, "main", "diagram");
    state = movePaneTab(state, "call-graph", "context", 0);

    expect(state.panes.context.tabs.map((tab) => tab.id)).toEqual(["call-graph", "entities"]);
    expect(state.panes.context.activeTabId).toBe("call-graph");
    expect(closePaneTab(state, "main", "diagram").panes.main).toBeUndefined();
  });

  it("clamps split resizing to usable pane sizes", () => {
    const split = addPane(initial(), {
      id: "context",
      tabs: [{ id: "entities", label: "Code entities" }]
    }, "main", { splitId: "root" });

    expect(findPaneSplit(resizePaneSplit(split, "root", 5).root, "root")?.ratio).toBe(0.9);
    expect(findPaneSplit(resizePaneSplit(split, "root", -2).root, "root")?.ratio).toBe(0.1);
  });

  it("clamps persisted ratios to rendered pane minimums", () => {
    expect(clampPaneRatioToSizes(0.88, 1280, 709, 320)).toBeCloseTo(951 / 1271);
    expect(clampPaneRatioToSizes(0.12, 1280, 320, 709)).toBeCloseTo(320 / 1271);
    expect(clampPaneRatioToSizes(0.62, 1920, 709, 320)).toBe(0.62);
  });

  it("falls back to proportional minimums when the viewport cannot fit both panes", () => {
    expect(clampPaneRatioToSizes(0.9, 700, 480, 320)).toBe(0.6);
  });

  it("restores valid persisted trees and rejects dangling pane references", () => {
    const split = addPane(initial(), {
      id: "context",
      tabs: [{ id: "entities", label: "Code entities" }]
    }, "main", { splitId: "root" });

    expect(parsePaneLayout(JSON.stringify(split))).toEqual(split);
    expect(parsePaneLayout(JSON.stringify({
      ...split,
      root: { kind: "pane", paneId: "missing" }
    }))).toBeNull();
    expect(parsePaneLayout("not json")).toBeNull();
  });
});
