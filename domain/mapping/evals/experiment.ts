import { z } from 'zod';
import { promptVersionRefSchema } from './evalPrompt';
import { evalRunRequestSchema, type EvalRunSummary } from './evalRun';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);
const name = z.string().trim().min(1).max(160);
export const renameExperimentSchema = z.object({ expectedRevision: z.number().int().positive(), name }).strict();
export type RenameExperiment = z.infer<typeof renameExperimentSchema>;
const experimentTagsSchema = z.array(z.string().trim().min(1).max(50)).max(20).transform(tags => [...new Set(tags)]);
export const updateExperimentTagsSchema = z.object({ expectedRevision: z.number().int().positive(), tags: experimentTagsSchema }).strict();
export type UpdateExperimentTags = z.infer<typeof updateExperimentTagsSchema>;
const stage = z.object({ id, name, dependsOn: z.array(id).default([]) }).strict();
const upstreamOutput = z.object({
  label: name, experimentId: id, runId: id, cellKey: z.string().min(1).max(300),
  checkpointId: z.string().min(1).max(300).optional()
}).strict();
export type UpstreamExperimentOutput = z.infer<typeof upstreamOutput>;

/** Organization references execution records; it never rewrites their pinned inputs or outputs. */
export const experimentDesignSchema = z.object({
  name, description: z.string().max(10000).default(''),
  /** Omission on a design update preserves existing experiment tags. */
  tags: experimentTagsSchema.optional(),
  /** Ordered output rounds, independent of workflow stages and prompt conditions. */
  phases: z.array(z.object({ id, name, description: z.string().max(10000).default('') }).strict()).max(100).optional(),
  workflow: z.object({ id, name, version: z.number().int().positive(), stages: z.array(stage).min(1).max(30) }).strict(),
  cases: z.array(z.object({ id, name, agentContextId: id, contentHash: z.string().optional() }).strict()).min(1).max(5000),
  /** Ordered source outputs consumed by a pinned case, including both sides of judge pairs. */
  inputLineage: z.array(z.object({
    caseId: id, agentContextId: id, sources: z.array(upstreamOutput).min(1).max(100)
  }).strict()).max(5000).optional(),
  conditions: z.array(z.object({ id, name, description: z.string().max(10000).default('') }).strict()).min(1).max(100),
  /** Legacy migration input only. Prompt ancestry is derived from pinned prompt versions. */
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
  unique((value.inputLineage ?? []).map(item => item.caseId), 'input lineage case');
  for (const edge of value.inputLineage ?? []) {
    if (!value.cases.some(c => c.id === edge.caseId && c.agentContextId === edge.agentContextId))
      fail('Input lineage must match its pinned case.');
  }
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
export const experimentCommentAnchorSchema = z.object({
  runId: id, cellKey: z.string().min(1).max(300), canvasId: z.string().min(1).max(200),
  checkpointId: z.string().min(1).max(200).optional(),
  selections: z.array(z.object({ diagramId: z.string().min(1).max(200), revisionId: z.string().min(1).max(200),
    nodeIds: z.array(z.string().min(1).max(600)).min(1).max(2000) }).strict()).min(1).max(100)
}).strict();
export type ExperimentCommentAnchor = z.infer<typeof experimentCommentAnchorSchema>;
export interface ExperimentComment { id: string; text: string; createdAt: string; tags?: string[];
  phaseId?: string;
  anchor?: ExperimentCommentAnchor;
  /** Captured from the pinned output by the server, never from client-supplied text. */
  excerpts?: { diagramId: string; title: string; ascii: string }[];
}
const commentTagsSchema = z.array(z.string().trim().min(1).max(50)).max(20).transform(tags => [...new Set(tags)]);
export const updateExperimentCommentTagsSchema = z.object({ tags: commentTagsSchema }).strict();
export const updateExperimentCommentSchema = z.object({ text: z.string().trim().min(1).max(10000).optional(), tags: commentTagsSchema.optional() }).strict()
  .refine(value => value.text !== undefined || value.tags !== undefined, 'Provide comment text or tags.');
export type UpdateExperimentComment = z.infer<typeof updateExperimentCommentSchema>;
export const addExperimentCommentSchema = z.object({ requestId: z.string().uuid(), text: z.string().trim().min(1).max(10000), tags: commentTagsSchema.optional(),
  phaseId: id.optional(), anchor: experimentCommentAnchorSchema.optional() }).strict()
  .refine(value => !(value.phaseId && value.anchor), 'Choose either a phase or an output selection for the comment.');
export type AddExperimentComment = z.infer<typeof addExperimentCommentSchema>;
/** A known-good answer for judging outputs. Judge-side only: it never enters generation prompts or AgentContexts.
 * Samples are append-only and immutable; a corrected answer is a new sample. */
const groundTruthFields = {
  requestId: z.string().uuid(), name, description: z.string().max(10000).default(''),
  caseIds: z.array(id).max(5000).default([]),
  source: z.object({ commit: z.string().regex(/^[0-9a-f]{7,40}$/), repositoryId: z.string().max(200).optional(), note: z.string().max(2000).optional() }).strict(),
  provenance: z.object({ kind: z.enum(['human', 'model', 'model-reviewed']), model: z.string().max(200).optional(), note: z.string().max(5000).optional() }).strict()
};
const referenceText = z.string().max(200_000).refine(text => text.trim().length > 0, 'Reference text is empty.');
export const addGroundTruthSampleSchema = z.discriminatedUnion('format', [
  z.object({ ...groundTruthFields, format: z.literal('ascii-tree'), ascii: referenceText }).strict(),
  z.object({ ...groundTruthFields, format: z.literal('markdown'), query: referenceText, markdown: referenceText }).strict()
]);
export type AddGroundTruthSample = z.infer<typeof addGroundTruthSampleSchema>;
type SavedReference<F extends AddGroundTruthSample['format']> = Omit<Extract<AddGroundTruthSample, { format: F }>, 'requestId'> & { id: string; createdAt: string };
export type ExperimentGroundTruthSample = (SavedReference<'ascii-tree'> & { asciiSha256: string }) | (SavedReference<'markdown'> & { markdownSha256: string });
export interface EvalExperiment extends ExperimentDesign {
  comments?: ExperimentComment[];
  commentTags?: string[];
  groundTruth?: ExperimentGroundTruthSample[];
  generationReview?: { status: 'awaiting-approval' | 'starting' | 'started'; runs: EvalRunSummary[]; approvedAt?: string; approval?: { requestId: string; expectedRevision: number } };
  schemaVersion: 1; id: string; projectId: string; revision: number; createdAt: string; updatedAt: string;
}
export const saveExperimentSchema = z.object({ requestId: z.string().uuid(), experimentId: id.optional(), expectedRevision: z.number().int().positive().optional(), experiment: experimentDesignSchema }).strict()
  .refine(value => !!value.experimentId === !!value.expectedRevision, 'Updates require experimentId and expectedRevision together');
export type SaveExperiment = z.infer<typeof saveExperimentSchema>;
export const relaunchExperimentSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().positive(), sampleId: id, stageId: id,
  stages: z.record(z.string(), z.string().max(50000)) }).strict();
