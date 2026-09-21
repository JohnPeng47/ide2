import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { mkdtemp, rm } from "node:fs/promises";
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
import { diagramApi } from "../vitePlugin";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Mapping and Core HTTP API", () => {

  it("starts without Studio and rejects all retired API namespaces", async () => {
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
    const origin = `http://127.0.0.1:${address.port}`;
    for (const endpoint of ['/api/studio/diagram-sets', '/api/studio/experiments', '/api/core/plans',
      '/api/core/workspace', '/api/core/imports', '/api/core/highlights', '/api/core/call-graph-focus',
      '/api/core/source', '/api/core/diagram-sets/set-one/files']) {
      for (const method of ['GET', 'POST']) {
        const response = await fetch(origin + endpoint, { method });
        expect(response.status, `${method} ${endpoint}`).toBe(404);
      }
    }
    const response = await fetch(`${origin}/api/core/project/representations`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: null, catalog: null });
    const created = await fetch(`${origin}/api/mapping/diagrams`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'First canvas', scene: singleDiagramScene('First') })
    });
    expect(created.status).toBe(200);
    const saved = await created.json();
    expect(saved.project.sources).toEqual([]);
    expect(saved.project).not.toHaveProperty('diagramSetIds');
    const reopened = await (await fetch(`${origin}/api/core/project/representations`)).json();
    expect(reopened.catalog.revisions[saved.representation.currentRevisionId].ascii).toBe('First');
    expect(reopened.project.id).toBe(saved.project.id);
  });
});
