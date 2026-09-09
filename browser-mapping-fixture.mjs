import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const packageRoot = path.dirname(new URL(import.meta.url).pathname);
/** Seed the old overview as a real project diagram for interaction regression tests. */
export async function seedMappingFixture(root) {
  execFileSync("git", ["init", "-q", root]);
  const { ascii, nodes } = JSON.parse(execFileSync(process.execPath, [path.join(packageRoot, "node_modules/tsx/dist/cli.mjs"), "-e",
    'import {MAPPING_POC_GRAPH_A as ascii,MAPPING_POC_A_NODES as nodes} from "./src/mappingPoc.ts"; console.log(JSON.stringify({ascii,nodes}));'
  ], { cwd: packageRoot, encoding: "utf8" }));
  const projectId = `project-${createHash("sha256").update(path.join(root, ".git")).digest("hex").slice(0, 12)}`;
  const evidence = {};
  const mappings = [];
  for (const node of nodes) {
    const sourceRanges = await Promise.all(node.sourceRanges.map(async (range, index) => ({
      ...range, id: `${node.id}-range-${index + 1}`,
      originalLines: (await readFile(path.join(packageRoot, range.path), "utf8")).split("\n").slice(range.startLine - 1, range.endLine)
    })));
    evidence[node.id] = { id: node.id, handle: node.id, label: node.label, category: "operation", summary: node.label, sourceRanges };
    sourceRanges.forEach((range, index) => mappings.push({ id: `${node.id}:range-${index+1}`, evidenceId: node.id, sourceRangeId: range.id, ...node.head }));
  }
  const timestamp = new Date().toISOString();
  const revision = { schemaVersion: 1, id: "revision-overview", projectId, representationId: "representation-overview", revision: 1, ascii,
    asciiSha256: createHash("sha256").update(ascii).digest("hex"), representationKind: "tree", evidence, mappings, createdAt: timestamp };
  const representation = { schemaVersion: 1, id: revision.representationId, projectId, handle: "overview", name: "Current LLM prompt stack", viewKind: "diagram", representationKind: "tree", status: "settled", currentRevisionId: revision.id, revisionIds: [revision.id], createdAt: timestamp, updatedAt: timestamp };
  await mkdir(path.join(root, ".diagrams/representations"), { recursive: true });
  await writeFile(path.join(root, ".diagrams/project.json"), JSON.stringify({ schemaVersion: 1, id: projectId, name: "Mapping fixture", repositoryIdentity: path.join(root, ".git"), canonicalRepoRoot: root,
    domainProfileId: "source-code", corpus: { kind: "git-worktree", root }, diagramSetIds: [], createdAt: timestamp, updatedAt: timestamp }));
  await writeFile(path.join(root, ".diagrams/representations/catalog.json"), JSON.stringify({ schemaVersion: 1, projectId, activeByKind: {}, representations: { [representation.id]: representation }, revisions: { [revision.id]: revision }, createdAt: timestamp, updatedAt: timestamp }));
}
