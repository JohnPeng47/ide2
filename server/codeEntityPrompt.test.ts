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
    expect(prompt).toContain("compact ASCII call graph");
    expect(prompt).toContain("success/error branches");
    expect(prompt).toContain("only 7-bit ASCII graph characters");
    expect(prompt).toContain("[Lines x-y | n lines compacted]");
    expect(prompt).toContain("do not invent calls or behavior");
    expect(prompt).toContain("For every graph line that names an");
    expect(prompt).toContain("expand each mapped node");
    expect(prompt).toContain("Do not map blank or connector-only lines");
    expect(prompt).toContain("server snapshots the exact");
    expect(prompt).not.toContain("line budget");
  });
});
