import { GenerationCanvasBridge } from '../../../application/mapping/agent-chat/generationCanvasBridge';
import { CompareSessionService } from '../../../application/mapping/compare/compareSessionService';
import { FileCompareSessionStore } from '../../../infrastructure/mapping/compare/fileCompareSessionStore';
import { WorkspaceRecordStore } from '../../../infrastructure/mapping/persistence/workspace/workspaceRecordStore';
import { MappingChatMcpBinding } from '../../../infrastructure/mapping/agent-chat/chatMcpBinding';
import { AgentChatService } from '../../../application/mapping/agent-chat/agentChatService';
import { ChatDiagramTools } from '../../../application/mapping/agent-chat/chatDiagramTools';
import { StdioCodexConnection } from '../../../infrastructure/mapping/agent-chat/codexConnection';
import { FileChatStore } from '../../../infrastructure/mapping/agent-chat/chatStore';
import { PushIntegrationService } from '../../../application/core/integrations/pushIntegrationService';
import { FilePushIntegrationStore } from '../../../infrastructure/core/integrations/pushIntegrationStore';
import { GitPushSource } from '../../../infrastructure/core/integrations/gitPushSource';
import { CanvasApiProjection } from '../../../application/mapping/agent/apiProjection';
import { AgentContextService } from '../../../application/mapping/agent/agentContextService';
import { LiveCanvasService } from '../../../application/mapping/agent/liveCanvasService';

