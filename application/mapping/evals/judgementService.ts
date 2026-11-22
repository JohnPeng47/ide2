import { fewShotProgressSchema } from '../../../domain/mapping/evals/fewShot';
import { diagramChangeTreeResultSchema } from '../../../domain/mapping/evals/diagramChangeTree';
import { ApplicationError } from '../../core/errors';
import type { ComparisonRun } from '../../../domain/mapping/compare/comparisonGeneration';
import type { ComparePageSession, CompareCanvasCopy } from '../../../domain/mapping/compare/comparePageSession';
import { canvasJudgementSchema, diagramJudgementSchema, summarizeJudgement, type Judgement, type JudgementSubject } from '../../../domain/mapping/evals/judgement';
import type { CompareSessionService } from '../compare/compareSessionService';
import type { ComparisonGenerationService, ComparisonRunStore } from '../compare/comparisonGenerationService';
import type { EvalRunStore } from './evalRunService';

export interface JudgementStore { list(): Promise<Judgement[]>; read(id: string): Promise<Judgement | null>; save(value: Judgement): Promise<void> }

/** Imports existing comparisons and materializes new evaluator results as independently typed records. */
export class JudgementService {
  private queue = Promise.resolve();
  constructor(private store: JudgementStore, private sessions: CompareSessionService, private comparisonStore: ComparisonRunStore,
    private comparisons: ComparisonGenerationService, private runs: EvalRunStore) {
    this.queue = store.list().then(async records => {
      for (const item of records) if (item.source.kind === 'eval-run' && !item.deletedAt && ['queued', 'generating'].includes(item.status))
        await store.save({ ...item, status: 'failed', error: 'Server restarted during evaluation. Completed rounds are retained.', updatedAt: new Date().toISOString() });
    });
  }
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(task); this.queue = pending.then(() => {}, () => {}); return pending;
  }
  private async reconcile() {
    const [sessions, jobs, existing, runs] = await Promise.all([this.sessions.list(), this.comparisonStore.list(), this.store.list(), this.runs.list()]);
    const records = new Map(existing.map(item => [item.id, item]));
    const jobsById = new Map(jobs.map(job => [job.sessionId ?? job.id, job]));
    const sources = new Set([...sessions.map(item => item.id), ...jobs.map(item => item.id)]);
    const subjects = (canvases: CompareCanvasCopy[]): JudgementSubject[] => canvases.map(copy => {
      const owner = runs.find(run => run.id === copy.generated?.runId) ?? runs.find(run => run.cells.some(cell => cell.canvasId === copy.source.documentId));
      const runId = owner?.id ?? copy.generated?.runId;
      const outputKey = owner?.cells.find(cell => cell.canvasId === copy.source.documentId)?.key;
      return { source: copy.source, ...(runId ? { runId } : {}), ...(outputKey ? { outputKey } : {}) };
    });
    const fingerprint = (job?: ComparisonRun) => JSON.stringify(job ? [job.status, job.completedAt, job.error, job.sessionId] : ['manual']);
    const save = async (sourceId: string, session: ComparePageSession | undefined, job: ComparisonRun | undefined) => {
      const canvases = session?.canvases ?? job!.canvases, refs = subjects(canvases);
      const common = { schemaVersion: 1 as const, projectId: session?.projectId ?? job!.projectId,
        title: session?.title ?? job!.request.title, createdAt: job?.createdAt ?? session!.createdAt, updatedAt: job?.completedAt ?? session?.createdAt ?? job!.createdAt,
        subjects: refs, runIds: [...new Set(refs.flatMap(ref => ref.runId ? [ref.runId] : []))], canvases,
        evaluator: job ? { kind: 'model' as const, model: job.request.model, effort: job.request.effort,
          ...(job.evaluationPrompt ? { prompt: job.evaluationPrompt, promptVersion: job.evaluationPromptVersion ?? 1 } : {}) } : { kind: 'manual' as const },
        status: session ? 'finished' as const : job!.status === 'finished' ? 'failed' as const : job!.status,
        error: !session && job?.status === 'finished' ? 'The saved comparison result is unavailable.' : job?.error, usage: job?.usage,
        source: { kind: 'comparison' as const, id: sourceId, fingerprint: fingerprint(job) } };
      const diagrams = session?.compares.filter(pair => pair.A.kind === 'diagram' && pair.B.kind === 'diagram') ?? [];
      const canvasesCompared = session?.compares.filter(pair => pair.A.kind !== 'diagram' && pair.B.kind !== 'diagram') ?? [];
      const results: Judgement[] = [];
      if (job?.request.experiment) results.push({ ...common, id: `${sourceId}-report`, kind: 'comparison-report', status: job.status, error: job.error, ...(job.report ? { data: job.report } : {}) });
      if (diagrams.length || !session && job && !job.request.experiment) results.push({ ...common, id: `${sourceId}-diagram`, kind: 'diagram-comparison',
        ...(diagrams.length ? { data: diagramJudgementSchema.parse({ comparisons: diagrams }) } : {}) });
      if (canvasesCompared.length) results.push({ ...common, id: `${sourceId}-canvas`, kind: 'canvas-comparison', data: canvasJudgementSchema.parse({
        comparisons: canvasesCompared.map(pair => ({ ...pair, A: { ...pair.A, kind: 'canvas' }, B: { ...pair.B, kind: 'canvas' } }))
      }) });
      for (const result of results) {
        if (result.data && result.kind !== 'few-shot-progress' && result.kind !== 'comparison-report' && result.kind !== 'diagram-change-tree') {
          const used = new Set(result.data.comparisons.flatMap(pair => [pair.A.canvasCopyId, pair.B.canvasCopyId]));
          result.canvases = canvases.filter(copy => used.has(copy.id));
          result.subjects = subjects(result.canvases);
          result.runIds = [...new Set(result.subjects.flatMap(ref => ref.runId ? [ref.runId] : []))];
        }
        const previous = records.get(result.id);
        if (previous?.deletedAt) continue;
        if (!previous || previous.status !== result.status || previous.source.fingerprint !== result.source.fingerprint || JSON.stringify(previous.subjects) !== JSON.stringify(result.subjects)) await this.store.save(result);
      }
    };
    for (const summary of sessions) {
      const job = jobsById.get(summary.id);
      // Completed session snapshots never change; avoid loading them again during polling.
      const previous = existing.filter(item => item.source.id === summary.id);
      if (previous.length && previous.every(item => item.deletedAt || item.status === 'finished' && item.source.fingerprint === fingerprint(job) && item.subjects.every(ref => ref.runId))) continue;
      await save(summary.id, await this.sessions.read(summary.id), job);
    }
    for (const job of jobs) if (!sessions.some(session => session.id === (job.sessionId ?? job.id))) await save(job.id, undefined, job);
    // Deletion through legacy comparison APIs also removes its imported judgements.
    for (const item of existing) if (item.source.kind === 'comparison' && !item.deletedAt && !sources.has(item.source.id)) await this.store.save({ ...item, deletedAt: new Date().toISOString() });
  }
  /** Native workflow results share the same durable store, without legacy import ownership. */
  saveDeterministic(item: Extract<Judgement, { kind: 'diagram-change-tree' }>) {
    return this.serialize(async () => {
      const previous = await this.store.read(item.id);
      if (previous) {
        if (previous.deletedAt || previous.source.fingerprint !== item.source.fingerprint) throw new ApplicationError('conflict', 'Judgement request ID already used.');
        return previous;
      }
      diagramChangeTreeResultSchema.parse(item.data);
      await this.store.save(structuredClone(item));
      return item;
    });
  }
  /** Agent-authored evidence is immutable; identical retries return the saved record. */
  saveTreeComparison(item: Extract<Judgement, { kind: 'comparison-report' }>) {
    return this.serialize(async () => {
      const previous = await this.store.read(item.id);
      if (previous) {
        if (previous.deletedAt || previous.source.fingerprint !== item.source.fingerprint) throw new ApplicationError('conflict', 'Judgement request ID already used.');
        return previous;
      }
      await this.store.save(structuredClone(item));
      return item;
    });
  }
  saveProgress(item: Extract<Judgement, { kind: 'few-shot-progress' }>) {
    return this.serialize(async () => {
      const previous = await this.store.read(item.id);
      if (previous?.deletedAt) return;
      if (item.data) fewShotProgressSchema.parse(item.data);
      await this.store.save(structuredClone(item));
    });
  }
  async list(runId?: string) {
    return this.serialize(async () => {
      await this.reconcile();
      return (await this.store.list()).filter(item => !item.deletedAt && (!runId || item.runIds.includes(runId)))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(summarizeJudgement);
    });
  }
  async read(id: string) {
    return this.serialize(async () => {
      await this.reconcile();
      const item = await this.store.read(id);
      if (!item || item.deletedAt) throw new ApplicationError('invalid-input', 'Judgement not found.');
      return item;
    });
  }
  async delete(id: string) {
    return this.serialize(async () => {
      await this.reconcile();
      const item = await this.store.read(id);
      if (!item || item.deletedAt) return;
      await this.store.save({ ...item, deletedAt: new Date().toISOString() });
      if (item.source.kind === 'comparison' && (item.status === 'queued' || item.status === 'generating')) await this.comparisons.delete(item.source.id);
    });
  }
}
