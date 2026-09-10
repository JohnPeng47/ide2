import { describe, expect, it } from "vitest";
import { presentationForRepresentation } from "./representationPresentation";

describe("representation presentation", () => {
  it("owns evidence-link appearance independently of evidence activation", () => {
    expect(presentationForRepresentation("tree")).toEqual({
      evidenceLinks: { kind: "text-highlight" },
      controls: { collapse: "gutter", savedHighlight: "gutter" }
    });
    expect(presentationForRepresentation("diagram").controls.collapse).toBe("none");
  });
});
