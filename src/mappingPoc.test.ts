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
  it("keeps the prompt-stack overview and detailed graph line-count contract", () => {
    expect(logicalLineCount(MAPPING_POC_GRAPH_A)).toBe(MAPPING_POC_GRAPH_A_LINE_COUNT);
    expect(logicalLineCount(MAPPING_POC_GRAPH_B)).toBe(MAPPING_POC_GRAPH_B_LINE_COUNT);
    expect(MAPPING_POC_GRAPH_A_LINE_COUNT).toBe(183);
    expect(MAPPING_POC_GRAPH_B_LINE_COUNT).toBe(512);
    expect(MAPPING_POC_GRAPH_A).toContain("CurrentLLMPromptStack");
    expect(MAPPING_POC_GRAPH_A).toMatch(/^[\x00-\x7f]+$/);
  });

  it("gives every overview entity concrete source coverage", () => {
    expect(MAPPING_POC_A_NODES).toHaveLength(24);
    expect(MAPPING_POC_B_NODES).toHaveLength(175);
    expect(MAPPING_POC_B_SECTIONS).toHaveLength(15);
    expect(MAPPING_POC_A_NODES.every((node) => node.sourceRanges.length > 0)).toBe(true);
    expect(MAPPING_POC_A_NODES.filter((node) => node.selectableBecause === "mapped").map((node) => node.id)).toEqual([
      "a-prompt-stack",
      "a-system-templates",
      "a-diagram-set",
      "a-collect-entities",
      "a-create-config",
      "a-generate-artifact",
      "a-submission-validation"
    ]);
    expect(projectASelectionToB(["a-system-templates"])).toMatchObject({
      mappedANodeIds: ["a-system-templates"],
      directlyMappedBNodeIds: ["b-system-prompt-template"],
      mappedBRange: { startLine: 7, endLine: 7 },
      alignedBRange: { startLine: 1, endLine: 17 },
      alignedSectionIds: ["inputs"]
    });
  });

  it("maps prompt configuration and generation runtime nodes into B", () => {
    const projection = projectASelectionToB([
      "a-create-config", "a-generate-artifact", "a-submission-validation"
    ]);
    expect(projection).toMatchObject({
      mappedANodeIds: ["a-create-config", "a-generate-artifact", "a-submission-validation"],
      mappedBRange: { startLine: 111, endLine: 202 },
      alignedBRange: { startLine: 110, endLine: 202 },
      bRange: { startLine: 110, endLine: 202 },
      alignedSectionIds: ["prompt-config", "model-generation"]
    });
    expect(projection.directlyMappedBNodeIds).toHaveLength(27);
    expect(projection.selectedBNodeIds).toHaveLength(33);
    expect(projection.directlyMappedBNodeIds).toEqual(expect.arrayContaining([
      "b-create-generation-config", "b-pi-generate", "b-create-agent-session",
      "b-model-session", "b-mapping-turn"
    ]));
    expect(projection.bAscii).toContain("== GENERATION PROMPT CONFIGURATION");
    expect(projection.bAscii).toContain("[R] createGenerationPromptConfig()");
    expect(projection.bAscii).toContain("[R] PiDiagramAgentRuntime.generateArtifact(request)");
    expect(projection.bAscii).toContain("[X] session.prompt()");
    expect(projection.bAscii).not.toContain("== BLIND JUDGMENT ORCHESTRATION");
  });

  it("matches source ranges only when paths and inclusive line intervals overlap", () => {
    expect(sourceRangesOverlap(
      { path: "./server/agentRuntime.ts", startLine: 139, endLine: 175 },
      { path: "server\\agentRuntime.ts", startLine: 160, endLine: 180 }
    )).toBe(true);
    expect(sourceRangesOverlap(
      { path: "server/agentRuntime.ts", startLine: 139, endLine: 175 },
      { path: "server/agentRuntime.ts", startLine: 176, endLine: 200 }
    )).toBe(false);
    expect(sourceRangesOverlap(
      { path: "src/prompt.ts", startLine: 482, endLine: 923 },
      { path: "server/agentRuntime.ts", startLine: 454, endLine: 607 }
    )).toBe(false);
  });

  it("projects persisted and runtime prompt-stack nodes to actual B entities", () => {
    expect([
      "a-system-templates",
      "a-diagram-set",
      "a-create-config",
      "a-generate-artifact"
    ].map((id) => projectASelectionToB([id]).alignedBRange)).toEqual([
      { startLine: 1, endLine: 17 },
      { startLine: 1, endLine: 17 },
      { startLine: 110, endLine: 137 },
      { startLine: 139, endLine: 202 }
    ]);
    expect(projectASelectionToB(["a-create-config"])).toMatchObject({
      mappedBRange: { startLine: 111, endLine: 125 },
      alignedBRange: { startLine: 110, endLine: 137 },
      alignedSectionIds: ["prompt-config"],
      bBounds: { startLine: 110, endLine: 137, startColumn: 1, endColumn: 80 }
    });
    expect(projectASelectionToB(["a-generate-artifact"]).bAscii)
      .toContain("[R] runGenerationPromptTurns()");
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
    const configThroughRuntime = projectASelectionToB(["a-create-config", "a-generate-artifact"]);
    expect(configThroughRuntime.mappedBRange).toEqual({ startLine: 111, endLine: 202 });
    expect(configThroughRuntime.alignedBRange).toEqual({ startLine: 110, endLine: 202 });
    expect(configThroughRuntime.alignedSectionIds).toEqual(["prompt-config", "model-generation"]);
    expect(configThroughRuntime.bAscii).toContain("[R] createGenerationPromptConfig()");
    expect(configThroughRuntime.bAscii).toContain("[R] runGenerationPromptTurns()");
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
    expect(projectASelectionToB(["a-generate-artifact", "a-create-config", "a-generate-artifact"]).selectedANodeIds)
      .toEqual(["a-create-config", "a-generate-artifact"]);
    expect(() => projectASelectionToB(["a-not-real"])).toThrow("Unknown Graph A node");
  });

  it("selects prompt-stack node heads intersected by a normalized grid rectangle", () => {
    expect(selectANodesInRect({
      startLine: 121,
      endLine: 87,
      startColumn: 1,
      endColumn: 80
    }).map((node) => node.id)).toEqual([
      "a-application-generate",
      "a-create-config",
      "a-generation-config",
      "a-begin-batch",
      "a-generate-artifact"
    ]);
    expect(selectANodesInRect({
      startLine: 140,
      endLine: 147,
      startColumn: 1,
      endColumn: 80
    }).map((node) => node.id)).toEqual(["a-turn-two", "a-turn-three"]);
  });
});
