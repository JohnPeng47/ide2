import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { updateGridBox } from "../../../../domain/core/diagrams/lineGrid";
import { projectCanvasSnapshot, sceneFromRevision, singleDiagramScene } from "../../../../domain/core/diagrams/projectDiagramCanvas";
import { ProjectCatalogStore } from "../../../core/persistence/projectCatalogStore";
import { FakeMappingAgentRuntime } from "../selection/agentRuntime";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function store() { const root = await mkdtemp(path.join(tmpdir(), "mapping-project-")); roots.push(root); return new ProjectCatalogStore(root); }

it("creates a project diagram and reopens immutable canvas revisions, including collapse and placement", async () => {
  const db = await store();
  const created = await db.saveMappingDiagram("project-one", { name: "First", scene: singleDiagramScene("First diagram") });
  const first = created.representation;
  const firstRevision = created.catalog.revisions[first.currentRevisionId];
  const scene = updateGridBox(sceneFromRevision(firstRevision), "overview", (box) => ({ ...box, collapsed: true, position: { column: 20, row: 4 } }));
  const saved = await db.saveMappingDiagram("project-one", { representationId: first.id, expectedRevisionId: first.currentRevisionId, name: "Renamed", scene });
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
  const { representation } = await db.saveMappingDiagram("project-one", { name: "First", scene: singleDiagramScene("First") });
  const input = { name: "Changed", representationId: representation.id, expectedRevisionId: representation.currentRevisionId, scene: singleDiagramScene("Changed") };
  const results = await Promise.allSettled([db.saveMappingDiagram("project-one", input), db.saveMappingDiagram("project-one", input)]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect((await db.loadRepresentationCatalog("project-one")).representations[representation.id].revisionIds).toHaveLength(2);
});

it("converts a legacy ASCII project diagram in place and resolves prompt evidence from its saved snapshot", async () => {
  const db = await store();
  const ascii = "Worker";
  const evidence = { "evidence-worker": { id: "evidence-worker", handle: "worker", label: "Worker", category: "operation" as const,
    summary: "Does work", sourceRanges: [{ id: "range-worker", path: "worker.ts", startLine: 1, endLine: 1, originalLines: ["export function worker() {}"] }] } };
  const promoted = await db.promoteRepresentation({ projectId: "project-one", name: "Worker", handle: "worker", viewKind: "diagram", representationKind: "diagram",
    ascii, asciiSha256: createHash("sha256").update(ascii).digest("hex"), evidence,
    mappings: [{ id: "mapping-worker", evidenceId: "evidence-worker", sourceRangeId: "range-worker", line: 1, startColumn: 1, endColumn: 6 }],
    provenance: { diagramSetId: "set-one", artifactId: "diagram-one" }, makeActive: true });
  const legacy = promoted.catalog.revisions[promoted.representation.currentRevisionId];
  delete legacy.content;
  await db.saveRepresentationCatalog(promoted.catalog);
  const normalized = (await db.loadRepresentationCatalog("project-one")).revisions[legacy.id];
  expect(normalized.content).toEqual({ kind: "ascii", ascii });
  const scene = sceneFromRevision(normalized);
  expect(projectCanvasSnapshot(scene, evidence).mappings[0].sourceRangeId).toBe("range-worker");
  const result = await new FakeMappingAgentRuntime().promptDiagramSelection({ clientSessionId: "project-prompt-test", sourceRoot: db.storeRoot,
    projectEvidence: evidence, diagramAscii: ascii, diagramRevision: 0, mappings: [...scene.contents.overview.mappings],
    selection: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 6 }, instruction: "Explain worker" });
  expect(result.diagramAscii).toContain("[edited: Explain worker]");
  const saved = await db.saveMappingDiagram("project-one", { representationId: promoted.representation.id, expectedRevisionId: legacy.id, name: "Worker", scene });
  expect(saved.representation.id).toBe(promoted.representation.id);
  expect(saved.catalog.revisions[saved.representation.currentRevisionId].evidence).toEqual(evidence);
});

it("rejects foreign projects, invalid scenes, and unknown evidence without changing the catalog", async () => {
  const db = await store();
  await db.saveMappingDiagram("project-one", { name: "First", scene: singleDiagramScene("First") });
  const before = await readFile(path.join(db.storeRoot, "representations/catalog.json"), "utf8");
  await expect(db.saveMappingDiagram("project-one", { projectId: "project-other", name: "Bad", scene: singleDiagramScene("Bad") })).rejects.toThrow("another Project");
  const scene = singleDiagramScene("Bad");
  scene.contents.overview.mappings = [{ id: "m", entityId: "unknown", sourceRangeIndex: 0, line: 1, startColumn: 1, endColumn: 3 }];
  await expect(db.saveMappingDiagram("project-one", { name: "Bad", scene })).rejects.toThrow("unknown project evidence");
  const hidden = singleDiagramScene("Bad");
  hidden.root = { id: "root", kind: "container", collapsed: true, collapsedContentId: "overview-summary", position: { column: 0, row: 0 },
    layout: { collisionPolicy: "push-right", gap: 3 }, children: [{ id: "child", kind: "diagram", contentId: "missing", collapsed: false, position: { column: 0, row: 0 } }] };
  await expect(db.saveMappingDiagram("project-one", { name: "Bad", scene: hidden })).rejects.toThrow("Missing grid content");
  const missingSummary = singleDiagramScene("Bad");
  await expect(db.saveMappingDiagram("project-one", { name: "Bad", scene: { ...missingSummary,
    contents: { overview: missingSummary.contents.overview } } })).rejects.toThrow("Unknown collapsed canvas content");
  expect(await readFile(path.join(db.storeRoot, "representations/catalog.json"), "utf8")).toBe(before);
});
