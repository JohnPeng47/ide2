import type { SaveProjectDiagramInput } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { BuiltInDomainProfileId } from '../../../domain/core/profiles/domainProfile';
import type { CorpusAccess } from '../../core/corpus/corpusAccess';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import { assertSafeId } from '../../../domain/core/records/domain';
import { ApplicationError } from '../../core/errors';

export class MappingDiagramService {
  constructor(private readonly projects: Pick<DiagramRepository, 'loadProject' | 'ensureProject' | 'projectCatalogs'>,
    private readonly corpus: CorpusAccess, private readonly root: string,
    private readonly profile: BuiltInDomainProfileId = 'source-code',
    private readonly checkpoints?: { capture(projectId: string, documentId: string, checkpointId: string, version: number): Promise<import('../../../domain/core/diagrams/checkpointPublication').CapturedCheckpoint> }) { }
  async initialize() {
    const project = await this.projects.loadProject() ?? await this.projects.ensureProject({ checkoutRoot: this.root, repositoryIdentity: "", domainProfileId: this.profile });
    return { project, catalog: await this.projects.projectCatalogs.loadRepresentationCatalog(project.id) };
  }
  async save(input: SaveProjectDiagramInput) {
    const project = await this.projects.loadProject() ?? await this.projects.ensureProject({ checkoutRoot: this.root, repositoryIdentity: "", domainProfileId: this.profile });
    return { project, ...await this.projects.projectCatalogs.saveMappingDiagram(project.id, input) };
  }
  async publishCheckpoint(input: import('../../../domain/core/diagrams/checkpointPublication').CheckpointPublication) {
    const project = await this.projects.loadProject();
    if (!project || !this.projects.projectCatalogs.publishCheckpoint || !this.checkpoints) throw Error('WORKSPACE_UNAVAILABLE: checkpoint publication unavailable');
    return this.projects.projectCatalogs.publishCheckpoint(project.id, input, () => this.checkpoints!.capture(project.id, input.documentId, input.checkpointId, input.expectedVersion));
  }
  async delete(representationId: string) {
    assertSafeId(representationId);
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    const catalog = await this.projects.projectCatalogs.archiveRepresentation(project.id, representationId);
    return { project, catalog };
  }
}
