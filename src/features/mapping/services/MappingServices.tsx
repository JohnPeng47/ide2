import type { CanvasHistoryService } from '../../../../domain/core/diagrams/canvasHistoryService';
import type { WorkspaceStorage } from '../workspace/workspaceStorage';
import { createContext, useContext } from 'react';
import type { DiagramService } from '../../../../domain/core/diagrams/diagramService';
import type { CodeRepoService } from '../../../../domain/core/source/codeRepoService';

export interface MappingServices { diagrams: DiagramService; canvasHistory: CanvasHistoryService; codeRepo: CodeRepoService; workspaceStorage?: WorkspaceStorage }
export const MappingServicesContext = createContext<MappingServices | null>(null);
export function useMappingServices(): MappingServices {
  const services = useContext(MappingServicesContext);
  if (!services) throw new Error('Mapping services must be injected by MappingPocPage');
  return services;
}
