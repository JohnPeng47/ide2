import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { definePartialDiff } from "../../../../domain/core/diagrams/partialDiff";
import { DiagramPartialDiffOverlay, PARTIAL_DIFF_DIALOG_HEADING, diagramPixelRect } from "../DiagramPartialDiffOverlay";

const diff = definePartialDiff({
  id: "ownership",
  label: "Open ownership diff",
  region: { startLine: 3, startColumn: 5, endLine: 8, endColumn: 14 },
  expandedAscii: "BEFORE\n  |\nAFTER"
});

describe("DiagramPartialDiffOverlay", () => {
  it("projects one-based character bounds into the grid coordinate system", () => {
    expect(diagramPixelRect(diff, { width: 8, height: 18 })).toEqual({
      x: 32,
      y: 36,
      width: 80,
      height: 108
    });
  });

  it("places the diff link at the region origin", () => {
    const markup = renderToStaticMarkup(createElement(DiagramPartialDiffOverlay, {
      diff,
      cell: { width: 8, height: 18 }
    }));

    expect(markup).toContain("data-partial-diff-region=\"true\"");
    expect(markup).toContain("left:32px;top:36px;width:80px;height:108px");
    expect(markup).toContain("class=\"partial-diff-trigger\"");
    expect(markup).toContain("aria-controls=\"ownership-dialog\"");
  });

  it("uses a feature-neutral dialog heading", () => {
    expect(PARTIAL_DIFF_DIALOG_HEADING).toBe("SEMANTIC PARTIAL DIFF");
  });
});
