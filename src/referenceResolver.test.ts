import { describe, expect, it } from "vitest";
import type { CodeEntityRecord, DiagramComponentRecord, DiagramRecord } from "./domain";
import { resolveReference, resolveReferences, type ReferenceResolutionContext } from "./referenceResolver";

const entity: CodeEntityRecord = {
  id: "entity-a",
  handle: "worker",
  label: "Worker",
  category: "operation",
  summary: "Runs work.",
  sourceRanges: [
    { path: "src/worker.ts", startLine: 2, endLine: 8 },
    { path: "src/queue.ts", startLine: 10, endLine: 14 }
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
});
