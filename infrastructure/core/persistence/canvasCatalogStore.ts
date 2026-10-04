import { inferRepositoryId } from '../../../domain/core/repositories/repository';
import type { ProjectRecord } from '../../../domain/core/records/domain';
import { DefaultCanvasHistoryService } from '../../../domain/core/diagrams/canvasHistoryService';
import { assertDiagramStorageFormat } from './diagramStorageFormat';
import path from 'node:path';
import type { AcceptCanvasChangesInput, ChangeSessionAcceptance } from '../../../domain/core/representations/changeAcceptance';
import { documentFromRevision, historyFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { ProjectProjectionRecord } from '../../../domain/core/diagrams/diagramProjection';
import type { SaveProjectDiagramInput } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { SaveProjectedTreeInput } from '../../../domain/core/representations/catalogCommands';
import type { ProjectRepresentationCatalogRecord } from '../../../domain/core/representations/projectCatalog';
import * as rules from '../../../domain/core/representations/catalogRules';
import { DiagramPersistence } from '../../../domain/core/diagrams/diagramPersistence';
import { DiagramRevisionStore } from './diagramRevisionStore';
import { readJsonIfExists, writeJsonAtomic, emptyRepresentationCatalog, catalogEnvironment } from './catalogPersistence';

/** Canvas catalog owns composition/publication. DiagramService owns diagram persistence. */
export class CanvasCatalogStore {
  private readonly historyService = new DefaultCanvasHistoryService();
  constructor(readonly storeRoot: string,
    protected readonly diagramPersistence: DiagramPersistence = new DiagramPersistence(new DiagramRevisionStore(storeRoot))) {}

  private representationWrite: Promise<unknown> = Promise.resolve();
  private serialize<T>(write: () => Promise<T>): Promise<T> {
    const result = this.representationWrite.then(write);
    this.representationWrite = result.catch(() => undefined);
    return result;
  }

  saveProjection(projectId: string, projection: ProjectProjectionRecord) {
    return this.serialize(async () => {
      const catalog = await this.readRepresentationCatalog(projectId);
      const result = rules.saveProjection(catalog, projectId, projection, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  /** Persist the generated tree and its relationship in one catalog write. */
  saveProjectedTree(projectId: string, input: SaveProjectedTreeInput) {
    return this.serialize(async () => {
      const catalog = await this.readRepresentationCatalog(projectId);
      const result = rules.saveProjectedTree(catalog, projectId, input, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  saveMappingDiagram(projectId: string, input: SaveProjectDiagramInput) {
    return this.serialize(async () => {
      const catalog = await this.readRepresentationCatalog(projectId);
      const project = await readJsonIfExists<ProjectRecord>(path.join(this.storeRoot, 'project.json'));
      const current = input.representationId ? catalog.representations[input.representationId] : undefined;
      const copied = input.sourceRevisionId ? catalog.representations[catalog.revisions[input.sourceRevisionId]?.representationId]?.repositoryId : undefined;
      const repositoryId = input.repositoryId ?? current?.repositoryId ?? copied ?? (!current ? inferRepositoryId(input.scene, project?.repositories ?? []) : undefined);
      if (repositoryId && !project?.repositories?.some(repo => repo.id === repositoryId)) throw Error('Unknown repositoryId');
      if (!current && project?.repositories?.length && !repositoryId) throw Error('Specify repositoryId for the new canvas');
      const result = rules.saveMappingDiagram(catalog, projectId, { ...input, repositoryId }, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  acceptCanvasChanges(projectId: string, input: AcceptCanvasChangesInput): Promise<ChangeSessionAcceptance> {
    return this.serialize(async () => {
      let catalog = await this.readRepresentationCatalog(projectId);
      const prior = catalog.changeSessionAcceptances?.[input.changeSessionId];
      if (prior) {
        if (prior.requestId !== input.requestId || prior.sessionVersion !== input.sessionVersion)
          throw new Error('REQUEST_ID_CONFLICT: proposal already accepted');
        return prior;
      }
      if (!input.documents.length || new Set(input.documents.map(d => d.documentId)).size !== input.documents.length)
        throw new Error('Acceptance requires distinct changed documents');
      const targets = input.documents.flatMap(d => d.representationId ? [d.representationId] : []);
      if (new Set(targets).size !== targets.length) throw new Error('Duplicate acceptance target');
      const acceptance: ChangeSessionAcceptance = { changeSessionId: input.changeSessionId, sessionVersion: input.sessionVersion,
        requestId: input.requestId, acceptedAt: new Date().toISOString(), changeIds: [...input.changeIds], documents: [] };
      for (const doc of input.documents) {
        const project = await readJsonIfExists<ProjectRecord>(path.join(this.storeRoot, 'project.json'));
        if (doc.repositoryId && !project?.repositories?.some(repo => repo.id === doc.repositoryId)) throw Error('Unknown repositoryId');
        const current = doc.representationId ? catalog.representations[doc.representationId] : undefined;
        if (doc.representationId && (!current || current.status !== 'settled' || current.currentRevisionId !== doc.expectedRevisionId))
          throw new Error('VERSION_CONFLICT: original canvas changed; create a new proposal');
        const proposed = this.historyService.openContext(doc.document, doc.history.snapshots[doc.history.headId].view, doc.history);
        let history = this.historyService.forkContext(proposed, doc.history.snapshots[doc.history.headId].view);
        let before: ChangeSessionAcceptance['documents'][number]['before'] = null;
        if (current) {
          const revision = catalog.revisions[current.currentRevisionId], saved = historyFromRevision(revision);
          const context = this.historyService.openContext(documentFromRevision(revision), saved?.snapshots[saved.headId].view ?? {}, saved);
          before = { revisionId: revision.id, checkpointId: this.historyService.state(context).checkpointId };
          this.historyService.adopt(context, doc.history);
          history = this.historyService.exportContext(context);
        }
        const result = rules.saveMappingDiagram(catalog, projectId, { name: doc.name, repositoryId: doc.repositoryId, representationId: doc.representationId,
          expectedRevisionId: doc.expectedRevisionId, scene: doc.document.scene, edges: doc.document.edges, history }, catalogEnvironment());
        catalog = result.catalog;
        acceptance.documents.push({ documentId: doc.documentId, representationId: result.representation.id, before,
          after: { revisionId: result.representation.currentRevisionId, checkpointId: history.headId }, proposedCheckpointId: doc.history.headId });
      }
      catalog = { ...catalog, changeSessionAcceptances: { ...catalog.changeSessionAcceptances, [input.changeSessionId]: acceptance } };
      // A failure before this write publishes none of the canvases. The receipt and
      // all new heads become visible in the same atomic catalog replacement.
      await this.saveRepresentationCatalog(catalog);
      return acceptance;
    });
  }

  private representationCatalogPath(): string {
    return path.join(this.storeRoot, 'canvases', 'catalog.json');
  }

  private async readStoredCatalog(projectId: string) {
    const raw = await readJsonIfExists<ProjectRepresentationCatalogRecord>(this.representationCatalogPath())
      ?? await readJsonIfExists<ProjectRepresentationCatalogRecord>(path.join(this.storeRoot, 'representations', 'catalog.json'));
    if (raw && raw.projectId !== projectId) throw new Error('representation catalog belongs to another Project');
    return raw;
  }

  /** Publication receipts contain no diagram references; listing proposals needs no restored catalog. */
  async loadChangeSessionAcceptances(projectId: string) {
    return (await this.readStoredCatalog(projectId))?.changeSessionAcceptances ?? {};
  }

  loadRepresentationCatalog(projectId: string, historyValidation: import('../../../domain/core/diagrams/canvasHistory').HistoryValidation = 'all'): Promise<ProjectRepresentationCatalogRecord> {
    return this.serialize(() => this.readRepresentationCatalog(projectId, historyValidation));
  }

  private async readRepresentationCatalog(projectId: string, historyValidation: import('../../../domain/core/diagrams/canvasHistory').HistoryValidation = 'all'): Promise<ProjectRepresentationCatalogRecord> {
    await assertDiagramStorageFormat(this.storeRoot);
    const raw = await this.readStoredCatalog(projectId);
    const stored = raw == null ? null : await this.diagramPersistence.restore<ProjectRepresentationCatalogRecord>(raw, historyValidation);
    if (!stored) return emptyRepresentationCatalog(projectId);
    if (stored.projectId !== projectId) {
      throw new Error("representation catalog belongs to another Project");
    }
    for (const revision of Object.values(stored.revisions)) if (revision.content?.kind !== 'canvas-history')
      throw new Error('Unsupported legacy diagram content: canvas history is required');
    if (!stored.repositoryOwnershipVersion && Object.keys(stored.representations).length) {
      const project = await readJsonIfExists<ProjectRecord>(path.join(this.storeRoot, 'project.json'));
      if (project?.repositories?.length) {
        for (const representation of Object.values(stored.representations)) {
          const revision = stored.revisions[representation.currentRevisionId];
          if (!representation.repositoryId && revision) representation.repositoryId = inferRepositoryId(documentFromRevision(revision).scene, project.repositories);
        }
        stored.repositoryOwnershipVersion = 1;
        await this.saveRepresentationCatalog(stored);
      }
    }
    return stored;
  }

  async saveRepresentationCatalog(catalog: ProjectRepresentationCatalogRecord): Promise<void> {
    await writeJsonAtomic(this.representationCatalogPath(), await this.diagramPersistence.persist(catalog));
  }

  archiveRepresentation(projectId: string, representationId: string) {
    return this.serialize(() => this.archiveRepresentationUnlocked(projectId, representationId));
  }

  private async archiveRepresentationUnlocked(
    projectId: string,
    representationId: string
  ): Promise<ProjectRepresentationCatalogRecord> {
    const catalog = await this.readRepresentationCatalog(projectId);
    const result = rules.archiveRepresentation(catalog, projectId, representationId, catalogEnvironment());
    if (result !== catalog) await this.saveRepresentationCatalog(result);
    return result;
  }
}
