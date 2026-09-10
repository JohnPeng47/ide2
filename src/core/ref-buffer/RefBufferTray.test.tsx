import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CodeEntityRecord, DiagramRecord, ReferenceIdentity } from "../domain";
import { RefBufferProvider } from "./RefBufferContext";
import { RefBufferTray } from "./RefBufferTray";

const sourceDiagram = {
  id: "diagram-11111111-1111-4111-8111-111111111111",
  recordOrigin: { projectId: "project-a", diagramSetId: "set-a" }
} as DiagramRecord;

const resolutionContext = {
  codeEntities: [],
  diagrams: {},
  components: {}
};

function renderTray(input: {
  onOpenCallGraphFocus?: () => Promise<void>;
  previewEntries?: ReferenceIdentity[];
  codeEntities?: CodeEntityRecord[];
  callGraphFocusReferenceKeys?: ReadonlySet<string>;
} = {}) {
  return renderToStaticMarkup(
    <RefBufferProvider>
      <RefBufferTray
        resolutionContext={{
          ...resolutionContext,
          codeEntities: input.codeEntities ?? []
        }}
        projectId="project-a"
        diagramSetId="set-a"
        sourceDiagram={sourceDiagram}
        onOpenCallGraphFocus={input.onOpenCallGraphFocus}
        callGraphFocusReferenceKeys={input.callGraphFocusReferenceKeys ?? new Set()}
        previewEntries={input.previewEntries}
        onInsertTokens={() => undefined}
        showWhenEmpty
      />
    </RefBufferProvider>
  );
}

describe("RefBufferTray call-graph action", () => {
  it("shows a disabled action when the handler exists but no references are committed", () => {
    const markup = renderTray({ onOpenCallGraphFocus: async () => undefined });

    expect(markup).toContain('class="display-call-graph"');
    expect(markup).toMatch(/class="display-call-graph" disabled=""/);
    expect(markup).toContain("display call-graph");
  });

  it("does not show the action without a handler", () => {
    expect(renderTray()).not.toContain("display call-graph");
  });

  it("does not enable the action for live preview references", () => {
    const origin = {
      projectId: "project-a",
      diagramSetId: "set-a",
      codeEntitiesSetId: "entities-a"
    };
    const entity: CodeEntityRecord = {
      id: "entity-a",
      origin,
      handle: "entity-a",
      label: "Entity A",
      category: "operation",
      summary: "A preview-only entity",
      sourceRanges: []
    };
    const markup = renderTray({
      onOpenCallGraphFocus: async () => undefined,
      codeEntities: [entity],
      previewEntries: [{ kind: "code-entity", targetId: entity.id, origin }]
    });

    expect(markup).toMatch(/class="display-call-graph" disabled=""/);
    expect(markup).toContain("1 IN RECT");
  });
});
