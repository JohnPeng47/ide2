import { DefaultCanvasHistoryService } from '../../domain/core/diagrams/canvasHistoryService';
import { httpDiagramGenerator } from '../features/mapping/services/diagramGenerator';
import { WorkspaceStorage } from '../features/mapping/workspace/workspaceStorage';
import { RevisionedDiagramService } from '../../domain/core/diagrams/diagramService';
import type { CodeRepoService } from '../../domain/core/source/codeRepoService';
import type { MappingServices } from '../features/mapping/services/MappingServices';

const unavailable = async (): Promise<never> => { throw new Error('CodeRepoService is not connected yet'); };
/** Intentionally unwired. Existing source navigation continues using its current APIs. */
export const unconnectedCodeRepoService: CodeRepoService = {
  available: false,
  readFile: unavailable, listDirectory: unavailable, search: unavailable, definitions: unavailable,
  git: { resolveCommit: unavailable, listCommits: unavailable, changedFiles: unavailable, diff: unavailable, readFileAt: unavailable }
};
export function createMappingServices(): MappingServices {
  return { canvasHistory: new DefaultCanvasHistoryService(), diagrams: new RevisionedDiagramService(httpDiagramGenerator), workspaceStorage: new WorkspaceStorage(), codeRepo: unconnectedCodeRepoService };
}
