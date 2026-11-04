import { ApplicationError } from '../../core/errors';
import { createEvalReferenceSchema, referenceSlug, updateEvalReferenceSchema, type EvalReference } from '../../../domain/mapping/evals/evalReference';

export interface EvalReferenceStore { list(): Promise<EvalReference[]>; read(id: string): Promise<EvalReference | null>; save(reference: EvalReference): Promise<void> }

/** Saved diagram excerpts that prompt templates cite. */
export class EvalReferenceService {
  private creating = new Map<string, Promise<EvalReference>>();
  constructor(private store: EvalReferenceStore, private projects: { loadProject(): Promise<{ id: string } | null> }) {}
  private async projectId() {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Open a project first.');
    return project.id;
  }
  /** Newest first. Archived references are listed only on request; they still resolve. */
  async list(archived = false) {
    const projectId = await this.projectId();
    return (await this.store.list()).filter(item => item.projectId === projectId && (archived || !item.archivedAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async read(id: string) {
    const projectId = await this.projectId(), reference = await this.store.read(id).catch(() => null);
    if (!reference || reference.projectId !== projectId) throw new ApplicationError('invalid-input', `Reference ${id} not found.`);
    return reference;
  }
  /** Every ID that resolves, archived included. */
  async ids() { return new Set((await this.list(true)).map(item => item.id)); }
  async create(raw: unknown) {
    const input = createEvalReferenceSchema.parse(raw);
    let pending = this.creating.get(input.requestId);
    if (!pending) {
      pending = (async () => {
        const projectId = await this.projectId(), all = await this.store.list();
        // Retries with the same request ID return the reference already made.
        const existing = all.find(item => item.requestId === input.requestId);
        if (existing) return existing;
        const now = new Date().toISOString();
        const reference: EvalReference = { schemaVersion: 1, id: referenceSlug(input.name, new Set(all.map(item => item.id))), projectId, requestId: input.requestId,
          name: input.name, ascii: input.ascii, source: input.source, sourceName: input.sourceName, canvasName: input.canvasName, createdAt: now, updatedAt: now };
        await this.store.save(reference);
        return reference;
      })().finally(() => this.creating.delete(input.requestId));
      this.creating.set(input.requestId, pending);
    }
    return pending;
  }
  /** Renaming changes the label only; the ID in prompt tokens stays. */
  async update(id: string, raw: unknown) {
    const input = updateEvalReferenceSchema.parse(raw), reference = await this.read(id);
    const next: EvalReference = { ...reference, updatedAt: new Date().toISOString(), ...(input.name ? { name: input.name } : {}) };
    if (input.archived === true) next.archivedAt = next.updatedAt;
    if (input.archived === false) delete next.archivedAt;
    await this.store.save(next);
    return next;
  }
}
