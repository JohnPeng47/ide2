import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const read = async (name) => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const [snapshot, extraction, files] = await Promise.all([read("project-snapshot"), read("extraction"), read("source-files")]);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const { catalog } = snapshot;
assert.ok(catalog.representations[extraction.primaryDiagramId]);
for (const representation of Object.values(catalog.representations)) {
  assert.ok(catalog.revisions[representation.currentRevisionId]);
  for (const id of representation.revisionIds) assert.ok(catalog.revisions[id], `Missing revision ${id}`);
}
for (const revision of Object.values(catalog.revisions)) {
  assert.equal(hash(revision.ascii), revision.asciiSha256);
  for (const evidence of Object.values(revision.evidence)) for (const range of evidence.sourceRanges) {
    assert.ok(files[range.path], `Missing evidence source ${range.path}`);
    assert.ok(range.startLine > 0 && range.endLine <= files[range.path].lines.length);
    if (range.originalLines) assert.deepEqual(files[range.path].lines.slice(range.startLine - 1, range.endLine), range.originalLines);
  }
}
for (const projection of Object.values(catalog.projections)) {
  assert.ok(catalog.revisions[projection.sourceRevisionId]);
  assert.ok(catalog.revisions[projection.targetRevisionId]);
  for (const compaction of projection.compactionProjection.files) {
    const source = files[compaction.sourceFile];
    assert.ok(source, `Missing compaction source ${compaction.sourceFile}`);
    assert.equal(hash(source.lines.join("\n")), compaction.sourceSha256, `Source snapshot mismatch: ${source.path}`);
    assert.equal(source.sourceSha256, compaction.sourceSha256);
    assert.equal(hash(compaction.ascii), compaction.asciiSha256);
    for (const row of compaction.mappings) for (const range of row.sourceRanges) {
      assert.ok(range.startLine > 0 && range.endLine <= source.lines.length, `Out-of-bounds range in ${source.path}`);
    }
  }
}
console.log(`PASS: ${Object.keys(catalog.representations).length} representations, ${Object.keys(catalog.revisions).length} revisions, ${Object.keys(catalog.projections).length} projection, ${Object.keys(files).length} exact source snapshots, and all evidence/compaction ranges.`);
