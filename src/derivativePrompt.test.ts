import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  type DiagramRecord,
  type GenerationPromptConfigRecord,
  type GenerationPromptReference
} from "./domain";
import {
  buildDerivativePrompt,
  diagramReferencesInPrompt,
  PREVIOUS_PROMPT_HEADER,
  promptCorrection
} from "./derivativePrompt";

const diagram = (
  id: string,
  handle: string,
  generationPromptConfigId: string
): DiagramRecord => ({
  schemaVersion: SCHEMA_VERSION,
  id,
  diagramSetId: "set-one",
  viewKind: "diagram",
  handle,
  name: handle.replaceAll("-", " "),
  ascii: `[${handle}]`,
  codeEntityIds: [],
  origin: "generated",
  generationPromptConfigId,
  derivedFromDiagramIds: [],
  createdAt: "2026-01-01T00:00:00Z"
});

const reference = (target: DiagramRecord): GenerationPromptReference => ({
  kind: "diagram",
  targetId: target.id,
  token: `@diagram/${target.handle}`,
  handle: target.handle,
  promptRepresentation: `Diagram @diagram/${target.handle}`
});

const config = (
  id: string,
  instruction: string,
  source: DiagramRecord | undefined,
  correction?: string
): GenerationPromptConfigRecord => ({
  schemaVersion: SCHEMA_VERSION,
  id,
  diagramSetId: "set-one",
  outputKind: "diagram",
  modelId: "gpt-5.6-sol",
  instruction,
  selectedCodeEntityIds: [],
  references: source ? [reference(source)] : [],
  ...(source && correction !== undefined ? {
    derivation: {
      sourceArtifactKind: "diagram" as const,
      sourceArtifactId: source.id,
      promptCorrection: correction
    }
  } : {}),
  contextPrompt: { templateVersion: 1, rendered: instruction },
  systemPrompt: {
    templateId: "artifact-generation",
    templateVersion: 1,
    profileId: "default",
    profileVersion: 1,
    rendered: "Generate one diagram."
  },
  createdAt: "2026-01-01T00:00:00Z"
});

describe("derivative prompt composition", () => {
  it("renders each lineage correction once in oldest-to-newest order", () => {
    const root = diagram("diagram-root", "root", "prompt-root");
    const middle = diagram("diagram-middle", "middle", "prompt-middle");
    const current = diagram("diagram-current", "current", "prompt-current");
    const promptConfigs = {
      "prompt-root": config("prompt-root", "Show ownership.", undefined),
      "prompt-middle": config(
        "prompt-middle",
        "a previously composed instruction that must not be nested",
        root,
        "Emphasize queue flow."
      ),
      "prompt-current": config(
        "prompt-current",
        "another composed instruction that must not be nested",
        middle,
        "Remove retry details."
      )
    };

    const draft = buildDerivativePrompt({
      sourceArtifactKind: "diagram",
      sourceArtifact: current,
      diagrams: { [root.id]: root, [middle.id]: middle, [current.id]: current },
      components: {},
      promptConfigs
    });

    expect(draft.prompt.match(new RegExp(PREVIOUS_PROMPT_HEADER, "g"))).toHaveLength(3);
    expect(draft.prompt.indexOf("Show ownership.")).toBeLessThan(
      draft.prompt.indexOf("Emphasize queue flow.")
    );
    expect(draft.prompt.indexOf("Emphasize queue flow.")).toBeLessThan(
      draft.prompt.indexOf("Remove retry details.")
    );
    expect(draft.prompt).not.toContain("previously composed instruction");
    expect(draft.prompt).toMatch(/@diagram\/current\n\n$/);
    expect(promptCorrection(`${draft.prompt}Use fewer boxes.`, draft)).toBe("Use fewer boxes.");
  });

  it("discovers current and historical diagram mentions for one toggle per artifact", () => {
    const current = diagram("diagram-current", "renamed", "prompt-current");
    const references = diagramReferencesInPrompt({
      prompt: "@diagram/old-name then @renamed and @diagram/old-name",
      diagrams: { [current.id]: current },
      historicalReferences: [{
        kind: "diagram",
        targetId: current.id,
        token: "@diagram/old-name",
        handle: "old-name"
      }]
    });

    expect(references).toEqual([expect.objectContaining({
      key: `diagram:${current.id}`,
      targetId: current.id,
      available: true,
      tokens: ["@diagram/old-name", "@renamed"]
    })]);
  });
});
