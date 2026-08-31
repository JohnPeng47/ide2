import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CodeEntityRecord, DiagramElementMapping } from "../domain";
import { buildRepresentationIndex } from "../representationIndex";
import { AsciiSelectionGrid } from "./AsciiSelectionGrid";

const entity = {
  id: "entity-a",
  handle: "entity-a",
  label: "Evidence A",
  category: "operation",
  summary: "Mapped evidence",
  sourceRanges: [{ id: "range-a", path: "notes.txt", startLine: 1, endLine: 2 }]
} as CodeEntityRecord;

const mapping = {
  id: "mapping-a",
  entityId: entity.id,
  sourceRangeIndex: 0,
  line: 2,
  startColumn: 6,
  endColumn: 11
} as DiagramElementMapping;

function renderGrid(input: {
  collapseSubtrees: boolean;
  onToggleHighlight?: (value: DiagramElementMapping) => void;
}) {
  const ascii = "title\n+--> parent\n     `--> child";
  return renderToStaticMarkup(createElement(AsciiSelectionGrid, {
    ascii,
    representationIndex: buildRepresentationIndex({
      kind: "tree",
      revision: { artifactId: "artifact-a", asciiSha256: "unmapped" },
      ascii
    }),
    mode: "read",
    mappings: [mapping],
    entities: [entity],
    previewMappingIds: new Set<string>(),
    bufferedReferenceKeys: new Set<string>(),
    highlightedMappingIds: new Set<string>(),
    highlightBusyMappingIds: new Set<string>(),
    overlayReferences: [],
    onLiveSelection: () => undefined,
    onSelectionComplete: () => undefined,
    collapseSubtrees: input.collapseSubtrees,
    onToggleHighlight: input.onToggleHighlight
  }));
}

describe("AsciiSelectionGrid command contributions", () => {
  it("does not expose transcript highlights when the profile omits that command", () => {
    expect(renderGrid({ collapseSubtrees: true })).not.toContain("mapped-highlight-toggle");
  });

  it("exposes document highlight and tree-collapse commands when contributed", () => {
    const markup = renderGrid({ collapseSubtrees: true, onToggleHighlight: () => undefined });

    expect(markup).toContain("mapped-highlight-toggle");
    expect(markup).toContain("tree-node-collapse");
    expect(markup).toContain("data-representation-element-id=\"tree:");
  });

  it("hides tree collapse controls when that command is unavailable", () => {
    expect(renderGrid({ collapseSubtrees: false })).not.toContain("tree-node-collapse");
  });
});
