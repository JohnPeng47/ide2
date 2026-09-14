import type { MappingWorkspaceSnapshot } from '../../../domain/mapping/workspace/mappingWorkspace';

export interface MappingWorkspaceRepository {
  load(projectId: string): Promise<MappingWorkspaceSnapshot | null>;
  save(projectId: string, input: unknown): Promise<void>;
}
