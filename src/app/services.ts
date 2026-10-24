import { DefaultCanvasHistoryService } from '../../domain/core/diagrams/canvasHistoryService';
import { httpDiagramGenerator } from '../features/mapping/services/diagramGenerator';
import { WorkspaceStorage } from '../features/mapping/workspace/workspaceStorage';

import { createHttpCodeRepoService } from '../shared/http/codeRepoService';
import type { MappingServices } from '../features/mapping/services/MappingServices';

export function createMappingServices(): MappingServices {
  return { canvasHistory: new DefaultCanvasHistoryService('current'), diagramGenerator: httpDiagramGenerator, codeRepo: createHttpCodeRepoService(), workspaceStorage: new WorkspaceStorage() };
}
