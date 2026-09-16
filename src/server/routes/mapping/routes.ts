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

export function createMappingRoutes({ selection, diagrams, workspace, chat, compactionService, agent }: {
  agent?: AgentDiagrammingSessionService;
  selection: SelectionService; diagrams: MappingDiagramService; workspace: MappingWorkspaceService;
  chat: LocalChatService; compactionService: FileCompactionService;
}) {
  return async (request: Connect.IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
    if (url.pathname.startsWith('/api/mapping/agent/') && agent) return handleAgentRoutes(request, response, url, agent);
    if (url.pathname === '/api/mapping/compactions' || url.pathname.startsWith('/api/mapping/compactions/')) {
      return handleFileCompaction(request, response, url, compactionService);
    }
    if (url.pathname === '/api/mapping/workspace') {
      if (request.method === 'GET') return sendJson(response, 200, await workspace.load());
      if (request.method !== 'PUT') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 200, await workspace.save(await readBody(request)));
    }
    if (url.pathname === '/api/mapping/chat') return handleLocalChat(request, response, chat);
    if (url.pathname === '/api/mapping/diagrams') {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 200, await diagrams.save(await readBody(request) as SaveProjectDiagramInput));
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
