import { compareSourceSchema } from '../../../domain/mapping/compare/comparePageSession';
import { documentFromHistory } from '../../../domain/core/diagrams/canvasHistory';
import { extractLayoutTemplate, type LayoutTemplate } from '../../../domain/core/diagrams/layoutTemplate';
import { presentationScene, resolveDiagramView } from '../../../domain/mapping/workspace/diagramViewState';
import type { MappingCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { saveLayoutTemplateSchema, updateLayoutTemplateSchema } from '../../../domain/mapping/evals/layoutTemplate';
import { sha256 } from '../../../domain/core/sha256';
import { ApplicationError } from '../../core/errors';
import type { CompareSessionService } from '../compare/compareSessionService';

type Stored = LayoutTemplate & { requestHash: string };
export interface LayoutTemplateStore { list(): Promise<Stored[]>; read(id: string): Promise<Stored | null>; save(value: Stored): Promise<void> }
export class LayoutTemplateService {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private store: LayoutTemplateStore, private comparisons: CompareSessionService, private projects: { loadProject(): Promise<{ id: string } | null> }) {}
  private async projectId() {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Open a project first.');
    return project.id;
  }
  private public({ requestHash: _, ...value }: Stored): LayoutTemplate { return structuredClone(value); }
  private write<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work); this.writes = next.catch(() => {}); return next;
  }
  async list() {
    const projectId = await this.projectId();
    return (await this.store.list()).filter(item => item.projectId === projectId && !item.archivedAt).map(item => this.public(item));
  }
  async read(id: string) {
    const item = await this.store.read(id);
    if (!item || item.projectId !== await this.projectId() || item.archivedAt) throw new ApplicationError('invalid-input', 'Layout template not found.');
    return this.public(item);
  }
  async capture(raw: unknown) {
    const source = compareSourceSchema.parse(raw), copy = (await this.comparisons.capture([source])).canvases[0];
    if (copy.view.generation && copy.view.generation.status !== 'finished') throw new ApplicationError('invalid-input', 'Wait for this canvas to finish generating.');
    const document = documentFromHistory(copy.history), view = copy.history.snapshots[copy.history.headId].view as MappingCanvasState | undefined;
    return { source: { documentId: source.documentId, checkpointId: source.checkpointId, ...(source.viewId ? { viewId: source.viewId } : {}) },
      geometry: extractLayoutTemplate(resolveDiagramView(presentationScene(document), view?.diagramViews)) };
  }
  save(raw: unknown) {
    const input = saveLayoutTemplateSchema.parse(raw), hash = sha256(JSON.stringify(input));
    return this.write(async () => {
      const projectId = await this.projectId(), previous = await this.store.read(input.requestId);
      if (previous) {
        if (previous.projectId !== projectId || previous.requestHash !== hash || previous.archivedAt) throw new ApplicationError('conflict', 'Request ID already used for another or deleted layout template.');
        return this.public(previous);
      }
      const item: Stored = { schemaVersion: 1, id: input.requestId, projectId, name: input.name, createdAt: new Date().toISOString(), ...input.capture, requestHash: hash };
      await this.store.save(item); return this.public(item);
    });
  }
  rename(id: string, name: string) {
    return this.update(id, { name });
  }
  update(id: string, raw: unknown) {
    const input = updateLayoutTemplateSchema.parse(raw);
    return this.write(async () => { await this.read(id); const item = (await this.store.read(id))!;
      if (Object.keys(input.descriptions ?? {}).some(id => !item.geometry.slots.some(slot => slot.id === id)))
        throw new ApplicationError('invalid-input', 'Unknown layout slot.');
      const updated = { ...item, ...(input.name !== undefined ? { name: input.name } : {}),
        geometry: { ...item.geometry, slots: item.geometry.slots.map(slot => {
          const description = input.descriptions?.[slot.id];
          if (description === undefined) return slot;
          const { description: _, ...rest } = slot;
          return { ...rest, ...(description ? { description } : {}) };
        }) } };
      await this.store.save(updated); return this.public(updated); });
  }
  delete(id: string) {
    return this.write(async () => { await this.read(id); await this.store.save({ ...(await this.store.read(id))!, archivedAt: new Date().toISOString() }); });
  }
}
