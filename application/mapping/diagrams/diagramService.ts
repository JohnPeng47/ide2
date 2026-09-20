import type { SaveProjectDiagramInput } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { BuiltInDomainProfileId } from '../../../domain/core/profiles/domainProfile';
import type { CorpusAccess } from '../../core/corpus/corpusAccess';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import { assertSafeId } from '../../../domain/core/records/domain';
import { ApplicationError } from '../../core/errors';

export class MappingDiagramService {
  constructor(private readonly projects: Pick<DiagramRepository, 'loadProject' | 'ensureProject' | 'projectCatalogs'>,
    private readonly corpus: CorpusAccess, private readonly root: string,
    private readonly profile: BuiltInDomainProfileId = 'source-code') { }
  async initialize() {
    const project = await this.projects.loadProject() ?? await this.projects.ensureProject({ checkoutRoot: this.root, repositoryIdentity: "", domainProfileId: this.profile });
    return { project, catalog: await this.projects.projectCatalogs.loadRepresentationCatalog(project.id) };
  }
  async save(input: SaveProjectDiagramInput) {
    const project = await this.projects.loadProject() ?? await this.projects.ensureProject({ checkoutRoot: this.root, repositoryIdentity: "", domainProfileId: this.profile });
    return { project, ...await this.projects.projectCatalogs.saveMappingDiagram(project.id, input) };
  }
  async delete(representationId: string) {
    assertSafeId(representationId);
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    const catalog = await this.projects.projectCatalogs.archiveRepresentation(project.id, representationId);
    return { project, catalog };
  }
}
