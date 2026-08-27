import { describe, expect, it } from "vitest";
import type { GeneratedArtifactDraft } from "../src/domain";
import { runGenerationPromptTurns } from "./agentRuntime";

describe("generation prompt turns", () => {
  it("waits for the initial submission and returns the follow-up submission from the same prompt function", async () => {
    const prompts: string[] = [];
    const submissions: GeneratedArtifactDraft[] = [];
    const prompt = async (text: string) => {
      prompts.push(text);
      submissions.push({
        name: prompts.length === 1 ? "Initial" : "Restyled",
        ascii: prompts.length === 1 ? "[initial]" : "[restyled]",
        codeEntityIds: []
      });
    };

    const result = await runGenerationPromptTurns({
      initialPrompt: "Create the diagram",
      referencePrompt: "Use @diagram/reference as its visual style",
      prompt,
      takeSubmission: () => submissions.shift(),
      artifactLabel: "diagram"
    });

    expect(prompts).toEqual([
      "Create the diagram",
      "Use @diagram/reference as its visual style"
    ]);
    expect(result).toMatchObject({ name: "Restyled", ascii: "[restyled]" });
  });

  it("keeps one-turn generation unchanged when there is no reference prompt", async () => {
    const submissions: GeneratedArtifactDraft[] = [];
    let promptCount = 0;
    const result = await runGenerationPromptTurns({
      initialPrompt: "Create the diagram",
      prompt: async () => {
        promptCount += 1;
        submissions.push({ name: "Initial", ascii: "[initial]", codeEntityIds: [] });
      },
      takeSubmission: () => submissions.shift(),
      artifactLabel: "diagram"
    });

    expect(promptCount).toBe(1);
    expect(result.name).toBe("Initial");
  });
});
