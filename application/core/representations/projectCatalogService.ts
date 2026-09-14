import type { SaveProjectedTreeInput } from '../../../domain/core/representations/catalogCommands';
import { ApplicationError } from '../errors';
import type { DiagramRepository } from '../ports/diagramRepository';

export class ProjectCatalogService {
  constructor(private readonly store: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>) { }
  async saveProjection(input: SaveProjectedTreeInput) {
    const project = await this.store.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    return { project, ...await this.store.projectCatalogs.saveProjectedTree(project.id, input) };
  }
  async compactions() {
    const project = await this.store.loadProject();
    if (!project) throw new ApplicationError('conflict', 'project is not initialized');
    return this.store.projectCatalogs.loadCompactionCatalog(project.id);
  }
  async requireProject() {
    const project = await this.store.loadProject();
    if (!project) throw new ApplicationError('conflict', 'project is not initialized');
    return project;
  }
}
