import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  type DiagramRecord,
  type DiagramSetRecord,
  type PlanRecord
} from "../../core/domain";
import { definePartialDiff } from "../../core/partialDiff";
import { DiagramSetTreePanel } from "./DiagramSetTreePanel";

const starred = {
  id: "diagram-starred",
  name: "System map",
  handle: "interactive-studio-panes-navigation",
  viewKind: "diagram"
} as DiagramRecord;

const archived = {
  id: "diagram-archived",
  name: "Old map",
  viewKind: "diagram",
  archivedAt: "2026-08-26T00:00:00.000Z"
} as DiagramRecord;

const diagramSet = {
  id: "set-a",
  name: "Workspace splitting",
  readiness: "ready",
  diagramIds: [starred.id, archived.id],
  featuredViewIds: { diagram: starred.id }
} as DiagramSetRecord;

const plans = [{
  schemaVersion: SCHEMA_VERSION,
  id: "plan-routing",
  projectId: "project-one",
  title: "Routing",
  status: "active",
  markdown: "# Routing",
  changes: [{
    id: "change-routing",
    kind: "diagram-modified",
    diagramSetId: diagramSet.id,
    diagramId: starred.id,
    label: starred.name,
    baseAsciiSha256: "hash",
    patch: { start: 0, deletedText: "", insertedText: "" },
    semanticDiff: definePartialDiff({
      id: "routing-diff",
      region: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      expandedAscii: "diff"
    })
  }],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
}] as PlanRecord[];

describe("DiagramSetTreePanel", () => {
  it("renders the selected generation session as an expanded candidate tree", () => {
    const markup = renderToStaticMarkup(
      <DiagramSetTreePanel
        diagramSets={[diagramSet]}
        diagrams={{ [starred.id]: starred, [archived.id]: archived }}
        plans={plans}
        activeSetId={diagramSet.id}
        activeDiagramId={starred.id}
        onSelectSet={() => undefined}
        onSelectDiagram={() => undefined}
        onDeleteSet={async () => undefined}
      />
    );

    expect(markup).toContain("Workspace splitting");
    expect(markup).toContain("`-- ");
    expect(markup).not.toContain("★");
    expect(markup).not.toContain("Promoted representation");
    expect(markup).toContain("System map");
    expect(markup).toContain('data-partial-diff-status="true"');
    expect(markup).toContain('aria-label="Has partial diff"');
    expect(markup).toContain("[diff]");
    expect(markup).not.toContain("Old map");
  });
});
