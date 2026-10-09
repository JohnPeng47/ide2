import { canvasSaveFixture } from '../../../../../tests/support/mappingDiagram';
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Connect } from "vite";
import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import { sourceBindingFromLocation } from '../../../../../domain/core/diagrams/diagram';
import { projectSelection, validateProjection } from "../../../../../domain/core/diagrams/diagramProjection";
import { singleDiagramScene } from "../../../../../domain/core/diagrams/projectDiagramCanvas";
import type { ProjectRepresentationCatalogRecord } from "../../../../../domain/core/representations/projectCatalog";
import { DiagramStore } from "../../../../../infrastructure/core/persistence/store";
import { saveDiagramFixture } from '../../../../../tests/support/mappingDiagram';
import { diagramApi } from "../../../app/vitePlugin";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "project-projection-http-"));
  roots.push(root);
  await mkdir(path.join(root, ".git"));
  const store = new DiagramStore(root);
  const project = await store.ensureProject({ checkoutRoot: root, repositoryIdentity: path.join(root, ".git") });
  const ascii = "Alpha\nBeta\nGamma";
  const source = await saveDiagramFixture(store.projectCatalogs, {
    source: sourceBindingFromLocation({checkoutRoot:root,repositoryIdentity:path.join(root,".git")}),
    projectId: project.id, name: "Source", representationKind: "diagram",
    ascii,
    evidence: Object.fromEntries(["a", "b", "c"].map((id) => [id, {
      id, handle: id, label: id, category: "operation" as const, summary: id,
      sourceRanges: [{
        id: `range-${id}`, path: "source.ts", startLine: 1, endLine: 1,
        originalLines: ["export function source() {}"]
      }]
    }])),
    mappings: ["a", "b", "c"].map((id, index) => ({
      id: `mapping-${id}`, evidenceId: id, sourceRangeId: `range-${id}`, line: index + 1,
      startColumn: 1, endColumn: ascii.split("\n")[index].length
    })),});
  let middleware: Connect.NextHandleFunction | undefined;
  const server = createServer((request, response) => {
    if (!middleware) throw new Error("middleware was not attached");
    middleware(request, response, () => { response.statusCode = 404; response.end(); });
  });
  servers.push(server);
  const configure = diagramApi(root, undefined, undefined, undefined, { httpEnabled: true }).configureServer;
  if (typeof configure !== "function") throw new Error("diagram API has no configure hook");
  (configure as unknown as (server: unknown) => void)({
    middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } }, httpServer: server
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const endpoint = `${origin}/api/core/project/projections`;
  const diagramsEndpoint = `${origin}/api/mapping/diagrams`;
  const post = (body: unknown) => fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const snapshot = async () => {
    const response = await fetch(`${origin}/api/core/project/representations`);
    expect(response.status).toBe(200);
    return response.json() as Promise<{ project: { id: string }; catalog: ProjectRepresentationCatalogRecord }>;
  };
  const input = {
    sourceRepresentationId: source.representation.id, sourceRevisionId: source.representation.currentRevisionId,
    name: "Calls", ascii: "Calls\n|\n+-- shared()\n|   \\-- detail\n\\-- gamma()",
    links: [{ sourceEvidenceIds: ["b", "c"], targetLines: [3] }, { sourceEvidenceIds: ["c"], targetLines: [5] }]
  };
  return {
    root, sourceEndpoint: `${origin}/api/core/project/source`, store, project, source, endpoint, diagramsEndpoint, post, snapshot, input,
    catalogPath: path.join(store.storeRoot, "canvases/catalog.json")
  };
}

