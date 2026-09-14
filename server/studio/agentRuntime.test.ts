import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GeneratedArtifactDraft } from "../../src/core/domain";
import { documentCorpusTools } from "./agentRuntime";
import { runAgentWorkflow } from "../core/agentWorkflow";
import { createGenerationWorkflow } from "./generationWorkflow";

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

    const mappedSources: GeneratedArtifactDraft[] = [];
    const workflow = createGenerationWorkflow({
      initialPrompt: "Create the diagram",
      referencePrompt: "Use @diagram/reference as its visual style",
      mappingPrompt: (artifact) => `Map ${artifact.ascii}`,
      onMappingTurn: (artifact) => { mappedSources.push(artifact); },
      artifactLabel: "diagram"
    });
    const result = await runAgentWorkflow(workflow, async (request) => {
      await prompt(request.prompt);
      return submissions.shift();
    });

    expect(prompts).toEqual([
      "Create the diagram",
      "Use @diagram/reference as its visual style",
      "Map [restyled]"
    ]);
    expect(mappedSources).toEqual([{ name: "Restyled", ascii: "[restyled]", codeEntityIds: [] }]);
    expect(result).toMatchObject({ name: "Restyled", ascii: "[restyled]", mappings: [] });
  });

  it("runs the mandatory mapping turn when there is no reference follow-up", async () => {
    const submissions: GeneratedArtifactDraft[] = [];
    let promptCount = 0;
    const workflow = createGenerationWorkflow({
      initialPrompt: "Create the diagram",
      mappingPrompt: () => "Map the diagram",
      artifactLabel: "diagram"
    });
    const result = await runAgentWorkflow(workflow, async () => {
      promptCount += 1;
      submissions.push({
        name: "Initial",
        ascii: "[initial]",
        codeEntityIds: [],
        ...(promptCount === 2 ? { mappings: [] } : {})
      });
      return submissions.shift();
    });

    expect(promptCount).toBe(2);
    expect(result.name).toBe("Initial");
    expect(result.mappings).toEqual([]);
  });

  it("rejects a final turn without mappings", async () => {
    const workflow = createGenerationWorkflow({
      initialPrompt: "Generate", mappingPrompt: () => "Map", artifactLabel: "diagram"
    });
    await expect(runAgentWorkflow(workflow, async () => ({ name: "Draft", ascii: "draft", codeEntityIds: [] })))
      .rejects.toThrow("no mappings");
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
