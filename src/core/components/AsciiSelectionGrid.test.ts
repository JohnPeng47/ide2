import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CodeEntityRecord, DiagramElementMapping } from "../domain";
import { buildRepresentationIndex } from "../representationIndex";
import { presentationForRepresentation } from "../representationPresentation";
import { AsciiSelectionGrid } from "./AsciiSelectionGrid";

const ascii = "title\n+--> parent\n     `--> child";

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
  spatialStatus?: "current" | "visited" | "complete" | "failed";
}) {
  const representationIndex = buildRepresentationIndex({
    kind: "tree",
    revision: { artifactId: "artifact-a", asciiSha256: "unmapped" },
    ascii
  });
  if (representationIndex.kind !== "tree") throw new Error("expected tree representation");
  const parentId = Object.values(representationIndex.nodes).find((node) => node.text === "parent")!.id;
  return renderToStaticMarkup(createElement(AsciiSelectionGrid, {
    ascii,
    representationIndex,
    presentation: presentationForRepresentation("tree"),
    spatialProgressByElementId: input.spatialStatus
      ? new Map([[parentId, input.spatialStatus]])
      : undefined,
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
    onReveal: () => undefined,
    onToggleHighlight: input.onToggleHighlight
  }));
}

function renderedPreText(markup: string): string {
  const pre = markup.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/)?.[1];
  if (pre === undefined) throw new Error("rendered grid did not contain a pre");
  return pre
    .replace(/<[^>]+>/g, "")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
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

  it("keeps controls out of the ASCII text while mapped text remains clickable", () => {
    const markup = renderGrid({ collapseSubtrees: true, onToggleHighlight: () => undefined });

    expect(renderedPreText(markup)).toBe(ascii);
    expect(markup).toContain("representation-link--text-highlight");
    expect(markup).not.toContain("[(**)]");
  });

  it("hides tree collapse controls when that command is unavailable", () => {
    expect(renderGrid({ collapseSubtrees: false })).not.toContain("tree-node-collapse");
  });

  it("projects agent progress onto its structural tree location", () => {
    const markup = renderGrid({ collapseSubtrees: true, spatialStatus: "current" });
    expect(markup).toContain("has-agent-current");
    expect(markup).toContain("data-agent-progress=\"current\"");
  });
});
