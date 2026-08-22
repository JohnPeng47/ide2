import { describe, expect, it } from "vitest";
import {
  isDiagramComponentArchived,
  SCHEMA_VERSION,
  type CodeEntitiesSetRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord
} from "./domain";
import {
  createGenerationPromptConfig,
  createBuiltInCodeEntityPromptTemplates,
  createBuiltInSystemPromptTemplates,
  promptOptions,
  renderArtifactSystemPrompt
} from "./prompt";

describe("prompt template records", () => {
  it("defines CodeEntity criteria through the same versioned prompts interface", () => {
    const [template] = createBuiltInCodeEntityPromptTemplates("2026-01-01T00:00:00Z");
    expect(template).toMatchObject({
      id: "default-code-entities",
      builtIn: true,
      version: 1,
      prompts: {
        "code-entity-identification": expect.stringContaining("A useful CodeEntity"),
        "code-entity-compaction": expect.stringContaining("visible consumers")
      }
    });
  });
});

const diagramSet: DiagramSetRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "set-one",
  projectId: "project-one",
  name: "Queue flow",
  initialPrompt: "Show queue ownership",
  sourceCheckoutRoot: "/repo",
  codeEntitiesSetId: "entities-one",
  diagramIds: ["diagram-one"],
  diagramComponentIds: ["component-one"],
  generationBatchIds: [],
  agentRunIds: [],
  editSessionIds: [],
  readiness: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
};

const component: DiagramComponentRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "component-one",
  diagramSetId: "set-one",
  handle: "queue-fragment",
  name: "Queue fragment",
  ascii: "[queue]",
  codeEntityIds: ["entity-queue"],
  origin: "selection",
  sourceDiagramId: "diagram-one",
  derivedFromDiagramIds: ["diagram-one"],
  derivedFromDiagramComponentIds: [],
  createdAt: "2026-01-01T00:00:00Z"
};

const codeEntities: CodeEntitiesSetRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "entities-one",
  diagramSetId: "set-one",
  revision: 1,
  status: "finalized",
  entities: [
    {
      id: "entity-queue",
      handle: "queue",
      label: "Queue",
      category: "state",
      summary: "Pending work",
      sourceRanges: [{ path: "src/queue.ts", startLine: 1, endLine: 10 }]
    }
  ]
};

const diagram: DiagramRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "diagram-one",
  diagramSetId: "set-one",
  handle: "current-flow",
  name: "Current flow",
  ascii: "queue -> worker",
  codeEntityIds: ["entity-queue"],
  origin: "generated",
  producedByRunId: "run-one",
  derivedFromDiagramIds: [],
  createdAt: "2026-01-01T00:00:00Z"
};

const buildPrompt = (input: {
  outputKind: "diagram" | "diagram-component";
  instruction: string;
  selectedCodeEntityIds: string[];
  profileId?: string;
  referenceSelections?: Parameters<typeof createGenerationPromptConfig>[0]["referenceSelections"];
  derivation?: Parameters<typeof createGenerationPromptConfig>[0]["derivation"];
}) => createGenerationPromptConfig({
  id: "prompt-one",
  diagramSet,
  codeEntities,
  diagrams: [diagram],
  components: [component],
  outputKind: input.outputKind,
  modelId: "gpt-5.6-sol",
  profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")
    .find((profile) => profile.id === (input.profileId ?? "default"))!,
  instruction: input.instruction,
  selectedCodeEntityIds: input.selectedCodeEntityIds,
  referenceSelections: input.referenceSelections,
  derivation: input.derivation,
  createdAt: "2026-01-01T00:00:00Z"
});

