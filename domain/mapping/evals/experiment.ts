import { z } from 'zod';
import type { EvalRunSummary } from './evalRun';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);
const name = z.string().trim().min(1).max(160);
const stage = z.object({ id, name, dependsOn: z.array(id).default([]) }).strict();
/** Organization references execution records; it never rewrites their pinned inputs or outputs. */
export const experimentDesignSchema = z.object({
  name, description: z.string().max(10000).default(''),
  workflow: z.object({ id, name, version: z.number().int().positive(), stages: z.array(stage).min(1).max(30) }).strict(),
  cases: z.array(z.object({ id, name, agentContextId: id, contentHash: z.string().optional() }).strict()).min(1).max(200),
  conditions: z.array(z.object({ id, name, description: z.string().max(10000).default('') }).strict()).min(1).max(100),
  samples: z.array(z.object({ id, caseId: id, conditionId: id, number: z.number().int().positive(), attempt: z.number().int().positive().default(1),
    outputs: z.array(z.object({ stageId: id, runId: id, cellKey: z.string().min(1).max(300) }).strict()).max(30)
  }).strict()).max(5000),
  comparisons: z.array(z.object({ id, name, description: z.string().max(10000).default(''), conditionIds: z.array(id).min(1), caseIds: z.array(id).min(1), judgementIds: z.array(id).default([]) }).strict()).max(200)
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
  unique(value.samples.map(s => JSON.stringify([s.caseId, s.conditionId, s.number, s.attempt])), 'sample attempt');
  unique(value.samples.flatMap(s => s.outputs.map(o => JSON.stringify([o.runId, o.cellKey]))), 'stage output');
  for (const sample of value.samples) {
    if (!cases.has(sample.caseId) || !conditions.has(sample.conditionId)) fail('Unknown sample case or condition');
    unique(sample.outputs.map(o => o.stageId), 'sample stage');
    if (sample.outputs.some(o => !stages.has(o.stageId))) fail('Unknown output stage');
  }
  unique(value.comparisons.flatMap(c => c.judgementIds), 'Judgement attachment');
  for (const c of value.comparisons) {
    unique(c.conditionIds, 'comparison condition'); unique(c.caseIds, 'comparison case');
    if (c.conditionIds.some(id => !conditions.has(id)) || c.caseIds.some(id => !cases.has(id))) fail('Unknown comparison case or condition');
  }
});
export type ExperimentDesign = z.infer<typeof experimentDesignSchema>;
export interface EvalExperiment extends ExperimentDesign {
  schemaVersion: 1; id: string; projectId: string; revision: number; createdAt: string; updatedAt: string;
}
export const saveExperimentSchema = z.object({ requestId: z.string().uuid(), experimentId: id.optional(), expectedRevision: z.number().int().positive().optional(), experiment: experimentDesignSchema }).strict()
  .refine(value => !!value.experimentId === !!value.expectedRevision, 'Updates require experimentId and expectedRevision together');
export type SaveExperiment = z.infer<typeof saveExperimentSchema>;
export const experimentRunIds = (experiment: ExperimentDesign) => [...new Set(experiment.samples.flatMap(s => s.outputs.map(o => o.runId)))];
export const experimentJudgementIds = (experiment: ExperimentDesign) => experiment.comparisons.flatMap(c => c.judgementIds);
export function experimentOutput(output: ExperimentDesign['samples'][number]['outputs'][number], runs: EvalRunSummary[]) {
  return runs.find(run => run.id === output.runId)?.cells.find(cell => cell.key === output.cellKey);
}
export function experimentProgress(experiment: ExperimentDesign, runs: EvalRunSummary[]) {
  const total = experiment.samples.length * experiment.workflow.stages.length;
  const cells = experiment.samples.flatMap(s => s.outputs.map(o => experimentOutput(o, runs)));
  const finished = cells.filter(c => c?.status === 'finished' && !c.deleted).length;
  const status = cells.some(c => c?.status === 'generating' || c?.status === 'queued') ? 'generating'
    : cells.some(c => !c || c.deleted || c.status === 'failed' || c.status === 'cancelled' || c.status === 'skipped') ? 'partial'
    : total > 0 && finished === total ? 'finished' : 'planned';
  return { finished, total, status };
}
