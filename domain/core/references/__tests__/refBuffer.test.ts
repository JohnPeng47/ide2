import { describe, expect, it } from "vitest";
import type { ReferenceIdentity } from "../../records/domain";
import {
  EMPTY_REF_BUFFER,
  reduceRefBuffer,
  referenceIdentityKey,
  referencesFromMappings
} from "../refBuffer";

const first: ReferenceIdentity = { kind: "code-entity", targetId: "entity-a", sourceRangeIndex: 0 };
const secondRange: ReferenceIdentity = { kind: "code-entity", targetId: "entity-a", sourceRangeIndex: 1 };

describe("reference buffer", () => {
  it("deduplicates exact identities while preserving distinct ranges and insertion order", () => {
    const state = reduceRefBuffer(EMPTY_REF_BUFFER, {
      type: "add",
      refs: [first, secondRange, first, { kind: "diagram", targetId: "diagram-a" }]
    });
    expect(state.entries).toEqual([
      first,
      secondRange,
      { kind: "diagram", targetId: "diagram-a" }
    ]);
    expect(reduceRefBuffer(state, { type: "add", refs: [first] })).toBe(state);
  });

  it("removes exact entries, clears, replaces, and resets only when scope changes", () => {
    const scoped = reduceRefBuffer(EMPTY_REF_BUFFER, { type: "scope", scopeKey: "project:set-a" });
    const populated = reduceRefBuffer(scoped, { type: "add", refs: [first, secondRange] });
    expect(reduceRefBuffer(populated, { type: "scope", scopeKey: "project:set-a" })).toBe(populated);
    expect(reduceRefBuffer(populated, { type: "remove", ref: first }).entries).toEqual([secondRange]);
    expect(reduceRefBuffer(populated, { type: "replace", refs: [secondRange, secondRange] }).entries)
      .toEqual([secondRange]);
    expect(reduceRefBuffer(populated, { type: "clear" }).entries).toEqual([]);
    expect(reduceRefBuffer(populated, { type: "scope", scopeKey: "project:set-b" }))
      .toEqual({ scopeKey: "project:set-b", entries: [], diagramSelections: [] });
  });

  it("keeps selected ASCII associated with its refs through removal and clear", () => {
    const populated = reduceRefBuffer(EMPTY_REF_BUFFER, {
      type: "add",
      refs: [first, secondRange],
      diagramSelection: { sourceArtifactId: "diagram-a", ascii: "[worker]" }
    });
    expect(populated.diagramSelections).toEqual([{
      sourceArtifactId: "diagram-a",
      ascii: "[worker]",
      referenceKeys: [referenceIdentityKey(first), referenceIdentityKey(secondRange)]
    }]);

    const withOneRef = reduceRefBuffer(populated, { type: "remove", ref: first });
    expect(withOneRef.diagramSelections[0].referenceKeys).toEqual([referenceIdentityKey(secondRange)]);
    expect(reduceRefBuffer(withOneRef, { type: "clear" }).diagramSelections).toEqual([]);
  });

  it("creates range-qualified identities from diagram mappings", () => {
    expect(referencesFromMappings([{
      id: "map-1",
      entityId: "entity-a",
      sourceRangeIndex: 2,
      line: 4,
      startColumn: 8,
      endColumn: 12
    }])).toEqual([{ kind: "code-entity", targetId: "entity-a", sourceRangeIndex: 2 }]);
    expect(referenceIdentityKey(first)).toBe("code-entity:legacy:entity-a:0");
  });

  it("keeps identical legacy target ids distinct by collection origin", () => {
    const left: ReferenceIdentity = {
      kind: "code-entity",
      targetId: "entity-parser",
      origin: { projectId: "project-a", diagramSetId: "set-a", codeEntitiesSetId: "entities-a" }
    };
    const right: ReferenceIdentity = {
      kind: "code-entity",
      targetId: "entity-parser",
      origin: { projectId: "project-b", diagramSetId: "set-b", codeEntitiesSetId: "entities-b" }
    };
    expect(referenceIdentityKey(left)).not.toBe(referenceIdentityKey(right));
    expect(reduceRefBuffer(EMPTY_REF_BUFFER, { type: "add", refs: [left, right] }).entries)
      .toHaveLength(2);
  });
});
