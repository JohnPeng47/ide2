import type { WorkspaceBatch } from '../../../domain/mapping/workspace/workspaceRecords';
import { ApplicationError } from '../../core/errors';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import type { MappingWorkspaceRepository } from './repository';

export class MappingWorkspaceService {
  constructor(private readonly projects: Pick<DiagramRepository, 'loadProject'>, private readonly workspace: MappingWorkspaceRepository) { }
  async loadRecords() {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    return this.workspace.loadRecords(project.id);
  }
  async applyBatch(input: WorkspaceBatch) {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    return this.workspace.applyBatch(project.id, input);
  }
  async load() {
    const project = await this.projects.loadProject();
    return project ? this.workspace.load(project.id) : null;
  }
  async save(input: unknown) {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    await this.workspace.save(project.id, input);
    return { saved: true };
  }
}
