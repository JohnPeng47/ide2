import { describe, expect, it } from "vitest";
import type {
  DiagramRepresentationIndex,
  RepresentationRevision,
  TreeRepresentationIndex
} from "./representationIndex";
import {
  AgentWorkScopeError,
  SpatialProgressError,
  assertAgentWorkScope,
  createSpatialProgressState,
  mergeSpatialProgressStates,
  resolveAgentWorkScope,
  updateSpatialProgressState,
  validateAgentWorkScope,
  validateSpatialProgressState,
  type AgentWorkScope,
  type SpatialProgressState
} from "./agentWork";

const revision: RepresentationRevision = {
  artifactId: "artifact-1",
  asciiSha256: "a".repeat(64)
};

const tree: TreeRepresentationIndex = {
  kind: "tree",
  revision,
  rootIds: ["root"],
  nodes: {
    root: {
      id: "root",
      order: 0,
      line: 1,
      text: "root",
      rootId: "root",
      childIds: ["left", "right"],
      mappingIds: [],
      evidence: []
    },
    left: {
      id: "left",
      order: 1,
      line: 2,
      text: "left",
      rootId: "root",
      parentId: "root",
      childIds: ["leaf"],
      mappingIds: ["left-map"],
      evidence: [{ evidenceId: "evidence-shared", sourceRangeIndex: 0 }]
    },
    leaf: {
      id: "leaf",
      order: 2,
      line: 3,
      text: "leaf",
      rootId: "root",
      parentId: "left",
      childIds: [],
      mappingIds: ["leaf-map"],
      evidence: [{ evidenceId: "evidence-shared", sourceRangeIndex: 1 }]
    },
    right: {
      id: "right",
      order: 3,
      line: 4,
      text: "right",
      rootId: "root",
      parentId: "root",
      childIds: [],
      mappingIds: [],
      evidence: []
    }
  }
};

const diagram: DiagramRepresentationIndex = {
  kind: "diagram",
  revision,
  elements: {
    second: {
      id: "second",
      mappingId: "map-2",
      line: 5,
      startColumn: 9,
      endColumn: 14,
      evidence: [{ evidenceId: "evidence-shared", sourceRangeIndex: 1 }]
    },
    first: {
      id: "first",
      mappingId: "map-1",
      line: 2,
      startColumn: 4,
      endColumn: 7,
      evidence: [{ evidenceId: "evidence-shared", sourceRangeIndex: 0 }]
    }
  }
};

function artifactScope(kind: "tree" | "diagram" = "tree"): AgentWorkScope {
  return { revision, representationKind: kind, target: { kind: "artifact" } };
}

describe("agent work scopes", () => {
  it("resolves a full tree artifact in stable structural order", () => {
    const resolved = resolveAgentWorkScope(artifactScope(), tree);

    expect(resolved.elementIds).toEqual(["root", "left", "leaf", "right"]);
    expect(resolved.locations[2]).toEqual({
      representationKind: "tree",
      elementId: "leaf",
      parentId: "left",
      childIds: [],
      lineageElementIds: ["root", "left", "leaf"]
    });
  });

  it("distinguishes one tree node from its structural subtree", () => {
    const nodeScope: AgentWorkScope = {
      revision,
      representationKind: "tree",
      target: { kind: "tree-node", elementId: "left" }
    };
    const subtreeScope: AgentWorkScope = {
      ...nodeScope,
      target: { kind: "tree-subtree", elementId: "left" }
    };

    expect(resolveAgentWorkScope(nodeScope, tree).elementIds).toEqual(["left"]);
    expect(resolveAgentWorkScope(subtreeScope, tree).elementIds).toEqual(["left", "leaf"]);
  });

  it("resolves diagram element ids to grid bounds instead of persisting coordinates in scope", () => {
    const scope: AgentWorkScope = {
      revision,
      representationKind: "diagram",
      target: { kind: "diagram-element", elementId: "second" }
    };

    expect(scope.target).toEqual({ kind: "diagram-element", elementId: "second" });
    expect(resolveAgentWorkScope(scope, diagram).locations).toEqual([{
      representationKind: "diagram",
      elementId: "second",
      line: 5,
      startColumn: 9,
      endColumn: 14
    }]);
  });

  it("resolves evidence independently for tree structure and diagram grid placement", () => {
    const treeScope: AgentWorkScope = {
      revision,
      representationKind: "tree",
      target: { kind: "evidence", evidenceId: "evidence-shared" }
    };
    const diagramScope: AgentWorkScope = {
      revision,
      representationKind: "diagram",
      target: { kind: "evidence", evidenceId: "evidence-shared" }
    };

    expect(resolveAgentWorkScope(treeScope, tree).elementIds).toEqual(["left", "leaf"]);
    expect(resolveAgentWorkScope(diagramScope, diagram).elementIds).toEqual(["first", "second"]);
    expect(resolveAgentWorkScope(diagramScope, diagram).locations).toMatchObject([
      { elementId: "first", line: 2, startColumn: 4 },
      { elementId: "second", line: 5, startColumn: 9 }
    ]);
  });

  it("rejects stale revisions, representation mismatches, missing elements and evidence", () => {
    const stale = {
      ...artifactScope(),
      revision: { ...revision, asciiSha256: "old" }
    } as AgentWorkScope;
    expect(validateAgentWorkScope(stale, tree)).toMatchObject({
      valid: false,
      code: "stale-revision"
    });

    const wrongRepresentation = artifactScope("diagram");
    expect(validateAgentWorkScope(wrongRepresentation, tree)).toMatchObject({
      valid: false,
      code: "representation-kind-mismatch"
    });
    expect(() => assertAgentWorkScope(wrongRepresentation, tree)).toThrow(AgentWorkScopeError);

    const missingElement: AgentWorkScope = {
      revision,
      representationKind: "tree",
      target: { kind: "tree-node", elementId: "missing" }
    };
    expect(validateAgentWorkScope(missingElement, tree)).toMatchObject({
      valid: false,
      code: "element-not-found"
    });

    const missingEvidence: AgentWorkScope = {
      revision,
      representationKind: "tree",
      target: { kind: "evidence", evidenceId: "missing" }
    };
    expect(validateAgentWorkScope(missingEvidence, tree)).toMatchObject({
      valid: false,
      code: "evidence-not-found"
    });
  });

  it("defends against target-kind mismatches in untyped persisted input", () => {
    const invalid = {
      revision,
      representationKind: "tree",
      target: { kind: "diagram-element", elementId: "left" }
    } as unknown as AgentWorkScope;

    expect(validateAgentWorkScope(invalid, tree)).toMatchObject({
      valid: false,
      code: "target-kind-mismatch"
    });
  });
});