import { FakeDiagramEditRuntime, PiDiagramEditRuntime } from '../../../infrastructure/mapping/agents/diagram-edit/diagramEditRuntime';
import { CoreApplication } from "../../../application/core/application";
import { AgentDiagrammingSessionService } from '../../../application/mapping/agent/sessionService';
import { ChangeSessionService } from '../../../application/mapping/changes/changeSessionService';
import { FileCompactionService } from "../../../application/mapping/compaction/fileCompactionService";
import type { BuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfile";
import { ProjectLanguageService } from '../../../infrastructure/core/language-services/projectLanguageService';
import { CanvasSessionBridge } from '../../../infrastructure/mapping/agent/canvasSessionBridge';
import { QuickJsAgentRuntime } from '../../../infrastructure/mapping/agent/execRuntime';
import { DiagramChangeSessionStore } from '../../../infrastructure/mapping/changes/diagramChangeSessionStore';

import { DiagramStore } from "../../../infrastructure/core/persistence/store";
import { FileDiagramAgentContextStore } from '../../../infrastructure/core/persistence/fileDiagramAgentContextStore';
import { CodexLocalChatRuntime, FakeLocalChatRuntime } from "../../../infrastructure/mapping/agents/chat/localChatRuntime";
import { FakeFileCompactionRuntime, PiFileCompactionRuntime } from "../../../infrastructure/mapping/agents/compaction/fileCompactionRuntime";
import { FakeMappingAgentRuntime, PiMappingAgentRuntime } from "../../../infrastructure/mapping/agents/selection/agentRuntime";
import { createCoreRoutes } from "../routes/core/routes";
import { createMappingRoutes } from "../routes/mapping/routes";

import type { CorpusAccess } from '../../../application/core/corpus/corpusAccess';
import type { DiagramRepository } from '../../../application/core/ports/diagramRepository';
import { ProjectCatalogService } from '../../../application/core/representations/projectCatalogService';
import { ProjectSourceService } from '../../../application/core/source/projectSource';
import { LocalChatService } from '../../../application/mapping/chat/chatService';
import type { FileCompactionRuntime } from '../../../application/mapping/compaction/agent';
import { MappingDiagramService } from '../../../application/mapping/diagrams/diagramService';
import { SelectionService } from '../../../application/mapping/selection/selectionService';
import { MappingWorkspaceService } from '../../../application/mapping/workspace/workspaceService';
import { corpusProvider, readCorpusDocumentLines } from '../../../infrastructure/core/corpus/corpus';
import { discoverDomainCorpus } from '../../../infrastructure/core/persistence/store';
import { resolveFileCompactionSettings } from '../../../infrastructure/mapping/agents/compaction/fileCompactionSettings';
import { loadFileCompactionPrompts } from '../../../infrastructure/mapping/agents/compaction/prompts';
import { FileCompactionStore } from '../../../infrastructure/mapping/persistence/compactionStore';
import { MappingWorkspaceStore } from '../../../infrastructure/mapping/persistence/workspace/mappingWorkspaceStore';
import { DiffSessionWorkflowService } from '../../../application/mapping/changes/diffSessionWorkflowService';
import { PiDiffSessionRuntime } from '../../../infrastructure/mapping/agents/diff-session-create/diffSessionRuntime';
import { FileDiffSessionRunStore, loadDiffSessionPrompts, createDiffSessionSourceReader } from '../../../infrastructure/mapping/agents/diff-session-create/diffSessionStorage';

export const corpusAccess: CorpusAccess = {
  provider: corpusProvider, readDocumentLines: readCorpusDocumentLines, discover: discoverDomainCorpus
};

export function createCoreApplication(store: DiagramRepository) {
  return new CoreApplication(store, corpusAccess);
}
export function createFileCompactionService(core: CoreApplication, runtime: FileCompactionRuntime) {
  return new FileCompactionService(core, runtime, new FileCompactionStore(core.store.storeRoot), {
    loadPrompts: loadFileCompactionPrompts, resolveAgent: resolveFileCompactionSettings
  });
}

/** The only production module that chooses and connects concrete integrations. */
export function createBackend(projectRoot: string, diagramsDirectory: string, configuredDomainProfileId: BuiltInDomainProfileId | undefined,
  mappingPocSourceRoot: string, options: { lspEnabled?: boolean; piEnabled?: boolean }) {
  const fake = process.env.NEW_DIAGRAM_AGENT === "fake";
  const chatRuntime = fake ? new FakeLocalChatRuntime() : new CodexLocalChatRuntime(options.piEnabled === true);
  const mappingRuntime = fake ? new FakeMappingAgentRuntime() : new PiMappingAgentRuntime(options.piEnabled === true);
  const diagramEditRuntime = fake ? new FakeDiagramEditRuntime() : new PiDiagramEditRuntime(mappingPocSourceRoot, options.piEnabled === true);
  const store = new DiagramStore(projectRoot, diagramsDirectory);
  const core = createCoreApplication(store);
  const compactionService = createFileCompactionService(core, fake ? new FakeFileCompactionRuntime() : new PiFileCompactionRuntime(options.piEnabled === true));
  const languageService = options.lspEnabled === true ? new ProjectLanguageService() : undefined;
  const diagrams = new MappingDiagramService(store, corpusAccess, projectRoot, configuredDomainProfileId, new WorkspaceRecordStore(store.storeRoot));
  const canvasBridge = new GenerationCanvasBridge(new CanvasSessionBridge());
  const agentContexts = new AgentContextService();
  const diagramContextStore = new FileDiagramAgentContextStore(store.storeRoot);
  const apiProjection = new CanvasApiProjection();
  const liveCanvas = new LiveCanvasService(() => canvasBridge.list(), async (workspaceInstanceId, documentId) =>
    await canvasBridge.dispatch(workspaceInstanceId, { method: 'context', documentId }) as import('../../../domain/mapping/agent/liveCanvasStatus').LiveCanvasContext, agentContexts, apiProjection);
  const changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot, undefined, true), store, canvasBridge);
  const agent = new AgentDiagrammingSessionService(canvasBridge, diagrams, store, new QuickJsAgentRuntime(),
    changes, diagramEditRuntime, agentContexts, apiProjection, diagramContextStore);
  const agentChat = new AgentChatService(new StdioCodexConnection(mappingPocSourceRoot, options.piEnabled === true), new FileChatStore(store.storeRoot), mappingPocSourceRoot, liveCanvas, new ChatDiagramTools(agent), new MappingChatMcpBinding(agent, process.cwd()), canvasBridge);
  const diffSessionWorkflows = new DiffSessionWorkflowService(changes, agent, new PiDiffSessionRuntime(options.piEnabled === true),
    new FileDiffSessionRunStore(store.storeRoot), { enabled: options.piEnabled === true, sourceRoot: mappingPocSourceRoot,
      loadPrompts: loadDiffSessionPrompts, sourceReader: capture => createDiffSessionSourceReader(store.repositories, capture) });
  const pushIntegrations = new PushIntegrationService(new FilePushIntegrationStore(store.storeRoot),
    new GitPushSource(store.repositories), diffSessionWorkflows, options.piEnabled === true);
  const workspace = new MappingWorkspaceService(store, new MappingWorkspaceStore(store.storeRoot, store.diagramPersistence), diagramContextStore);
  const compareSessions = new CompareSessionService(workspace, new FileCompareSessionStore(store.storeRoot));
  const routes = {
    core: createCoreRoutes({
      application: core,
      source: new ProjectSourceService(store, corpusAccess, languageService),
      catalog: new ProjectCatalogService(store)
    }),
    mapping: createMappingRoutes({
      selection: new SelectionService(store, mappingRuntime, mappingPocSourceRoot),
      diagrams, agent, agentChat, liveCanvas, diffSessionWorkflows, pushIntegrations, pushToken: process.env.NEW_DIAGRAM_PUSH_TOKEN,
      workspace, compareSessions,
      chat: new LocalChatService(store, corpusAccess, chatRuntime, mappingPocSourceRoot),
      compactionService
    })
  };
  return {
    routes, liveCanvas, diffSessionWorkflows, pushIntegrations, dispose() {
      agentChat.dispose();
      diffSessionWorkflows.dispose();
      agent.dispose(); diagramEditRuntime.dispose(); canvasBridge.dispose(); languageService?.dispose(); mappingRuntime.dispose(); chatRuntime.dispose(); compactionService.dispose();
    }
  };
}
