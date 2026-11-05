import { defaultPromptTemplateBase, legacyPromptTemplateBase, parsePromptSections } from '../../../domain/mapping/evals/promptTemplateBase';
import type { PromptProjectSnapshot } from '../../../domain/mapping/evals/evalPrompt';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../core/errors';
import { sha256 } from '../../../domain/core/sha256';
import { evalWorkflowIds, evalWorkflows, templateAlternativePrompt, promptHasErrors, validatePromptStages, type EvalWorkflowId } from '../../../domain/mapping/evals/evalWorkflows';
import { latestVersion, saveEvalPromptSchema, trackPromptLineageSchema, type PromptDerivation, type PromptVersionRef, type EvalPrompt } from '../../../domain/mapping/evals/evalPrompt';
import type { EvalRunPrompt } from '../../../domain/mapping/evals/evalRun';
import { templateReferences } from '../../../domain/mapping/evals/promptTemplate';
import type { EvalReferenceService } from './evalReferenceService';

export interface EvalPromptStore { list(): Promise<EvalPrompt[]>; read(id: string): Promise<EvalPrompt | null>; save(prompt: EvalPrompt): Promise<void> }

export const promptContentHash = (stages: Record<string, string>) => sha256(JSON.stringify(Object.fromEntries(Object.entries(stages).sort(([a], [b]) => a.localeCompare(b)))));

export class EvalPromptService {
  private writes: Promise<unknown> = Promise.resolve();
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
  private async validateDerivation(derivation: PromptDerivation, workflow: EvalWorkflowId, target?: PromptVersionRef) {
    const visit = async (ref: PromptVersionRef, path: Set<string>): Promise<void> => {
      const key = `${ref.promptId}:${ref.version}`;
      if (path.has(key)) throw new ApplicationError('invalid-input', 'Prompt lineage cannot contain a cycle.');
      const prompt = await this.read(ref.promptId), version = prompt.versions.find(v => v.version === ref.version);
      if (prompt.workflow !== workflow || !version) throw new ApplicationError('invalid-input', 'Parent must be an existing version in the same workflow.');
      const next = new Set(path); next.add(key);
      for (const parent of version.parents?.length ? version.parents : version.derivation ? [version.derivation.parent] : []) await visit(parent, next);
    };
    await visit(derivation.parent, new Set(target ? [`${target.promptId}:${target.version}`] : []));
  }

