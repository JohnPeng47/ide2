import { describe, expect, it } from "vitest";
import { MAPPING_POC_GRAPH_A_LINE_COUNT } from "./mappingPoc";
import {
  MAPPING_POC_A_SECTIONS,
  MAPPING_POC_DETAIL_OVERLAYS,
  MAPPING_POC_OVERLAY_PLACEMENTS,
  parseOverlayPlacement
} from "./mappingPocOverlays";

describe("mapping POC A detail overlays", () => {
  it("partitions all of A into five contiguous sections", () => {
    expect(MAPPING_POC_A_SECTIONS).toHaveLength(5);
    expect(MAPPING_POC_A_SECTIONS[0].startLine).toBe(1);
    expect(MAPPING_POC_A_SECTIONS.at(-1)?.endLine).toBe(MAPPING_POC_GRAPH_A_LINE_COUNT);
    for (let index = 1; index < MAPPING_POC_A_SECTIONS.length; index += 1) {
      expect(MAPPING_POC_A_SECTIONS[index].startLine)
        .toBe(MAPPING_POC_A_SECTIONS[index - 1].endLine + 1);
    }
  });

  it("generates one seven-bit ASCII detail diagram per section", () => {
    expect(MAPPING_POC_DETAIL_OVERLAYS.map((overlay) => overlay.sectionId))
      .toEqual(MAPPING_POC_A_SECTIONS.map((section) => section.id));
    for (const overlay of MAPPING_POC_DETAIL_OVERLAYS) {
      expect(overlay.ascii).toMatch(/^[\x00-\x7f]+$/);
      expect(overlay.ascii.split("\n").length).toBeGreaterThan(20);
    }
  });

  it("parses origins that place each overlay anchor exactly over its A anchor", () => {
    expect(MAPPING_POC_OVERLAY_PLACEMENTS).toHaveLength(5);
    for (const placement of MAPPING_POC_OVERLAY_PLACEMENTS) {
      expect(placement.originLine + placement.overlayAnchor.line - 1).toBe(placement.aAnchor.line);
      expect(placement.originColumn + placement.overlayAnchor.startColumn - 1)
        .toBe(placement.aAnchor.startColumn);
    }
  });

  it("rejects an overlay whose anchor is absent", () => {
    expect(() => parseOverlayPlacement({
      ...MAPPING_POC_DETAIL_OVERLAYS[0],
      ascii: "missing anchor"
    })).toThrow("anchor must occur exactly once");
  });
});