export type RelaunchExperiment = z.infer<typeof relaunchExperimentSchema>;
export const rerunExperimentSchema = z.object({
  requestId: z.string().uuid(), expectedRevision: z.number().int().positive(),
  runId: id, cellKey: z.string().min(1).max(300), prompt: promptVersionRefSchema
}).strict();
export type RerunExperiment = z.infer<typeof rerunExperimentSchema>;
export const experimentRunIds = (experiment: ExperimentDesign) => [...new Set(experiment.samples.flatMap(s => s.outputs.map(o => o.runId)))];
export const experimentJudgementIds = (experiment: ExperimentDesign) => experiment.comparisons.flatMap(c => c.judgementIds);
export function experimentOverviewPhases(experiment: ExperimentDesign) {
  return experiment.phases?.length ? experiment.phases : experiment.workflow.stages.map((stage, index) => ({
    id: stage.id, name: `Phase ${index + 1} · ${stage.name}`, description: ''
  }));
}
export function experimentOutput(output: ExperimentDesign['samples'][number]['outputs'][number], runs: EvalRunSummary[]) {
  return runs.find(run => run.id === output.runId)?.cells.find(cell => cell.key === output.cellKey);
}
/** Explicit phases can own only a subset of workflow stages (for example a scaffold). */
export function experimentSampleStages(experiment: ExperimentDesign, sample: ExperimentDesign['samples'][number]) {
  if (!experiment.phases?.length && !sample.relaunchedFrom) return experiment.workflow.stages;
  const ids = new Set([
    ...sample.outputs.map(output => output.stageId),
    ...(experiment.plannedRuns ?? []).flatMap(run => run.outputs.filter(output => output.sampleId === sample.id).map(output => output.stageId))
  ]);
  return experiment.workflow.stages.filter(stage => ids.has(stage.id));
}
export function experimentProgress(experiment: ExperimentDesign, runs: EvalRunSummary[]) {
  const total = experiment.samples.reduce((sum, sample) => sum + experimentSampleStages(experiment, sample).length, 0);
  const cells = experiment.samples.flatMap(s => s.outputs.map(o => experimentOutput(o, runs)));
  const finished = cells.filter(c => c?.status === 'finished' && !c.deleted).length;
  const status = cells.some(c => c?.status === 'generating' || c?.status === 'queued') ? 'generating'
    : cells.some(c => !c || c.deleted || c.status === 'failed' || c.status === 'cancelled' || c.status === 'skipped') ? 'partial'
    : total > 0 && finished === total ? 'finished' : 'planned';
  return { finished, total, status };
}

export const approveExperimentSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
export const judgeExperimentSchema = approveExperimentSchema.extend({ comparisonId: id });
