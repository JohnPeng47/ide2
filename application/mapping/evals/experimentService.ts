import { saveExperimentSchema, type EvalExperiment } from '../../../domain/mapping/evals/experiment';
import { sha256 } from '../../../domain/core/sha256';
import { ApplicationError } from '../../core/errors';
import type { EvalRunService } from './evalRunService';

export type StoredExperiment = EvalExperiment & { lastRequest: { id: string; hash: string } };
export interface ExperimentStore { list(): Promise<StoredExperiment[]>; read(id: string): Promise<StoredExperiment | null>; save(value: StoredExperiment): Promise<void> }
export class ExperimentService {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private store: ExperimentStore, private runs: Pick<EvalRunService, 'read' | 'judgements'>,
    private projects: { loadProject(): Promise<{ id: string } | null> },
    private contexts: { read(id: string, resolveSources: boolean): Promise<{ contentHash: string }> }) {}
  private public({ lastRequest: _, ...record }: StoredExperiment): EvalExperiment { return structuredClone(record); }
  private async projectId() {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Open a project first.');
    return project.id;
  }
  async list() {
    const projectId = await this.projectId();
    return (await this.store.list()).filter(e => e.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(e => this.public(e));
  }
  async read(id: string) {
    const item = await this.store.read(id);
    if (!item || item.projectId !== await this.projectId()) throw new ApplicationError('invalid-input', 'Experiment not found.');
    return this.public(item);
  }
  save(raw: unknown) {
    const input = saveExperimentSchema.parse(raw), hash = sha256(JSON.stringify(input));
    const work = async () => {
      const projectId = await this.projectId(), id = input.experimentId ?? input.requestId;
      const previous = await this.store.read(id);
      if (previous && previous.projectId !== projectId) throw new ApplicationError('invalid-input', 'Experiment not found.');
      if (previous?.lastRequest.id === input.requestId) {
        if (previous.lastRequest.hash !== hash) throw new ApplicationError('conflict', 'Request ID already used for different content.');
        return this.public(previous);
      }
      if (input.experimentId ? !previous || previous.revision !== input.expectedRevision : !!previous)
        throw new ApplicationError('conflict', 'Experiment changed. Read its current revision before updating.');
      const design = input.experiment;
      for (const inputCase of design.cases) {
        const context = await this.contexts.read(inputCase.agentContextId, false);
        if (inputCase.contentHash && inputCase.contentHash !== context.contentHash)
          throw new ApplicationError('invalid-input', 'Input case hash does not match its saved AgentContext.');
      }
      const runIds = [...new Set(design.samples.flatMap(s => s.outputs.map(o => o.runId)))];
      const runs = await Promise.all(runIds.map(id => this.runs.read(id)));
      for (const sample of design.samples) for (const output of sample.outputs) {
        const run = runs.find(r => r.id === output.runId)!;
        const inputCase = design.cases.find(c => c.id === sample.caseId)!;
        if (run.projectId !== projectId || run.agentContextId !== inputCase.agentContextId || !run.cells.some(c => c.key === output.cellKey))
          throw new ApplicationError('invalid-input', 'Stage output must reference an existing run cell for its input case and project.');
        if (inputCase.contentHash && !Object.values(run.contexts ?? {}).some(c => c.agentContextId === inputCase.agentContextId && c.contentHash === inputCase.contentHash))
          throw new ApplicationError('invalid-input', 'Stage output context does not match the pinned input hash.');
      }
      const judgements = await this.runs.judgements?.list() ?? [];
      const otherExperiments = (await this.store.list()).filter(e => e.projectId === projectId && e.id !== id);
      for (const comparison of design.comparisons) for (const judgementId of comparison.judgementIds) {
        const judgement = judgements.find(j => j.id === judgementId);
        const outputs = design.samples.filter(s => comparison.caseIds.includes(s.caseId) && comparison.conditionIds.includes(s.conditionId)).flatMap(s => s.outputs);
        if (!judgement || judgement.projectId !== projectId || !judgement.subjects.length || judgement.subjects.some(subject => !outputs.some(o => o.runId === subject.runId && o.cellKey === subject.outputKey)))
          throw new ApplicationError('invalid-input', 'Judgement subjects must belong to this comparison’s cases and conditions.');
        if (otherExperiments.some(e => e.comparisons.some(c => c.judgementIds.includes(judgementId))))
          throw new ApplicationError('conflict', 'This Judgement already has a home in another experiment.');
      }
      const now = new Date().toISOString();
      const saved: StoredExperiment = { ...design, schemaVersion: 1, id, projectId, revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now, lastRequest: { id: input.requestId, hash } };
      await this.store.save(saved); return this.public(saved);
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
}
