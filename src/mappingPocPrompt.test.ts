import { describe, expect, it } from "vitest";
import { MAPPING_POC_GRAPH_A } from "./mappingPoc";
import {
  applyMappingPocPromptPatch,
  mappingPocPromptHunk,
  renderMappingPocAgentSystemPrompt,
  renderMappingPocEditPrompt
} from "./mappingPocPrompt";

describe("mapping POC selection prompts", () => {
  const selection = { startLine: 35, endLine: 55, startColumn: 1, endColumn: 54 };

  it("includes three complete context rows on each side", () => {
    const hunk = mappingPocPromptHunk(MAPPING_POC_GRAPH_A, selection, 3);
    expect(hunk.contextStartLine).toBe(32);
    expect(hunk.contextEndLine).toBe(58);
    expect(hunk.expectedOldLines).toHaveLength(21);
    expect(hunk.contextLines[5]).toContain("same-value stochastic spread");
    expect(hunk.contextLines[23]).toContain("revised prompt feeds next iteration");
  });

  it("keeps the full diagram in bootstrap context and out of each edit prompt", () => {
    const hunk = mappingPocPromptHunk(MAPPING_POC_GRAPH_A, selection, 3);
    const system = renderMappingPocAgentSystemPrompt(MAPPING_POC_GRAPH_A, 0, "BOOT123");
    const prompt = renderMappingPocEditPrompt({
      instruction: "Make the scoring branch clearer",
      selectionId: "selection-123",
      diagramRevision: 0,
      selection,
      hunk,
      sourceContext: [{
        mappingId: "a-judge-cross:range-1",
        elementId: "a-judge-cross",
        elementLabel: "judgeCross",
        diagramLine: 36,
        startColumn: 1,
        endColumn: 14,
        path: "experiments/runtime.ts",
        startLine: 134,
        endLine: 135,
        lines: ["async judgeCross() {", "  return this.judge();"]
      }],
      nonce: "TURN123"
    });
    expect(system).toContain(MAPPING_POC_GRAPH_A);
    expect(prompt).not.toContain("[P] finalized source DiagramSetRecord");
    expect(prompt).toContain("Make the scoring branch clearer");
    expect(prompt).toContain(">> 35 |       v");
    expect(prompt).toContain(":: 32 |       |");
    expect(prompt).toContain(":: 58 |       |");
    expect(prompt).toContain("[MAPPED ELEMENT a-judge-cross]");
    expect(prompt).toContain("Corpus range: experiments/runtime.ts:134-135");
    expect(prompt).toContain("134 | async judgeCross() {");
  });

  it("applies an exact row splice and reports the downstream vertical delta", () => {
    const ascii = ["top", "old a", "old b", "bottom"].join("\n");
    const hunk = mappingPocPromptHunk(ascii, {
      startLine: 2,
      endLine: 3,
      startColumn: 1,
      endColumn: 5
    });
    const result = applyMappingPocPromptPatch({
      currentAscii: ascii,
      currentRevision: 4,
      expectedRevision: 4,
      hunk,
      replacementLines: ["new a", "new b", "new c"]
    });
    expect(result.diagramAscii).toBe("top\nnew a\nnew b\nnew c\nbottom");
    expect(result.verticalDelta).toBe(1);
    expect(result.newEndLine).toBe(4);
    expect(result.diagramRevision).toBe(5);
  });

  it("rejects a stale hunk instead of searching for a fuzzy match", () => {
    const hunk = mappingPocPromptHunk("top\nold\nbottom", {
      startLine: 2,
      endLine: 2,
      startColumn: 1,
      endColumn: 3
    });
    expect(() => applyMappingPocPromptPatch({
      currentAscii: "top\nchanged\nbottom",
      currentRevision: 0,
      expectedRevision: 0,
      hunk,
      replacementLines: ["new"]
    })).toThrow("selected rows no longer match");
  });
});
