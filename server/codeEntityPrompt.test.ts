import { describe, expect, it } from "vitest";
import { codeEntityCollectionPrompt } from "./codeEntityPrompt";

describe("codeEntityCollectionPrompt", () => {
  it("requests qualitative, structurally coherent source compaction", () => {
    const prompt = codeEntityCollectionPrompt({
      diagramSetName: "SIM.DYNAMICS",
      initialPrompt: "Show the world step and observation flow"
    });

    expect(prompt).toContain('level "low", "medium", or "high"');
    expect(prompt).toContain("Prefer a few cohesive spans");
    expect(prompt).toContain("function, class, method, and type declarations");
    expect(prompt).toContain("collapsed-comment sections");
    expect(prompt).toContain("server snapshots the exact");
    expect(prompt).not.toContain("line budget");
  });
});
