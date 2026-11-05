import { ApplicationError } from '../../core/errors';
import { createEvalReferenceGroupSchema, createEvalReferenceSchema, referenceSlug, updateEvalReferenceGroupSchema, updateEvalReferenceSchema, type EvalReference, type EvalReferenceGroup } from '../../../domain/mapping/evals/evalReference';

export interface EvalReferenceStore { list(): Promise<EvalReference[]>; read(id: string): Promise<EvalReference | null>; save(reference: EvalReference): Promise<void> }
export interface EvalReferenceGroupStore { list(): Promise<EvalReferenceGroup[]>; read(id: string): Promise<EvalReferenceGroup | null>; save(group: EvalReferenceGroup): Promise<void>; delete(id: string): Promise<void> }

/** Saved diagram excerpts that prompt templates cite. */
export class EvalReferenceService {
  private creating = new Map<string, Promise<EvalReference>>();
  private creatingGroups = new Map<string, Promise<EvalReferenceGroup>>();
  constructor(private store: EvalReferenceStore, private projects: { loadProject(): Promise<{ id: string } | null> }, private groups: EvalReferenceGroupStore) {}
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
        if (input.groupId) await this.readGroup(input.groupId);
        const now = new Date().toISOString();
        const reference: EvalReference = { schemaVersion: 1, id: referenceSlug(input.name, new Set(all.map(item => item.id))), projectId, requestId: input.requestId,
          name: input.name, ascii: input.ascii, source: input.source, sourceName: input.sourceName, canvasName: input.canvasName,
          ...(input.diagramName ? { diagramName: input.diagramName } : {}), ...(input.groupId ? { groupId: input.groupId } : {}), ...(input.comment ? { comment: input.comment } : {}), createdAt: now, updatedAt: now };
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
    if (input.groupId) { await this.readGroup(input.groupId); next.groupId = input.groupId; }
    if (input.groupId === null) delete next.groupId;
    if (input.comment) next.comment = input.comment;
    if (input.comment === '') delete next.comment;
    await this.store.save(next);
    return next;
  }
  async listGroups() {
    const projectId = await this.projectId();
    return (await this.groups.list()).filter(item => item.projectId === projectId).sort((a, b) => a.name.localeCompare(b.name));
  }
  private async readGroup(id: string) {
    const projectId = await this.projectId(), group = await this.groups.read(id).catch(() => null);
    if (!group || group.projectId !== projectId) throw new ApplicationError('invalid-input', `Reference group ${id} not found.`);
    return group;
  }
  async createGroup(raw: unknown) {
    const input = createEvalReferenceGroupSchema.parse(raw);
    let pending = this.creatingGroups.get(input.requestId);
    if (!pending) {
      pending = (async () => {
        const projectId = await this.projectId(), all = await this.groups.list();
        const existing = all.find(item => item.requestId === input.requestId);
        if (existing) return existing;
        const now = new Date().toISOString();
        const group: EvalReferenceGroup = { schemaVersion: 1, id: referenceSlug(input.name, new Set(all.map(item => item.id))), projectId, requestId: input.requestId, name: input.name, createdAt: now, updatedAt: now };
        await this.groups.save(group);
        return group;
      })().finally(() => this.creatingGroups.delete(input.requestId));
      this.creatingGroups.set(input.requestId, pending);
    }
    return pending;
  }
  async updateGroup(id: string, raw: unknown) {
    const input = updateEvalReferenceGroupSchema.parse(raw), group = await this.readGroup(id);
    const next: EvalReferenceGroup = { ...group, name: input.name, updatedAt: new Date().toISOString() };
    await this.groups.save(next);
    return next;
  }
  /** Members become ungrouped, archived ones included; references are never deleted with their group. */
  async deleteGroup(id: string) {
    await this.readGroup(id);
    for (const reference of await this.list(true)) if (reference.groupId === id) await this.update(reference.id, { groupId: null });
    await this.groups.delete(id);
  }
}
