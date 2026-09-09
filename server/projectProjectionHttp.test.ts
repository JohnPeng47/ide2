import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Connect } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { projectSelection, validateProjection } from "../src/diagramProjection";
import type { ProjectRepresentationCatalogRecord } from "../src/projectCatalog";
import { singleDiagramScene } from "../src/projectDiagramCanvas";
import { diagramApi } from "./http";
import { DiagramStore } from "./store";

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
  const source = await store.projectCatalogs.promoteRepresentation({
    projectId: project.id, handle: "source", name: "Source", viewKind: "diagram", representationKind: "diagram",
    ascii, asciiSha256: createHash("sha256").update(ascii).digest("hex"),
    evidence: Object.fromEntries(["a", "b", "c"].map((id) => [id, {
      id, handle: id, label: id, category: "operation" as const, summary: id,
      sourceRanges: [{ id: `range-${id}`, path: "source.ts", startLine: 1, endLine: 1,
        originalLines: ["export function source() {}"] }]
    }])),
    mappings: ["a", "b", "c"].map((id, index) => ({
      id: `mapping-${id}`, evidenceId: id, sourceRangeId: `range-${id}`, line: index + 1,
      startColumn: 1, endColumn: ascii.split("\n")[index].length
    })),
    provenance: { diagramSetId: "set-test", artifactId: "diagram-test" }, makeActive: true
  });
  let middleware: Connect.NextHandleFunction | undefined;
  const server = createServer((request, response) => {
    if (!middleware) throw new Error("middleware was not attached");
    middleware(request, response, () => { response.statusCode = 404; response.end(); });
  });
  servers.push(server);
  const configure = diagramApi(root).configureServer;
  if (typeof configure !== "function") throw new Error("diagram API has no configure hook");
  (configure as unknown as (server: unknown) => void)({
    middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } }, httpServer: server
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const endpoint = `${origin}/internal/mapping/projections`;
  const diagramsEndpoint = `${origin}/internal/mapping/diagrams`;
  const post = (body: unknown) => fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const snapshot = async () => {
    const response = await fetch(diagramsEndpoint);
    expect(response.status).toBe(200);
    return response.json() as Promise<{ project: { id: string }; catalog: ProjectRepresentationCatalogRecord }>;
  };
  const input = {
    sourceRepresentationId: source.representation.id, sourceRevisionId: source.representation.currentRevisionId,
    name: "Calls", ascii: "Calls\n|\n+-- shared()\n|   \\-- detail\n\\-- gamma()",
    links: [{ sourceEvidenceIds: ["b", "c"], targetLines: [3] }, { sourceEvidenceIds: ["c"], targetLines: [5] }]
  };
  return { store, project, source, endpoint, diagramsEndpoint, post, snapshot, input,
    catalogPath: path.join(store.storeRoot, "representations/catalog.json") };
}

describe("Project projection HTTP API", () => {
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
    expect(projection).toMatchObject({ match: "any", sourceRevisionId: input.sourceRevisionId,
      sourceRepresentationId: source.representation.id, targetRepresentationId: created.representation.id });
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
      body: JSON.stringify({ projectId: project.id, representationId: source.representation.id,
        expectedRevisionId: input.sourceRevisionId, name: "Updated source", scene: singleDiagramScene("Changed") })
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
