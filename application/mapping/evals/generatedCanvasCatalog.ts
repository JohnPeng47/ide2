import type { DiagramRepository } from '../../core/ports/diagramRepository';
import type { GeneratedCanvasRecord } from '../../../domain/core/diagrams/generatedCanvas';
import type { ProjectRepresentationRecord } from '../../../domain/core/representations/projectCatalog';

export type { GeneratedCanvasRecord };
export interface GeneratedCanvasSource {
  list(): Promise<ProjectRepresentationRecord[]>;
  read(id: string): Promise<GeneratedCanvasRecord | null>;
}

/** Generated canvases live in the project catalog, outside the Mapping workspace. */
export class GeneratedCanvasCatalog implements GeneratedCanvasSource {
  constructor(private projects: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>) {}
  private async catalog(revisionIds?: string[]) {
    const project = await this.projects.loadProject(); if (!project) return undefined;
    const catalogs = this.projects.projectCatalogs;
    return catalogs.loadCurrentRepresentationCatalog?.(project.id, revisionIds) ?? catalogs.loadRepresentationCatalog(project.id);
  }
  async list() {
    const catalog = await this.catalog([]);
    return catalog ? Object.values(catalog.representations).filter(c => c.type === 'generated' && c.status === 'settled' && c.generated) : [];
  }
  async read(id: string) {
    const index = await this.catalog([]), record = index?.representations[id];
    if (!record || record.type !== 'generated' || record.status !== 'settled' || !record.generated) return null;
    const catalog = await this.catalog([record.currentRevisionId]), content = catalog?.revisions[record.currentRevisionId]?.content;
    if (content?.kind !== 'canvas-history') return null;
    return { id, name: record.name, generated: record.generated, history: structuredClone(content.history) };
  }
}
