import { describe, expect, it } from "vitest";
import {
  isDiagramComponentArchived,
  SCHEMA_VERSION,
  type CodeEntitiesSetRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord
} from "./domain";
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
  promptReferences: [],
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
  promptReferences: [],
  origin: "generated",
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
      components: [component],
      outputKind: "diagram",
      userPrompt: "Simplify @diagram/current-flow around @entity/queue and @component/queue-fragment",
      selectedCodeEntityIds: []
    });
    expect(result.references.map((reference) => reference.targetId)).toEqual([
      "diagram-one",
      "entity-queue",
      "component-one"
    ]);
    expect(result.allowedCodeEntityIds).toEqual(["entity-queue"]);
    expect(result.resolvedPrompt).toContain("CodeEntity @entity/queue");
    expect(result.resolvedPrompt).toContain("Diagram @diagram/current-flow");
    expect(result.resolvedPrompt).toContain("DiagramComponent @component/queue-fragment");
  });

  it("rejects unknown references", () => {
    expect(() => resolveGenerationPrompt({
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      components: [component],
      outputKind: "diagram",
      userPrompt: "Use @entity/missing",
      selectedCodeEntityIds: []
    })).toThrow(/unknown prompt reference/);
  });

  it("excludes archived diagrams from prompt interaction", () => {
    const archived = { ...diagram, archivedAt: "2026-01-02T00:00:00Z" };
    expect(promptOptions(codeEntities, [archived], [component]).map((option) => option.token))
      .not.toContain("@diagram/current-flow");
    expect(() => resolveGenerationPrompt({
      diagramSet,
      codeEntities,
      diagrams: [archived],
      components: [component],
      outputKind: "diagram",
      userPrompt: "Use @diagram/current-flow",
      selectedCodeEntityIds: []
    })).toThrow(/unknown prompt reference/);
  });

  it("excludes archived DiagramComponents from prompt interaction", () => {
    const archived = { ...component, archivedAt: "2026-01-02T00:00:00Z" };
    expect(isDiagramComponentArchived(archived)).toBe(true);
    expect(promptOptions(codeEntities, [diagram], [archived]).map((option) => option.token))
      .not.toContain("@component/queue-fragment");
    expect(() => resolveGenerationPrompt({
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      components: [archived],
      outputKind: "diagram-component",
      userPrompt: "Use @component/queue-fragment",
      selectedCodeEntityIds: []
    })).toThrow(/unknown prompt reference/);
  });
});
