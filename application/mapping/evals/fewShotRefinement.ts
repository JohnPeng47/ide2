import { randomUUID } from 'node:crypto';
import type { EvalReferenceService } from './evalReferenceService';
import type { z } from 'zod';
import { canvasContext } from '../../../domain/mapping/rollup/rollUp';
import { composePrompt, evalWorkflows } from '../../../domain/mapping/evals/evalWorkflows';
import { cellKey, type EvalRun, type EvalRunCell } from '../../../domain/mapping/evals/evalRun';
import { FEW_SHOT_ROUNDS, FEW_SHOT_ALTERNATIVES, seedReferencesSchema, roundJudgementSchema, type FewShotReference } from '../../../domain/mapping/evals/fewShot';
import type { Judgement } from '../../../domain/mapping/evals/judgement';
import type { EvalRuntime } from './evalRunService';
import type { JudgementService } from './judgementService';

export function firstTarget(run: Pick<EvalRun, 'inputs'>) {
  const diagram = canvasContext(run.inputs.target, false).diagrams
    .sort((a, b) => a.position.row - b.position.row || a.position.column - b.position.column)[0];
  if (!diagram || !('ascii' in diagram) || !diagram.ascii) throw Error('The target has no diagram content.');
  return diagram;
}
export function fewShotCells(prompt: EvalRun['prompts'][number]): EvalRunCell[] {
  const cell = (stage: string, pass: number): EvalRunCell => ({ key: cellKey(prompt.promptId, pass, stage), stage, pass,
    promptId: prompt.promptId, promptVersion: prompt.version, promptName: prompt.name, status: 'queued' });
  return [cell('seed', 1), ...Array.from({ length: FEW_SHOT_ROUNDS }, (_, r) => [
    ...Array.from({ length: FEW_SHOT_ALTERNATIVES }, (_, i) => cell('alternative', r * FEW_SHOT_ALTERNATIVES + i + 1)), cell('judge', r + 1)
  ]).flat()];
}

