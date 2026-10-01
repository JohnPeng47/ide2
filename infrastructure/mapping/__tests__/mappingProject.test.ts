import { canvasSaveFixture } from '../../../tests/support/mappingDiagram';
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { updateGridBox } from "../../../domain/core/diagrams/lineGrid";
import { projectCanvasSnapshot, sceneFromRevision, singleDiagramScene } from "../../../domain/core/diagrams/projectDiagramCanvas";
import { saveDiagramFixture } from '../../../tests/support/mappingDiagram';
import { ProjectCatalogStore } from "../../core/persistence/projectCatalogStore";
import { FakeMappingAgentRuntime } from "../agents/selection/agentRuntime";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function store() { const root = await mkdtemp(path.join(tmpdir(), "mapping-project-")); roots.push(root); return new ProjectCatalogStore(root); }

it("creates a project diagram and reopens immutable canvas revisions, including collapse and placement", async () => {
  const db = await store();
  const created = await db.saveMappingDiagram("project-one", canvasSaveFixture({ name: "First", scene: singleDiagramScene("First diagram") }));
  const first = created.representation;
  const firstRevision = created.catalog.revisions[first.currentRevisionId];
  const scene = updateGridBox(sceneFromRevision(firstRevision), "overview", (box) => ({ ...box, collapsed: true, position: { column: 20, row: 4 } }));
  const saved = await db.saveMappingDiagram("project-one", canvasSaveFixture({ representationId: first.id, expectedRevisionId: first.currentRevisionId, name: "Renamed", scene }));
  expect(saved.representation.id).toBe(first.id);
  expect(saved.representation.revisionIds).toHaveLength(2);
  const reopened = await new ProjectCatalogStore(db.storeRoot).loadRepresentationCatalog("project-one");
  expect(sceneFromRevision(reopened.revisions[saved.representation.currentRevisionId])).toEqual(scene);
  expect(reopened.revisions[firstRevision.id]).toEqual(firstRevision);
  expect(saved.representation.name).toBe("Renamed");
  expect(reopened.revisions[saved.representation.currentRevisionId].ascii).toContain("[Diagram]");
});

it("allows only one concurrent save from the same base revision", async () => {
  const db = await store();
  const { representation } = await db.saveMappingDiagram("project-one", canvasSaveFixture({ name: "First", scene: singleDiagramScene("First") }));
  const input = { name: "Changed", representationId: representation.id, expectedRevisionId: representation.currentRevisionId, scene: singleDiagramScene("Changed") };
  const results = await Promise.allSettled([db.saveMappingDiagram("project-one", canvasSaveFixture(input)), db.saveMappingDiagram("project-one", canvasSaveFixture(input))]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect((await db.loadRepresentationCatalog("project-one")).representations[representation.id].revisionIds).toHaveLength(2);
});

it('rejects legacy ASCII content instead of silently rebuilding a diagram', async () => {
  const db = await store();
  const saved = await saveDiagramFixture(db, { projectId: 'project-one', name: 'Legacy', ascii: 'Worker' });
  const revision = saved.catalog.revisions[saved.representation.currentRevisionId];
  delete revision.content;
  expect(() => sceneFromRevision(revision)).toThrow('Unsupported legacy diagram content');
});

it("rejects foreign projects, invalid scenes, and unknown evidence without changing the catalog", async () => {
  const db = await store();
  await db.saveMappingDiagram("project-one", canvasSaveFixture({ name: "First", scene: singleDiagramScene("First") }));
  const before = await readFile(path.join(db.storeRoot, "canvases/catalog.json"), "utf8");
  await expect(async () => db.saveMappingDiagram("project-one", canvasSaveFixture({ projectId: "project-other", name: "Bad", scene: singleDiagramScene("Bad") }))).rejects.toThrow("another Project");
  const scene = singleDiagramScene("Bad");
  scene.contents = { ...scene.contents, overview: { ...scene.contents.overview, sourceContext: { ...scene.contents.overview.sourceContext, mappings: [{ id: "m", entityId: "unknown", sourceRangeIndex: 0, line: 1, startColumn: 1, endColumn: 3 }] } } };
  await expect(async () => db.saveMappingDiagram("project-one", canvasSaveFixture({ name: "Bad", scene }))).rejects.toThrow("unknown diagram evidence");
  const hidden = singleDiagramScene("Bad");
  hidden.root = {
    id: "root", kind: "container", collapsed: true, collapsedContentId: "overview-summary", position: { column: 0, row: 0 },
    layout: { collisionPolicy: "push-right", gap: 3 }, children: [{ id: "child", kind: "diagram", contentId: "missing", collapsed: false, position: { column: 0, row: 0 } }]
  };
  await expect(async () => db.saveMappingDiagram("project-one", canvasSaveFixture({ name: "Bad", scene: hidden }))).rejects.toThrow("Missing grid content");
  const missingSummary = singleDiagramScene("Bad");
  await expect(async () => db.saveMappingDiagram("project-one", canvasSaveFixture({
    name: "Bad", scene: {
      ...missingSummary,
      contents: { overview: missingSummary.contents.overview }
    }
  }))).rejects.toThrow("Unknown collapsed canvas content");
  expect(await readFile(path.join(db.storeRoot, "canvases/catalog.json"), "utf8")).toBe(before);
});
