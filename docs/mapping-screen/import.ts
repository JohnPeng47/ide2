import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sceneFromRevision } from "../../src/core/projectDiagramCanvas";
import { buildProjectionTree, projectSelection, validateProjection } from "../../src/core/diagramProjection";
import { projectCompactions } from "../../src/core/compactionProjection";

const base = process.argv[2];
assert(base && /^https?:\/\//.test(base), "Usage: tsx docs/mapping-screen/import.ts <server-url>");
const output = "docs/mapping-screen";
const bundle = JSON.parse(await readFile(`${output}/prepared.json`, "utf8"));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const receiptFile = `${output}/receipt.json`;
let receipt: Record<string, string> = {};
try { receipt = JSON.parse(await readFile(receiptFile, "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
async function record(values: Record<string, string>) {
  receipt = { ...receipt, ...values };
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
}
async function request(route: string, body?: unknown) {
  const response = await fetch(new URL(route, base), body === undefined ? undefined
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  assert(response.ok, `${route}: ${response.status}: ${text.slice(0, 1000)}`);
  if (response.headers.get("content-type")?.includes("ndjson")) {
    const result = text.trim().split("\n").map((line) => JSON.parse(line)).find((event) => event.type === "result");
    assert(result, "Materialized import did not return a result; inspect the workspace before retrying");
    return result;
  }
  return JSON.parse(text);
}

// Fail before any mutation if this prepared bundle belongs to a different snapshot.
const originalAscii = await readFile(`${output}/diagram.txt`, "utf8");
assert.equal(bundle.materialized.diagrams[0].ascii, originalAscii);
for (const file of bundle.projection.compactionProjection.files) {
  const source = await readFile(file.sourceFile, "utf8");
  assert.equal(hash(source), file.sourceSha256, `Source changed: ${file.sourceFile}; regenerate before import`);
  assert.equal(hash(file.ascii), file.asciiSha256);
  const lineCount = source.split("\n").length - Number(source.endsWith("\n"));
  for (const row of file.mappings) for (const range of row.sourceRanges) {
    assert(range.startLine >= 1 && range.endLine >= range.startLine && range.endLine <= lineCount);
  }
}
let snapshot = await request("/api/core/project/representations");
assert.equal(path.resolve(snapshot.project.canonicalRepoRoot), process.cwd(), "The server is using a different repository");
assert(!receipt.projectId || receipt.projectId === snapshot.project.id, "Receipt belongs to another project");
const bundleSha256 = hash(JSON.stringify(bundle));
assert(!receipt.bundleSha256 || receipt.bundleSha256 === bundleSha256,
  "Bundle changed after import began; inspect the existing import before generating a replacement");
await record({ server: base, projectId: snapshot.project.id, bundleSha256 });
if (!receipt.diagramSetId) {
  const workspace = await request("/api/core/workspace");
  assert(!workspace.diagramSets.some((set: { name: string }) => set.name === bundle.materialized.name),
    "A matching DiagramSet already exists; recover its IDs instead of creating a duplicate");
  const result = await request("/api/studio/diagram-sets", { ...bundle.materialized, path: process.cwd() });
  await record({ diagramSetId: result.diagramSetId, diagramId: result.diagramIdsByKey["mapping-screen"] });
}
const findSource = () => Object.values(snapshot.catalog.representations).find((item: any) => {
  const provenance = snapshot.catalog.revisions[item.currentRevisionId]?.provenance;
  return provenance?.diagramSetId === receipt.diagramSetId && provenance?.artifactId === receipt.diagramId;
}) as any;
let representation = receipt.representationId ? snapshot.catalog.representations[receipt.representationId] : findSource();
if (!representation) {
  await request("/api/studio/project/representations/promote", {
    diagramSetId: receipt.diagramSetId, diagramId: receipt.diagramId, makeActive: false
  });
  snapshot = await request("/api/core/project/representations");
  representation = findSource();
}
assert(representation, "Promoted representation was not found");
await record({ representationId: representation.id });
let revision = snapshot.catalog.revisions[representation.currentRevisionId];
if (revision.content?.kind !== "mapping-canvas") {
  snapshot = await request("/api/mapping/diagrams", { projectId: snapshot.project.id,
    representationId: representation.id, expectedRevisionId: revision.id,
    name: representation.name, scene: sceneFromRevision(revision) });
  representation = snapshot.representation;
  revision = snapshot.catalog.revisions[representation.currentRevisionId];
}
assert.equal(revision.ascii.trimEnd(), originalAscii.trimEnd(), "Saved canvas changed diagram text");
assert.equal(revision.mappings.length, bundle.materialized.diagrams[0].mappings.length);
assert(!receipt.sourceRevisionId || receipt.sourceRevisionId === revision.id, "Source canvas changed after import");
await record({ sourceRevisionId: revision.id });
const links = bundle.projection.links.map((link: { handle: string; targetLines: number[] }) => {
  const evidence = Object.values(revision.evidence).find((entity: any) => entity.handle === link.handle) as any;
  assert(evidence, `No project evidence for ${link.handle}`);
  const expected = bundle.materialized.codeEntities.find((entity: { handle: string }) => entity.handle === link.handle);
  assert.deepEqual(evidence.sourceRanges.map(({ path, startLine, endLine, symbol }: any) => ({ path, startLine, endLine, symbol })),
    expected.sourceRanges.map(({ path, startLine, endLine, symbol }: any) => ({ path, startLine, endLine, symbol })),
    `Saved evidence differs from the intended source region: ${link.handle}`);
  const range = evidence.sourceRanges[0];
  if (evidence.label === "ProjectionCompanion") {
    assert(range.originalLines.join("\n").includes('className="mapping-poc-companion"'),
      "ProjectionCompanion must map to its rendered JSX wrapper, not the projection calculation");
  }
  return { sourceEvidenceIds: [evidence.id], targetLines: link.targetLines, sourceFile: range.path };
});
const input = { ...bundle.projection, sourceRepresentationId: representation.id, sourceRevisionId: revision.id,
  links: links.map(({ sourceFile: _file, ...link }: any) => link) };
await writeFile(`${output}/projection.json`, JSON.stringify(input, null, 2) + "\n");
let projection = receipt.projectionId && snapshot.catalog.projections?.[receipt.projectionId];
if (!projection) {
  const result = await request("/api/core/project/projections", input);
  snapshot = result;
  projection = result.projection;
  await record({ projectionId: projection.id, targetRepresentationId: projection.targetRepresentationId });
}
validateProjection(projection, snapshot.catalog);
const target = snapshot.catalog.revisions[projection.targetRevisionId];
const targetTree = buildProjectionTree(target);
for (const link of links) {
  const selection = projectSelection(projection, target, link.sourceEvidenceIds);
  assert.equal(selection.matchedSourceEvidenceIds.length, 1);
  assert.deepEqual(selection.targetNodeIds.map((id) => targetTree.nodes[id].line), link.targetLines);
  const compactions = projectCompactions(projection.compactionProjection, selection.projectedNodeIds);
  assert.equal(compactions.length, 1, "A selective mapping must only expose its intended file");
  assert.equal(compactions[0].sourceFile, link.sourceFile);
  assert(compactions[0].selectedLineCount > 0);
}
await record({ url: new URL(`/mapping?diagram=${encodeURIComponent(representation.id)}`, base).href,
  verifiedAt: new Date().toISOString() });
console.log(JSON.stringify({ ...receipt, mappedNodes: revision.mappings.length,
  sourceFiles: projection.compactionProjection.files.length }, null, 2));
