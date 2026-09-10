import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type DiagramCodeEntityMapRecord, type DiagramElementMapping } from "./domain";
import {
  assertRepresentationRevision,
  buildDiagramRepresentationIndex,
  buildRepresentationIndex,
  buildTreeRepresentationIndex,
  representationElementIdForMapping,
  resolveElementEvidence,
  resolveEvidenceElements,
  treeRepresentationLineage,
  treeRepresentationSubtree
} from "./representationIndex";

const ascii = [
  "transcript",
  "+--> app",
  "|    +--> api",
  "|    |    `--> worker",
  "|    `--> unmapped",
  "`--> database"
].join("\n");

const revision = { artifactId: "artifact-1", asciiSha256: "a".repeat(64) };

function mapping(
  id: string,
  entityId: string,
  line: number,
  startColumn: number,
  endColumn: number,
  sourceRangeIndex: number,
  sourceRangeId?: string
): DiagramElementMapping {
  return {
    id,
    entityId,
    sourceRangeIndex,
    ...(sourceRangeId !== undefined ? { sourceRangeId } : {}),
    line,
    startColumn,
    endColumn
  };
}

function codeEntityMap(
  mappings: DiagramElementMapping[],
  overrides: Partial<Pick<DiagramCodeEntityMapRecord, "artifactId" | "asciiSha256">> = {}
): DiagramCodeEntityMapRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    diagramSetId: "set-1",
    artifactKind: "diagram",
    artifactId: overrides.artifactId ?? revision.artifactId,
    asciiSha256: overrides.asciiSha256 ?? revision.asciiSha256,
    mappings,
    producedByRunId: "run-1",
    createdAt: "2026-08-31T00:00:00.000Z"
  };
}

