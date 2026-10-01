import { canvasSaveFixture, revisionCanvasFixture } from '../../../../tests/support/mappingDiagram';
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { projectSelection } from "../../../../domain/core/diagrams/diagramProjection";
import { singleDiagramScene } from "../../../../domain/core/diagrams/projectDiagramCanvas";
import { saveDiagramFixture } from '../../../../tests/support/mappingDiagram';
import type { SaveProjectedTreeInput } from "../../persistence/projectCatalogStore";
import { ProjectCatalogStore } from "../../persistence/projectCatalogStore";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "project-projection-")); roots.push(root);
  const db = new ProjectCatalogStore(root);
  const ascii = "Alpha\nBeta\nGamma";
  const evidence = Object.fromEntries(["a", "b", "c"].map((id) => [id, {
    id, handle: id, label: id,
    category: "operation" as const, summary: id, sourceRanges: [{
      id: `range-${id}`, path: "source.ts", startLine: 1,
      endLine: 1, originalLines: ["export function source() {}"]
    }]
  }]));
  const source = await saveDiagramFixture(db, {
    projectId: "project-test", name: "Source",
    representationKind: "diagram", ascii, evidence,
    mappings: ["a", "b", "c"].map((id, i) => ({
      id: `m-${id}`, evidenceId: id, sourceRangeId: `range-${id}`, line: i + 1,
      startColumn: 1, endColumn: ascii.split("\n")[i].length
    })),});
  const input = {
    sourceRepresentationId: source.representation.id, sourceRevisionId: source.representation.currentRevisionId,
    name: "Detailed calls", ascii: "Calls\n|\n+-- shared()\n|   \\-- detail\n\\-- gamma()",
    links: [{ sourceEvidenceIds: ["b", "c"], targetLines: [3] }, { sourceEvidenceIds: ["c"], targetLines: [5] }]
  };
  return { db, source, input };
}

it("atomically persists a call tree and OR links, preserving source and active preferences", async () => {
  const { db, source, input } = await fixture();
  const result = await db.saveProjectedTree("project-test", input);
  const loaded = await new ProjectCatalogStore(db.storeRoot).loadRepresentationCatalog("project-test");
  expect(loaded.activeByKind).toEqual(source.catalog.activeByKind);
  expect(loaded.revisions[input.sourceRevisionId]).toEqual(JSON.parse(JSON.stringify(source.catalog.revisions[input.sourceRevisionId])));
  const p = loaded.projections![result.projection.id];
  const target = loaded.revisions[p.targetRevisionId];
  expect(target.representationKind).toBe("tree");
  expect(target.mappings.length).toBe(3);
  expect(projectSelection(p, target, ["b"]).ascii).toContain("shared()");
  expect(projectSelection(p, target, ["b"]).ascii).not.toContain("gamma()");
  expect(projectSelection(p, target, ["c"]).targetNodeIds).toHaveLength(2);
  const again = await db.saveProjectedTree("project-test", input);
  expect(again.catalog).toEqual(loaded);
});

it("rejects invalid links and stale imports without partially creating the target", async () => {
  const { db, source, input } = await fixture();
  const catalogPath = path.join(db.storeRoot, "canvases/catalog.json");
  const before = await readFile(catalogPath, "utf8");
  for (const links of [[{ sourceEvidenceIds: ["missing"], targetLines: [3] }], [{ sourceEvidenceIds: ["a"], targetLines: [2] }]]) {
    await expect(db.saveProjectedTree("project-test", { ...input, links })).rejects.toThrow();
    expect(await readFile(catalogPath, "utf8")).toBe(before);
  }
  await db.saveMappingDiagram("project-test", canvasSaveFixture({
    representationId: source.representation.id, expectedRevisionId: input.sourceRevisionId,
    name: "Updated", scene: singleDiagramScene("Changed")
  }));
  await expect(db.saveProjectedTree("project-test", input)).rejects.toThrow("Source diagram changed");
});

it("preserves projection history when either representation gains a revision", async () => {
  const { db, input } = await fixture();
  const result = await db.saveProjectedTree("project-test", input);
  const changed = await db.saveMappingDiagram("project-test", canvasSaveFixture({
    representationId: result.representation.id,
    expectedRevisionId: result.representation.currentRevisionId, name: "Edited target", scene: singleDiagramScene("Calls\n\\-- changed()")
  }));
  expect(changed.catalog.projections![result.projection.id]).toEqual(result.projection);
  expect(changed.representation.currentRevisionId).not.toBe(result.projection.targetRevisionId);
  expect(changed.catalog.revisions[result.projection.targetRevisionId].ascii).toEqual(input.ascii);
});

