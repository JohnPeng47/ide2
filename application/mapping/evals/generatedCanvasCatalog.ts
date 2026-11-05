import type { DiagramRepository } from '../../core/ports/diagramRepository';
import type { GeneratedCanvasRecord } from '../../../domain/core/diagrams/generatedCanvas';
import type { ProjectRepresentationRecord } from '../../../domain/core/representations/projectCatalog';

export type { GeneratedCanvasRecord };
export interface GeneratedCanvasSource {
  list(): Promise<ProjectRepresentationRecord[]>;
  read(id: string, checkpointId?: string): Promise<GeneratedCanvasRecord | null>;
  /** Every listed canvas from one catalog read. Use this rather than `read` in a loop: each `read` parses the whole catalog file. */
  readAll(): Promise<GeneratedCanvasRecord[]>;
}

/** Generated canvases live in the project catalog, outside the Mapping workspace. */
export class GeneratedCanvasCatalog implements GeneratedCanvasSource {
  snapshot?: (id: string, checkpointId: string) => Promise<GeneratedCanvasRecord | null>;
  constructor(private projects: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>) {}
  private async catalog(revisionIds?: string[]) {
    const project = await this.projects.loadProject(); if (!project) return undefined;
    const catalogs = this.projects.projectCatalogs;
    return catalogs.loadCurrentRepresentationCatalog?.(project.id, revisionIds) ?? catalogs.loadRepresentationCatalog(project.id);
  }
  private listed(catalog: NonNullable<Awaited<ReturnType<GeneratedCanvasCatalog['catalog']>>>) {
    return Object.values(catalog.representations).filter(c => c.type === 'generated' && c.status === 'settled' && c.generated && (!c.generated.generation || c.generated.generation.status === 'finished'));
  }
  async list() {
    const catalog = await this.catalog([]);
    return catalog ? this.listed(catalog) : [];
  }
  async readAll() {
    const index = await this.catalog([]); if (!index) return [];
    const records = this.listed(index), catalog = await this.catalog(records.map(record => record.currentRevisionId));
    return records.flatMap((record): GeneratedCanvasRecord[] => {
      const content = catalog?.revisions[record.currentRevisionId]?.content;
      return content?.kind === 'canvas-history' && record.generated ? [{ id: record.id, name: record.name, generated: record.generated, history: content.history }] : [];
    });
  }
  async read(id: string, checkpointId?: string) {
    if (checkpointId) { const pinned = await this.snapshot?.(id, checkpointId); if (pinned) return pinned; }
    const index = await this.catalog([]), record = index?.representations[id];
    if (!record || record.type !== 'generated' || (record.status !== 'settled' && !checkpointId) || !record.generated || (record.generated.generation && record.generated.generation.status !== 'finished')) return null;
    const catalog = await this.catalog([record.currentRevisionId]), content = catalog?.revisions[record.currentRevisionId]?.content;
    if (content?.kind !== 'canvas-history') return null;
    return { id, name: record.name, generated: record.generated, history: structuredClone(content.history) };
  }
}
