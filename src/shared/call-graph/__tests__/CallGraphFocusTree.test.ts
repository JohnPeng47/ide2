import { describe, expect, it } from "vitest";
import type { CallGraphFocusNode } from "../../../../domain/core/source/callGraphFocus";
import { flattenVisibleCallGraph } from "../CallGraphFocusTree";

const roots: CallGraphFocusNode[] = [{
  id: "root",
  label: "root",
  children: [{
    id: "branch",
    label: "branch",
    children: [{ id: "leaf", label: "leaf", children: [] }]
  }, {
    id: "sibling",
    label: "sibling",
    children: []
  }]
}];

describe("focused call-graph tree", () => {
  it("flattens only expanded branches with structural accessibility metadata", () => {
    expect(flattenVisibleCallGraph(roots, new Set(["0"]))).toMatchObject([
      { path: "0", depth: 1, position: 1, siblingCount: 1 },
      { path: "0.0", parentPath: "0", depth: 2, position: 1, siblingCount: 2 },
      { path: "0.1", parentPath: "0", depth: 2, position: 2, siblingCount: 2 }
    ]);
    expect(flattenVisibleCallGraph(roots, new Set(["0", "0.0"])).map(({ node }) => node.id))
      .toEqual(["root", "branch", "leaf", "sibling"]);
  });

  it("hides descendants when their parent is collapsed", () => {
    expect(flattenVisibleCallGraph(roots, new Set()).map(({ node }) => node.id)).toEqual(["root"]);
  });
});
