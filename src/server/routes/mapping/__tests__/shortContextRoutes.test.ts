import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { LiveCanvasService } from '../../../../../application/mapping/agent/liveCanvasService';
import type { LiveCanvasContext } from '../../../../../domain/mapping/agent/liveCanvasStatus';
import { canvasDisplayNodes } from '../../../../../domain/mapping/workspace/canvasDisplayNode';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { createMappingRoutes } from '../routes';

it('serves a fresh short HTTP snapshot without a reader socket and validates identity, method and query', async () => {
  const ascii = 'Root  \n\n`-- Child\n';
  const nodes = canvasDisplayNodes(mappingDocumentFromScene(singleDiagramScene(ascii)), initialCanvasState(), 8);
  const load = vi.fn(async (): Promise<LiveCanvasContext> => ({ version: 8, name: 'Canvas', nodes, edges: [] }));
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [{ documentId: 'doc', name: 'Canvas' }] }], load);
  const owner = {}, notify = vi.fn();
  service.publish(owner, 'workspace', notify);
  const route = createMappingRoutes({ liveCanvas: service } as Parameters<typeof createMappingRoutes>[0]);
  const server = createServer((req, res) => { void route(req, res, new URL(req.url!, 'http://localhost')); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/live/context/short`;
  const url = `${root}?workspaceInstanceId=workspace&documentId=doc`;
  const selection = { documentId: 'doc', canvasEpoch: 'epoch', sequence: 0, documentVersion: 2, regions: [] };
  try {
    expect((await fetch(root)).status).toBe(400);
    expect((await fetch(`${url}&documentId=other`)).status).toBe(400);
    expect((await fetch(`${root}?workspaceInstanceId=${'x'.repeat(201)}&documentId=doc`)).status).toBe(400);
    expect((await fetch(url, { method: 'POST' })).status).toBe(405);
    expect((await fetch(url)).status).toBe(503);
    expect(load).not.toHaveBeenCalled();
    service.update(owner, 'workspace', selection);
    const response = await fetch(url), result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-document-version')).toBe('8'); // Not the older selection version.
    expect(response.headers.get('x-canvas-epoch')).toBe('epoch');
    expect(result).toMatchObject({ workspaceInstanceId: 'workspace', documentId: 'doc', canvasEpoch: 'epoch',
      view: 'short', shortFormatVersion: 1, version: 8, diagrams: [{ id: 'grid:overview', ascii }] });
    expect(result).not.toHaveProperty('nodes');
    expect(result.diagrams[0]).not.toHaveProperty('contentNodes');
    expect(load).toHaveBeenLastCalledWith('workspace', 'doc');
    expect(notify).not.toHaveBeenCalled(); // No persistent agent binding or indicator change.
    expect((await fetch(`${root}?workspaceInstanceId=gone&documentId=doc`)).status).toBe(410);
    expect((await fetch(`${root}?workspaceInstanceId=workspace&documentId=missing`)).status).toBe(503);

    let finish!: (context: LiveCanvasContext) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fetch(url);
    await expect.poll(() => load.mock.calls.length).toBe(2);
    service.update(owner, 'workspace', { ...selection, canvasEpoch: 'replacement' });
    finish({ version: 8, name: 'Obsolete', nodes, edges: [] });
    const replaced = await pending;
    expect(replaced.status).toBe(409);
    expect(await replaced.json()).toMatchObject({ code: 'CANVAS_REPLACED' });

    load.mockResolvedValueOnce({ version: 9, name: 'New', nodes, edges: [] });
    expect(await (await fetch(url)).json()).toMatchObject({ canvasEpoch: 'replacement', name: 'New', version: 9 });
    load.mockRejectedValueOnce(Error('CANVAS_TIMEOUT'));
    expect((await fetch(url)).status).toBe(503);
    service.disconnect(owner, 'workspace');
    expect((await fetch(url)).status).toBe(503);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
