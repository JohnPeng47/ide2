import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type CodeEntitiesSetRecord, type DiagramRecord, type DiagramSetRecord } from "./domain";
import { promptOptions, resolveGenerationPrompt } from "./prompt";

const diagramSet: DiagramSetRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "set-one",
  projectId: "project-one",
  name: "Queue flow",
  initialPrompt: "Show queue ownership",
  sourceCheckoutRoot: "/repo",
  codeEntitiesSetId: "entities-one",
  diagramIds: ["diagram-one"],
  generationBatchIds: [],
  agentRunIds: [],
  readiness: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
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
  promptReferences: [],
  producedByRunId: "run-one",
  derivedFromDiagramIds: [],
  createdAt: "2026-01-01T00:00:00Z"
};

describe("resolveGenerationPrompt", () => {
  it("resolves typed entity and diagram references through prompt_str", () => {
    const result = resolveGenerationPrompt({
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      userPrompt: "Simplify @diagram/current-flow around @entity/queue",
      selectedCodeEntityIds: []
    });
    expect(result.references.map((reference) => reference.targetId)).toEqual([
      "diagram-one",
      "entity-queue"
    ]);
    expect(result.allowedCodeEntityIds).toEqual(["entity-queue"]);
    expect(result.resolvedPrompt).toContain("CodeEntity @entity/queue");
    expect(result.resolvedPrompt).toContain("Diagram @diagram/current-flow");
  });

  it("rejects unknown references", () => {
    expect(() => resolveGenerationPrompt({
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      userPrompt: "Use @entity/missing",
      selectedCodeEntityIds: []
    })).toThrow(/unknown prompt reference/);
  });

  it("excludes archived diagrams from prompt interaction", () => {
    const archived = { ...diagram, archivedAt: "2026-01-02T00:00:00Z" };
    expect(promptOptions(codeEntities, [archived]).map((option) => option.token))
      .not.toContain("@diagram/current-flow");
    expect(() => resolveGenerationPrompt({
      diagramSet,
      codeEntities,
      diagrams: [archived],
      userPrompt: "Use @diagram/current-flow",
      selectedCodeEntityIds: []
    })).toThrow(/unknown prompt reference/);
  });
});
