import path from 'node:path';
import { CanvasCatalogStore } from './canvasCatalogStore';
import { readJsonIfExists, writeJsonAtomic, emptyCompactionCatalog, catalogEnvironment } from './catalogPersistence';
import * as rules from '../../../domain/core/representations/catalogRules';
import type { ProjectCorpusCompactionCatalogRecord, ProjectFileCompactionInput, ProjectFileCompactionRecord } from '../../../domain/core/representations/projectCatalog';
export type { SaveProjectedTreeInput } from '../../../domain/core/representations/catalogCommands';
export { ProjectDiagramConflict } from '../../../domain/core/representations/errors';

/** Compatibility facade for callers that also use the corpus compaction catalog. */
export class ProjectCatalogStore extends CanvasCatalogStore {
  private compactionCatalogPath() { return path.join(this.storeRoot, 'corpus', 'compactions.json'); }
  async loadCompactionCatalog(projectId: string): Promise<ProjectCorpusCompactionCatalogRecord> {
    const stored = await readJsonIfExists<ProjectCorpusCompactionCatalogRecord>(
      this.compactionCatalogPath()
    );
    if (!stored) return emptyCompactionCatalog(projectId);
    if (stored.projectId !== projectId) throw new Error("compaction catalog belongs to another Project");
    return stored;
  }

  async saveCompactionCatalog(catalog: ProjectCorpusCompactionCatalogRecord): Promise<void> {
    await writeJsonAtomic(this.compactionCatalogPath(), catalog);
  }

  async upsertFileCompaction(
    projectId: string,
    input: ProjectFileCompactionInput
  ): Promise<{ catalog: ProjectCorpusCompactionCatalogRecord; compaction: ProjectFileCompactionRecord }> {
    const catalog = await this.loadCompactionCatalog(projectId);
    const result = rules.upsertFileCompaction(catalog, projectId, input, catalogEnvironment());
    if (result.catalog !== catalog) await this.saveCompactionCatalog(result.catalog);
    return result;
  }

}
