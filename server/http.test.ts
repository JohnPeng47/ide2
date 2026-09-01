import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Connect } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { diagramApi } from "./http";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("call-graph focus HTTP API", () => {
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
    const response = await fetch(`http://127.0.0.1:${address.port}/api/diagram-sets`, {
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
    const endpoint = `http://127.0.0.1:${address.port}/api/call-graph-focus`;

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
    const endpoint = `http://127.0.0.1:${address.port}/api/diagram-sets/set-one/candidate-batches/candidate-batch-one/feedback`;

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
    const endpoint = `http://127.0.0.1:${address.port}/api/diagram-sets/set-one/code-entity-maps`;

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
