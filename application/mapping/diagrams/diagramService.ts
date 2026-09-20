import type { SaveProjectDiagramInput } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { BuiltInDomainProfileId } from '../../../domain/core/profiles/domainProfile';
import type { CorpusAccess } from '../../core/corpus/corpusAccess';
import type { DiagramRepository } from '../../core/ports/diagramRepository';

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
}
