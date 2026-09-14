import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type PlanRecord } from "../../../../../domain/core/records/domain";
import { definePartialDiff } from "../../../../../domain/core/diagrams/partialDiff";
import { partialDiffForDiagram } from "../artifactPartialDiffs";

const plans: PlanRecord[] = [{
  schemaVersion: SCHEMA_VERSION,
  id: "plan-routing",
  projectId: "project-one",
  title: "Routing",
  status: "active",
  markdown: "# Routing",
  selection: {
    availability: "recorded",
    affectedCodeEntities: [],
    diagramCandidates: [{ diagramId: "diagram-routing", decision: "include", reason: "Affected" }],
    selectedDiagramIds: ["diagram-routing"]
  },
  changes: [{
    id: "change-routing",
    kind: "diagram-modified",
    mode: "partial",
    diagramSetId: "set-one",
    diagramId: "diagram-routing",
    label: "Routing",
    baseDiagram: {
      schemaVersion: SCHEMA_VERSION,
      id: "diagram-routing",
      diagramSetId: "set-one",
      viewKind: "diagram",
      handle: "routing",
      name: "Routing",
      ascii: "",
      representationKind: "diagram",
      codeEntityIds: [],
      origin: "materialized",
      derivedFromDiagramIds: [],
      createdAt: "2026-09-01T00:00:00.000Z"
    },
    baseAsciiSha256: "hash",
    patch: { start: 0, deletedText: "", insertedText: "" },
    outputAscii: "",
    semanticDiff: definePartialDiff({
      id: "interactive-studio-input-routing",
      region: { startLine: 15, startColumn: 2, endLine: 36, endColumn: 67 },
      expandedAscii: "RepresentationInputRegistry\nregisters Ctrl+G -> open view menu\nalternate: all DiagramSets tree"
    })
  }],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
}];

describe("partialDiffForDiagram", () => {
  it("registers the input-routing proposal on the interactive studio diagram", () => {
    const diff = partialDiffForDiagram({ id: "diagram-routing" }, plans);

    expect(diff).toMatchObject({
      id: "interactive-studio-input-routing",
      region: { startLine: 15, startColumn: 2, endLine: 36, endColumn: 67 }
    });
    expect(diff?.expandedAscii).toContain("RepresentationInputRegistry");
    expect(diff?.expandedAscii).toContain("registers Ctrl+G -> open view menu");
    expect(diff?.expandedAscii).toContain("alternate: all DiagramSets tree");
  });

  it("clears the previous artifact-refinement diff", () => {
    expect(partialDiffForDiagram({ id: "diagram-other" }, plans)).toBeUndefined();
  });
});