it("persists the regenerated two-hop projection and retains all seven source-backed snapshots", async () => {
  const { db } = await fixture();
  const input: SaveProjectedTreeInput = JSON.parse(await readFile("docs/projections/prompt-reference-call-tree.json", "utf8"));
  const catalog = JSON.parse(await readFile(".diagrams-parent-architecture/representations/catalog.json", "utf8"));
  for (const revision of Object.values(catalog.revisions) as import('../../../../domain/core/representations/projectCatalog').ProjectRepresentationRevisionRecord[]) revision.content = revisionCanvasFixture(revision);
  await db.saveRepresentationCatalog(catalog);
  const { projection } = await db.saveProjectedTree(catalog.projectId, input);
  const loaded = await new ProjectCatalogStore(db.storeRoot).loadRepresentationCatalog(catalog.projectId);
  const saved = loaded.projections![projection.id];
  expect(saved).toEqual(projection);
  expect(saved.compactionProjection!.files).toHaveLength(7);
  const target = loaded.revisions[saved.targetRevisionId];
  const source = loaded.revisions[saved.sourceRevisionId];
  for (const evidence of Object.values(source.evidence)) {
    const result = projectSelection(saved, target, [evidence.id]);
    expect(result.targetNodeIds.length).toBeGreaterThan(0);
    expect(saved.compactionProjection!.links.some(link => result.projectedNodeIds.includes(link.callTreeNodeId))).toBe(true);
  }
  const ids = Object.values(source.evidence).filter((e) => ["createGenerationPromptConfig", "GenerationPromptReference"].includes(e.label.replace(/\(\)$/, ""))).map((e) => e.id);
  expect(ids).toHaveLength(2);
  const result = projectSelection(saved, target, ids);
  expect(result.ascii).toContain("User's reference choices");
  expect(result.ascii).not.toContain("PiDiagramAgentRuntime");
  const linkedFiles = saved.compactionProjection!.links.filter(link => result.projectedNodeIds.includes(link.callTreeNodeId)).map(link => link.file);
  expect([...new Set(linkedFiles)].sort()).toEqual(["src/domain.ts", "src/prompt.ts"]);
  const reimport = await db.saveProjectedTree(catalog.projectId, input);
  expect(reimport.catalog).toEqual(loaded);
});

it("rejects invalid compaction snapshots and row links atomically", async () => {
  const { db, input } = await fixture();
  const ascii = "source.ts\n\\-- detail";
  const withCompaction: SaveProjectedTreeInput = {
    ...input, compactionProjection: {
      files: [{
        sourceFile: "source.ts", sourceSha256: "a".repeat(64), ascii, asciiSha256: createHash("sha256").update(ascii).digest("hex"),
        mappings: [1, 2].map((treeLine) => ({ treeLine, sourceRanges: [{ startLine: 1, endLine: 2 }] }))
      }], links: [{ callTreeLine: 3, file: "source.ts", treeLines: [2] }]
    }
  };
  const before = await db.loadRepresentationCatalog("project-test");
  for (const invalid of [
    { ...withCompaction.compactionProjection!, links: [{ callTreeLine: 999, file: "source.ts", treeLines: [2] }] },
    { ...withCompaction.compactionProjection!, links: [{ callTreeLine: 3, file: "source.ts", treeLines: [999] }] },
    { ...withCompaction.compactionProjection!, files: [{ ...withCompaction.compactionProjection!.files[0], asciiSha256: "b".repeat(64) }] }
  ]) {
    await expect(db.saveProjectedTree("project-test", { ...withCompaction, compactionProjection: invalid })).rejects.toThrow();
    expect(await db.loadRepresentationCatalog("project-test")).toEqual(before);
  }
});

it("regenerates in place with a new revision, keeping old tree and projection history", async () => {
  const { db, input } = await fixture();
  const old = await db.saveProjectedTree("project-test", input);
  const regenerated = {
    ...input, ascii: input.ascii + "\n    \\-- extra detail",
    targetRepresentationId: old.representation.id, expectedTargetRevisionId: old.representation.currentRevisionId
  };
  const next = await db.saveProjectedTree("project-test", regenerated);
  expect(next.representation.id).toBe(old.representation.id);
  expect(next.representation.revisionIds).toHaveLength(2);
  expect(next.catalog.revisions[old.projection.targetRevisionId].ascii).toBe(input.ascii);
  expect(next.catalog.projections![old.projection.id]).toEqual(old.projection);
  expect((await db.saveProjectedTree("project-test", regenerated)).catalog).toEqual(next.catalog);
  await expect(db.saveProjectedTree("project-test", { ...regenerated, ascii: regenerated.ascii + "!" })).rejects.toThrow(/Call tree changed/);
});
