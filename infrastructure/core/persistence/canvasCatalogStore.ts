import path from 'node:path';
import type { ProjectProjectionRecord } from '../../../domain/core/diagrams/diagramProjection';
import type { SaveProjectDiagramInput } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { SaveProjectedTreeInput } from '../../../domain/core/representations/catalogCommands';
import type { ProjectRepresentationCatalogRecord } from '../../../domain/core/representations/projectCatalog';
import * as rules from '../../../domain/core/representations/catalogRules';
import { RevisionedDiagramService, type DiagramService } from '../../../domain/core/diagrams/diagramService';
import { DiagramRevisionStore } from './diagramRevisionStore';
import { readJsonIfExists, writeJsonAtomic, emptyRepresentationCatalog, catalogEnvironment } from './catalogPersistence';

/** Canvas catalog owns composition/publication. DiagramService owns diagram persistence. */
export class CanvasCatalogStore {
  constructor(readonly storeRoot: string,
    protected readonly diagrams: DiagramService = new RevisionedDiagramService(new DiagramRevisionStore(storeRoot))) {}

  private representationWrite: Promise<unknown> = Promise.resolve();
  private serialize<T>(write: () => Promise<T>): Promise<T> {
    const result = this.representationWrite.then(write);
    this.representationWrite = result.catch(() => undefined);
    return result;
  }

  saveProjection(projectId: string, projection: ProjectProjectionRecord) {
    return this.serialize(async () => {
      const catalog = await this.loadRepresentationCatalog(projectId);
      const result = rules.saveProjection(catalog, projectId, projection, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  /** Persist the generated tree and its relationship in one catalog write. */
  saveProjectedTree(projectId: string, input: SaveProjectedTreeInput) {
    return this.serialize(async () => {
      const catalog = await this.loadRepresentationCatalog(projectId);
      const result = rules.saveProjectedTree(catalog, projectId, input, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  saveMappingDiagram(projectId: string, input: SaveProjectDiagramInput) {
    return this.serialize(async () => {
      const catalog = await this.loadRepresentationCatalog(projectId);
      const result = rules.saveMappingDiagram(catalog, projectId, input, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  private representationCatalogPath(): string {
    return path.join(this.storeRoot, 'canvases', 'catalog.json');
  }

  async loadRepresentationCatalog(projectId: string): Promise<ProjectRepresentationCatalogRecord> {
    const raw = await readJsonIfExists<unknown>(this.representationCatalogPath())
      ?? await readJsonIfExists<unknown>(path.join(this.storeRoot, 'representations', 'catalog.json'));
    const stored = raw == null ? null : await this.diagrams.restore<ProjectRepresentationCatalogRecord>(raw);
    if (!stored) return emptyRepresentationCatalog(projectId);
    if (stored.projectId !== projectId) {
      throw new Error("representation catalog belongs to another Project");
    }
    return {
      ...stored, revisions: Object.fromEntries(Object.entries(stored.revisions).map(([id, revision]) => [id,
        { ...revision, content: revision.content ?? { kind: "ascii" as const, ascii: revision.ascii } }
      ]))
    };
  }

  async saveRepresentationCatalog(catalog: ProjectRepresentationCatalogRecord): Promise<void> {
    await writeJsonAtomic(this.representationCatalogPath(), await this.diagrams.persist(catalog));
  }

  archiveRepresentation(projectId: string, representationId: string) {
    return this.serialize(() => this.archiveRepresentationUnlocked(projectId, representationId));
  }

  private async archiveRepresentationUnlocked(
    projectId: string,
    representationId: string
  ): Promise<ProjectRepresentationCatalogRecord> {
    const catalog = await this.loadRepresentationCatalog(projectId);
    const result = rules.archiveRepresentation(catalog, projectId, representationId, catalogEnvironment());
    if (result !== catalog) await this.saveRepresentationCatalog(result);
    return result;
  }
}
