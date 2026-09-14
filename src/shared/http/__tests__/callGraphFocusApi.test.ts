import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { fetchCallGraphFocus } from "../api";
import { CALL_GRAPH_FOCUS_VERSION, type CallGraphFocusRequest, type CallGraphFocusResult } from "../../../../domain/core/source/callGraphFocus";

const request: CallGraphFocusRequest = {
  version: CALL_GRAPH_FOCUS_VERSION,
  diagramSetId: "set-1",
  sourceDiagram: {
    kind: "diagram",
    targetId: "diagram-1",
    origin: { projectId: "project-1", diagramSetId: "set-1" }
  },
  selectedCodeEntities: [{
    kind: "code-entity",
    targetId: "entity-1",
    origin: {
      projectId: "project-1",
      diagramSetId: "set-1",
      codeEntitiesSetId: "entities-1"
    }
  }]
};

const result: CallGraphFocusResult = {
  version: CALL_GRAPH_FOCUS_VERSION,
  diagramSetId: "set-1",
  sourceDiagram: request.sourceDiagram,
  callGraph: {
    kind: "diagram",
    targetId: "call-graph-1",
    origin: { projectId: "project-1", diagramSetId: "set-1" }
  },
  callGraphName: "Calls",
  roots: []
};

afterEach(() => vi.unstubAllGlobals());

describe("call-graph focus API client", () => {
  it("posts the qualified focus request and returns the filtered graph", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCallGraphFocus(request)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith("/api/core/call-graph-focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
  });

  it("surfaces the server error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "featured call graph is unavailable" }),
      { status: 409, headers: { "content-type": "application/json" } }
    )));

    await expect(fetchCallGraphFocus(request)).rejects.toThrow("featured call graph is unavailable");
  });
});