describe("createGenerationPromptConfig", () => {
  it("resolves typed entity and diagram references through prompt_str", () => {
    const result = buildPrompt({
      outputKind: "diagram",
      instruction: "Simplify @diagram/current-flow around @entity/queue and @component/queue-fragment",
      selectedCodeEntityIds: []
    });
    expect(result.config.references.map((reference) => reference.targetId)).toEqual([
      "diagram-one",
      "entity-queue",
      "component-one"
    ]);
    expect(result.allowedCodeEntityIds).toEqual(["entity-queue"]);
    expect(result.config.contextPrompt.rendered).toContain("CodeEntity @entity/queue");
    expect(result.config.contextPrompt.rendered).toContain("Diagram @diagram/current-flow");
    expect(result.config.contextPrompt.rendered).toContain("DiagramComponent @component/queue-fragment");
    expect(result.config.references.map((reference) => reference.promptRepresentation))
      .toEqual(expect.arrayContaining([
        expect.stringContaining("Diagram @diagram/current-flow"),
        expect.stringContaining("CodeEntity @entity/queue"),
        expect.stringContaining("DiagramComponent @component/queue-fragment")
      ]));
  });

  it("persists omitted diagram decisions without adding their context or lineage", () => {
    const result = buildPrompt({
      outputKind: "diagram",
      instruction: "Keep the history text for @diagram/current-flow",
      selectedCodeEntityIds: [],
      referenceSelections: [{
        kind: "diagram",
        targetId: diagram.id,
        token: "@diagram/current-flow",
        handle: diagram.handle,
        included: false
      }],
      derivation: {
        sourceArtifactKind: "diagram",
        sourceArtifactId: diagram.id,
        promptCorrection: "Reduce the queue detail."
      }
    });

    expect(result.config.references).toEqual([]);
    expect(result.config.omittedReferences).toEqual([{
      kind: "diagram",
      targetId: diagram.id,
      token: "@diagram/current-flow",
      handle: diagram.handle
    }]);
    expect(result.config.derivation).toBeUndefined();
    expect(result.config.contextPrompt.rendered).toContain("Keep the history text");
    expect(result.config.contextPrompt.rendered).not.toContain("Diagram @diagram/current-flow");
    expect(result.allowedDiagramIds).toEqual([]);
  });

  it("binds historical tokens by artifact id and stores derivative correction metadata", () => {
    const renamed = { ...diagram, handle: "renamed-flow", name: "Renamed flow" };
    const result = createGenerationPromptConfig({
      id: "prompt-history",
      diagramSet,
      codeEntities,
      diagrams: [renamed],
      components: [component],
      outputKind: "diagram",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Compare @diagram/current-flow",
      selectedCodeEntityIds: [],
      referenceSelections: [{
        kind: "diagram",
        targetId: renamed.id,
        token: "@diagram/current-flow",
        handle: "current-flow",
        included: true
      }],
      derivation: {
        sourceArtifactKind: "diagram",
        sourceArtifactId: renamed.id,
        promptCorrection: "  Reduce the queue detail.  "
      },
      createdAt: "2026-01-01T00:00:00Z"
    });

    expect(result.config.references[0]).toMatchObject({
      targetId: renamed.id,
      token: "@diagram/current-flow",
      handle: renamed.handle
    });
    expect(result.config.derivation).toEqual({
      sourceArtifactKind: "diagram",
      sourceArtifactId: renamed.id,
      promptCorrection: "Reduce the queue detail."
    });
  });

  it("renders the original default system prompts exactly", () => {
    const defaultTemplate = createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0];
    expect(renderArtifactSystemPrompt({ outputKind: "diagram", template: defaultTemplate })).toBe(
      "Generate exactly one architecture diagram from the supplied explicit context. Give it a compact, specific name, ideally two to five words; omit redundant words such as the DiagramSet name. Never modify files. Use 7-bit ASCII only and finish through submit_diagram."
    );
    expect(renderArtifactSystemPrompt({
      outputKind: "diagram-component",
      template: defaultTemplate
    })).toBe(
      "Generate exactly one reusable DiagramComponent from the supplied explicit context. It is a fragment for a broader ASCII Diagram, not a complete diagram. Give it a compact, specific name. Be creative. Never modify files. Use 7-bit ASCII only and finish through submit_diagram_component."
    );
  });

  it("varies only the profile directive in the system prompt", () => {
    const config = buildPrompt({
      outputKind: "diagram",
      instruction: "Show the queue",
      selectedCodeEntityIds: ["entity-queue"],
      profileId: "flow-first"
    }).config;
    expect(config.systemPrompt).toMatchObject({
      templateId: "artifact-generation",
      templateVersion: 1,
      profileId: "flow-first",
      profileVersion: 1
    });
    expect(config.systemPrompt.rendered).toContain("Emphasize directional control and data flow.");
    expect(config.contextPrompt.rendered).toContain("Show the queue");
  });

  it("rejects unknown references", () => {
    expect(() => buildPrompt({
      outputKind: "diagram",
      instruction: "Use @entity/missing",
      selectedCodeEntityIds: []
    })).toThrow(/unknown prompt reference/);
  });

  it("excludes archived diagrams from prompt interaction", () => {
    const archived = { ...diagram, archivedAt: "2026-01-02T00:00:00Z" };
    expect(promptOptions(codeEntities, [archived], [component]).map((option) => option.token))
      .not.toContain("@diagram/current-flow");
    expect(() => createGenerationPromptConfig({
      id: "prompt-archived",
      diagramSet,
      codeEntities,
      diagrams: [archived],
      components: [component],
      outputKind: "diagram",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Use @diagram/current-flow",
      selectedCodeEntityIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    })).toThrow(/unknown prompt reference/);
  });

  it("excludes archived DiagramComponents from prompt interaction", () => {
    const archived = { ...component, archivedAt: "2026-01-02T00:00:00Z" };
    expect(isDiagramComponentArchived(archived)).toBe(true);
    expect(promptOptions(codeEntities, [diagram], [archived]).map((option) => option.token))
      .not.toContain("@component/queue-fragment");
    expect(() => createGenerationPromptConfig({
      id: "prompt-archived",
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      components: [archived],
      outputKind: "diagram-component",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Use @component/queue-fragment",
      selectedCodeEntityIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    })).toThrow(/unknown prompt reference/);
  });
});