describe("Project projection HTTP API", () => {
  it("reads complete project source with an exact hash and rejects foreign projects and escaping paths", async () => {
    const { root, project, sourceEndpoint } = await fixture();
    const source = "// context\r\nexport const selected = 1;\r\n// tail\r\n";
    await writeFile(path.join(root, "source.ts"), source);
    const read = (file: string, projectId = project.id) => fetch(`${sourceEndpoint}?${new URLSearchParams({ projectId, path: file })}`);
    const response = await read("source.ts");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "source.ts", startLine: 1, lines: source.split(/\r?\n/),
      sourceSha256: createHash("sha256").update(source).digest("hex"), lspEnabled: false
    });
    expect((await read("source.ts", "other-project")).status).toBe(409);
    for (const file of ["../source.ts", path.join(root, "source.ts"), "missing.ts"]) {
      expect((await read(file)).ok).toBe(false);
    }
    await symlink(path.join(root, "source.ts"), path.join(root, "link.ts"));
    expect((await read("link.ts")).ok).toBe(false);
    expect((await fetch(sourceEndpoint, { method: "POST" })).status).toBe(405);
  });

  it("persists a target tree and OR links visible through the diagrams endpoint", async () => {
    const { project, source, post, snapshot, input } = await fixture();
    const response = await post(input);
    expect(response.status).toBe(200);
    const created = await response.json();
    expect(created.project.id).toBe(project.id);
    const reopened = await snapshot();
    expect(reopened.project.id).toBe(project.id);
    expect(reopened.catalog).toEqual(created.catalog);
    expect(reopened.catalog.activeByKind).toEqual(source.catalog.activeByKind);
    expect(reopened.catalog.revisions[input.sourceRevisionId]).toEqual(source.catalog.revisions[input.sourceRevisionId]);
    const projection = reopened.catalog.projections![created.projection.id];
    expect(projection).toMatchObject({
      match: "any", sourceRevisionId: input.sourceRevisionId,
      sourceRepresentationId: source.representation.id, targetRepresentationId: created.representation.id
    });
    expect(() => validateProjection(projection, reopened.catalog)).not.toThrow();
    const target = reopened.catalog.revisions[projection.targetRevisionId];
    expect(target).toMatchObject({ representationKind: "tree", ascii: input.ascii });
    expect(projectSelection(projection, target, ["b"]).ascii).toBe("Calls\n\\-- shared()\n    \\-- detail");
    expect(projectSelection(projection, target, ["c"]).targetNodeIds).toHaveLength(2);
    expect(projectSelection(projection, target, ["a", "c"]).unmatchedSourceEvidenceIds).toEqual(["a"]);
  });

  it("returns 400 for invalid target lines and unknown evidence without changing the catalog", async () => {
    const { post, snapshot, input, catalogPath } = await fixture();
    const before = await snapshot();
    const beforeBytes = await readFile(catalogPath, "utf8");
    for (const links of [
      [{ sourceEvidenceIds: ["b"], targetLines: [2] }],
      [{ sourceEvidenceIds: ["b"], targetLines: [999] }],
      [{ sourceEvidenceIds: ["unknown"], targetLines: [3] }]
    ]) {
      const response = await post({ ...input, links });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
      expect(await readFile(catalogPath, "utf8")).toBe(beforeBytes);
    }
  });

  it("returns 409 for a stale source revision without creating a target", async () => {
    const { project, source, diagramsEndpoint, post, snapshot, input, catalogPath } = await fixture();
    const updated = await fetch(diagramsEndpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(canvasSaveFixture({
        projectId: project.id, representationId: source.representation.id,
        expectedRevisionId: input.sourceRevisionId, name: "Updated source", scene: singleDiagramScene("Changed")
      }))
    });
    expect(updated.status).toBe(200);
    await updated.json();
    const before = await snapshot();
    const beforeBytes = await readFile(catalogPath, "utf8");
    const response = await post(input);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Source diagram changed") });
    expect(await snapshot()).toEqual(before);
    expect(await readFile(catalogPath, "utf8")).toBe(beforeBytes);
  });

  it("returns 405 for GET on the POST-only projection endpoint", async () => {
    const { endpoint, snapshot } = await fixture();
    const before = await snapshot();
    const response = await fetch(endpoint);
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "method not allowed" });
    expect(await snapshot()).toEqual(before);
  });
});

it('lists repository directories lazily through project scope and rejects foreign roots and symlinks', async () => {
  const { root, project, sourceEndpoint } = await fixture();
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/main.ts'), 'export const main = 1;');
  const endpoint = sourceEndpoint.replace('/source', '/files');
  const list = (directory: string, projectId = project.id) => fetch(`${endpoint}?${new URLSearchParams({ projectId, path: directory })}`);
  const rootListing = await (await list('')).json();
  expect(rootListing.entries).toContainEqual({ name: 'src', path: 'src', kind: 'directory' });
  expect(rootListing.entries.some((entry: any) => entry.name === '.git' || entry.path === 'src/main.ts')).toBe(false);
  expect(await (await list('src')).json()).toEqual({ directory: 'src', entries: [{ name: 'main.ts', path: 'src/main.ts', kind: 'file' }] });
  expect((await list('', 'foreign')).status).toBe(409);
  expect((await list('../')).ok).toBe(false);
  await symlink(path.join(root, 'src'), path.join(root, 'linked'));
  expect((await list('linked')).ok).toBe(false);
});