/** The only adaptive input to generation is the versioned five-slot reference set. */
export async function executeFewShot(input: {
  run: EvalRun; runtime: EvalRuntime; judgements: JudgementService; signal: AbortSignal; context: unknown;
  referenceLibrary?: Partial<Pick<EvalReferenceService, "create">>;
  persist: () => Promise<void>;
  generate: (cell: EvalRunCell, round: number, alternative: number, references: FewShotReference[]) => Promise<void>;
}) {
  const { run, runtime, judgements, signal, persist } = input, prompt = run.prompts[0];
  const target = firstTarget(run);
  const report: Extract<Judgement, { kind: 'few-shot-progress' }> = {
    schemaVersion: 1, kind: 'few-shot-progress', id: `${run.id}-progress`, projectId: run.projectId, title: 'Few-shot refinement · three rounds',
    createdAt: run.createdAt, updatedAt: new Date().toISOString(), runIds: [run.id], subjects: [],
    evaluator: { kind: 'model', model: run.request.model, effort: run.request.effort, prompt: prompt.stages.judge, promptVersion: 1 },
    status: 'generating', canvases: [run.inputs.target], source: { kind: 'eval-run', id: run.id, fingerprint: run.requestHash },
    data: { targetTitle: run.layoutTemplate!.geometry.slots[0].title ?? target.ascii!.split('\n')[0], targetAscii: target.ascii!, initialReferences: [], rounds: [] }
  };
  const saveReferences = async (items: FewShotReference[], round: number) => {
    if (!input.referenceLibrary?.create) throw Error('The reference library is unavailable.');
    const saved = [];
    for (const item of items) {
      const reference = await input.referenceLibrary.create({ requestId: randomUUID(), name: `${item.title.slice(0,65)} · ${run.id.slice(0, 8)} · round ${round} slot ${item.slot}`,
        ascii: item.ascii, source: run.inputs.target.source, sourceName: 'Synthetic example inspired by target topology', canvasName: run.inputs.target.canvasName });
      saved.push({ ...item, referenceId: reference.id });
    }
    return saved;
  };
  const save = async () => { report.updatedAt = new Date().toISOString(); await judgements.saveProgress(report); };
  const assess = async <T>(cell: EvalRunCell, schema: z.ZodType<T>, files: Record<string, unknown>, validate: (value: T) => void = () => {}) => {
    Object.assign(cell, { status: 'generating', startedAt: new Date().toISOString() }); await persist();
    const body = composePrompt(evalWorkflows[run.workflow], cell.stage, prompt.stages[cell.stage], { round: String(cell.pass), references: '', pass: '1', passes: '1' }, prompt.templateBase);
    const usage: Record<string, number> = {};
    let attemptFiles = files;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const response = await runtime.generate({ workflow: run.workflow, stage: cell.stage, prompt: body, schema,
        files: attemptFiles, model: run.request.model, effort: run.request.effort, signal });
      signal.throwIfAborted();
      for (const [key, value] of Object.entries(response.usage ?? {})) usage[key] = (usage[key] ?? 0) + value;
      try {
        const value = schema.parse(response.output); validate(value);
        Object.assign(cell, { status: cell.stage === 'judge' ? 'generating' : 'finished', usage, completedAt: new Date().toISOString() }); await persist();
        return value;
      } catch (error) {
        if (attempt === 2) throw error;
        attemptFiles = { ...files, 'previous-output.json': response.output, 'validation-error.json': { error: String(error) } };
      }
    }
  };
  try {
    await save();
    const targetFiles = { 'target.json': { id: target.id, ascii: target.ascii }, 'layout-template.json': run.layoutTemplate!.geometry };
    let references = (await assess(run.cells[0], seedReferencesSchema, targetFiles)).references.sort((a, b) => a.slot - b.slot);
    references = await saveReferences(references, 1);
    report.data!.initialReferences = structuredClone(references); await save();
    for (let round = 1; round <= FEW_SHOT_ROUNDS; round++) {
      signal.throwIfAborted();
      const cells = run.cells.filter(cell => cell.stage === 'alternative' && Math.ceil(cell.pass / FEW_SHOT_ALTERNATIVES) === round);
      // Wait for every sibling before reporting failure or starting the next round.
      const results = await Promise.allSettled(cells.map((cell, i) => input.generate(cell, round, i + 1, references)));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const outputs = cells.map(cell => {
        const snapshot = run.outputSnapshots![cell.canvasId!];
        const revision = snapshot.history.snapshots[snapshot.history.headId];
        return { key: cell.key, canvasId: cell.canvasId!, checkpointId: cell.checkpointId!, history: snapshot.history, revision };
      });
      // Reuse canonical canvas-context serialization rather than giving the judge storage internals.
      const readable = outputs.map(output => {
        const copy = { ...run.inputs.target, history: output.history };
        return { key: output.key, canvasId: output.canvasId, checkpointId: output.checkpointId, diagrams: canvasContext(copy, false).diagrams };
      });
      const judged = await assess(run.cells.find(cell => cell.stage === 'judge' && cell.pass === round)!, roundJudgementSchema,
        { ...targetFiles, 'context.json': input.context, 'few-shot.json': references, 'outputs.json': readable, 'progress.json': report.data },
        value => { if (new Set(value.assessments.map(item => item.key)).size !== cells.length || value.assessments.some(item => !cells.some(cell => cell.key === item.key)))
          throw Error('Assess each exact output key once.'); });
      const assessments = judged.assessments.map(item => {
        const output = readable.find(output => output.key === item.key)!;
        return { ...item, canvasId: output.canvasId, checkpointId: output.checkpointId, ascii: output.diagrams.map(d => 'ascii' in d ? d.ascii : '').join('\n\n') };
      });
      judged.nextReferences = await saveReferences(judged.nextReferences, round + 1);
      report.data!.rounds.push({ round, references: structuredClone(references), ...judged, assessments });
      report.subjects.push(...cells.map(cell => ({ runId: run.id, outputKey: cell.key, source: { documentId: cell.canvasId!, checkpointId: cell.checkpointId! } })));
      references = judged.nextReferences.sort((a, b) => a.slot - b.slot);
      await save();
      if (round < FEW_SHOT_ROUNDS) { run.cells.find(cell => cell.stage === 'judge' && cell.pass === round)!.status = 'finished'; await persist(); }
    }
    report.status = 'finished'; await save();
    run.cells.find(cell => cell.stage === 'judge' && cell.pass === FEW_SHOT_ROUNDS)!.status = 'finished'; await persist();
  } catch (error) {
    const message = signal.aborted ? 'Run cancelled. Completed rounds are retained.' : error instanceof Error ? error.message : String(error);
    run.error = message;
    for (const cell of run.cells) if (cell.status === 'queued' || cell.status === 'generating')
      Object.assign(cell, { status: signal.aborted ? 'cancelled' : cell.status === 'generating' ? 'failed' : 'skipped', error: message, completedAt: new Date().toISOString() });
    report.status = 'failed'; report.error = message; await save(); await persist();
  }
}
