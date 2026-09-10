import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { sceneFromRevision } from "../../src/core/projectDiagramCanvas";

// Explicit correction of this imported example, preserving its canvas URL and old revisions.
const directory = "docs/mapping-screen";
const base = process.argv[2];
assert(base, "Usage: tsx docs/mapping-screen/refresh.ts <server-url>");
const bundle = JSON.parse(await readFile(`${directory}/prepared.json`, "utf8"));
const receipt = JSON.parse(await readFile(`${directory}/receipt.json`, "utf8"));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const bundleSha256 = hash(JSON.stringify(bundle));
const journalPath = `${directory}/refresh-receipt.json`;
let journal: Record<string, string>;
try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  journal = { bundleSha256, sourceRevisionId: receipt.sourceRevisionId, previousDiagramSetId: receipt.diagramSetId };
}
assert.equal(journal.bundleSha256, bundleSha256, "Prepared files changed during correction; inspect the existing journal");
async function record(values: Record<string, string>) {
  Object.assign(journal, values);
  await writeFile(journalPath, JSON.stringify(journal, null, 2) + "\n");
}
async function request(route: string, body?: unknown) {
  const response = await fetch(new URL(route, base), body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const text = await response.text();
  assert(response.ok, `${route}: ${response.status} ${text.slice(0, 1000)}`);
  if (response.headers.get("content-type")?.includes("ndjson")) {
    const result = text.trim().split("\n").map((line) => JSON.parse(line)).find((event) => event.type === "result");
    assert(result, "Missing import result; inspect the workspace before retrying");
    return result;
  }
  return JSON.parse(text);
}
for (const file of bundle.projection.compactionProjection.files) {
  assert.equal(hash(await readFile(file.sourceFile, "utf8")), file.sourceSha256, `Changed source: ${file.sourceFile}`);
}
let snapshot = await request("/api/core/project/representations");
assert.equal(snapshot.project.id, receipt.projectId);
assert.equal(snapshot.project.canonicalRepoRoot, process.cwd());
const original = snapshot.catalog.revisions[journal.sourceRevisionId];
assert(original && original.representationId === receipt.representationId);
assert.equal(original.ascii.trimEnd(), bundle.materialized.diagrams[0].ascii.trimEnd(), "The saved canvas contains other edits");
const source = snapshot.catalog.representations[receipt.representationId];
const target = snapshot.catalog.representations[receipt.targetRepresentationId];
await record({ targetRevisionId: journal.targetRevisionId ?? target.currentRevisionId });
if (!journal.diagramSetId) {
  assert.equal(source.currentRevisionId, original.id, "Source changed before correction");
  const result = await request("/api/studio/diagram-sets", { ...bundle.materialized, path: process.cwd(),
    name: "Mapping screen architecture - corrected sources" });
  await record({ diagramSetId: result.diagramSetId, diagramId: result.diagramIdsByKey["mapping-screen"] });
}
let revision = snapshot.catalog.revisions[source.currentRevisionId];
if (revision.provenance?.diagramSetId !== journal.diagramSetId) {
  await request("/api/studio/project/representations/promote", { diagramSetId: journal.diagramSetId,
    diagramId: journal.diagramId, representationId: source.id, expectedRevisionId: original.id, makeActive: false });
  snapshot = await request("/api/core/project/representations");
  revision = snapshot.catalog.revisions[snapshot.catalog.representations[source.id].currentRevisionId];
}
assert.equal(revision.provenance?.diagramSetId, journal.diagramSetId, "Corrected evidence was not promoted");
const companion = Object.values(revision.evidence).find((entity: any) => entity.label === "ProjectionCompanion") as any;
assert(companion?.sourceRanges[0].originalLines.join("\n").includes('className="mapping-poc-companion"'), "Mapping must identify the rendered wrapper");
if (revision.content?.kind !== "mapping-canvas") {
  const scene = structuredClone(sceneFromRevision(original));
  for (const content of Object.values(scene.contents)) for (const mapping of content.mappings) {
    const handle = original.evidence[mapping.entityId].handle;
    const entity = Object.values(revision.evidence).find((entity: any) => entity.handle === handle) as any;
    assert(entity, `Missing corrected entity: ${handle}`);
    mapping.entityId = entity.id;
    mapping.sourceRangeId = entity.sourceRanges[mapping.sourceRangeIndex].id;
  }
  snapshot = await request("/api/mapping/diagrams", { projectId: receipt.projectId, representationId: source.id,
    expectedRevisionId: revision.id, name: source.name, scene });
  revision = snapshot.catalog.revisions[snapshot.representation.currentRevisionId];
}
const links = bundle.projection.links.map((link: { handle: string; targetLines: number[] }) => {
  const entity = Object.values(revision.evidence).find((entity: any) => entity.handle === link.handle) as any;
  assert(entity);
  return { sourceEvidenceIds: [entity.id], targetLines: link.targetLines };
});
const input = { ...bundle.projection, sourceRepresentationId: source.id, sourceRevisionId: revision.id,
  targetRepresentationId: target.id, expectedTargetRevisionId: journal.targetRevisionId, links };
const result = await request("/api/core/project/projections", input);
await writeFile(`${directory}/projection.json`, JSON.stringify(input, null, 2) + "\n");
await writeFile(`${directory}/receipt.json`, JSON.stringify({ ...receipt, bundleSha256,
  diagramSetId: journal.diagramSetId, diagramId: journal.diagramId, sourceRevisionId: revision.id,
  projectionId: result.projection.id, verifiedAt: new Date().toISOString() }, null, 2) + "\n");
await record({ correctedSourceRevisionId: revision.id, projectionId: result.projection.id });
console.log(JSON.stringify({ url: receipt.url, wrapperRange: companion.sourceRanges[0], projectionId: result.projection.id }, null, 2));
