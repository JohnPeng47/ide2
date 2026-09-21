import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import { ProjectDiagramConflict } from "../../../../domain/core/representations/errors";
import { saveDiagramFixture, type MappingDiagramFixture } from '../../../../tests/support/mappingDiagram';
import { ProjectCatalogStore } from "../projectCatalogStore";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectCatalogStore", () => {
  it("versions corrected source evidence and mappings even when the ASCII is unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mapping-correction-"));
    roots.push(root);
    const store = new ProjectCatalogStore(root);
    const draft: MappingDiagramFixture = {
      projectId: "project-one", name: "Wrapper", representationKind: "diagram", ascii: "Wrapper",
      evidence: {
        wrapper: {
          id: "wrapper", handle: "wrapper", label: "Wrapper", category: "operation", summary: "UI wrapper",
          sourceRanges: [{ id: "range-one", path: "component.tsx", startLine: 1, endLine: 1, originalLines: ["const projection = compute();"] }]
        }
      },
      mappings: [{ id: "map-one", evidenceId: "wrapper", sourceRangeId: "range-one", line: 1, startColumn: 1, endColumn: 7 }],};
    const first = await saveDiagramFixture(store, draft);
    const firstId = first.representation.currentRevisionId;
    const corrected = { ...structuredClone(draft), representationId: first.representation.id };
    corrected.expectedRevisionId = firstId;
    corrected.evidence!.wrapper.sourceRanges[0] = { id: "range-one", path: "component.tsx", startLine: 20, endLine: 20, originalLines: ['<aside className="companion" />'] };
    const second = await saveDiagramFixture(store, corrected);
    const secondId = second.representation.currentRevisionId;
    expect(secondId).not.toBe(firstId);
    expect(second.catalog.revisions[firstId].evidence.wrapper.sourceRanges[0].startLine).toBe(1);
    expect(second.catalog.revisions[secondId].evidence.wrapper.sourceRanges[0].originalLines).toEqual(['<aside className="companion" />']);
    await expect(saveDiagramFixture(store, corrected)).rejects.toBeInstanceOf(ProjectDiagramConflict);
    corrected.expectedRevisionId = secondId;
    corrected.mappings![0].endColumn = 6;
    const third = await saveDiagramFixture(store, corrected);
    expect(third.representation.revisionIds).toHaveLength(3);
    expect(third.catalog.revisions[third.representation.currentRevisionId].mappings[0].endColumn).toBe(6);
  });
  it("shares one active file compaction across Mapping diagrams", async () => {
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
    expect(second.catalog.activeByPath[JSON.stringify([null, input.path])]).toBe(first.compaction.id);
    await expect(store.loadCompactionCatalog("project-one")).resolves.toEqual(second.catalog);
  });

  it("persists settled representation snapshots with their source evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-representation-catalog-"));
    roots.push(root);
    const store = new ProjectCatalogStore(path.join(root, ".diagrams"));
    const promoted = await saveDiagramFixture(store, {
      projectId: "project-one",
      name: "Settled architecture",
      representationKind: "diagram",
      ascii: "architecture",
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
      }],});

    const catalog = await store.loadRepresentationCatalog("project-one");
    expect(catalog.activeByKind).toEqual({});
    expect(catalog.revisions[promoted.representation.currentRevisionId]).toMatchObject({
      ascii: "architecture",});

    const archived = await store.archiveRepresentation("project-one", promoted.representation.id);
    expect(archived.activeByKind.diagram).toBeUndefined();
    expect(archived.representations[promoted.representation.id].status).toBe("archived");
  });
});

it("serializes revision checks with writes when two updates share the same base", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "catalog-concurrent-revisions-"));
  roots.push(root);
  const store = new ProjectCatalogStore(root);
  const draft: MappingDiagramFixture = {
    projectId: "project-one", name: "Root", representationKind: "diagram", ascii: "Root",
    evidence: {}, mappings: [],};
  const initial = await saveDiagramFixture(store, draft);
  const base = initial.representation.currentRevisionId;
  const results = await Promise.allSettled([
    saveDiagramFixture(store, { ...draft, representationId: initial.representation.id, expectedRevisionId: base, ascii: "First",}),
    saveDiagramFixture(store, { ...draft, representationId: initial.representation.id, expectedRevisionId: base, ascii: "Second",})
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ProjectDiagramConflict);
  const catalog = await store.loadRepresentationCatalog(draft.projectId);
  expect(catalog.representations[initial.representation.id].revisionIds).toHaveLength(2);
  expect(catalog.revisions[base]).toEqual(initial.catalog.revisions[base]);
});
