import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  describe,
  expect,
  it,
  vi
} from "vitest";
import { SCHEMA_VERSION, type PlanRecord } from "../../../../domain/core/records/domain";
import { PlansTreePanel } from "../PlansTreePanel";

const plan: PlanRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "plan-routing",
  projectId: "project-one",
  title: "Input routing",
  status: "active",
  markdown: "# Input routing",
  selection: {
    availability: "recorded",
    affectedCodeEntities: [],
    diagramCandidates: [{ diagramId: "diagram-one", decision: "include", reason: "Affected" }],
    selectedDiagramIds: ["diagram-one"]
  },
  changes: [{
    id: "change-routing",
    kind: "diagram-modified",
    mode: "partial",
    diagramSetId: "set-one",
    diagramId: "diagram-one",
    label: "Interactive Studio",
    baseDiagram: {
      schemaVersion: SCHEMA_VERSION,
      id: "diagram-one",
      diagramSetId: "set-one",
      viewKind: "diagram",
      handle: "interactive-studio",
      name: "Interactive Studio",
      ascii: "",
      representationKind: "diagram",
      codeEntityIds: [],
      origin: "materialized",
      derivedFromDiagramIds: [],
      createdAt: "2026-09-01T00:00:00.000Z"
    },
    baseAsciiSha256: "hash",
    patch: { start: 0, deletedText: "", insertedText: "" },
    outputAscii: ""
  }],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
};

describe("PlansTreePanel", () => {
  it("renders plans and all three change categories", () => {
    const markup = renderToStaticMarkup(createElement(PlansTreePanel, {
      plans: [plan],
      staleChangeIds: new Set(["plan-routing:change-routing"]),
      onSelect: vi.fn()
    }));

    expect(markup).toContain("Input routing");
    expect(markup).toContain("Modified diagrams");
    expect(markup).toContain("Added diagrams");
    expect(markup).toContain("Code entity compactions");
    expect(markup).toContain("[stale]");
  });
});