describe("representation indexes", () => {
  const mappings = [
    mapping("app-map", "entity-app", 2, 6, 8, 0, "range-app"),
    mapping("worker-first", "entity-worker", 4, 16, 21, 0, "range-worker-a"),
    mapping("worker-second", "entity-worker", 4, 16, 21, 1, "range-worker-b"),
    mapping("database-map", "entity-database", 6, 6, 13, 0)
  ];

  it("builds ordered tree structure and retains unmapped branches", () => {
    const index = buildTreeRepresentationIndex({ revision, ascii, codeEntityMap: codeEntityMap(mappings) });
    const ordered = Object.values(index.nodes).sort((left, right) => left.order - right.order);

    expect(index.kind).toBe("tree");
    expect(ordered.map((node) => node.text)).toEqual([
      "transcript", "app", "api", "worker", "unmapped", "database"
    ]);
    expect(index.rootIds).toEqual([ordered[0].id, ordered[1].id, ordered[5].id]);
    expect(ordered[1].childIds).toEqual([ordered[2].id, ordered[4].id]);
    expect(ordered[3].parentId).toBe(ordered[2].id);
    expect(ordered[3].rootId).toBe(ordered[1].id);
    expect(ordered[4].evidence).toEqual([]);
    expect(ordered[3].mappingIds).toEqual(["worker-first", "worker-second"]);
    expect(ordered[3].evidence).toEqual([
      { evidenceId: "entity-worker", sourceRangeId: "range-worker-a", sourceRangeIndex: 0 },
      { evidenceId: "entity-worker", sourceRangeId: "range-worker-b", sourceRangeIndex: 1 }
    ]);
  });

  it("resolves tree lineage and subtree in structural order", () => {
    const index = buildTreeRepresentationIndex({ revision, ascii, codeEntityMap: codeEntityMap(mappings) });
    const ordered = Object.values(index.nodes).sort((left, right) => left.order - right.order);

    const worker = ordered.find((node) => node.text === "worker")!;
    const api = ordered.find((node) => node.text === "api")!;
    expect(treeRepresentationLineage(index, worker.id).map((node) => node.text))
      .toEqual(["app", "api", "worker"]);
    expect(treeRepresentationSubtree(index, api.id).map((node) => node.text))
      .toEqual(["api", "worker"]);
    expect(treeRepresentationLineage(index, "missing")).toEqual([]);
    expect(treeRepresentationSubtree(index, "missing")).toEqual([]);
  });

  it("builds exact diagram bounds with revision-scoped coordinate-independent ids", () => {
    const map = codeEntityMap(mappings);
    const index = buildRepresentationIndex({ kind: "diagram", revision, ascii, codeEntityMap: map });
    if (index.kind !== "diagram") throw new Error("expected diagram index");
    const elements = Object.values(index.elements);

    expect(elements.map(({ line, startColumn, endColumn }) => ({ line, startColumn, endColumn })))
      .toEqual([
        { line: 2, startColumn: 6, endColumn: 8 },
        { line: 4, startColumn: 16, endColumn: 21 },
        { line: 4, startColumn: 16, endColumn: 21 },
        { line: 6, startColumn: 6, endColumn: 13 }
      ]);
    expect(elements[1].id).toContain("worker-first");
    expect(elements[1].mappingId).toBe("worker-first");
    expect(representationElementIdForMapping(index, "worker-first")).toBe(elements[1].id);
    const movedMapping = { ...mappings[1], line: 20, startColumn: 2, endColumn: 7 };
    const moved = buildDiagramRepresentationIndex({
      revision,
      ascii,
      codeEntityMap: codeEntityMap([movedMapping])
    });
    expect(Object.keys(moved.elements)[0]).toBe(elements[1].id);
  });

  it("indexes unmapped trees without inventing evidence", () => {
    const index = buildRepresentationIndex({ kind: "tree", revision, ascii });
    if (index.kind !== "tree") throw new Error("expected tree index");
    expect(Object.values(index.nodes)).toHaveLength(6);
    expect(Object.values(index.nodes).every((node) => node.evidence.length === 0)).toBe(true);
  });

  it("indexes mapped semantic text outside branch lines", () => {
    const headerMapping = mapping("header-map", "entity-header", 1, 1, 10, 0);
    const index = buildTreeRepresentationIndex({
      revision,
      ascii,
      codeEntityMap: codeEntityMap([headerMapping])
    });
    const elementId = representationElementIdForMapping(index, "header-map");
    expect(elementId).toBeDefined();
    expect(index.nodes[elementId!]).toMatchObject({ text: "transcript", mappingIds: ["header-map"] });
    expect(resolveEvidenceElements(index, "entity-header")[0].elementId).toBe(elementId);
  });

  it("resolves evidence to every element and elements back to evidence", () => {
    const index = buildDiagramRepresentationIndex({
      revision,
      ascii,
      codeEntityMap: codeEntityMap(mappings)
    });
    const resolved = resolveEvidenceElements(index, "entity-worker");

    expect(resolved).toHaveLength(2);
    expect(resolved.map((entry) => entry.evidence.sourceRangeIndex)).toEqual([0, 1]);
    expect(resolveElementEvidence(index, resolved[1].elementId)).toEqual([resolved[1]]);
    expect(resolveEvidenceElements(index, "missing")).toEqual([]);
    expect(resolveElementEvidence(index, "missing")).toEqual([]);
  });

  it("rejects stale artifact and ASCII revisions", () => {
    expect(() => buildTreeRepresentationIndex({
      revision,
      ascii,
      codeEntityMap: codeEntityMap([], { artifactId: "artifact-old" })
    })).toThrow(/stale representation artifact/);
    expect(() => buildDiagramRepresentationIndex({
      revision,
      ascii,
      codeEntityMap: codeEntityMap([], { asciiSha256: "b".repeat(64) })
    })).toThrow(/stale representation ASCII/);
    expect(() => assertRepresentationRevision(
      { artifactId: revision.artifactId, asciiSha256: "old" },
      revision
    )).toThrow(/SHA-256/);
  });
});
