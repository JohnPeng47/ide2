import { describe, expect, it } from "vitest";
import type {
  CodeEntitiesSetRecord,
  CodeEntityRecord,
  DiagramCodeEntityMapRecord,
  DiagramRecord,
  DiagramSetRecord
} from "./domain";
import {
  buildFileTree,
  diagramFileFilter,
  diagramSetFileIndex,
  diagramSetFileLabels,
  flattenFileTree,
  flattenRepositoryListings,
  normalizeRepositoryPath,
  rollUpFileTreeLabels
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

  it("indexes exact mapped ranges across DiagramSets and rolls labels up the file tree", () => {
    const sets = [
      diagramSet("set-c", "Corpus Interaction", "entities-c", ["diagram-c"]),
      diagramSet("set-e", "Evidence Interaction", "entities-e", ["diagram-e"]),
      diagramSet("set-r", "Representation Interaction", "entities-r", ["diagram-r"])
    ];
    const corpusEntity = entity(
      "entity-c",
      "project-a",
      "set-c",
      ["src/App.tsx", "server/corpus.ts"]
    );
    const evidenceEntity = entity("entity-e", "project-a", "set-e", ["src/App.tsx"]);
    const representationEntity = entity(
      "entity-r",
      "project-a",
      "set-r",
      ["src/components/DiagramView.tsx"]
    );
    const diagrams = Object.fromEntries([
      diagram("diagram-c", "set-c", corpusEntity.id),
      diagram("diagram-e", "set-e", evidenceEntity.id),
      diagram("diagram-r", "set-r", representationEntity.id)
    ].map((record) => [record.id, record]));
    const codeEntitySets = Object.fromEntries([
      codeEntitySet("entities-c", "set-c", [corpusEntity]),
      codeEntitySet("entities-e", "set-e", [evidenceEntity]),
      codeEntitySet("entities-r", "set-r", [representationEntity])
    ].map((record) => [record.id, record]));
    const codeEntityMaps = Object.fromEntries([
      codeEntityMap("diagram-c", "set-c", [
        { entity: corpusEntity, range: 0 },
        { entity: corpusEntity, range: 1 }
      ]),
      codeEntityMap("diagram-e", "set-e", [{ entity: evidenceEntity, range: 0 }]),
      codeEntityMap("diagram-r", "set-r", [{ entity: representationEntity, range: 0 }])
    ].map((record) => [record.artifactId, record]));

    const index = diagramSetFileIndex({
      projectId: "project-a",
      diagramSets: sets,
      diagrams,
      codeEntitySets,
      codeEntityMaps
    });

    expect(index.labels.map(({ label }) => label)).toEqual(["C", "E", "R"]);
    expect(index.labelsByPath).toEqual({
      "src/App.tsx": ["C", "E"],
      "server/corpus.ts": ["C"],
      "src/components/DiagramView.tsx": ["R"]
    });
    expect(index.entitiesByPath["server/corpus.ts"][0]).toMatchObject({
      diagramSetId: "set-c",
      sourceRangeIndex: 1
    });
    expect(rollUpFileTreeLabels(index.paths, index.labelsByPath, ["C", "E", "R"])).toEqual({
      server: ["C"],
      "server/corpus.ts": ["C"],
      src: ["C", "E", "R"],
      "src/App.tsx": ["C", "E"],
      "src/components": ["R"],
      "src/components/DiagramView.tsx": ["R"]
    });
  });

  it("uses the shortest unique name prefixes for DiagramSet labels", () => {
    expect(diagramSetFileLabels([
      { id: "set-corpus", name: "Corpus" },
      { id: "set-control", name: "Control" },
      { id: "set-evidence", name: "Evidence" }
    ]).map(({ label }) => label)).toEqual(["COR", "CON", "E"]);
  });
});

function diagramSet(
  id: string,
  name: string,
  codeEntitiesSetId: string,
  diagramIds: string[]
): DiagramSetRecord {
  return {
    schemaVersion: 1,
    id,
    projectId: "project-a",
    name,
    initialPrompt: name,
    sourceCheckoutRoot: "/repo",
    codeEntitiesSetId,
    featuredViewIds: {},
    diagramIds,
    diagramComponentIds: [],
    generationBatchIds: [],
    agentRunIds: [],
    editSessionIds: [],
    readiness: "ready",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

function diagram(id: string, diagramSetId: string, entityId: string): DiagramRecord {
  return {
    schemaVersion: 1,
    id,
    diagramSetId,
    viewKind: "diagram",
    handle: id,
    name: id,
    ascii: `[${id}]`,
    codeEntityIds: [entityId],
    origin: "generated",
    derivedFromDiagramIds: [],
    createdAt: "2026-09-01T00:00:00.000Z"
  };
}

function codeEntitySet(
  id: string,
  diagramSetId: string,
  entities: CodeEntityRecord[]
): CodeEntitiesSetRecord {
  return {
    schemaVersion: 1,
    id,
    diagramSetId,
    revision: 1,
    status: "finalized",
    entities,
    finalizedAt: "2026-09-01T00:00:00.000Z"
  };
}

function codeEntityMap(
  artifactId: string,
  diagramSetId: string,
  values: Array<{ entity: CodeEntityRecord; range: number }>
): DiagramCodeEntityMapRecord {
  return {
    schemaVersion: 1,
    diagramSetId,
    artifactKind: "diagram",
    artifactId,
    asciiSha256: "hash",
    mappings: values.map(({ entity, range }, index) => ({
      id: `mapping-${artifactId}-${index}`,
      entityId: entity.id,
      sourceRangeId: entity.sourceRanges[range].id,
      sourceRangeIndex: range === 0 ? 1 : 0,
      line: index + 1,
      startColumn: 1,
      endColumn: 2
    })),
    producedByRunId: `run-${artifactId}`,
    createdAt: "2026-09-01T00:00:00.000Z"
  };
}
