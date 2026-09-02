import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectCatalogStore } from "./projectCatalogStore";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectCatalogStore", () => {
  it("shares one active file compaction across Project generation sessions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-project-catalog-"));
    roots.push(root);
    const store = new ProjectCatalogStore(path.join(root, ".diagrams"));
    const input = {
      path: "src/example.ts",
      startLine: 1,
      endLine: 3,
      originalLines: ["export function example() {", "  return 1;", "}"],
      compactedSource: {
        level: "high" as const,
        sections: [{
          kind: "collapsed-comment" as const,
          startLine: 1,
          endLine: 3,
          comment: "Example\n`--> export function example(...) -> 1",
          nodes: [{ graphLine: 2, startLine: 1, endLine: 3 }]
        }]
      },
      provenance: {
        diagramSetId: "set-legacy",
        codeEntitiesSetId: "entities-legacy",
        codeEntityId: "entity-legacy",
        sourceRangeId: "range-legacy"
      }
    };

    const first = await store.upsertFileCompaction("project-one", input);
    const second = await store.upsertFileCompaction("project-one", input);

    expect(second.compaction.id).toBe(first.compaction.id);
    expect(second.catalog.activeByPath[input.path]).toBe(first.compaction.id);
    await expect(store.loadCompactionCatalog("project-one")).resolves.toEqual(second.catalog);
  });

  it("persists settled representation snapshots independently from their source session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-representation-catalog-"));
    roots.push(root);
    const store = new ProjectCatalogStore(path.join(root, ".diagrams"));
    const promoted = await store.promoteRepresentation({
      projectId: "project-one",
      handle: "settled-architecture",
      name: "Settled architecture",
      viewKind: "diagram",
      representationKind: "diagram",
      ascii: "architecture",
      asciiSha256: "a".repeat(64),
      evidence: {
        "evidence-one": {
          id: "evidence-one",
          handle: "example",
          label: "Example",
          category: "operation",
          summary: "Example evidence",
          sourceRanges: [{
            id: "evidence-range-one",
            path: "src/example.ts",
            startLine: 1,
            endLine: 1,
            originalLines: ["example"]
          }]
        }
      },
      mappings: [{
        id: "representation-map-one",
        evidenceId: "evidence-one",
        sourceRangeId: "evidence-range-one",
        line: 1,
        startColumn: 1,
        endColumn: 12
      }],
      provenance: { diagramSetId: "set-source", artifactId: "diagram-source" },
      makeActive: true
    });

    const catalog = await store.loadRepresentationCatalog("project-one");
    expect(catalog.activeByKind.diagram).toBe(promoted.representation.id);
    expect(catalog.revisions[promoted.representation.currentRevisionId]).toMatchObject({
      ascii: "architecture",
      provenance: { diagramSetId: "set-source", artifactId: "diagram-source" }
    });

    const archived = await store.archiveRepresentation("project-one", promoted.representation.id);
    expect(archived.activeByKind.diagram).toBeUndefined();
    expect(archived.representations[promoted.representation.id].status).toBe("archived");
  });
});
