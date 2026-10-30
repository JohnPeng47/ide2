import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../core/errors';
import { sha256 } from '../../../domain/core/sha256';
import { evalWorkflowIds, evalWorkflows, promptHasErrors, validatePromptStages } from '../../../domain/mapping/evals/evalWorkflows';
import { latestVersion, saveEvalPromptSchema, type EvalPrompt } from '../../../domain/mapping/evals/evalPrompt';
import type { EvalRunPrompt } from '../../../domain/mapping/evals/evalRun';

export interface EvalPromptStore { list(): Promise<EvalPrompt[]>; read(id: string): Promise<EvalPrompt | null>; save(prompt: EvalPrompt): Promise<void> }

export class EvalPromptService {
  /** Retry state for in-flight saves; like other request IDs it does not survive restarts. */
  private saves = new Map<string, { hash: string; result: Promise<EvalPrompt> }>();
  private seeding?: Promise<void>;
  constructor(private store: EvalPromptStore, private projects: { loadProject(): Promise<{ id: string } | null> }) {}
  private async projectId() {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Open a project first.');
    return project.id;
  }
  /** Each workflow starts with its original built-in prompt as v1. */
  private async seed(projectId: string) {
    const existing = await this.store.list(), now = new Date().toISOString();
    for (const workflow of evalWorkflowIds) {
      const id = `builtin-${workflow}`, { defaultPrompt } = evalWorkflows[workflow];
      const builtin = existing.find(prompt => prompt.id === id && prompt.projectId === projectId);
      if (builtin) {
        // Workflow inputs changed (e.g. Alternatives now reads an AgentContext): keep history, add a valid version.
        const latest = latestVersion(builtin);
        if (promptHasErrors(validatePromptStages(evalWorkflows[workflow], latest.stages)))
          await this.store.save({ ...builtin, updatedAt: now, versions: [...builtin.versions, { version: latest.version + 1, createdAt: now,
            note: 'Updated for the current workflow inputs.', stages: defaultPrompt.stages }] });
        continue;
      }
      await this.store.save({ schemaVersion: 1, id, projectId, workflow, name: defaultPrompt.name, description: defaultPrompt.description,
        builtin: true, createdAt: now, updatedAt: now, versions: [{ version: 1, createdAt: now, stages: defaultPrompt.stages }] });
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
    const result = this.write(input);
    this.saves.set(input.requestId, { hash, result });
    result.catch(() => this.saves.delete(input.requestId));
    if (this.saves.size > 200) this.saves.delete(this.saves.keys().next().value!);
    return result;
  }
  private async write(input: ReturnType<typeof saveEvalPromptSchema.parse>) {
    const workflow = evalWorkflows[input.workflow];
    if (promptHasErrors(validatePromptStages(workflow, input.stages))) throw new ApplicationError('invalid-input', 'Fix the prompt errors before saving.');
    const now = new Date().toISOString(), stages = Object.fromEntries(workflow.stages.map(stage => [stage.id, input.stages[stage.id]]));
    if (!input.promptId) {
      const prompt: EvalPrompt = { schemaVersion: 1, id: randomUUID(), projectId: await this.projectId(), workflow: input.workflow, name: input.name,
        ...(input.description ? { description: input.description } : {}), createdAt: now, updatedAt: now,
        versions: [{ version: 1, createdAt: now, ...(input.note ? { note: input.note } : {}), stages }] };
      await this.store.save(prompt); return prompt;
    }
    const prompt = await this.read(input.promptId), latest = latestVersion(prompt);
    if (prompt.workflow !== input.workflow) throw new ApplicationError('invalid-input', 'A prompt cannot change workflow.');
    if (latest.version !== input.baseVersion) throw new ApplicationError('conflict', `This prompt was saved as v${latest.version} since you opened it. Reload it before saving.`);
    const changed = JSON.stringify(latest.stages) !== JSON.stringify(stages);
    const next: EvalPrompt = { ...prompt, name: input.name, updatedAt: now,
      ...(input.description !== undefined ? { description: input.description || undefined } : {}),
      versions: changed ? [...prompt.versions, { version: latest.version + 1, createdAt: now, ...(input.note ? { note: input.note } : {}), stages }] : prompt.versions };
    await this.store.save(next); return next;
  }
  async setArchived(id: string, archived: boolean) {
    const prompt = await this.read(id), next = { ...prompt, archivedAt: archived ? new Date().toISOString() : undefined };
    await this.store.save(next); return next;
  }
  async resolve(promptId: string, version: number, workflow: string): Promise<EvalRunPrompt> {
    const prompt = await this.read(promptId), pinned = prompt.versions.find(item => item.version === version);
    if (prompt.workflow !== workflow) throw new ApplicationError('invalid-input', `${prompt.name} belongs to another workflow.`);
    if (!pinned) throw new ApplicationError('invalid-input', `${prompt.name} has no v${version}.`);
    return { promptId, version, name: prompt.name, stages: pinned.stages };
  }
}
