import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { CanvasSessionBridge } from '../../../../../infrastructure/mapping/agent/canvasSessionBridge';
import type { AgentDiagrammingSessionService } from '../../../../../application/mapping/agent/sessionService';
import { handleAgentRoutes } from '../agentRoutes';

it('roundtrips stable scope metadata while unregistering only the named instance', async () => {
  const bridge = new CanvasSessionBridge();
  const service = { bridge } as unknown as AgentDiagrammingSessionService;
  const server = createServer((req, res) => void handleAgentRoutes(req, res, new URL(req.url!, 'http://localhost'), service));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/agent/canvases`;
  const before = '00000000-0000-4000-8000-000000000001', after = '00000000-0000-4000-8000-000000000002';
  const scope = { stableWorkspaceId: '00000000-0000-4000-8000-000000000003', projectId: 'project', documents: [{ documentId: 'doc', name: 'Test' }] };
  try {
    for (const canvasId of [before, after]) {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ canvasId, ...scope }) });
      expect(response.status).toBe(200);
    }
    expect(await (await fetch(url)).json()).toHaveLength(2);
    expect((await fetch(`${url}/${before}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await fetch(url)).json()).toEqual([{ canvasId: after, ...scope }]);
    const invalid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvasId: before, ...scope, stableWorkspaceId: 'not-a-uuid' }) });
    expect(invalid.status).toBe(400);
  } finally {
    bridge.dispose(); server.closeAllConnections(); server.close(); await once(server, 'close');
  }
});
