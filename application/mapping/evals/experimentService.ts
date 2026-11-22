import { isDeepStrictEqual } from 'node:util';
import { judgeDiagramChangeTrees } from '../../../domain/mapping/evals/diagramChangeTree';
import { experimentOverviewPhases, addExperimentCommentSchema, addGroundTruthSampleSchema, updateExperimentCommentSchema, updateExperimentCommentTagsSchema, updateExperimentTagsSchema, renameExperimentSchema, saveExperimentSchema, rerunExperimentSchema, relaunchExperimentSchema, approveExperimentSchema, judgeExperimentSchema, type EvalExperiment, type UpdateExperimentComment } from '../../../domain/mapping/evals/experiment';
import { summarizeEvalRun, type EvalRun } from '../../../domain/mapping/evals/evalRun';
import { sha256 } from '../../../domain/core/sha256';
import { ApplicationError } from '../../core/errors';
import type { EvalRunService } from './evalRunService';
import { ExperimentReadService } from './experimentReadService';
import { commentExcerpts } from '../../../domain/mapping/evals/experimentNodeComments';

export type StoredExperiment = EvalExperiment & { lastRequest: { id: string; hash: string }; reruns?: { id: string; hash: string }[]; startedRunIds?: string[]; preparedRuns?: EvalRun[]; approvalRequest?: { id: string; hash: string }; launches?: { id: string; hash: string; sample: EvalExperiment['samples'][number] }[] };
export interface ExperimentStore { list(): Promise<StoredExperiment[]>; read(id: string): Promise<StoredExperiment | null>; save(value: StoredExperiment): Promise<void> }
export class ExperimentService {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private store: ExperimentStore, private runs: Pick<EvalRunService, 'read' | 'judgements'> & Partial<Pick<EvalRunService, 'rerunWithSavedPrompt' | 'editedPrompt' | 'launchEdited' | 'prepareForReview' | 'launchPrepared' | 'outputResult' | 'promotionSource'>>,
    private projects: { loadProject(): Promise<{ id: string } | null> },
    private contexts: { read(id: string, resolveSources: boolean): Promise<{ contentHash: string }> }) {}
  private public({ reruns: _reruns, lastRequest: _, launches: __, preparedRuns: ___, approvalRequest: ____, startedRunIds: _____, ...record }: StoredExperiment): EvalExperiment { return structuredClone({ ...record, tags: record.tags ?? [] }); }
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
  overview(id: string) { return new ExperimentReadService(this, this.runs).overview(id); }
  readBatch(id: string, raw: unknown) { return new ExperimentReadService(this, this.runs).read(id, raw); }
  rename(id: string, raw: unknown) {
    const { name, expectedRevision } = renameExperimentSchema.parse(raw);
    const work = async () => {
      const experiment = await this.store.read(id);
      if (!experiment || experiment.projectId !== await this.projectId()) throw new ApplicationError('invalid-input', 'Experiment not found.');
      if (name === experiment.name) return this.public(experiment);
      if (experiment.revision !== expectedRevision) throw new ApplicationError('conflict', 'The experiment changed while you were editing. Review the current title and save again.');
      const saved = { ...experiment, name, revision: experiment.revision + 1, updatedAt: new Date().toISOString() };
      await this.store.save(saved);
      return this.public(saved);
    };
    const pending = this.writes.then(work);
    this.writes = pending.catch(() => {});
    return pending;
  }
  updateTags(id: string, raw: unknown) {
    const input = updateExperimentTagsSchema.parse(raw);
    const work = async () => {
      await this.read(id);
      const experiment = (await this.store.read(id))!;
      if (JSON.stringify(experiment.tags ?? []) === JSON.stringify(input.tags)) return this.public(experiment);
      if (experiment.revision !== input.expectedRevision) throw new ApplicationError('conflict', 'Experiment changed. Refresh before editing tags.');
      const saved = { ...experiment, tags: input.tags, revision: experiment.revision + 1, updatedAt: new Date().toISOString() };
      await this.store.save(saved);
      return this.public(saved);
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
  addComment(id: string, raw: unknown) {
    const input = addExperimentCommentSchema.parse(raw);
    const work = async () => {
      await this.read(id);
      const experiment = (await this.store.read(id))!;
      const existing = experiment.comments?.find(comment => comment.id === input.requestId);
      if (existing) {
        if (existing.text !== input.text || existing.phaseId !== input.phaseId || JSON.stringify(existing.tags ?? []) !== JSON.stringify(input.tags ?? []) || JSON.stringify(existing.anchor) !== JSON.stringify(input.anchor)) throw new ApplicationError('conflict', 'Request ID already used for different comment content.');
        return this.public(experiment);
      }
      if (input.phaseId && !experimentOverviewPhases(experiment).some(phase => phase.id === input.phaseId)) {
        throw new ApplicationError('invalid-input', 'The phase does not belong to this experiment.');
      }
      let excerpts;
      if (input.anchor) {
        const anchor = input.anchor;
        if (!experiment.samples.some(sample => sample.outputs.some(output => output.runId === anchor.runId && output.cellKey === anchor.cellKey)))
          throw new ApplicationError('invalid-input', 'The output set does not belong to this experiment.');
        const run = await this.runs.read(anchor.runId), cell = run.cells.find(cell => cell.key === anchor.cellKey);
        if (run.projectId !== experiment.projectId || !cell || cell.status !== 'finished' || cell.output?.format === 'markdown' || cell.output?.format === 'canvas-layout')
          throw new ApplicationError('invalid-input', 'Choose a completed canvas output.');
        if (!cell.output && anchor.checkpointId !== cell.checkpointId) throw new ApplicationError('invalid-input', 'The output snapshot changed.');
        const result = await this.runs.promotionSource?.(anchor.runId, anchor.cellKey);
        const canvas = result?.canvases.find(canvas => canvas.id === anchor.canvasId);
        if (!canvas) throw new ApplicationError('invalid-input', 'The canvas is not in this output set.');
        try { excerpts = commentExcerpts(canvas.proposed.document, anchor.selections); }
        catch (error) { throw new ApplicationError('invalid-input', error instanceof Error ? error.message : 'Invalid selection.'); }
      }
      const now = new Date().toISOString();
      const saved = { ...experiment, revision: experiment.revision + 1, updatedAt: now,
        commentTags: [...new Set([...(experiment.commentTags ?? []), ...(experiment.comments ?? []).flatMap(comment => comment.tags ?? []), ...(input.tags ?? [])])],
        comments: [...(experiment.comments ?? []), { id: input.requestId, text: input.text, createdAt: now, ...(input.phaseId ? { phaseId: input.phaseId } : {}), ...(input.tags ? { tags: input.tags } : {}), ...(input.anchor ? { anchor: input.anchor, excerpts } : {}) }] };
      await this.store.save(saved);
      return this.public(saved);
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
  updateCommentTags(id: string, commentId: string, raw: unknown) {
    return this.mutateComment(id, commentId, updateExperimentCommentTagsSchema.parse(raw));
  }
  updateComment(id: string, commentId: string, raw: unknown) {
    return this.mutateComment(id, commentId, updateExperimentCommentSchema.parse(raw));
  }
  deleteComment(id: string, commentId: string) { return this.mutateComment(id, commentId); }
  /** Append-only: the request ID becomes the sample ID, and identical retries return the saved experiment. */
  addGroundTruth(id: string, raw: unknown) {
    const { requestId, ...input } = addGroundTruthSampleSchema.parse(raw);
    const work = async () => {
      await this.read(id);
      const experiment = (await this.store.read(id))!;
      const reference = input.format === 'ascii-tree'
        ? { ...input, asciiSha256: sha256(input.ascii) }
        : { ...input, markdownSha256: sha256(input.markdown) };
      const existing = experiment.groundTruth?.find(sample => sample.id === requestId);
      if (existing) {
        const { id: _, createdAt: __, ...saved } = existing;
        if (!isDeepStrictEqual(saved, reference)) throw new ApplicationError('conflict', 'Request ID already used for a different ground truth sample.');
        return this.public(experiment);
      }
      const cases = new Set(experiment.cases.map(item => item.id));
      if (input.caseIds.some(caseId => !cases.has(caseId))) throw new ApplicationError('invalid-input', 'Ground truth names an unknown input case.');
      if (new Set(input.caseIds).size !== input.caseIds.length) throw new ApplicationError('invalid-input', 'Duplicate ground truth case.');
      const now = new Date().toISOString();
      const saved = { ...experiment, revision: experiment.revision + 1, updatedAt: now,
        groundTruth: [...(experiment.groundTruth ?? []), { id: requestId, ...reference, createdAt: now }] };
      await this.store.save(saved);
      return this.public(saved);
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
  private mutateComment(id: string, commentId: string, patch?: UpdateExperimentComment) {
    const work = async () => {
      await this.read(id);
      const experiment = (await this.store.read(id))!;
      const existing = experiment.comments?.find(comment => comment.id === commentId);
      if (!existing) {
        if (patch) throw new ApplicationError('invalid-input', 'Comment not found.');
        return this.public(experiment);
      }
      if (patch && (patch.text === undefined || patch.text === existing.text)
        && (patch.tags === undefined || JSON.stringify(existing.tags ?? []) === JSON.stringify(patch.tags))) return this.public(experiment);
      const comments = patch ? experiment.comments!.map(comment => comment.id === commentId ? { ...comment,
        ...(patch.text !== undefined ? { text: patch.text } : {}), ...(patch.tags !== undefined ? { tags: patch.tags } : {}) } : comment)
        : experiment.comments!.filter(comment => comment.id !== commentId);
      const commentTags = [...new Set([...(experiment.commentTags ?? []), ...(experiment.comments ?? []).flatMap(comment => comment.tags ?? []), ...(patch?.tags ?? [])])];
      const saved = { ...experiment, comments, commentTags, revision: experiment.revision + 1, updatedAt: new Date().toISOString() };
      await this.store.save(saved);
      return this.public(saved);
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
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
      const design = { ...input.experiment, tags: input.experiment.tags ?? previous?.tags ?? [] };
      if (previous?.inputLineage) {
        const retained = previous.inputLineage.filter(edge => design.cases.some(c => c.id === edge.caseId && c.agentContextId === edge.agentContextId));
        design.inputLineage ??= retained;
        for (const edge of retained) {
          const replacement = design.inputLineage.find(item => item.caseId === edge.caseId);
          if (JSON.stringify(replacement?.sources) !== JSON.stringify(edge.sources))
            throw new ApplicationError('conflict', 'Recorded source outputs for a pinned case cannot change.');
        }
      }
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
      const incoming = otherExperiments.flatMap(e => (e.inputLineage ?? []).flatMap(edge => edge.sources.filter(source => source.experimentId === id)));
      for (const source of incoming) {
        if (!design.samples.some(sample => sample.outputs.some(output => output.runId === source.runId && output.cellKey === source.cellKey)))
          throw new ApplicationError('conflict', 'Another experiment uses this output as a pinned input.');
      }
      for (const edge of design.inputLineage ?? []) {
        for (const source of edge.sources) {
          const producer = source.experimentId === id ? design : otherExperiments.find(e => e.id === source.experimentId);
          const sample = producer?.samples.find(s => s.outputs.some(o => o.runId === source.runId && o.cellKey === source.cellKey));
          if (!sample || (producer === design && sample.caseId === edge.caseId))
            throw new ApplicationError('invalid-input', 'Input lineage must reference a registered upstream output in this project.');
        }
      }
      for (const comparison of design.comparisons) for (const judgementId of comparison.judgementIds) {
        const judgement = judgements.find(j => j.id === judgementId);
        const outputs = design.samples.filter(s => s.phaseId === comparison.phaseId && comparison.caseIds.includes(s.caseId) && comparison.conditionIds.includes(s.conditionId)).flatMap(s => s.outputs);
        if (!judgement || judgement.projectId !== projectId || !judgement.subjects.length || judgement.subjects.some(subject => !outputs.some(o => o.runId === subject.runId && o.cellKey === subject.outputKey)))
          throw new ApplicationError('invalid-input', 'Judgement subjects must belong to this comparison’s phase, cases and conditions.');
        if (otherExperiments.some(e => e.comparisons.some(c => c.judgementIds.includes(judgementId))))
          throw new ApplicationError('conflict', 'This Judgement already has a home in another experiment.');
      }
      const samePlan = JSON.stringify(previous?.plannedRuns) === JSON.stringify(design.plannedRuns)
        && JSON.stringify(previous?.cases) === JSON.stringify(design.cases);
      const startedRunIds = previous?.startedRunIds ?? (previous?.generationReview?.status === 'started' ? previous.plannedRuns?.map(p => p.request.requestId) ?? [] : []);
      if (previous?.generationReview?.status === 'starting' && !samePlan)
        throw new ApplicationError('conflict', 'Finish the recorded generation approval before changing the plan.');
      for (const old of previous?.plannedRuns ?? []) if (startedRunIds.includes(old.request.requestId)) {
        if (JSON.stringify(design.plannedRuns?.find(p => p.request.requestId === old.request.requestId)) !== JSON.stringify(old))
          throw new ApplicationError('conflict', 'An approved generation plan cannot be changed. Add a new phase instead.');
        for (const output of old.outputs) {
          const before = previous!.samples.find(s => s.id === output.sampleId)!;
          const after = design.samples.find(s => s.id === before.id);
          // Introducing phases may label the original round without changing its approved execution.
          const comparable = after && !previous!.phases?.length && !before.phaseId
            ? (({ phaseId: _, ...sample }) => sample)(after) : after;
          if (JSON.stringify(comparable) !== JSON.stringify(before) || JSON.stringify(design.cases.find(c => c.id === before.caseId)) !== JSON.stringify(previous!.cases.find(c => c.id === before.caseId)))
            throw new ApplicationError('conflict', 'Approved samples and inputs cannot be reassigned.');
        }
      }
      let preparedRuns = samePlan ? previous?.preparedRuns : undefined;
      if (design.plannedRuns?.length && !preparedRuns) {
        if (!this.runs.prepareForReview) throw Error('Generation review is unavailable.');
        preparedRuns = [];
        for (const plan of design.plannedRuns) {
          const alreadyStarted = startedRunIds.includes(plan.request.requestId);
          const run = alreadyStarted ? previous!.preparedRuns!.find(r => r.id === plan.request.requestId)! : await this.runs.prepareForReview(plan.request);
          if (run.projectId !== projectId) throw Error('Planned run belongs to another project.');
          if (run.cells.length !== plan.outputs.length || new Set(plan.outputs.map(o => o.cellKey)).size !== run.cells.length) throw Error('Map every planned generation cell exactly once.');
          for (const output of plan.outputs) {
            const sample = design.samples.find(s => s.id === output.sampleId)!;
            const inputCase = design.cases.find(c => c.id === sample.caseId)!;
            if (!run.cells.some(c => c.key === output.cellKey) || run.agentContextId !== inputCase.agentContextId
              || inputCase.contentHash && !Object.values(run.contexts ?? {}).some(c => c.contentHash === inputCase.contentHash)) throw Error('Planned output does not match its case and cell.');
            if (!alreadyStarted && sample.outputs.some(o => o.stageId === output.stageId)) throw Error('Planned stage already has an output.');
          }
          preparedRuns.push(run);
        }
      }
      for (const plan of design.plannedRuns ?? []) for (const output of plan.outputs) {
        const sample = design.samples.find(s => s.id === output.sampleId)!;
        const inputCase = design.cases.find(c => c.id === sample.caseId)!;
        const run = preparedRuns!.find(r => r.id === plan.request.requestId)!;
        if (run.agentContextId !== inputCase.agentContextId) throw Error('Planned sample input cannot be reassigned.');
        if (!startedRunIds.includes(plan.request.requestId) && sample.outputs.some(o => o.stageId === output.stageId)) throw Error('Planned stage already has an output.');
      }
      const generationReview = preparedRuns?.length ? samePlan && previous?.generationReview
        ? previous.generationReview : { status: 'awaiting-approval' as const, runs: preparedRuns.filter(r => !startedRunIds.includes(r.id)).map(summarizeEvalRun) } : undefined;
      const now = new Date().toISOString();
      const saved: StoredExperiment = { ...design, ...(previous?.reruns ? { reruns: previous.reruns } : {}), ...(previous?.comments ? { comments: previous.comments } : {}), ...(previous?.commentTags ? { commentTags: previous.commentTags } : {}), ...(previous?.groundTruth ? { groundTruth: previous.groundTruth } : {}), startedRunIds, ...(preparedRuns ? { preparedRuns, generationReview } : {}), ...(samePlan && previous?.approvalRequest ? { approvalRequest: previous.approvalRequest } : {}), ...(previous?.launches ? { launches: previous.launches } : {}), schemaVersion: 1, id, projectId, revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now, lastRequest: { id: input.requestId, hash } };
      await this.store.save(saved); return this.public(saved);
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
  approve(id: string, raw: unknown) {
    const input = approveExperimentSchema.parse(raw), hash = sha256(JSON.stringify(input));
    const work = async () => {
      await this.read(id);
      const experiment = (await this.store.read(id))!;
      const receipt = experiment.approvalRequest;
      if (receipt && (receipt.id !== input.requestId || receipt.hash !== hash)) throw new ApplicationError('conflict', 'Generation approval already recorded. Refresh the experiment.');
      if (!receipt && experiment.revision !== input.expectedRevision) throw new ApplicationError('conflict', 'Experiment changed. Review its current prompts before approving.');
      if (!experiment.preparedRuns?.length || !experiment.generationReview || !this.runs.launchPrepared) throw Error('No generation plan to approve.');
      if (experiment.generationReview.status === 'started') return this.public(experiment);
      if (!receipt) {
        experiment.approvalRequest = { id: input.requestId, hash };
        experiment.generationReview.approval = input;
        experiment.generationReview.status = 'starting'; experiment.generationReview.approvedAt = new Date().toISOString();
        experiment.revision++; experiment.updatedAt = new Date().toISOString();
        await this.store.save(experiment);
      }
      for (const run of experiment.preparedRuns) if (!(experiment.startedRunIds ?? []).includes(run.id)) {
        await this.runs.launchPrepared(run);
        (experiment.startedRunIds ??= []).push(run.id);
        await this.store.save(experiment);
      }
      for (const plan of experiment.plannedRuns ?? []) for (const output of plan.outputs) {
        const sample = experiment.samples.find(s => s.id === output.sampleId)!;
        if (!sample.outputs.some(o => o.stageId === output.stageId)) sample.outputs.push({ stageId: output.stageId, runId: plan.request.requestId, cellKey: output.cellKey });
      }
      experiment.generationReview.status = 'started'; experiment.revision++; experiment.updatedAt = new Date().toISOString();
      await this.store.save(experiment); return this.public(experiment);
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
  judge(id: string, raw: unknown) {
    const input = judgeExperimentSchema.parse(raw), fingerprint = sha256(JSON.stringify({ experimentId: id, ...input }));
    const work = async () => {
      await this.read(id);
      const experiment = (await this.store.read(id))!;
      const comparison = experiment.comparisons.find(c => c.id === input.comparisonId);
      if (!comparison?.evaluator || !this.runs.judgements) throw new ApplicationError('invalid-input', 'Choose a deterministic phase assessment.');
      if (comparison.judgementIds.includes(input.requestId)) {
        const previous = await this.runs.judgements.read(input.requestId);
        if (previous.source.fingerprint !== fingerprint) throw new ApplicationError('conflict', 'Judgement request ID already used.');
        return this.public(experiment);
      }
      if (experiment.revision !== input.expectedRevision) throw new ApplicationError('conflict', 'Experiment changed. Refresh before judging.');
      const samples = experiment.samples.filter(s => s.phaseId === comparison.phaseId && comparison.caseIds.includes(s.caseId) && comparison.conditionIds.includes(s.conditionId));
      if (!samples.length || samples.some(s => !s.outputs.length || !s.relaunchedFrom && s.outputs.length !== experiment.workflow.stages.length))
        throw new ApplicationError('invalid-input', 'Generate all phase outputs before running this assessment.');
      const outputs = samples.flatMap(s => s.outputs);
      const runs = await Promise.all([...new Set(outputs.map(o => o.runId))].map(id => this.runs.read(id)));
      const evidence = outputs.map(output => {
        const run = runs.find(r => r.id === output.runId)!;
        const cell = run.cells.find(c => c.key === output.cellKey);
        if (run.projectId !== experiment.projectId || !cell || cell.status !== 'finished' || cell.proposalTree === undefined || !cell.canvasId || !cell.checkpointId)
          throw new ApplicationError('invalid-input', 'Every assessed output must be a finished diagram-change proposal.');
        return { runId: run.id, outputKey: cell.key, text: cell.proposalTree, source: { documentId: cell.canvasId, checkpointId: cell.checkpointId } };
      });
      const now = new Date().toISOString();
      await this.runs.judgements.saveDeterministic({ schemaVersion: 1, id: input.requestId, projectId: experiment.projectId,
        title: `${experiment.phases?.find(p => p.id === comparison.phaseId)?.name ?? experiment.name} · ${comparison.name}`,
        createdAt: now, updatedAt: now, runIds: runs.map(r => r.id), subjects: evidence.map(({ text: _, ...subject }) => subject),
        evaluator: comparison.evaluator, kind: 'diagram-change-tree', status: 'finished', canvases: [],
        source: { kind: 'experiment', id, fingerprint }, data: judgeDiagramChangeTrees(evidence.map(({ source: _, ...item }) => item)) });
      comparison.judgementIds.push(input.requestId); experiment.revision++; experiment.updatedAt = now;
      await this.store.save(experiment);
      return this.public(experiment);
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
  rerun(id: string, raw: unknown) {
    const input = rerunExperimentSchema.parse(raw);
    const hash = sha256(JSON.stringify([input.runId, input.cellKey, input.prompt]));
    const work = async () => {
      await this.read(id);
      const experiment = (await this.store.read(id))!;
      const receipt = experiment.reruns?.find(item => item.id === input.requestId);
      if (receipt && receipt.hash !== hash) throw new ApplicationError('conflict', 'Rerun request ID already used.');
      if (receipt && experiment.samples.some(sample => sample.id === `rerun-${input.requestId}-0`))
        return { experiment: this.public(experiment), runId: input.requestId };
      if (!receipt && input.expectedRevision !== experiment.revision)
        throw new ApplicationError('conflict', 'The experiment changed. Review the refreshed experiment and try again.');
      const selected = experiment.samples.flatMap(sample => sample.outputs).find(output => output.runId === input.runId && output.cellKey === input.cellKey);
      if (!selected || !this.runs.rerunWithSavedPrompt) throw new ApplicationError('invalid-input', 'Choose an existing generation to rerun.');
      const source = await this.runs.read(selected.runId);
      const originalPrompt = source.cells.find(cell => cell.key === selected.cellKey)?.promptId;
      if (!originalPrompt) throw new ApplicationError('invalid-input', 'Pinned prompt is unavailable.');
      // Reserve the request before generation so a retry after an interrupted attachment reuses the run.
      if (!receipt) {
        experiment.reruns = [...experiment.reruns ?? [], { id: input.requestId, hash }];
        await this.store.save(experiment);
      }
      const run = await this.runs.rerunWithSavedPrompt(source, selected.cellKey, input.prompt, input.requestId);
      const attemptKey = (sample: EvalExperiment['samples'][number]) => JSON.stringify([sample.phaseId, sample.caseId, sample.conditionId, sample.number]);
      const attempts = new Map<string, number>();
      for (const sample of [...experiment.samples, ...(experiment.launches ?? []).map(item => item.sample)]) {
        const key = attemptKey(sample);
        attempts.set(key, Math.max(sample.attempt, attempts.get(key) ?? 0));
      }
      const originals = experiment.samples.filter(sample => sample.outputs.some(output => output.runId === source.id));
      for (const [index, original] of originals.entries()) {
        const outputs = original.outputs.filter(output => output.runId === source.id).map(output => {
          const before = source.cells.find(cell => cell.key === output.cellKey)!;
          const promptId = before.promptId === originalPrompt ? input.prompt.promptId : before.promptId;
          const cell = run.cells.find(cell => cell.stage === before.stage && cell.pass === before.pass && cell.promptId === promptId);
          if (!cell) throw new ApplicationError('conflict', 'The rerun is missing an expected output.');
          return { stageId: output.stageId, runId: run.id, cellKey: cell.key };
        });
        const key = attemptKey(original), attempt = attempts.get(key)! + 1;
        attempts.set(key, attempt);
        experiment.samples.push({ ...original, id: `rerun-${input.requestId}-${index}`, attempt,
          relaunchedFrom: { sampleId: original.id, stageId: outputs.find(output => output.stageId === selected.stageId)?.stageId ?? outputs[0].stageId }, outputs });
      }
      experiment.revision++;
      experiment.updatedAt = new Date().toISOString();
      await this.store.save(experiment);
      return { experiment: this.public(experiment), runId: run.id };
    };
    const pending = this.writes.then(work);
    this.writes = pending.catch(() => {});
    return pending;
  }
  relaunch(id: string, raw: unknown) {
    const input = relaunchExperimentSchema.parse(raw), hash = sha256(JSON.stringify(input));
    const work = async () => {
      await this.read(id);
      const experiment = (await this.store.read(id))!;
      let receipt = experiment.launches?.find(l => l.id === input.requestId);
      if (receipt && receipt.hash !== hash) throw new ApplicationError('conflict', 'Relaunch request ID already used for different edits.');
      if (receipt && experiment.samples.some(s => s.id === receipt!.sample.id)) return { experiment: this.public(experiment), runId: input.requestId };
      if (!receipt && input.expectedRevision !== experiment.revision) throw new ApplicationError('conflict', 'Experiment changed. Refresh before relaunching.');
      const sample = experiment.samples.find(s => s.id === input.sampleId), output = sample?.outputs.find(o => o.stageId === input.stageId);
      if (!sample || !output || !this.runs.launchEdited || !this.runs.editedPrompt) throw new ApplicationError('invalid-input', 'Choose an existing generation output to relaunch.');
      const source = await this.runs.read(output.runId);
      await this.runs.editedPrompt(source, output.cellKey, input.stages, input.requestId);
      if (!receipt) {
        const attempts = [...experiment.samples, ...(experiment.launches ?? []).map(l => l.sample)].filter(s => s.phaseId === sample.phaseId && s.caseId === sample.caseId && s.conditionId === sample.conditionId && s.number === sample.number);
        receipt = { id: input.requestId, hash, sample: { id: `attempt-${input.requestId}`, ...(sample.phaseId ? { phaseId: sample.phaseId } : {}), caseId: sample.caseId, conditionId: sample.conditionId, number: sample.number,
          attempt: Math.max(...attempts.map(s => s.attempt)) + 1, relaunchedFrom: { sampleId: sample.id, stageId: input.stageId }, outputs: [] } };
        experiment.launches = [...experiment.launches ?? [], receipt];
        await this.store.save(experiment);
      }
      const run = await this.runs.launchEdited(source.id, output.cellKey, input.stages, input.requestId);
      const selected = source.cells.find(c => c.key === output.cellKey)!;
      const outputs = sample.outputs.filter(o => o.runId === source.id).flatMap(o => {
        const before = source.cells.find(c => c.key === o.cellKey);
        if (!before || before.promptId !== selected.promptId || source.workflow !== 'few-shot-refinement' && before.pass !== selected.pass) return [];
        const cell = run.cells.find(c => c.stage === before.stage && c.pass === (source.workflow === 'few-shot-refinement' ? before.pass : 1));
        if (!cell) throw Error('Relaunched workflow did not produce the expected stage cell.');
        return [{ stageId: o.stageId, runId: run.id, cellKey: cell.key }];
      });
      experiment.samples.push({ ...receipt.sample, outputs }); experiment.revision++; experiment.updatedAt = new Date().toISOString();
      await this.store.save(experiment);
      return { experiment: this.public(experiment), runId: run.id };
    };
    const pending = this.writes.then(work); this.writes = pending.catch(() => {}); return pending;
  }
}
