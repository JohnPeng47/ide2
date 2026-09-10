import { describe, expect, it } from "vitest";
import { createCallGraphFocusRequest } from "./callGraphFocus";
import type { DiagramRecord, ReferenceIdentity } from "./domain";

const sourceDiagram = {
  id: "diagram-11111111-1111-4111-8111-111111111111",
  recordOrigin: { projectId: "project-a", diagramSetId: "set-a" }
} as DiagramRecord;

describe("call-graph focus request", () => {
  it("collapses mapped ranges to deterministic qualified entity identities", () => {
    const origin = {
      projectId: "project-a",
      diagramSetId: "set-a",
      codeEntitiesSetId: "entities-a"
    };
    const references: ReferenceIdentity[] = [
      { kind: "diagram", targetId: "diagram-other" },
      { kind: "code-entity", targetId: "entity-b", origin, sourceRangeId: "range-2" },
      { kind: "code-entity", targetId: "entity-a", origin, sourceRangeIndex: 0 },
      { kind: "code-entity", targetId: "entity-b", origin, sourceRangeId: "range-1" }
    ];

    expect(createCallGraphFocusRequest({
      diagramSetId: "set-current",
      sourceDiagram,
      references
    })).toEqual({
      version: 1,
      diagramSetId: "set-current",
      sourceDiagram: {
        kind: "diagram",
        targetId: sourceDiagram.id,
        origin: sourceDiagram.recordOrigin
      },
      selectedCodeEntities: [
        { kind: "code-entity", targetId: "entity-a", origin },
        { kind: "code-entity", targetId: "entity-b", origin }
      ]
    });
  });

  it("requires mapped entity provenance and a non-empty entity selection", () => {
    expect(() => createCallGraphFocusRequest({
      diagramSetId: "set-current",
      sourceDiagram,
      references: [{ kind: "diagram", targetId: sourceDiagram.id }]
    })).toThrow(/at least one mapped CodeEntity/);
    expect(() => createCallGraphFocusRequest({
      diagramSetId: "set-current",
      sourceDiagram,
      references: [{ kind: "code-entity", targetId: "entity-legacy" }]
    })).toThrow(/missing provenance/);
  });
});