  /** One-time provenance backfill for legacy records. Text and version identities never change. */
  trackLineage(id: string, raw: unknown) {
    const input = trackPromptLineageSchema.parse(raw);
    return this.serialize(async () => {
      const prompt = await this.read(id), version = prompt.versions.find(v => v.version === input.version);
      if (!version || promptContentHash(version.stages) !== input.expectedContentHash) throw new ApplicationError('conflict', 'Prompt version text does not match the migration.');
      if (version.derivation) {
        if (JSON.stringify(version.derivation) !== JSON.stringify(input.derivation)) throw new ApplicationError('conflict', 'This version already has immutable lineage.');
        return prompt;
      }
      await this.validateDerivation(input.derivation, prompt.workflow, { promptId: id, version: input.version });
      const now = new Date().toISOString();
      const next = { ...prompt, updatedAt: now, versions: prompt.versions.map(v => v.version === input.version ? { ...v, contentHash: input.expectedContentHash, derivation: input.derivation, lineageRecordedAt: now } : v) };
      await this.store.save(next); return next;
    });
  }
  /** A separate, immutable prompt copy for a relaunch; deterministic identity makes retries safe. */
  forkForAttempt(requestId: string, workflow: EvalWorkflowId, source: EvalRunPrompt, stages: Record<string, string>) {
    return this.serialize(async () => {
    const id = `attempt-${requestId}`, projectId = await this.projectId();
    const existing = await this.store.read(id);
    if (existing) {
      if (existing.projectId !== projectId || existing.workflow !== workflow || JSON.stringify(existing.versions[0].stages) !== JSON.stringify(stages)
        || (existing.versions[0].derivation && JSON.stringify(existing.versions[0].derivation.parent) !== JSON.stringify({ promptId: source.promptId, version: source.version })))
        throw new ApplicationError('conflict', 'Relaunch request ID already used for a different prompt.');
      return existing;
    }
    const derivation: PromptDerivation | undefined = source.version ? { parent: { promptId: source.promptId, version: source.version }, kind: 'relaunch' } : undefined;
    if (derivation) await this.validateDerivation(derivation, workflow);
    const templateBase = source.templateBase ?? legacyPromptTemplateBase(stages);
    const issues = Object.values(stages).flatMap(text => parsePromptSections(text, templateBase).issues);
    if (issues.length) throw new ApplicationError('invalid-input', issues.map(i => i.message).join(' '));
    const now = new Date().toISOString();
    const fork: EvalPrompt = { schemaVersion: 1, id, projectId, workflow, name: `${source.name} · edited attempt`.slice(0, 120), createdAt: now, updatedAt: now,
      versions: [{ version: 1, templateBase: source.templateBase ?? legacyPromptTemplateBase(stages), parents: source.version ? [{ promptId: source.promptId, version: source.version, relation: 'relaunch' }] : [], format: 'explicit-v1', createdAt: now, note: `Relaunched from ${source.promptId} v${source.version ?? 'unknown'}.`, contentHash: promptContentHash(stages), ...(derivation ? { derivation } : {}), stages }] };
    await this.store.save(fork); return fork;
    });
  }
  /** Retry state for in-flight saves; like other request IDs it does not survive restarts. */
  private saves = new Map<string, { hash: string; result: Promise<EvalPrompt> }>();
  private seeding?: Promise<void>;
  constructor(private store: EvalPromptStore, private projects: { loadProject(): Promise<{ id: string } | null> },
    readonly references?: Pick<EvalReferenceService, 'ids' | 'read'> & Partial<Pick<EvalReferenceService, 'create'>>,
    private snapshots?: { save(value: PromptProjectSnapshot): Promise<void>; read(id: string): Promise<PromptProjectSnapshot | null>; list(): Promise<PromptProjectSnapshot[]> }) {}
  private async projectId() {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Open a project first.');
    return project.id;
  }
  /** Each workflow starts with its original built-in prompt as v1. */
  private async seed(projectId: string) {
    const existing = await this.store.list(), now = new Date().toISOString();
    const seeds = [...evalWorkflowIds.map(workflow => ({ workflow, id: `builtin-${workflow}`, defaultPrompt: evalWorkflows[workflow].defaultPrompt })),
      { workflow: 'alternatives' as const, id: 'builtin-template-alternatives', defaultPrompt: templateAlternativePrompt }];
    for (const { workflow, id, defaultPrompt } of seeds) {
      const builtin = existing.find(prompt => prompt.id === id && prompt.projectId === projectId);
      if (builtin) {
        // Workflow inputs changed (e.g. Alternatives now reads an AgentContext): keep history, add a valid version.
        const latest = latestVersion(builtin);
        if (latest.format !== 'explicit-v1' || Object.values(latest.stages).some(body => /\{\{\s*passes?\s*\}\}/.test(body) || body.includes('Read few-shot.json: five synthetic')) || promptHasErrors(validatePromptStages(evalWorkflows[workflow], latest.stages)))
          await this.store.save({ ...builtin, updatedAt: now, versions: [...builtin.versions, { version: latest.version + 1, createdAt: now,
            templateBase: legacyPromptTemplateBase(defaultPrompt.stages), contentHash: promptContentHash(defaultPrompt.stages), derivation: { parent: { promptId: builtin.id, version: latest.version }, kind: 'revision' }, format: 'explicit-v1', note: 'All instructions are now explicit in the prompt; run-level task variables are removed.', stages: defaultPrompt.stages }] });
        continue;
      }
      await this.store.save({ schemaVersion: 1, id, projectId, workflow, name: defaultPrompt.name, description: defaultPrompt.description,
        builtin: true, createdAt: now, updatedAt: now, versions: [{ version: 1, templateBase: legacyPromptTemplateBase(defaultPrompt.stages), format: 'explicit-v1', createdAt: now, contentHash: promptContentHash(defaultPrompt.stages), stages: defaultPrompt.stages }] });
    }
  }
  private async seeded() {
    const projectId = await this.projectId();
    this.seeding ??= this.seed(projectId).finally(() => { this.seeding = undefined; });
    await this.seeding;
    return projectId;
  }
  async list() {
    const projectId = await this.seeded();
    return (await this.store.list()).filter(prompt => prompt.projectId === projectId)
      .sort((a, b) => Number(!!b.builtin) - Number(!!a.builtin) || a.createdAt.localeCompare(b.createdAt));
  }
  async read(id: string) {
    const projectId = await this.seeded(), prompt = await this.store.read(id);
    if (!prompt || prompt.projectId !== projectId) throw new ApplicationError('invalid-input', 'Prompt not found.');
    return prompt;
  }
  async save(raw: unknown) {
    const input = saveEvalPromptSchema.parse(raw), hash = sha256(JSON.stringify(input));
    const prior = this.saves.get(input.requestId);
    if (prior) {
      if (prior.hash !== hash) throw new ApplicationError('conflict', 'Request ID already used for another prompt save.');
      return prior.result;
    }
    const result = this.serialize(() => this.write(input));
    this.saves.set(input.requestId, { hash, result });
    result.catch(() => this.saves.delete(input.requestId));
    if (this.saves.size > 200) this.saves.delete(this.saves.keys().next().value!);
    return result;
  }
  private async write(input: ReturnType<typeof saveEvalPromptSchema.parse>) {
    const workflow = evalWorkflows[input.workflow];
    const source = input.promptId ? await this.read(input.promptId) : undefined;
    const templateBase = input.templateBase ?? (source ? latestVersion(source).templateBase ?? legacyPromptTemplateBase(latestVersion(source).stages) : defaultPromptTemplateBase);
    const tagIssues = Object.values(input.stages).flatMap(text => parsePromptSections(text, templateBase).issues);
    if (tagIssues.length) throw new ApplicationError('invalid-input', tagIssues.map(i => i.message).join(' '));
    const parents = input.parents ?? (input.derivation ? [{ ...input.derivation.parent, relation: input.derivation.kind }] : source ? [{ promptId: source.id, version: input.baseVersion!, relation: 'revision' as const }] : []);
    if (parents.some(p => p.relation === 'merge') && parents.length < 2) throw new ApplicationError('invalid-input', 'A merge requires at least two parent versions.');
    for (const parent of parents) await this.validateDerivation({ parent, kind: parent.relation }, input.workflow, input.promptId ? { promptId: input.promptId, version: input.baseVersion! + 1 } : undefined);
    if (promptHasErrors(validatePromptStages(workflow, input.stages, await this.references?.ids() ?? new Set()))) throw new ApplicationError('invalid-input', 'Fix the prompt errors before saving.');
    const now = new Date().toISOString(), stages = Object.fromEntries(workflow.stages.map(stage => [stage.id, input.stages[stage.id]]));
    if (input.derivation) await this.validateDerivation(input.derivation, input.workflow);
    if (!input.promptId) {
      const existing = await this.store.read(input.requestId);
      if (existing) {
        const first = existing.versions[0];
        if (existing.projectId !== await this.projectId() || existing.name !== input.name || existing.workflow !== input.workflow || promptContentHash(first.stages) !== promptContentHash(stages)
          || JSON.stringify(first.parents) !== JSON.stringify(parents) || JSON.stringify(first.templateBase) !== JSON.stringify(templateBase)) throw new ApplicationError('conflict', 'Request ID already used for another prompt.');
        return existing;
      }
      const prompt: EvalPrompt = { schemaVersion: 1, id: input.requestId, projectId: await this.projectId(), workflow: input.workflow, name: input.name,
        ...(input.description ? { description: input.description } : {}), createdAt: now, updatedAt: now,
        versions: [{ version: 1, templateBase, parents, format: 'explicit-v1', createdAt: now, ...(input.note ? { note: input.note } : {}), contentHash: promptContentHash(stages), ...(input.derivation ? { derivation: input.derivation } : {}), stages }] };
      await this.store.save(prompt); return prompt;
    }
    const prompt = await this.read(input.promptId), latest = latestVersion(prompt);
    if (prompt.workflow !== input.workflow) throw new ApplicationError('invalid-input', 'A prompt cannot change workflow.');
    if (latest.version !== input.baseVersion) throw new ApplicationError('conflict', `This prompt was saved as v${latest.version} since you opened it. Reload it before saving.`);
    const derivation: PromptDerivation = input.derivation ?? { parent: { promptId: prompt.id, version: latest.version }, kind: 'revision' };
    await this.validateDerivation(derivation, input.workflow, { promptId: prompt.id, version: latest.version + 1 });
    const changed = promptContentHash(latest.stages) !== promptContentHash(stages) || JSON.stringify(latest.templateBase) !== JSON.stringify(templateBase) || !!input.parents;
    const next: EvalPrompt = { ...prompt, name: input.name, updatedAt: now,
      ...(input.description !== undefined ? { description: input.description || undefined } : {}),
      versions: changed ? [...prompt.versions, { version: latest.version + 1, templateBase, parents, format: 'explicit-v1' as const, createdAt: now, ...(input.note ? { note: input.note } : {}), contentHash: promptContentHash(stages), derivation, stages }] : prompt.versions };
    await this.store.save(next); return next;
  }
  async fork(id: string, version: number, requestId: string, name: string) {
    const source = await this.read(id), pinned = source.versions.find(v => v.version === version);
    if (!pinned) throw new ApplicationError('invalid-input', 'Parent version not found.');
    return this.save({ requestId, workflow: source.workflow, name, stages: pinned.stages,
      templateBase: pinned.templateBase ?? legacyPromptTemplateBase(pinned.stages),
      derivation: { parent: { promptId: id, version }, kind: 'fork' } });
  }
  async snapshot(requestId: string, name: string) {
    if (!this.snapshots) throw Error('Snapshot storage unavailable.');
    return this.serialize(async () => {
      const projectId = await this.projectId(), existing = await this.snapshots!.read(requestId);
      if (existing) { if (existing.projectId !== projectId || existing.name !== name) throw new ApplicationError('conflict', 'Snapshot request ID already used.'); return existing; }
      const prompts = structuredClone(await this.list());
      const snapshot = { id: requestId, projectId, name, createdAt: new Date().toISOString(), prompts };
      await this.snapshots!.save(snapshot); return snapshot;
    });
  }
  async readSnapshot(id: string) {
    const snapshot = await this.snapshots?.read(id);
    if (!snapshot || snapshot.projectId !== await this.projectId()) throw new ApplicationError('invalid-input', 'Snapshot not found.');
    return snapshot;
  }
  async listSnapshots() { const projectId = await this.projectId(); return (await this.snapshots?.list() ?? []).filter(s => s.projectId === projectId); }
  setArchived(id: string, archived: boolean) {
    return this.serialize(async () => {
    const prompt = await this.read(id), next = { ...prompt, archivedAt: archived ? new Date().toISOString() : undefined };
    await this.store.save(next); return next;
    });
  }
  async resolve(promptId: string, version: number, workflow: string): Promise<EvalRunPrompt> {
    const prompt = await this.read(promptId), pinned = prompt.versions.find(item => item.version === version);
    if (prompt.workflow !== workflow) throw new ApplicationError('invalid-input', `${prompt.name} belongs to another workflow.`);
    if (!pinned) throw new ApplicationError('invalid-input', `${prompt.name} has no v${version}.`);
    // Cited reference text is frozen into the run with the prompt.
    const ids = [...new Set(Object.values(pinned.stages).flatMap(templateReferences))];
    const references = ids.length ? Object.fromEntries(await Promise.all(ids.map(async id => {
      const reference = await this.references?.read(id).catch(() => undefined);
      if (!reference) throw new ApplicationError('invalid-input', `${prompt.name} v${version} cites reference ${id}, which no longer exists.`);
      return [id, { name: reference.name, ascii: reference.ascii, ...(reference.comment ? { comment: reference.comment } : {}) }] as const;
    }))) : undefined;
    return { promptId, version, name: prompt.name, stages: pinned.stages, templateBase: pinned.templateBase ?? legacyPromptTemplateBase(pinned.stages), parents: pinned.parents, contentHash: promptContentHash(pinned.stages), ...(pinned.derivation ? { derivation: pinned.derivation } : {}), ...(references ? { references } : {}) };
  }
}
