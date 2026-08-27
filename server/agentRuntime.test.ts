import { describe, expect, it } from "vitest";
import type { GeneratedArtifactDraft } from "../src/domain";
import { runGenerationPromptTurns } from "./agentRuntime";

describe("generation prompt turns", () => {
  it("returns the mapped final artifact after generation and reference follow-up turns", async () => {
    const prompts: string[] = [];
    const submissions: GeneratedArtifactDraft[] = [];
    const prompt = async (text: string) => {
      prompts.push(text);
      submissions.push(prompts.length === 1
        ? { name: "Initial", ascii: "[initial]", codeEntityIds: [] }
        : { name: "Restyled", ascii: "[restyled]", codeEntityIds: [], ...(prompts.length === 3 ? { mappings: [] } : {}) });
    };

    const result = await runGenerationPromptTurns({
      initialPrompt: "Create the diagram",
      referencePrompt: "Use @diagram/reference as its visual style",
      mappingPrompt: () => "Map the final diagram",
      prompt,
      takeSubmission: () => submissions.shift(),
      artifactLabel: "diagram"
    });

    expect(prompts).toEqual([
      "Create the diagram",
      "Use @diagram/reference as its visual style",
      "Map the final diagram"
    ]);
    expect(result).toMatchObject({ name: "Restyled", ascii: "[restyled]", mappings: [] });
  });

  it("runs the mandatory mapping turn when there is no reference follow-up", async () => {
    const submissions: GeneratedArtifactDraft[] = [];
    let promptCount = 0;
    const result = await runGenerationPromptTurns({
      initialPrompt: "Create the diagram",
      mappingPrompt: () => "Map the diagram",
      prompt: async () => {
        promptCount += 1;
        submissions.push({
          name: "Initial",
          ascii: "[initial]",
          codeEntityIds: [],
          ...(promptCount === 2 ? { mappings: [] } : {})
        });
      },
      takeSubmission: () => submissions.shift(),
      artifactLabel: "diagram"
    });

    expect(promptCount).toBe(2);
    expect(result.name).toBe("Initial");
    expect(result.mappings).toEqual([]);
  });
});
