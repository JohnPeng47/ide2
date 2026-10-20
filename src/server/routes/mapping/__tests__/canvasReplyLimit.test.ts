import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { CanvasSessionBridge } from '../../../../../infrastructure/mapping/agent/canvasSessionBridge';
import { handleAgentRoutes } from '../agentRoutes';
import type { AgentDiagrammingSessionService } from '../../../../../application/mapping/agent/sessionService';

it('returns HTTP 413 and rejects the pending command immediately for an oversized legacy browser reply', async () => {
  const bridge = new CanvasSessionBridge();
  bridge.register({ canvasId: 'browser', documents: [] });
  const service = { bridge } as unknown as AgentDiagrammingSessionService;
  const server = createServer((request, response) => { void handleAgentRoutes(request, response, new URL(request.url!, 'http://localhost'), service); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const pending = bridge.dispatch('browser', { method: 'snapshot' });
    const rejected = expect(pending).rejects.toThrow('CANVAS_REPLY_REJECTED');
    const [command] = await bridge.poll('browser');
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/mapping/agent/canvases/browser/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-canvas-command-id': command.id },
      body: JSON.stringify({ commandId: command.id, value: 'x'.repeat(65 * 1024 * 1024) })
    });
    expect(response.status).toBe(413); await rejected;
  } finally { bridge.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 10_000);
