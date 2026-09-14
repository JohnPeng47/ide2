import { describe, expect, it } from "vitest";
import type { CodeEntityRecord, DiagramComponentRecord, DiagramRecord } from "../../records/domain";
import { resolveReference, resolveReferences, type ReferenceResolutionContext } from "../referenceResolver";

const entity: CodeEntityRecord = {
  id: "entity-a",
  origin: { projectId: "project-a", diagramSetId: "set-a", codeEntitiesSetId: "entities-a" },
  handle: "worker",
  label: "Worker",
  category: "operation",
  summary: "Runs work.",
  sourceRanges: [
    { id: "range-worker", path: "src/worker.ts", startLine: 2, endLine: 8 },
    { id: "range-queue", path: "src/queue.ts", startLine: 10, endLine: 14 }
  ]
};
const diagram = { id: "diagram-a", handle: "flow" } as DiagramRecord;
const component = { id: "component-a", handle: "fragment" } as DiagramComponentRecord;
const context: ReferenceResolutionContext = {
  codeEntities: [entity],
  diagrams: { [diagram.id]: diagram },
  components: { [component.id]: component }
};

describe("reference resolution", () => {
  it("resolves all reference kinds by stable target ID", () => {
    expect(resolveReference({ kind: "diagram", targetId: diagram.id }, context)?.record).toBe(diagram);
    expect(resolveReference({ kind: "diagram-component", targetId: component.id }, context)?.record)
      .toBe(component);
    const resolved = resolveReference({
      kind: "code-entity",
      targetId: entity.id,
      sourceRangeIndex: 1
    }, context);
    expect(resolved?.kind).toBe("code-entity");
    expect(resolved?.kind === "code-entity" ? resolved.sourceRange : undefined)
      .toEqual(entity.sourceRanges[1]);
    expect(resolved?.selectableText?.getSelectionText(resolved.identity)).toBe("src/queue.ts");
  });

  it("reports missing targets and invalid source ranges without silently dropping them", () => {
    const identities = [
      { kind: "code-entity" as const, targetId: entity.id, sourceRangeIndex: 99 },
      { kind: "diagram" as const, targetId: "missing" }
    ];
    expect(resolveReferences(identities, context)).toEqual({ resolved: [], unresolved: identities });
  });

  it("resolves source ranges by stable id and rejects a mismatched collection origin", () => {
    const resolved = resolveReference({
      kind: "code-entity",
      targetId: entity.id,
      origin: entity.origin,
      sourceRangeId: "range-queue"
    }, context);
    expect(resolved?.kind === "code-entity" ? resolved.sourceRange?.path : undefined)
      .toBe("src/queue.ts");
    expect(resolveReference({
      kind: "code-entity",
      targetId: entity.id,
      origin: { projectId: "project-b", diagramSetId: "set-b", codeEntitiesSetId: "entities-b" }
    }, context)).toBeNull();
  });

  it("continues past a colliding legacy id to the record with the requested origin", () => {
    const foreign = {
      ...entity,
      origin: {
        projectId: "project-foreign",
        diagramSetId: "set-foreign",
        codeEntitiesSetId: "entities-foreign"
      }
    };
    const collisionContext = { ...context, codeEntities: [foreign, entity] };
    const resolved = resolveReference({
      kind: "code-entity",
      targetId: entity.id,
      origin: entity.origin
    }, collisionContext);
    expect(resolved?.kind === "code-entity" ? resolved.record : null).toBe(entity);
  });
});
