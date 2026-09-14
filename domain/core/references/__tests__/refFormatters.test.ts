import { describe, expect, it } from "vitest";
import type { CodeEntityRecord, DiagramRecord } from "../../records/domain";
import { resolveReferences, type ReferenceResolutionContext } from "../referenceResolver";
import { formatDiagramReferenceClipboard, formatReferences, UnsupportedReferenceFormatError } from "../refFormatters";

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
const diagram = { id: "diagram-a", handle: "flow", name: "Flow", derivedFromDiagramIds: [] } as unknown as DiagramRecord;
const context: ReferenceResolutionContext = {
  codeEntities: [entity],
  diagrams: { [diagram.id]: diagram },
  components: {}
};

describe("reference formatters", () => {
  it("deduplicates prompt tokens after discarding range precision", () => {
    const { resolved } = resolveReferences([
      { kind: "code-entity", targetId: entity.id, sourceRangeIndex: 0 },
      { kind: "code-entity", targetId: entity.id, sourceRangeIndex: 1 }
    ], context);
    expect(formatReferences(resolved, "prompt-token")).toBe("@entity/worker");
  });

  it("preserves exact source ranges and expands an unqualified entity", () => {
    const qualified = resolveReferences([
      { kind: "code-entity", targetId: entity.id, sourceRangeIndex: 1 }
    ], context).resolved;
    expect(formatReferences(qualified, "source-location")).toBe("src/queue.ts:10-14");
    const unqualified = resolveReferences([
      { kind: "code-entity", targetId: entity.id }
    ], context).resolved;
    expect(formatReferences(unqualified, "source-location"))
      .toBe("src/worker.ts:2-8 src/queue.ts:10-14");
  });

  it("rejects unsupported source-location targets", () => {
    const resolved = resolveReferences([{ kind: "diagram", targetId: diagram.id }], context).resolved;
    expect(() => formatReferences(resolved, "source-location"))
      .toThrow(UnsupportedReferenceFormatError);
  });

  it("uses existing prompt representations for prompt context", () => {
    const resolved = resolveReferences([{ kind: "code-entity", targetId: entity.id }], context).resolved;
    expect(formatReferences(resolved, "prompt-context")).toContain("CodeEntity @entity/worker");
  });

  it("formats selected ASCII above one associated source location per line", () => {
    const resolved = resolveReferences([
      { kind: "code-entity", targetId: entity.id, sourceRangeIndex: 0 },
      { kind: "code-entity", targetId: entity.id, sourceRangeIndex: 1 }
    ], context).resolved;
    expect(formatDiagramReferenceClipboard([{
      sourceArtifactId: "diagram-a",
      ascii: "+----+\n| AB |\n+----+",
      referenceKeys: ["first", "second"]
    }], resolved)).toBe(
      "+----+\n| AB |\n+----+\nAssociated Code Entities:\nWorker: src/worker.ts:2-8\nWorker: src/queue.ts:10-14"
    );
  });
});
