import { projectOutput, projectCopies } from '../../../domain/mapping/projections/savedCanvasProjection';
import { type ProjectionType } from '../../../domain/mapping/projections/projectionType';
import { projectExperimentOverview, type ExperimentReadTarget } from '../../../domain/mapping/evals/experimentOverviewProjection';
import { experimentReadBatchSchema, type ExperimentReadBatchResult, type ExperimentReadResult, type ExperimentReadValue } from '../../../domain/mapping/evals/experimentOverview';
import type { EvalExperiment } from '../../../domain/mapping/evals/experiment';
import { summarizeEvalRun, type EvalRun, type EvalRunSummary } from '../../../domain/mapping/evals/evalRun';
import type { EvalRunService } from './evalRunService';

/** Bound storage pressure while keeping independent reads concurrent and ordered. */
async function concurrent<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    for (;;) { const index = next++; if (index >= items.length) return; results[index] = await read(items[index]); }
  }));
  return results;
}

export class ExperimentReadService {
  constructor(private experiments: { read(id: string): Promise<EvalExperiment> },
    private runs: Pick<EvalRunService, 'read'> & Partial<Pick<EvalRunService, 'outputResult' | 'promotionSource' | 'judgements'>>) {}

  private async context(id: string) {
    const experiment = await this.experiments.read(id);
    const ids = [...new Set([...experiment.samples.flatMap(sample => sample.outputs.map(output => output.runId)),
      ...(experiment.plannedRuns ?? []).map(plan => plan.request.requestId), ...(experiment.generationReview?.runs ?? []).map(run => run.id)])];
    const loaded = await concurrent(ids, async id => {
      try { const run = await this.runs.read(id); return run.projectId === experiment.projectId && !run.deletedAt ? run : undefined; }
      catch { return undefined; }
    });
    const full = new Map(loaded.flatMap(run => run ? [[run.id, run] as const] : []));
    const summaries = new Map((experiment.generationReview?.runs ?? []).filter(run => run.projectId === experiment.projectId).map(run => [run.id, run]));
    full.forEach(run => summaries.set(run.id, summarizeEvalRun(run)));
    return { experiment, full, summaries, ...projectExperimentOverview(experiment, [...summaries.values()]) };
  }

  async overview(id: string) { return (await this.context(id)).overview; }

  /** Read-only despite POST: the body allows a batch of opaque references without URL limits. */
  async read(id: string, raw: unknown): Promise<ExperimentReadBatchResult> {
    const input = experimentReadBatchSchema.parse(raw);
    const context = await this.context(id);
    const { experiment, full, summaries, reads } = context;
    // Duplicate references share work, but results retain the caller's order and multiplicity.
    const results = await concurrent([...new Set(input.refs)], async (ref): Promise<ExperimentReadResult> => {
      const target = reads.get(ref);
      if (!target) return { ref, status: 'error', error: { code: 'not-found', message: 'Reference is not present in this experiment overview. Read the current overview.' } };
      try { return { ref, status: 'ok', value: await this.value(experiment, target, full, summaries, input.projectionType) }; }
      catch (error) { return { ref, status: 'error', error: { code: error instanceof UnavailableRead ? 'unavailable' : 'read-failed', message: error instanceof Error ? error.message : 'Read failed.' } }; }
    });
    const byRef = new Map(results.map(result => [result.ref, result]));
    return { experimentId: id, revision: experiment.revision, results: input.refs.map(ref => byRef.get(ref)!) };
  }

  private async value(experiment: EvalExperiment, target: ExperimentReadTarget, full: Map<string, EvalRun>, summaries: Map<string, EvalRunSummary>, projectionType: ProjectionType): Promise<ExperimentReadValue> {
    if (target.kind === 'prompt') {
      const source = target.sources[0], run = summaries.get(source.runId);
      const pinned = run?.prompts.find(prompt => prompt.promptId === source.promptId && (!source.version || prompt.version === source.version));
      const text = pinned?.stages[target.stage];
      if (text === undefined || !pinned) throw new UnavailableRead('Pinned prompt is unavailable.');
      return { kind: 'prompt', name: pinned.name, stage: target.stage, text, textKind: 'pinned-template', templateSource: pinned.templateSources?.[target.stage], references: pinned.references, sources: target.sources };
    }
    if (target.kind === 'conditions') return { kind: 'conditions', data: experiment.conditions };
    if (target.kind === 'ground-truth') {
      const sample = experiment.groundTruth?.find(sample => sample.id === target.sampleId);
      if (!sample) throw new UnavailableRead('Ground truth sample is unavailable.');
      return { kind: 'ground-truth', data: sample };
    }
    if (target.kind === 'settings') return { kind: 'settings', data: [...summaries.values()].map(run => ({ runId: run.id, name: run.name, request: run.request })) };
    if (target.kind === 'case') {
      const input = experiment.cases.find(input => input.id === target.caseId)!;
      return { kind: 'case', data: { ...input, runs: [...summaries.values()].filter(run => run.agentContextId === input.agentContextId).map(run => ({ runId: run.id, name: run.name, contexts: run.contexts, inputs: run.inputs, canvasInputs: run.canvasInputs })) } };
    }
    if (target.kind === 'judgement') {
      const judgement = await this.runs.judgements?.read(target.judgementId);
      if (!judgement || judgement.projectId !== experiment.projectId) throw new UnavailableRead('Saved judgement is unavailable.');
      return { kind: 'judgement', data: projectCopies(judgement, projectionType) };
    }
    const sample = experiment.samples.find(sample => sample.id === target.sampleId)!;
    const input = experiment.cases.find(input => input.id === sample.caseId);
    const run = target.runId ? summaries.get(target.runId) : undefined;
    const cell = run?.cells.find(cell => cell.key === target.cellKey);
    if (target.kind === 'inputs') return { kind: 'inputs', data: { case: input, contexts: run?.contexts, canvases: run?.inputs, canvasSet: run?.canvasInputs, history: run?.historyInput,
      request: run?.request ?? experiment.plannedRuns?.find(plan => plan.request.requestId === target.runId)?.request,
      available: !!run, note: 'Pinned input references and hashes; source payloads remain in AgentContexts and canvas checkpoints.' } };
    if (!run || !cell || cell.deleted) throw new UnavailableRead('Run cell is unavailable.');
    if (target.kind === 'details') return { kind: 'details', data: { runId: run.id, sampleId: sample.id, stageId: target.stageId, cell } };
    if (cell.status !== 'finished') throw new UnavailableRead(`Output is ${cell.status}; no completed result is available.`);
    const saved = full.get(run.id)?.outputResults?.[cell.key];
    if (saved) return { kind: 'output', result: projectOutput(saved, projectionType) };
    if (cell.historyArtifact && this.runs.outputResult) return { kind: 'output', result: projectOutput(await this.runs.outputResult(run.id, cell.key), projectionType) };
    // Older runs retain a pinned canvas/checkpoint rather than an EvalOutputResult.
    if (cell.canvasId && cell.checkpointId && this.runs.promotionSource) return { kind: 'output', result: projectOutput(await this.runs.promotionSource(run.id, cell.key), projectionType) };
    throw new UnavailableRead('Saved output is unavailable.');
  }
}
class UnavailableRead extends Error {}
