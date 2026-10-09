import { DiagramStore } from '../../../../infrastructure/core/persistence/store';
import { canvasSaveFixture, saveDiagramFixture } from '../../../../tests/support/mappingDiagram';
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
    const plugin = diagramApi(root, undefined, undefined, undefined, { httpEnabled: true });
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
      body: JSON.stringify(canvasSaveFixture({ name: 'First canvas', scene: singleDiagramScene('First') }))
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

// Exercise both Vite serving modes and every flag combination over real transports.
for (const hook of ['configureServer', 'configurePreviewServer'] as const) {
  for (const httpEnabled of [false, true]) for (const piEnabled of [false, true]) {
    it(`${hook}: HTTP=${httpEnabled}, Pi=${piEnabled} allows app persistence and gates agent mutations`, async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'new-diagram-capabilities-'));
      roots.push(root);
      const store = new DiagramStore(root);
      const project = await store.ensureProject({ checkoutRoot: root, repositoryIdentity: path.join(root, '.git') });
      const saved = await saveDiagramFixture(store.projectCatalogs, { projectId: project.id, name: 'Existing diagram', ascii: 'Root\n`-- Child' });
      let middleware: Connect.NextHandleFunction;
      const server = createServer((request, response) => middleware(request, response, () => response.end('static frontend')));
      servers.push(server);
      const configure = diagramApi(root, undefined, undefined, undefined, httpEnabled || piEnabled ? { httpEnabled, piEnabled } : undefined)[hook];
      if (typeof configure !== 'function') throw new Error('missing Vite hook');
      (configure as unknown as (server: unknown) => void)({
        middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } }, httpServer: server
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect(await (await fetch(origin + '/')).text()).toBe('static frontend');
      const catalog = await fetch(origin + '/api/core/project/representations');
      expect(catalog.status).toBe(200);
      expect((await catalog.json()).catalog.revisions[saved.representation.currentRevisionId].ascii).toBe('Root\n`-- Child');
      for (const endpoint of ['/api/mapping/workspace', '/api/mapping/workspace/records']) {
        expect((await fetch(origin + endpoint)).status).toBe(200);
      }
      const readQuery = await fetch(origin + '/api/mapping/agent/tools/canvas-api-search', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'nodes.get' })
      });
      expect(readQuery.status).toBe(200);
      expect(JSON.stringify(await readQuery.json())).toContain('nodes.get');
      // Definitions is a read despite POST; its independent LSP flag still applies.
      expect((await fetch(origin + '/api/core/project/definitions', { method: 'POST' })).status).toBe(503);
      if (!httpEnabled) {
        for (const endpoint of ['/api/mapping/agent/tools/edit-diagram', '/api/mapping/agent/tools/exec',
          '/api/mapping/agent/tools/register_repository', '/api/mapping/agent/tools/draw_diagram',
          '/api/mapping/agent/tools/accept_diagram_change_session']) {
          for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            const response = await fetch(origin + endpoint, { method });
            expect(response.status, `${method} ${endpoint}`).toBe(403);
            expect(await response.json()).toMatchObject({ code: 'HTTP_WRITES_DISABLED' });
          }
        }
      }
      const post = (endpoint: string, body: unknown, method = 'POST') => fetch(origin + endpoint, {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      // Browser persistence must work in every flag combination, including defaults.
      expect((await post('/api/mapping/workspace', { schemaVersion: 3, projectId: project.id, documents: [] }, 'PUT')).status).toBe(200);
      const records = await (await fetch(origin + '/api/mapping/workspace/records')).json();
      expect((await post('/api/mapping/workspace/records', { requestId: crypto.randomUUID(), expectedRevision: records.revision,
        changes: [{ key: 'workspace', value: { projectId: project.id, documentIds: [], transfers: [] } }] })).status).toBe(200);
      const created = await post('/api/mapping/diagrams', canvasSaveFixture({ name: 'Browser save', scene: singleDiagramScene('Saved without flags') }));
      expect(created.status).toBe(200);
      const createdBody = await created.json();
      expect((await fetch(origin + `/api/mapping/diagrams/${createdBody.representation.id}`, { method: 'DELETE' })).status).toBe(200);
      const canvasId = crypto.randomUUID();
      // App attachment is a fixed operation, never an alternate arbitrary-exec endpoint.
      expect((await post('/api/mapping/agent/attachments', { canvasId, documentId: 'doc', code: 'return nodes.remove({nodeId:"grid:overview"});' })).status).toBe(400);
      expect((await post('/api/mapping/agent/change-sessions/session/accept', { expectedVersion: 0, requestId: 'accept', changeSessionId: 'override' })).status).toBe(400);
      expect((await post('/api/mapping/agent/canvases', { canvasId, documents: [] })).status).toBe(200);
      expect((await (await fetch(origin + '/api/mapping/agent/canvases')).json()).some((canvas: { canvasId: string }) => canvas.canvasId === canvasId)).toBe(true);
      expect((await fetch(origin + `/api/mapping/agent/canvases/${canvasId}`, { method: 'DELETE' })).status).toBe(200);
      const { WebSocket } = await import('ws');
      const connect = (endpoint: string, protocol?: string) => new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(origin.replace('http:', 'ws:') + endpoint, protocol);
        ws.on('open', () => { ws.close(); resolve(101); });
        ws.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode!); });
        ws.on('error', reject);
      });
      expect(await connect('/api/mapping/live')).toBe(101);
    });
  }
}
