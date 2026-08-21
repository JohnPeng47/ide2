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
  promptOptions,
  renderArtifactSystemPrompt
} from "./prompt";

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
  profileId?: "default" | "structureFirst" | "flowFirst" | "compact";
}) => createGenerationPromptConfig({
  id: "prompt-one",
  diagramSet,
  codeEntities,
  diagrams: [diagram],
  components: [component],
  outputKind: input.outputKind,
  modelId: "gpt-5.6-sol",
  profileId: input.profileId ?? "default",
  instruction: input.instruction,
  selectedCodeEntityIds: input.selectedCodeEntityIds,
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

  it("renders the original default system prompts exactly", () => {
    expect(renderArtifactSystemPrompt({ outputKind: "diagram", profileId: "default" })).toBe(
      "Generate exactly one architecture diagram from the supplied explicit context. Give it a compact, specific name, ideally two to five words; omit redundant words such as the DiagramSet name. Never modify files. Use 7-bit ASCII only and finish through submit_diagram."
    );
    expect(renderArtifactSystemPrompt({
      outputKind: "diagram-component",
      profileId: "default"
    })).toBe(
      "Generate exactly one reusable DiagramComponent from the supplied explicit context. It is a fragment for a broader ASCII Diagram, not a complete diagram. Give it a compact, specific name. Be creative. Never modify files. Use 7-bit ASCII only and finish through submit_diagram_component."
    );
  });

  it("varies only the profile directive in the system prompt", () => {
    const config = buildPrompt({
      outputKind: "diagram",
      instruction: "Show the queue",
      selectedCodeEntityIds: ["entity-queue"],
      profileId: "flowFirst"
    }).config;
    expect(config.systemPrompt).toMatchObject({
      templateId: "artifact-generation",
      templateVersion: 1,
      profileId: "flowFirst",
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
      profileId: "default",
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
      profileId: "default",
      instruction: "Use @component/queue-fragment",
      selectedCodeEntityIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    })).toThrow(/unknown prompt reference/);
  });
});
