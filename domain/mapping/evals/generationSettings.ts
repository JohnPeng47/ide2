import { cellKey } from './evalRun';
import type { EvalRunSummary } from './evalRun';
import { experimentDesignSchema, type EvalExperiment, type ExperimentDesign } from './experiment';
import { evalWorkflows } from './evalWorkflows';

export const generationModelPresets = [
  { id: 'astra-high', label: 'Astra · High', model: 'gpt-6-astra', effort: 'high' },
  { id: 'sol-6-1-high', label: 'Sol 6.1 · High', model: 'gpt-6.1-sol', effort: 'high' },
  { id: 'sol-6-1-low', label: 'Sol 6.1 · Low', model: 'gpt-6.1-sol', effort: 'low' }
] as const;
export type GenerationModelPresetId = typeof generationModelPresets[number]['id'];
export const generationModelPreset = (model: string, effort: string) => generationModelPresets.find(p => p.model === model && p.effort === effort);

export function canResizeGenerationRun(experiment: EvalExperiment, run: EvalRunSummary) {
  const plan = experiment.plannedRuns?.find(p => p.request.requestId === run.id);
  if (!plan || run.workflow === 'few-shot-refinement') return false;
  const samples = new Set(plan.outputs.map(o => o.sampleId));
  return !experiment.samples.some(s => samples.has(s.id) && (s.outputs.length || s.relaunchedFrom))
    && !experiment.plannedRuns!.some(p => p !== plan && p.outputs.some(o => samples.has(o.sampleId)));
}

/** Change only an unapproved run's sampling plan; retain its exact prompt and input references. */
export function configureGenerationRun(experiment: EvalExperiment, runId: string, passes: number, presetId: string,
  newId: () => string = () => crypto.randomUUID()): ExperimentDesign {
  const run = experiment.generationReview?.runs.find(r => r.id === runId);
  if (experiment.generationReview?.status !== 'awaiting-approval' || !run) throw Error('Only pending generation settings can be changed.');
  const preset = generationModelPresets.find(p => p.id === presetId);
  if (!preset) throw Error('Choose one of the three model options.');
  if (!Number.isInteger(passes) || passes < 1 || passes > 20) throw Error('Choose between 1 and 20 outputs per prompt.');
  const { id, projectId, schemaVersion, revision, createdAt, updatedAt, generationReview, ...source } = experiment;
  const design = structuredClone(source);
  const plan = design.plannedRuns?.find(p => p.request.requestId === runId);
  if (!plan) throw Error('Generation plan not found.');
  if (passes !== plan.request.passes) {
    if (!canResizeGenerationRun(experiment, run)) throw Error('This workflow has fixed or shared samples. Its output count cannot be changed here.');
    const originalOutputs = [...plan.outputs];
    const affected = new Set(originalOutputs.map(o => o.sampleId));
    const cells = new Map(run.cells.map(cell => [cell.key, cell]));
    if (originalOutputs.some(o => !cells.has(o.cellKey))) throw Error('Prepared output mapping is incomplete. Refresh the experiment.');
    plan.outputs = originalOutputs.filter(o => cells.get(o.cellKey)!.pass <= passes);
    const added = new Map<string, string>();
    for (let pass = plan.request.passes + 1; pass <= passes; pass++) {
      for (const prompt of plan.request.prompts) for (const stage of evalWorkflows[plan.request.workflow].stages) {
        const seed = originalOutputs.find(o => o.cellKey === cellKey(prompt.promptId, 1, stage.id));
        if (!seed) throw Error('Missing first sample for this prompt and stage.');
        const original = design.samples.find(s => s.id === seed.sampleId)!;
        const key = `${original.id}:${pass}`;
        let sampleId = added.get(key);
        if (!sampleId) {
          sampleId = `sample-${newId()}`;
          const peers = design.samples.filter(s => s.phaseId === original.phaseId && s.caseId === original.caseId && s.conditionId === original.conditionId && s.attempt === original.attempt);
          design.samples.push({ ...original, id: sampleId, number: Math.max(0, ...peers.map(s => s.number)) + 1, outputs: [] });
          added.set(key, sampleId);
        }
        plan.outputs.push({ ...seed, sampleId, cellKey: cellKey(prompt.promptId, pass, stage.id) });
      }
    }
    const retained = new Set(design.plannedRuns!.flatMap(p => p.outputs.map(o => o.sampleId)));
    design.samples = design.samples.filter(s => !affected.has(s.id) || retained.has(s.id) || s.outputs.length);
  }
  plan.request = { ...plan.request, passes, model: preset.model, effort: preset.effort };
  return experimentDesignSchema.parse(design);
}
