import { z } from 'zod';
import { evalRunRequestSchema, type EvalRunSummary } from './evalRun';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);
const name = z.string().trim().min(1).max(160);
const stage = z.object({ id, name, dependsOn: z.array(id).default([]) }).strict();
/** Organization references execution records; it never rewrites their pinned inputs or outputs. */
export const experimentDesignSchema = z.object({
  name, description: z.string().max(10000).default(''),
  /** Ordered output rounds, independent of workflow stages and prompt conditions. */
  phases: z.array(z.object({ id, name, description: z.string().max(10000).default('') }).strict()).max(100).optional(),
  workflow: z.object({ id, name, version: z.number().int().positive(), stages: z.array(stage).min(1).max(30) }).strict(),
  cases: z.array(z.object({ id, name, agentContextId: id, contentHash: z.string().optional() }).strict()).min(1).max(200),
  conditions: z.array(z.object({ id, name, description: z.string().max(10000).default('') }).strict()).min(1).max(100),
  /** Legacy migration input only. Overview derives its tree from prompt-version ancestry. */
  promptTree: z.array(z.object({ id, name, parentId: id.optional(), conditionId: id.optional(), description: z.string().max(1000).optional() }).strict()).max(300).optional(),
  plannedRuns: z.array(z.object({ request: evalRunRequestSchema, outputs: z.array(z.object({ sampleId: id, stageId: id, cellKey: z.string().min(1).max(300) }).strict()).min(1) }).strict()).max(100).optional(),
  samples: z.array(z.object({ id, phaseId: id.optional(), caseId: id, conditionId: id, number: z.number().int().positive(), attempt: z.number().int().positive().default(1),
    relaunchedFrom: z.object({ sampleId: id, stageId: id }).strict().optional(),
    outputs: z.array(z.object({ stageId: id, runId: id, cellKey: z.string().min(1).max(300) }).strict()).max(30)
  }).strict()).max(5000),
  comparisons: z.array(z.object({ id, phaseId: id.optional(), name, description: z.string().max(10000).default(''), conditionIds: z.array(id).min(1), caseIds: z.array(id).min(1), judgementIds: z.array(id).default([]),
    evaluator: z.object({ kind: z.literal('deterministic'), parser: z.literal('diagram-change-tree'), version: z.literal(1) }).strict().optional()
  }).strict()).max(200)
}).strict().superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length) fail(`Duplicate ${label}`); };
  for (const [label, items] of [['stage', value.workflow.stages], ['case', value.cases], ['condition', value.conditions], ['sample', value.samples], ['comparison', value.comparisons]] as const) unique(items.map(item => item.id), label);
  const stages = new Set<string>();
  for (const stage of value.workflow.stages) {
    unique(stage.dependsOn, 'stage dependency');
    if (stage.dependsOn.some(id => !stages.has(id))) fail('Stage dependencies must name earlier stages');
    stages.add(stage.id);
  }
  const cases = new Set(value.cases.map(item => item.id)), conditions = new Set(value.conditions.map(item => item.id));
  unique((value.phases ?? []).map(p => p.id), 'phase');
  const phases = new Set(value.phases?.map(p => p.id));
  for (const item of [...value.samples, ...value.comparisons]) {
    if (item.phaseId && !phases.has(item.phaseId)) fail('Unknown phase');
    if (phases.size && !item.phaseId) fail('Assign every sample and comparison to a phase');
  }
  const treeIds = new Set<string>();
  unique((value.promptTree ?? []).flatMap(node => node.conditionId ? [node.conditionId] : []), 'prompt tree condition');
  for (const node of value.promptTree ?? []) {
    if (treeIds.has(node.id)) fail('Duplicate prompt tree node');
    if (node.parentId && !treeIds.has(node.parentId)) fail('Prompt tree parents must name earlier nodes');
    if (node.conditionId && !conditions.has(node.conditionId)) fail('Unknown prompt tree condition');
    treeIds.add(node.id);
  }
  unique(value.samples.map(s => JSON.stringify([s.phaseId, s.caseId, s.conditionId, s.number, s.attempt])), 'sample attempt');
  unique(value.samples.flatMap(s => s.outputs.map(o => JSON.stringify([o.runId, o.cellKey]))), 'stage output');
  for (const sample of value.samples) {
    if (!cases.has(sample.caseId) || !conditions.has(sample.conditionId)) fail('Unknown sample case or condition');
    unique(sample.outputs.map(o => o.stageId), 'sample stage');
    if (sample.outputs.some(o => !stages.has(o.stageId))) fail('Unknown output stage');
  }
  unique((value.plannedRuns ?? []).map(p => p.request.requestId), 'planned run');
  unique((value.plannedRuns ?? []).flatMap(p => p.outputs.map(o => `${o.sampleId}:${o.stageId}`)), 'planned output');
  for (const plan of value.plannedRuns ?? []) for (const output of plan.outputs) {
    if (!value.samples.some(s => s.id === output.sampleId) || !stages.has(output.stageId)) fail('Unknown planned sample or stage');
  }
  unique(value.comparisons.flatMap(c => c.judgementIds), 'Judgement attachment');
  for (const c of value.comparisons) {
    unique(c.conditionIds, 'comparison condition'); unique(c.caseIds, 'comparison case');
    if (c.conditionIds.some(id => !conditions.has(id)) || c.caseIds.some(id => !cases.has(id))) fail('Unknown comparison case or condition');
  }
});
export type ExperimentDesign = z.infer<typeof experimentDesignSchema>;
export interface EvalExperiment extends ExperimentDesign {
  generationReview?: { status: 'awaiting-approval' | 'starting' | 'started'; runs: EvalRunSummary[]; approvedAt?: string; approval?: { requestId: string; expectedRevision: number } };
  schemaVersion: 1; id: string; projectId: string; revision: number; createdAt: string; updatedAt: string;
}
export const saveExperimentSchema = z.object({ requestId: z.string().uuid(), experimentId: id.optional(), expectedRevision: z.number().int().positive().optional(), experiment: experimentDesignSchema }).strict()
  .refine(value => !!value.experimentId === !!value.expectedRevision, 'Updates require experimentId and expectedRevision together');
