import { tsImport } from 'tsx/esm/api';
const { revisionCanvasFixture } = await tsImport('../../support/mappingDiagram.ts', import.meta.url);
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
/** Seed current canvas records with deterministic evidence, independent of deleted source files. */
export async function seedMappingFixture(root, diagram) {
  execFileSync("git", ["init", "-q", root]);
  const { ascii, nodes } = diagram ?? JSON.parse(execFileSync(process.execPath, [path.join(packageRoot, "node_modules/tsx/dist/cli.mjs"), "-e",
    'import {MAPPING_POC_GRAPH_A as ascii,MAPPING_POC_A_NODES as nodes} from "./domain/mapping/selection/mappingPoc.ts"; console.log(JSON.stringify({ascii,nodes}));'
  ], { cwd: packageRoot, encoding: "utf8" }));
  const projectId = `project-${createHash("sha256").update(path.join(root, ".git")).digest("hex").slice(0, 12)}`;
  const evidence = {};
  const mappings = [];
  for (const node of nodes) {
    const sourceRanges = await Promise.all(node.sourceRanges.map(async (range, index) => ({
      ...range, id: `${node.id}-range-${index + 1}`,
      originalLines: Array.from({ length: range.endLine - range.startLine + 1 }, (_, offset) =>
        `// ${node.label}: fixture source line ${range.startLine + offset}`)

    })));
    evidence[node.id] = { id: node.id, handle: node.id, label: node.label, category: "operation", summary: node.label, sourceRanges };
    sourceRanges.forEach((range, index) => mappings.push({ id: `${node.id}:range-${index+1}`, evidenceId: node.id, sourceRangeId: range.id, ...node.head }));
  }
  const timestamp = new Date().toISOString();
  const revision = { schemaVersion: 1, id: "revision-overview", projectId, representationId: "representation-overview", revision: 1, ascii,
    source: {sourceId: "fixture-source", repositoryIdentity:path.join(root,".git"),domainProfileId:"source-code",corpus:{kind:"git-worktree",root}},
    asciiSha256: createHash("sha256").update(ascii).digest("hex"), representationKind: "tree", evidence, mappings, createdAt: timestamp };
  revision.content = revisionCanvasFixture(revision);
  delete revision.source;
  const representation = { schemaVersion: 1, id: revision.representationId, projectId, handle: "overview", name: "Current LLM prompt stack", viewKind: "diagram", representationKind: "tree", status: "settled", currentRevisionId: revision.id, revisionIds: [revision.id], createdAt: timestamp, updatedAt: timestamp };
  await mkdir(path.join(root, ".diagrams/representations"), { recursive: true });
  await writeFile(path.join(root, ".diagrams/project.json"), JSON.stringify({ schemaVersion: 1, id: projectId, name: "Mapping fixture", defaultDomainProfileId: "source-code", diagramSetIds: [], createdAt: timestamp, updatedAt: timestamp }));
  await writeFile(path.join(root, ".diagrams/representations/catalog.json"), JSON.stringify({ schemaVersion: 1, projectId, activeByKind: {}, representations: { [representation.id]: representation }, revisions: { [revision.id]: revision }, createdAt: timestamp, updatedAt: timestamp }));
}
