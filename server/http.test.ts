import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Connect } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { diagramApi } from "./http";
import { DiagramStore } from "./store";
import { execFileSync } from "node:child_process";
import { singleDiagramScene } from "../src/projectDiagramCanvas";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Studio HTTP API", () => {
  it("serves Studio routes only within the Studio namespace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-http-namespaces-"));
    roots.push(root);
    let middleware: Connect.NextHandleFunction | undefined;
    const server = createServer((request, response) => {
      if (!middleware) throw new Error("middleware was not attached");
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    servers.push(server);
    const configure = diagramApi(root).configureServer;
    if (typeof configure !== "function") throw new Error("diagram API has no configure hook");
    (configure as unknown as (server: unknown) => void)({
      middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } },
      httpServer: server
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const workspace = await fetch(`${origin}/api/studio/workspace`);
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({ diagramSets: [] });
    const internalPrompt = `${origin}/internal/mapping/prompt`;
    expect((await fetch(internalPrompt)).status).toBe(405);
    const invalidPrompt = await fetch(internalPrompt, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(invalidPrompt.status).toBe(400);
    await expect(invalidPrompt.json()).resolves.toEqual({ error: "valid clientSessionId is required" });
    for (const pathname of ["/api/workspace", "/api/mapping/workspace", "/api/studio/unknown"]) {
      const response = await fetch(`${origin}${pathname}`);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "API route not found" });
    }
    for (const pathname of [
      "/api/diagram-sets",
      "/api/mapping/diagram-sets",
      "/api/mapping/prompt",
      "/api/mapping-poc/prompt",
      "/api/studio/mapping-poc/prompt"
    ]) {
      const response = await fetch(`${origin}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: root, name: "Must not be created" })
      });
      expect(response.status).toBe(404);
    }
    await expect((await fetch(`${origin}/api/studio/workspace`)).json())
      .resolves.toMatchObject({ diagramSets: [] });
    // Mapping can initialize the same project catalog without a Studio generation session.
    const diagramsUrl = `${origin}/internal/mapping/diagrams`;
    await expect((await fetch(diagramsUrl)).json()).resolves.toMatchObject({ project: null, catalog: null });
    execFileSync("git", ["init", "-q", root]);
    const postDiagram = (body: unknown) => fetch(diagramsUrl, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const createdResponse = await postDiagram({ name: "Canvas", scene: singleDiagramScene("Canvas") });
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json();
    const input = { projectId: created.project.id, representationId: created.representation.id,
      expectedRevisionId: created.representation.currentRevisionId, name: "Renamed", scene: singleDiagramScene("Updated") };
    expect((await postDiagram(input)).status).toBe(200);
    expect((await postDiagram(input)).status).toBe(409);
    const reopened = await (await fetch(diagramsUrl)).json();
    expect(reopened.catalog.representations[input.representationId].revisionIds).toHaveLength(2);
    expect(reopened.project.id).toBe(created.project.id);
    expect((await fetch(`${origin}/api/mapping/diagrams`)).status).toBe(404);
    const stalePrompt = await fetch(internalPrompt, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: created.project.id, representationId: input.representationId,
        baseRevisionId: input.expectedRevisionId, clientSessionId: "stale-project-prompt", diagramAscii: "Canvas", diagramRevision: 0,
        instruction: "Explain", selection: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 6 }, mappings: [] }) });
    expect(stalePrompt.status).toBe(409);
  });

  it("creates, lists, reads, and updates project Plans", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-http-plans-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    await new DiagramStore(root).ensureProject({
      checkoutRoot: root,
      repositoryIdentity: path.join(root, ".git")
    });
    let middleware: Connect.NextHandleFunction | undefined;
    const server = createServer((request, response) => {
      if (!middleware) throw new Error("middleware was not attached");
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    servers.push(server);
    const configure = diagramApi(root).configureServer;
    if (typeof configure !== "function") throw new Error("diagram API has no configure hook");
    (configure as unknown as (server: unknown) => void)({
      middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } },
      httpServer: server
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/api/studio/plans`;

    const createdResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Routing", markdown: "# Routing", changes: [] })
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; status: string };
    expect(created).toMatchObject({ status: "draft" });

    const list = await (await fetch(endpoint)).json() as Array<{ id: string }>;
    expect(list.map((plan) => plan.id)).toEqual([created.id]);

    const planEndpoint = `${endpoint}/${created.id}`;
    const updatedResponse = await fetch(planEndpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" })
    });
    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({ id: created.id, status: "active" });
    await expect((await fetch(planEndpoint)).json()).resolves.toMatchObject({ markdown: "# Routing" });
    await expect((await fetch(`http://127.0.0.1:${address.port}/api/studio/workspace`)).json())
      .resolves.toMatchObject({ plans: [{ id: created.id, status: "active" }] });
  });

  it("requires CodeEntities alongside ASCII in materialized creation mode", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-http-materialized-"));
    roots.push(root);
    let middleware: Connect.NextHandleFunction | undefined;
    const server = createServer((request, response) => {
      if (!middleware) throw new Error("middleware was not attached");
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    servers.push(server);
    const configure = diagramApi(root).configureServer;
    if (typeof configure !== "function") throw new Error("diagram API has no configure hook");
    (configure as unknown as (server: unknown) => void)({
      middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } },
      httpServer: server
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/studio/diagram-sets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creationMode: "materialized",
        path: root,
        name: "Missing entities",
        codeEntities: [],
        diagrams: [{ key: "diagram", name: "Diagram", ascii: "diagram", codeEntityKeys: [] }]
      })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "materialized DiagramSet creation requires at least one CodeEntity"
    });
  });

  it("exposes a POST-only endpoint and validates the request version", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-http-focus-"));
    roots.push(root);
    let middleware: Connect.NextHandleFunction | undefined;
    const server = createServer((request, response) => {
      if (!middleware) throw new Error("middleware was not attached");
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    servers.push(server);
    const plugin = diagramApi(root);
    const configure = plugin.configureServer;
    if (typeof configure !== "function") throw new Error("diagram API has no configure hook");
    (configure as unknown as (server: unknown) => void)({
      middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } },
      httpServer: server
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/api/studio/call-graph-focus`;

    const wrongMethod = await fetch(endpoint);
    expect(wrongMethod.status).toBe(405);

    const invalid = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2 })
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "unsupported call-graph focus request version: 2"
    });
  });

  it("requires complete numerical candidate feedback through PUT", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-http-feedback-"));
    roots.push(root);
    let middleware: Connect.NextHandleFunction | undefined;
    const server = createServer((request, response) => {
      if (!middleware) throw new Error("middleware was not attached");
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    servers.push(server);
    const configure = diagramApi(root).configureServer;
    if (typeof configure !== "function") throw new Error("diagram API has no configure hook");
    (configure as unknown as (server: unknown) => void)({
      middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } },
      httpServer: server
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/api/studio/diagram-sets/set-one/candidate-batches/candidate-batch-one/feedback`;

    expect((await fetch(endpoint)).status).toBe(405);
    const invalid = await fetch(endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rankings: [{ diagramId: "diagram-one", rank: "first" }] })
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "rankings must contain a diagramId and numerical rank for every candidate"
    });
  });

  it("validates code-entity mapping batches before opening the event stream", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-http-map-batch-"));
    roots.push(root);
    let middleware: Connect.NextHandleFunction | undefined;
    const server = createServer((request, response) => {
      if (!middleware) throw new Error("middleware was not attached");
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    servers.push(server);
    const configure = diagramApi(root).configureServer;
    if (typeof configure !== "function") throw new Error("diagram API has no configure hook");
    (configure as unknown as (server: unknown) => void)({
      middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } },
      httpServer: server
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/api/studio/diagram-sets/set-one/code-entity-maps`;

    expect((await fetch(endpoint)).status).toBe(405);
    const empty = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifacts: [] })
    });
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toEqual({
      error: "at least one artifact is required for mapping"
    });
    const invalidConcurrency = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: [{ artifactKind: "diagram", artifactId: "diagram-one" }],
        concurrency: 7
      })
    });
    expect(invalidConcurrency.status).toBe(400);
    await expect(invalidConcurrency.json()).resolves.toEqual({
      error: "mapping concurrency must be between 1 and 6"
    });
  });
});
