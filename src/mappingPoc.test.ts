import { describe, expect, it } from "vitest";
import {
  alignBRangeToSections,
  logicalLineCount,
  MAPPING_POC_A_NODES,
  MAPPING_POC_B_NODES,
  MAPPING_POC_B_SECTIONS,
  MAPPING_POC_GRAPH_A,
  MAPPING_POC_GRAPH_A_LINE_COUNT,
  MAPPING_POC_GRAPH_B,
  MAPPING_POC_GRAPH_B_LINE_COUNT,
  MAPPING_POC_PROGRESSIVE_SELECTIONS,
  projectASelectionToB,
  selectANodesInRect,
  sourceRangesOverlap
} from "./mappingPoc";

describe("representation mapping POC graphs", () => {
  it("keeps the approved A/B line-count contract", () => {
    expect(logicalLineCount(MAPPING_POC_GRAPH_A)).toBe(MAPPING_POC_GRAPH_A_LINE_COUNT);
    expect(logicalLineCount(MAPPING_POC_GRAPH_B)).toBe(MAPPING_POC_GRAPH_B_LINE_COUNT);
    expect(MAPPING_POC_GRAPH_A_LINE_COUNT).toBe(70);
    expect(MAPPING_POC_GRAPH_B_LINE_COUNT).toBe(512);
    expect(MAPPING_POC_GRAPH_B_LINE_COUNT).toBeGreaterThan(3 * 111);
  });

  it("classifies A nodes from overlap with B's mapped source ranges", () => {
    expect(MAPPING_POC_A_NODES).toHaveLength(22);
    expect(MAPPING_POC_B_NODES).toHaveLength(175);
    expect(MAPPING_POC_B_SECTIONS).toHaveLength(15);
    expect(MAPPING_POC_A_NODES.filter((node) => node.selectableBecause === "mapped").map((node) => node.id)).toEqual([
      "a-source-input",
      "a-system-prompt",
      "a-initialize",
      "a-manifest",
      "a-prompt-for",
      "a-generate",
      "a-sol-runtime",
      "a-pi-runtime",
      "a-model-session",
      "a-generation-record",
      "a-judge-cross",
      "a-judge-within",
      "a-stored-cross",
      "a-stored-within",
      "a-aggregate",
      "a-analyze",
      "a-stored-analysis",
      "a-experiment-output",
      "a-catalog",
      "a-viewer",
      "a-dataset-store",
      "a-curated-item"
    ]);
    expect(MAPPING_POC_A_NODES.filter((node) => node.selectableBecause === "important-code-entity")).toEqual([]);
    expect(projectASelectionToB(["a-system-prompt"])).toMatchObject({
      mappedANodeIds: ["a-system-prompt"],
      directlyMappedBNodeIds: ["b-system-prompt-template"],
      mappedBRange: { startLine: 7, endLine: 7 },
      alignedBRange: { startLine: 1, endLine: 17 },
      alignedSectionIds: ["inputs"]
    });
  });

  it("maps the generation selection to B call-graph nodes rather than output filenames", () => {
    const projection = projectASelectionToB([
      "a-generate", "a-sol-runtime", "a-pi-runtime", "a-model-session", "a-generation-record"
    ]);
    expect(projection).toMatchObject({
      mappedANodeIds: ["a-generate", "a-sol-runtime", "a-pi-runtime", "a-model-session", "a-generation-record"],
      mappedBRange: { startLine: 74, endLine: 238 },
      alignedBRange: { startLine: 73, endLine: 238 },
      bRange: { startLine: 73, endLine: 238 },
      alignedSectionIds: ["generation-plan", "prompt-config", "model-generation", "artifact-record"]
    });
    expect(projection.directlyMappedBNodeIds).toHaveLength(40);
    expect(projection.selectedBNodeIds).toHaveLength(55);
    expect(projection.directlyMappedBNodeIds).toEqual(expect.arrayContaining([
      "b-runner-generate", "b-sol-generate", "b-pi-generate",
      "b-create-agent-session", "b-model-session", "b-generation-record"
    ]));
    const ascii = projection.bAscii;
    expect(ascii).toContain("== GENERATION PLANNING");
    expect(ascii).toContain("[R] ExperimentRunner.generate(axis, iteration, prompt)");
    expect(ascii).toContain("[R] PiDiagramAgentRuntime.generateArtifact(request)");
    expect(ascii).toContain("[X] session.prompt()");
    expect(ascii).toContain("[P] GenerationRecord");
    expect(ascii).not.toContain("== BLIND JUDGMENT ORCHESTRATION");
  });

  it("matches source ranges only when paths and inclusive line intervals overlap", () => {
    expect(sourceRangesOverlap(
      { path: "./server/experimentCatalog.ts", startLine: 41, endLine: 185 },
      { path: "server\\experimentCatalog.ts", startLine: 151, endLine: 184 }
    )).toBe(true);
    expect(sourceRangesOverlap(
      { path: "server/experimentCatalog.ts", startLine: 41, endLine: 66 },
      { path: "server/experimentCatalog.ts", startLine: 67, endLine: 140 }
    )).toBe(false);
    expect(sourceRangesOverlap(
      { path: "experiments/runner.ts", startLine: 188, endLine: 265 },
      { path: "server/experimentCatalog.ts", startLine: 41, endLine: 185 }
    )).toBe(false);
  });

  it("projects each overlapping A node to actual B code-entity nodes", () => {
    expect([
      "a-catalog",
      "a-viewer",
      "a-dataset-store",
      "a-curated-item"
    ].map((id) => projectASelectionToB([id]).alignedBRange)).toEqual([
      { startLine: 397, endLine: 437 },
      { startLine: 439, endLine: 466 },
      { startLine: 468, endLine: 512 },
      { startLine: 468, endLine: 512 }
    ]);
    expect(projectASelectionToB(["a-catalog"])).toMatchObject({
      mappedBRange: { startLine: 398, endLine: 433 },
      alignedBRange: { startLine: 397, endLine: 437 },
      alignedSectionIds: ["catalog"],
      bBounds: { startLine: 397, endLine: 437, startColumn: 1, endColumn: 98 }
    });
    expect(projectASelectionToB(["a-dataset-store"])).toMatchObject({
      mappedBRange: { startLine: 474, endLine: 507 },
      alignedBRange: { startLine: 468, endLine: 512 },
      alignedSectionIds: ["curation"]
    });
    expect(projectASelectionToB(["a-dataset-store"]).bAscii)
      .toContain("[R] DiagramDatasetStore.addItem()");
  });

  it("section-aligns progressive matches into one geometry-preserving B tree slice", () => {
    for (const example of MAPPING_POC_PROGRESSIVE_SELECTIONS) {
      const projection = projectASelectionToB(example.aNodeIds);
      expect(projection.alignedSectionIds).toEqual(example.expectedSectionIds);
      expect(projection.bRange).toEqual(projection.alignedBRange);
      expect(projection.alignedBRange!.startLine).toBeLessThanOrEqual(projection.mappedBRange!.startLine);
      expect(projection.alignedBRange!.endLine).toBeGreaterThanOrEqual(projection.mappedBRange!.endLine);
      expect(logicalLineCount(projection.bAscii)).toBe(
        projection.alignedBRange!.endLine - projection.alignedBRange!.startLine + 1
      );
    }
    const catalogThroughViewer = projectASelectionToB(["a-catalog", "a-viewer"]);
    expect(catalogThroughViewer.mappedBRange).toEqual({ startLine: 398, endLine: 466 });
    expect(catalogThroughViewer.alignedBRange).toEqual({ startLine: 397, endLine: 466 });
    expect(catalogThroughViewer.alignedSectionIds).toEqual(["catalog", "viewer"]);
    expect(catalogThroughViewer.bAscii).toContain("[R] ExperimentCatalog.list()");
    expect(catalogThroughViewer.bAscii).toContain("[P] ExperimentSummary");
    expect(catalogThroughViewer.bAscii).toContain("[R] ExperimentViewerPage");
  });

  it("snaps raw ranges outward to complete semantic section boundaries", () => {
    expect(alignBRangeToSections({ startLine: 74, endLine: 74 })).toEqual({
      range: { startLine: 73, endLine: 108 },
      sectionIds: ["generation-plan"]
    });
    expect(alignBRangeToSections({ startLine: 100, endLine: 150 })).toEqual({
      range: { startLine: 73, endLine: 202 },
      sectionIds: ["generation-plan", "prompt-config", "model-generation"]
    });
    expect(alignBRangeToSections(null)).toEqual({ range: null, sectionIds: [] });
  });

  it("normalizes selection order and rejects unknown A nodes", () => {
    expect(projectASelectionToB(["a-viewer", "a-catalog", "a-viewer"]).selectedANodeIds)
      .toEqual(["a-catalog", "a-viewer"]);
    expect(() => projectASelectionToB(["a-not-real"])).toThrow("Unknown Graph A node");
  });

  it("selects node heads intersected by a normalized grid rectangle", () => {
    expect(selectANodesInRect({
      startLine: 65,
      endLine: 57,
      startColumn: 1,
      endColumn: 80
    }).map((node) => node.id)).toEqual([
      "a-experiment-output",
      "a-catalog",
      "a-viewer",
      "a-dataset-store"
    ]);
    expect(selectANodesInRect({
      startLine: 36,
      endLine: 36,
      startColumn: 32,
      endColumn: 60
    }).map((node) => node.id)).toEqual(["a-judge-within"]);
  });
});
