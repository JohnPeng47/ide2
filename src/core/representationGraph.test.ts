import { describe, expect, it } from "vitest";
import {
  appendRepresentationFeedback,
  assertRepresentationGraph,
  normalizeRepresentationGraph,
  orderRepresentationLayers,
  reviseRepresentationRecipe,
  type RepresentationFeedbackRecord,
  type RepresentationGraphRecord,
  type RepresentationRecipe
} from "./representationGraph";

const sha = (character: string) => character.repeat(64);

function graph(): RepresentationGraphRecord {
  return {
    id: "graph-1",
    layers: [
      { id: "detail-b", label: "Details B", informationRank: 1, representationKind: "diagram", artifactRevision: { artifactId: "b", asciiSha256: sha("b") } },
      { id: "overview", label: "Overview", informationRank: 0, representationKind: "tree", artifactRevision: { artifactId: "a", asciiSha256: sha("a") } },
      { id: "detail-a", label: "Details A", informationRank: 1, representationKind: "tree", artifactRevision: { artifactId: "c", asciiSha256: sha("c") }, evidenceReferences: [{ evidenceId: "evidence-2" }, { evidenceId: "evidence-1", sourceRangeId: "range-1" }] }
    ],
    transitions: [
      { id: "to-b", fromLayerId: "overview", toLayerId: "detail-b" },
      { id: "to-a", fromLayerId: "overview", toLayerId: "detail-a" }
    ]
  };
}

describe("representation graph", () => {
  it("orders a branching DAG deterministically from abstract to detailed layers", () => {
    expect(orderRepresentationLayers(graph()).map((layer) => layer.id)).toEqual([
      "overview", "detail-a", "detail-b"
    ]);
    const normalized = normalizeRepresentationGraph(graph());
    expect(normalized.transitions.map((transition) => transition.id)).toEqual(["to-a", "to-b"]);
    expect(normalized.layers[1].evidenceReferences?.map((reference) => reference.evidenceId))
      .toEqual(["evidence-1", "evidence-2"]);
    expect(normalized.feedback).toEqual([]);
    expect(normalized.recipes).toEqual([]);
  });

  it("rejects cycles, duplicate edges, stale-looking revisions, and non-increasing detail", () => {
    const cyclic = graph();
    cyclic.transitions.push({ id: "back", fromLayerId: "detail-a", toLayerId: "overview" });
    expect(() => assertRepresentationGraph(cyclic)).toThrow(/acyclic/);

    const duplicate = graph();
    duplicate.transitions.push({ id: "again", fromLayerId: "overview", toLayerId: "detail-a" });
    expect(() => assertRepresentationGraph(duplicate)).toThrow(/duplicate representation transition/);

    const invalidSha = graph();
    invalidSha.layers[0].artifactRevision.asciiSha256 = "old";
    expect(() => assertRepresentationGraph(invalidSha)).toThrow(/SHA-256/);

    const backwards = graph();
    backwards.layers.find((layer) => layer.id === "detail-a")!.informationRank = 0;
    expect(() => assertRepresentationGraph(backwards)).toThrow(/increase informationRank/);
  });

  it("records feedback immutably and validates its target", () => {
    const feedback: RepresentationFeedbackRecord = {
      id: "feedback-1",
      target: { kind: "layer", layerId: "detail-a" },
      comment: "Split this layer into clearer concepts.",
      createdAt: "2026-08-31T10:00:00Z"
    };
    const original = graph();
    const updated = appendRepresentationFeedback(original, feedback);
    expect(original.feedback).toBeUndefined();
    expect(updated.feedback).toEqual([feedback]);
    expect(() => appendRepresentationFeedback(updated, feedback)).toThrow(/duplicate/);
    expect(() => appendRepresentationFeedback(original, { ...feedback, id: "bad", target: { kind: "transition", transitionId: "missing" } })).toThrow(/unknown/);
  });

  it("creates monotonic recipe revisions driven by same-target feedback", () => {
    const recipe: RepresentationRecipe = {
      id: "recipe-1",
      revision: 2,
      target: { kind: "transition", transitionId: "to-a" },
      instruction: "Expand the overview.",
      incorporatedFeedbackIds: ["feedback-old"],
      createdAt: "2026-08-30T10:00:00Z"
    };
    const feedback: RepresentationFeedbackRecord = {
      id: "feedback-new",
      target: { kind: "transition", transitionId: "to-a" },
      comment: "Preserve the causal ordering.",
      createdAt: "2026-08-31T10:00:00Z"
    };
    expect(reviseRepresentationRecipe(recipe, [feedback], {
      instruction: "Expand while preserving causal ordering.",
      createdAt: "2026-08-31T11:00:00Z"
    })).toEqual({
      ...recipe,
      revision: 3,
      instruction: "Expand while preserving causal ordering.",
      supersedesRevision: 2,
      incorporatedFeedbackIds: ["feedback-new", "feedback-old"],
      createdAt: "2026-08-31T11:00:00Z"
    });
    expect(() => reviseRepresentationRecipe(recipe, [], { instruction: "x", createdAt: "now" })).toThrow(/incorporate feedback/);
    expect(() => reviseRepresentationRecipe(recipe, [{ ...feedback, target: { kind: "layer", layerId: "detail-a" } }], { instruction: "x", createdAt: "now" })).toThrow(/does not match/);
  });

  it("validates recipe references and feedback incorporation against graph targets", () => {
    const value = graph();
    value.feedback = [{ id: "f", target: { kind: "layer", layerId: "detail-a" }, comment: "Improve it", createdAt: "now" }];
    value.recipes = [{ id: "r", revision: 1, target: { kind: "layer", layerId: "detail-a" }, instruction: "Improve it", incorporatedFeedbackIds: ["f"], createdAt: "now" }];
    value.layers.find((layer) => layer.id === "detail-a")!.recipe = { recipeId: "r", revision: 1 };
    expect(() => assertRepresentationGraph(value)).not.toThrow();

    value.recipes[0].target = { kind: "layer", layerId: "detail-b" };
    expect(() => assertRepresentationGraph(value)).toThrow(/another target/);
  });
});