export type SaveExperiment = z.infer<typeof saveExperimentSchema>;
export const relaunchExperimentSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().positive(), sampleId: id, stageId: id,
  stages: z.record(z.string(), z.string().max(50000)) }).strict();
export type RelaunchExperiment = z.infer<typeof relaunchExperimentSchema>;
export const experimentRunIds = (experiment: ExperimentDesign) => [...new Set(experiment.samples.flatMap(s => s.outputs.map(o => o.runId)))];
export const experimentJudgementIds = (experiment: ExperimentDesign) => experiment.comparisons.flatMap(c => c.judgementIds);
export function experimentOutput(output: ExperimentDesign['samples'][number]['outputs'][number], runs: EvalRunSummary[]) {
  return runs.find(run => run.id === output.runId)?.cells.find(cell => cell.key === output.cellKey);
}
export function experimentProgress(experiment: ExperimentDesign, runs: EvalRunSummary[]) {
  const total = experiment.samples.reduce((sum, sample) => sum + (sample.relaunchedFrom ? sample.outputs.length : experiment.workflow.stages.length), 0);
  const cells = experiment.samples.flatMap(s => s.outputs.map(o => experimentOutput(o, runs)));
  const finished = cells.filter(c => c?.status === 'finished' && !c.deleted).length;
  const status = cells.some(c => c?.status === 'generating' || c?.status === 'queued') ? 'generating'
    : cells.some(c => !c || c.deleted || c.status === 'failed' || c.status === 'cancelled' || c.status === 'skipped') ? 'partial'
    : total > 0 && finished === total ? 'finished' : 'planned';
  return { finished, total, status };
}

export const approveExperimentSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
export const judgeExperimentSchema = approveExperimentSchema.extend({ comparisonId: id });
