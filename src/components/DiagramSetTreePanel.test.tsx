import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DiagramRecord, DiagramSetRecord } from "../domain";
import { DiagramSetTreePanel } from "./DiagramSetTreePanel";

const starred = {
  id: "diagram-starred",
  name: "System map",
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

describe("DiagramSetTreePanel", () => {
  it("renders the selected set as an expanded ASCII tree with visible starred diagrams", () => {
    const markup = renderToStaticMarkup(
      <DiagramSetTreePanel
        diagramSets={[diagramSet]}
        diagrams={{ [starred.id]: starred, [archived.id]: archived }}
        activeSetId={diagramSet.id}
        activeDiagramId={starred.id}
        onSelectSet={() => undefined}
        onSelectDiagram={() => undefined}
        onDeleteSet={async () => undefined}
      />
    );

    expect(markup).toContain("Workspace splitting");
    expect(markup).toContain("`-- ");
    expect(markup).toContain("★");
    expect(markup).toContain('aria-label="Starred diagram"');
    expect(markup).toContain("System map");
    expect(markup).not.toContain("Old map");
  });
});
