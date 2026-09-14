import type { RepresentationIndex } from "../../../domain/core/representations/representationIndex";

export type RepresentationKind = RepresentationIndex["kind"];

export interface RepresentationPresentation {
  evidenceLinks: {
    kind: "text-highlight";
  };
  controls: {
    collapse: "gutter" | "none";
    savedHighlight: "gutter" | "none";
  };
}

const PRESENTATION_BY_KIND: Readonly<Record<RepresentationKind, RepresentationPresentation>> = {
  tree: {
    evidenceLinks: { kind: "text-highlight" },
    controls: { collapse: "gutter", savedHighlight: "gutter" }
  },
  diagram: {
    evidenceLinks: { kind: "text-highlight" },
    controls: { collapse: "none", savedHighlight: "gutter" }
  }
};

/** Presentation belongs to the representation kind; evidence activation does not. */
export function presentationForRepresentation(
  kind: RepresentationKind
): RepresentationPresentation {
  return PRESENTATION_BY_KIND[kind];
}
