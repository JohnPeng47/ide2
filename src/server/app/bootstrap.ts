import { AgentDiagrammingSessionService } from '../../../application/mapping/agent/sessionService';
import { CanvasSessionBridge } from '../../../infrastructure/mapping/agent/canvasSessionBridge';
import { QuickJsAgentRuntime } from '../../../infrastructure/mapping/agent/execRuntime';
import { CoreApplication } from "../../../application/core/application";
import { FileCompactionService } from "../../../application/mapping/compaction/fileCompactionService";
import { StudioApplication } from "../../../application/studio/application";
import { DiagramSetWorkflow } from '../../../application/studio/collection/diagramSetWorkflow';
import { DatasetService } from '../../../application/studio/datasets/datasetService';
import type { BuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfile";
import { ProjectLanguageService } from '../../../infrastructure/core/language-services/projectLanguageService';

import { DiagramStore } from "../../../infrastructure/core/persistence/store";
import { CodexLocalChatRuntime, FakeLocalChatRuntime } from "../../../infrastructure/mapping/agents/chat/localChatRuntime";
import { FakeFileCompactionRuntime, PiFileCompactionRuntime } from "../../../infrastructure/mapping/agents/compaction/fileCompactionRuntime";
import { FakeMappingAgentRuntime, PiMappingAgentRuntime } from "../../../infrastructure/mapping/agents/selection/agentRuntime";
import { FakeDiagramAgentRuntime, PiDiagramAgentRuntime } from "../../../infrastructure/studio/agents/agentRuntime";
import { DiagramDatasetStore } from "../../../infrastructure/studio/persistence/datasets/diagramDatasetStore";
import { ExperimentCatalog } from "../../../infrastructure/studio/persistence/experiments/experimentCatalog";
import { createCoreRoutes } from "../routes/core/routes";
import { createMappingRoutes } from "../routes/mapping/routes";
import { createStudioRoutes } from "../routes/studio/routes";

import type { CorpusAccess } from '../../../application/core/corpus/corpusAccess';
import { PlanService } from '../../../application/core/plans/planService';
import type { DiagramRepository } from '../../../application/core/ports/diagramRepository';
import { ProjectCatalogService } from '../../../application/core/representations/projectCatalogService';
import { ProjectSourceService } from '../../../application/core/source/projectSource';
import { LocalChatService } from '../../../application/mapping/chat/chatService';
import type { FileCompactionRuntime } from '../../../application/mapping/compaction/agent';
import { MappingDiagramService } from '../../../application/mapping/diagrams/diagramService';
import { SelectionService } from '../../../application/mapping/selection/selectionService';
import { MappingWorkspaceService } from '../../../application/mapping/workspace/workspaceService';
import type { DiagramAgentRuntime } from '../../../application/studio/generation/agent';
import { corpusProvider, readCorpusDocumentLines } from '../../../infrastructure/core/corpus/corpus';
import { discoverDomainCorpus } from '../../../infrastructure/core/persistence/store';
import { resolveFileCompactionSettings } from '../../../infrastructure/mapping/agents/compaction/fileCompactionSettings';
import { loadFileCompactionPrompts } from '../../../infrastructure/mapping/agents/compaction/prompts';
import { FileCompactionStore } from '../../../infrastructure/mapping/persistence/compactionStore';
import { MappingWorkspaceStore } from '../../../infrastructure/mapping/persistence/workspace/mappingWorkspaceStore';

export const corpusAccess: CorpusAccess = {
  provider: corpusProvider, readDocumentLines: readCorpusDocumentLines, discover: discoverDomainCorpus
};

export function createCoreApplication(store: DiagramRepository) {
  return new CoreApplication(store, corpusAccess);
}
export function createStudioApplication(store: DiagramRepository, agents: DiagramAgentRuntime,
  profile: BuiltInDomainProfileId = 'source-code') {
  return new StudioApplication(store, createCoreApplication(store), agents, profile);
}
export function createFileCompactionService(core: CoreApplication, runtime: FileCompactionRuntime) {
  return new FileCompactionService(core, runtime, new FileCompactionStore(core.store.storeRoot), {
    loadPrompts: loadFileCompactionPrompts, resolveAgent: resolveFileCompactionSettings
  });
}

/** The only production module that chooses and connects concrete integrations. */
export function createBackend(projectRoot: string, diagramsDirectory: string, experimentsRoot: string,
  datasetCollectionsRoot: string, configuredDomainProfileId: BuiltInDomainProfileId | undefined,
  mappingPocSourceRoot: string, options: { lspEnabled?: boolean }) {
  const fake = process.env.NEW_DIAGRAM_AGENT === "fake";
  const studioRuntime = fake ? new FakeDiagramAgentRuntime() : new PiDiagramAgentRuntime();
  const chatRuntime = fake ? new FakeLocalChatRuntime() : new CodexLocalChatRuntime();
  const mappingRuntime = fake ? new FakeMappingAgentRuntime() : new PiMappingAgentRuntime();
  const store = new DiagramStore(projectRoot, diagramsDirectory);
  const core = createCoreApplication(store);
  const compactionService = createFileCompactionService(core, fake ? new FakeFileCompactionRuntime() : new PiFileCompactionRuntime());
  const languageService = options.lspEnabled === true ? new ProjectLanguageService() : undefined;
  const studio = createStudioApplication(store, studioRuntime, configuredDomainProfileId ?? "source-code");
  const diagrams = new MappingDiagramService(store, corpusAccess, projectRoot, configuredDomainProfileId);
  const canvasBridge = new CanvasSessionBridge();
  const agent = new AgentDiagrammingSessionService(canvasBridge, diagrams, store, new QuickJsAgentRuntime());
  const routes = {
    core: createCoreRoutes({
      application: core,
      source: new ProjectSourceService(store, corpusAccess, languageService),
      plans: new PlanService(store), catalog: new ProjectCatalogService(store)
    }),
    studio: createStudioRoutes({
      application: studio,
      experimentCatalog: new ExperimentCatalog(experimentsRoot),
      datasetStore: new DatasetService(new DiagramDatasetStore(datasetCollectionsRoot), new ExperimentCatalog(experimentsRoot)),
      creationWorkflow: new DiagramSetWorkflow(studio, configuredDomainProfileId)
    }),
    mapping: createMappingRoutes({
      selection: new SelectionService(store, mappingRuntime, mappingPocSourceRoot),
      diagrams, agent,
      workspace: new MappingWorkspaceService(store, new MappingWorkspaceStore(store.storeRoot)),
      chat: new LocalChatService(store, corpusAccess, chatRuntime, mappingPocSourceRoot),
      compactionService
    })
  };
  return {
    routes, recover: () => studio.recoverInterruptedRuns(), dispose() {
      canvasBridge.dispose(); languageService?.dispose(); studio.dispose(); mappingRuntime.dispose(); chatRuntime.dispose(); compactionService.dispose();
    }
  };
}
