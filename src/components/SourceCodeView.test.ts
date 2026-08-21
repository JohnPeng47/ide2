import { describe, expect, it } from "vitest";
import { formatCollapsedCallGraph } from "./SourceCodeView";

describe("formatCollapsedCallGraph", () => {
  it("renders a multiline ASCII graph as a source comment block", () => {
    expect(formatCollapsedCallGraph({
      kind: "collapsed-comment",
      startLine: 12,
      endLine: 18,
      comment: [
        "collectEntities(request)",
        "  |",
        "  +--> model()",
        "  \\--[failure]--> throw"
      ].join("\n"),
      nodes: [
        { graphLine: 1, startLine: 12, endLine: 18 },
        { graphLine: 3, startLine: 14, endLine: 15 },
        { graphLine: 4, startLine: 16, endLine: 18 }
      ]
    })).toBe([
      "// [Lines 12-18 | 7 lines compacted]",
      "//",
      "// collectEntities(request)",
      "//   |",
      "//   +--> model()",
      "//   \\--[failure]--> throw"
    ].join("\n"));
  });

  it("normalizes newlines and trims only empty edge lines", () => {
    expect(formatCollapsedCallGraph({
      kind: "collapsed-comment",
      startLine: 2,
      endLine: 3,
      comment: "\r\nroot\r\n  \\--> result\r\n"
    })).toContain("// root\n//   \\--> result");
  });
});
