import { expect, it } from "vitest";
import { validateCompactionProjection, type CompactionProjection } from "../compactionProjection";

function fixture(): CompactionProjection {
  const file = (sourceFile: string) => ({ sourceFile, sourceSha256: "a".repeat(64), asciiSha256: "b".repeat(64),
    ascii: `${sourceFile}\n+-- method()\n|   +-- selected\n|   \\-- hidden sibling\n\\-- unrelated()`,
    mappings: [1, 2, 3, 4, 5].map((treeLine) => ({ treeLine, sourceRanges: [{ startLine: treeLine * 2, endLine: treeLine * 2 + 1 }] })) });
  return { files: [file("src/one.ts"), file("src/two.ts")], links: [
    { callTreeNodeId: "selected", file: "src/one.ts", treeLines: [2, 3] },
    { callTreeNodeId: "duplicate", file: "src/one.ts", treeLines: [3] },
    { callTreeNodeId: "other", file: "src/two.ts", treeLines: [3] }
  ] };
}

it("rejects foreign nodes, missing files/rows, and incomplete source mappings", () => {
  const validate = (f: CompactionProjection) => validateCompactionProjection(f, new Set(["selected", "duplicate", "other"]));
  const foreign = fixture(); foreign.links[0].callTreeNodeId = "foreign";
  expect(() => validate(foreign)).toThrow(/Unresolved/);
  const row = fixture(); row.links[0].treeLines = [100];
  expect(() => validate(row)).toThrow(/Unresolved/);
  const file = fixture(); file.links[0].file = "unknown.ts";
  expect(() => validate(file)).toThrow(/Unresolved/);
  const missing = fixture(); missing.files[0].mappings.pop();
  expect(() => validate(missing)).toThrow(/Every compaction node/);
});