describe("spatial progress", () => {
  it("creates queued progress and normalizes updates to representation order", () => {
    const scope = artifactScope();
    const queued = createSpatialProgressState(scope, tree);
    const running = updateSpatialProgressState(queued, {
      status: "running",
      currentElementIds: ["right", "left"],
      visitedElementIds: ["right"]
    }, tree);
    const advanced = updateSpatialProgressState(running, {
      currentElementIds: ["leaf"],
      completedElementIds: ["right", "left"]
    }, tree);

    expect(queued).toEqual({
      scope,
      status: "queued",
      currentElementIds: [],
      visitedElementIds: [],
      completedElementIds: []
    });
    expect(running.currentElementIds).toEqual(["left", "right"]);
    expect(running.visitedElementIds).toEqual(["left", "right"]);
    expect(advanced.currentElementIds).toEqual(["leaf"]);
    expect(advanced.visitedElementIds).toEqual(["left", "leaf", "right"]);
    expect(advanced.completedElementIds).toEqual(["left", "right"]);
  });

  it("clears the active frontier for terminal states and models failures", () => {
    const running = updateSpatialProgressState(
      createSpatialProgressState(artifactScope(), tree),
      { status: "running", currentElementIds: ["left"] },
      tree
    );
    const failed = updateSpatialProgressState(running, {
      status: "failed",
      error: "agent stopped"
    }, tree);

    expect(failed).toMatchObject({
      status: "failed",
      currentElementIds: [],
      visitedElementIds: ["left"],
      error: "agent stopped"
    });
    expect(() => updateSpatialProgressState(failed, { status: "running" }, tree))
      .toThrow(/cannot move backward/);
  });

  it("rejects progress outside its scope", () => {
    const scope: AgentWorkScope = {
      revision,
      representationKind: "tree",
      target: { kind: "tree-subtree", elementId: "left" }
    };
    const state = createSpatialProgressState(scope, tree);

    expect(() => updateSpatialProgressState(state, {
      status: "running",
      currentElementIds: ["right"]
    }, tree)).toThrow(SpatialProgressError);
  });

  it("validates progress invariants and stale scope revisions", () => {
    const invalid: SpatialProgressState = {
      scope: artifactScope(),
      status: "running",
      currentElementIds: ["left"],
      visitedElementIds: [],
      completedElementIds: []
    };
    expect(validateSpatialProgressState(invalid, tree)).toMatchObject({
      valid: false,
      code: "current-not-visited"
    });

    const stale: SpatialProgressState = {
      ...createSpatialProgressState(artifactScope(), tree),
      scope: {
        ...artifactScope(),
        revision: { ...revision, asciiSha256: "stale" }
      }
    };
    expect(validateSpatialProgressState(stale, tree)).toMatchObject({
      valid: false,
      code: "stale-revision"
    });
  });

  it("merges snapshots commutatively in spatial order", () => {
    const base = createSpatialProgressState(artifactScope(), tree);
    const left = updateSpatialProgressState(base, {
      status: "running",
      currentElementIds: ["right"],
      completedElementIds: ["left"]
    }, tree);
    const right = updateSpatialProgressState(base, {
      status: "running",
      currentElementIds: ["leaf"]
    }, tree);

    const leftRight = mergeSpatialProgressStates([left, right], tree);
    const rightLeft = mergeSpatialProgressStates([right, left], tree);
    expect(leftRight).toEqual(rightLeft);
    expect(leftRight).toMatchObject({
      status: "running",
      currentElementIds: ["leaf", "right"],
      visitedElementIds: ["left", "leaf", "right"],
      completedElementIds: ["left"]
    });
    expect(mergeSpatialProgressStates([leftRight, leftRight], tree)).toEqual(leftRight);
  });

  it("uses deterministic terminal precedence and rejects different scopes", () => {
    const base = createSpatialProgressState(artifactScope(), tree);
    const failed = updateSpatialProgressState(base, { status: "failed", error: "z failure" }, tree);
    const complete = updateSpatialProgressState(base, { status: "complete" }, tree);

    expect(mergeSpatialProgressStates([failed, complete], tree)).toMatchObject({
      status: "complete",
      currentElementIds: []
    });
    const otherScope = createSpatialProgressState({
      revision,
      representationKind: "tree",
      target: { kind: "tree-node", elementId: "left" }
    }, tree);
    expect(() => mergeSpatialProgressStates([base, otherScope], tree))
      .toThrow(/different scopes/);
  });
});
