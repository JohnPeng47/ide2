import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GeneratedArtifactDraft } from "../../src/core/domain";
import { documentCorpusTools, runGenerationPromptTurns } from "./agentRuntime";

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

describe("document corpus agent tools", () => {
  it("read only through the configured corpus boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-agent-corpus-"));
    const outside = await mkdtemp(path.join(tmpdir(), "new-diagram-agent-outside-"));
    try {
      await writeFile(path.join(root, "transcript.txt"), "first\nsecond", "utf8");
      await writeFile(path.join(outside, "secret.txt"), "secret\n", "utf8");
      const tools = documentCorpusTools({ kind: "filesystem-documents", root });
      expect(tools.map((tool) => tool.name)).toEqual([
        "read_corpus", "list_corpus", "search_corpus"
      ]);
      const read = tools.find((tool) => tool.name === "read_corpus")!;
      const execute = read.execute as (...args: unknown[]) => Promise<unknown>;
      await expect(execute("call", { path: "transcript.txt" }))
        .resolves.toMatchObject({ content: [{ text: "1: first\n2: second" }] });
      await expect(execute("call", { path: "../secret.txt" })).rejects.toThrow(/invalid/);
      await expect(execute("call", { path: path.join(outside, "secret.txt") }))
        .rejects.toThrow(/relative/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
