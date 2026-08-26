import { describe, expect, it } from "vitest";
import type { CodeEntityRecord, DiagramRecord } from "./domain";
import {
  buildFileTree,
  diagramFileFilter,
  flattenFileTree,
  flattenRepositoryListings,
  normalizeRepositoryPath
} from "./fileTree";

const artifact: DiagramRecord = {
  schemaVersion: 1,
  id: "diagram-one",
  recordOrigin: { projectId: "project-a", diagramSetId: "set-a" },
  diagramSetId: "set-a",
  viewKind: "diagram",
  handle: "one",
  name: "One",
  ascii: "[one]",
  codeEntityIds: ["entity-local", "entity-same-project", "entity-foreign", "entity-missing"],
  origin: "generated",
  derivedFromDiagramIds: [],
  createdAt: "2026-08-25T00:00:00.000Z"
};

function entity(
  id: string,
  projectId: string,
  diagramSetId: string,
  paths: string[]
): CodeEntityRecord {
  return {
    id,
    origin: { projectId, diagramSetId, codeEntitiesSetId: `entities-${diagramSetId}` },
    handle: id,
    label: id,
    category: "operation",
    summary: id,
    sourceRanges: paths.map((path, index) => ({
      id: `range-${id}-${index}`,
      path,
      startLine: 1,
      endLine: 1
    }))
  };
}

describe("file tree", () => {
  it("normalizes repository-relative paths without accepting traversal", () => {
    expect(normalizeRepositoryPath("./src\\worker.ts")).toBe("src/worker.ts");
    expect(normalizeRepositoryPath("src//worker.ts")).toBe("src/worker.ts");
    expect(normalizeRepositoryPath("../worker.ts")).toBeNull();
    expect(normalizeRepositoryPath("/tmp/worker.ts")).toBeNull();
    expect(normalizeRepositoryPath("C:/tmp/worker.ts")).toBeNull();
  });

  it("derives filter candidates from local and same-project global identities", () => {
    const result = diagramFileFilter(artifact, [
      entity("entity-local", "project-a", "set-a", ["src/worker.ts", "src/worker.ts"]),
      entity("entity-same-project", "project-a", "set-b", ["docs/design.md", "src/worker.ts"]),
      entity("entity-foreign", "project-b", "set-c", ["src/worker.ts"])
    ], "project-a");
    expect(result.paths).toEqual(["docs/design.md", "src/worker.ts"]);
    expect(result.entitiesByPath["src/worker.ts"]).toEqual([
      {
        entityId: "entity-local",
        handle: "entity-local",
        label: "entity-local",
        sourceRangeIndex: 0
      },
      {
        entityId: "entity-same-project",
        handle: "entity-same-project",
        label: "entity-same-project",
        sourceRangeIndex: 1
      }
    ]);
    expect(result.entitiesByPath["docs/design.md"]).toEqual([expect.objectContaining({
      entityId: "entity-same-project",
      sourceRangeIndex: 0
    })]);
    expect(result.foreignEntityIds).toEqual(["entity-foreign"]);
    expect(result.unresolvedEntityIds).toEqual(["entity-missing"]);
  });

  it("materializes ancestors, sorts directories first, and flattens expanded rows", () => {
    const tree = buildFileTree(["z.txt", "src/z.ts", "src/a.ts", "docs/readme.md"]);
    expect(tree.map((node) => node.path)).toEqual(["docs", "src", "z.txt"]);
    const rows = flattenFileTree(tree, new Set(["src"]));
    expect(rows.map((row) => row.path)).toEqual(["docs", "src", "src/a.ts", "src/z.ts", "z.txt"]);
    expect(rows.find((row) => row.path === "src/a.ts")).toMatchObject({
      level: 2,
      parentPath: "src",
      prefix: "+-- "
    });
  });

  it("flattens only loaded children from the shared live-directory cache", () => {
    const rows = flattenRepositoryListings(
      [{ path: "src", name: "src", kind: "directory" }, { path: "a.txt", name: "a.txt", kind: "file" }],
      {
        src: {
          directory: "src",
          entries: [{ path: "src/worker.ts", name: "worker.ts", kind: "file" }]
        }
      },
      new Set(["src"])
    );
    expect(rows.map((row) => row.path)).toEqual(["src", "src/worker.ts", "a.txt"]);
  });
});
