import type { AgentChatService } from '../../../../application/mapping/agent-chat/agentChatService';
import { handleAgentChat } from './agent-chat/agentChatRoutes';
import type { LiveCanvasService } from '../../../../application/mapping/agent/liveCanvasService';
import { readLiveSelection, readShortContext } from './liveCanvasRoutes';
import type { WorkspaceBatch } from '../../../../domain/mapping/workspace/workspaceRecords';
import type { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { handleAgentRoutes } from './agentRoutes';

import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { LocalChatService } from '../../../../application/mapping/chat/chatService';
import type { FileCompactionService } from '../../../../application/mapping/compaction/fileCompactionService';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import type { SelectionService } from '../../../../application/mapping/selection/selectionService';
import type { MappingWorkspaceService } from '../../../../application/mapping/workspace/workspaceService';
import type { SaveProjectDiagramInput } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { readBody, sendEvent, sendJson } from '../../http/http';
import { handleLocalChat } from './chat/localChatRoutes';
import { handleFileCompaction } from './compaction/fileCompactionRoutes';
import type { DiffSessionWorkflowService } from '../../../../application/mapping/changes/diffSessionWorkflowService';
import { handleDiffSessionWorkflow } from './changes/diffSessionWorkflowRoutes';

export function createMappingRoutes({ selection, diagrams, workspace, chat, compactionService, agent, agentChat, liveCanvas, diffSessionWorkflows }: {
  agentChat?: AgentChatService;
  diffSessionWorkflows?: DiffSessionWorkflowService;
  agent?: AgentDiagrammingSessionService; liveCanvas?: LiveCanvasService;
  selection: SelectionService; diagrams: MappingDiagramService; workspace: MappingWorkspaceService;
  chat: LocalChatService; compactionService: FileCompactionService;
}) {
  return async (request: Connect.IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
    if (url.pathname.startsWith('/api/mapping/agent-chat/') && agentChat) return handleAgentChat(request, response, url, agentChat);
    if (url.pathname.startsWith('/api/mapping/workflows/diff-session-create') && diffSessionWorkflows)
      return handleDiffSessionWorkflow(request, response, url, diffSessionWorkflows);
    if (url.pathname === '/api/mapping/live/context/short' && liveCanvas) return readShortContext(request, response, url, liveCanvas);
    const selectionRead = url.pathname.match(/^\/api\/mapping\/live\/connections\/([^/]+)\/selection$/);
    if (selectionRead && liveCanvas) return readLiveSelection(request, response, decodeURIComponent(selectionRead[1]), liveCanvas);
    if (url.pathname.startsWith('/api/mapping/agent/') && agent) return handleAgentRoutes(request, response, url, agent);
    if (url.pathname === '/api/mapping/compactions' || url.pathname.startsWith('/api/mapping/compactions/')) {
      return handleFileCompaction(request, response, url, compactionService);
    }
    if (url.pathname === '/api/mapping/workspace/records') {
      if (request.method === 'GET') return sendJson(response, 200, await workspace.loadRecords(url.searchParams.get('history') === 'current' ? 'current' : 'all'));
      if (request.method === 'POST') return sendJson(response, 200, await workspace.applyBatch(await readBody(request, 64 * 1024 * 1024) as WorkspaceBatch));
      return sendJson(response, 405, { error: 'method not allowed' });
    }
    if (url.pathname === '/api/mapping/workspace') {
      if (request.method === 'GET') return sendJson(response, 200, await workspace.load());
      if (request.method !== 'PUT') return sendJson(response, 405, { error: 'method not allowed' });
      // Workspace saves include revision histories and captured source evidence.
      return sendJson(response, 200, await workspace.save(await readBody(request, 64 * 1024 * 1024)));
    }
    if (url.pathname === '/api/mapping/chat') return handleLocalChat(request, response, chat);
    if (url.pathname === '/api/mapping/diagrams/publish' && request.method === 'POST')
      return sendJson(response, 200, await diagrams.publishCheckpoint(await readBody(request) as import('../../../../domain/core/diagrams/checkpointPublication').CheckpointPublication));
    if (url.pathname === '/api/mapping/diagrams') {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 200, await diagrams.save(await readBody(request) as SaveProjectDiagramInput));
    }
    const diagram = url.pathname.match(/^\/api\/mapping\/diagrams\/([^/]+)$/);
    if (diagram) {
      if (request.method !== 'DELETE') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 200, await diagrams.delete(decodeURIComponent(diagram[1])));
    }
    if (url.pathname === '/api/mapping/prompt') {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' });
      const input = await selection.prepare(await readBody(request) as Record<string, unknown>);
      response.statusCode = 200;
      response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      response.setHeader('cache-control', 'no-cache, no-transform');
      response.flushHeaders();
      const result = await selection.run(input, event => sendEvent(response, { type: 'progress', ...event }));
      sendEvent(response, { type: 'result', result });
      response.end();
      return;
    }
    return sendJson(response, 404, { error: 'API route not found' });
  };
}
