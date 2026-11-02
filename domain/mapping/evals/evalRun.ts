import { z } from 'zod';
import { compareSourceSchema, type CompareCanvasCopy, type CompareSource } from '../compare/comparePageSession';
import type { RollUpRun } from '../rollup/rollUp';
import { evalWorkflowIds, type EvalWorkflowId } from './evalWorkflows';
import { savedAgentContextIdSchema } from '../../core/agents/savedAgentContext';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);
export const evalRunRequestSchema = z.object({
  requestId: z.string().uuid(), workflow: z.enum(evalWorkflowIds),
  prompts: z.array(z.object({ promptId: id, version: z.number().int().positive() }).strict()).min(1).max(6)
    .refine(items => new Set(items.map(item => item.promptId)).size === items.length, 'Select each prompt once'),
  /** Canvas inputs pin a checkpoint; AgentContext inputs are immutable by ID. */
  inputs: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.union([compareSourceSchema, z.object({ agentContextId: savedAgentContextIdSchema }).strict()])),
  task: z.string().max(20000).optional(),
  /** Earlier generated canvases attached as extra input (Alternatives). */
  previous: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/)).max(6).optional(),
  layoutTemplateId: id.optional(),
  passes: z.number().int().min(1).max(4).default(1),
  model: z.string().trim().min(1).max(100).default('gpt-6-sol'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh']).default('high'),
  /** Reruns are filed under the original run and share its AgentContext. */
  parentRunId: id.optional()
}).strict();
export type EvalRunRequest = z.infer<typeof evalRunRequestSchema>;
export const renameEvalRunSchema = z.object({ name: z.string().trim().max(120) }).strict();
export const evalEfforts = ['low', 'medium', 'high', 'xhigh'] as const;

/** Prompt text is pinned into the run; later prompt edits never change what a run means. */
export interface EvalRunPrompt { promptId: string; version?: number; name: string; stages: Record<string, string> }
export type EvalCellStatus = 'queued' | 'generating' | 'finished' | 'failed' | 'skipped' | 'cancelled';
export interface EvalRunCell {
  layoutPlacements?: import('../../core/diagrams/layoutTemplate').LayoutPlacement[];
  candidateName?: string;
  key: string; promptId?: string; promptVersion?: number; promptName?: string; pass: number; stage: string;
  status: EvalCellStatus; canvasId?: string; checkpointId?: string; explanation?: string; error?: string;
  usage?: Record<string, number>; startedAt?: string; completedAt?: string;
  /** Set on summaries when the output canvas was deleted. */
  deleted?: boolean;
}
export type EvalRunStatus = 'queued' | 'generating' | 'finished' | 'failed' | 'partial' | 'cancelled';
export interface EvalRun {
  layoutTemplate?: import('../../core/diagrams/layoutTemplate').LayoutTemplate;
  number?: number;
  deletedAt?: string;
  outputSnapshots?: Record<string, import('../../core/diagrams/generatedCanvas').GeneratedCanvasRecord>;
  /** Compatibility records retain their original request and child chat identities. */
  compatibility?: { kind: 'chat-alternatives'; requestId?: string; parentChatId: string; candidates: { viewId: string; chatId: string; name: string }[] };
  schemaVersion: 1; id: string; requestHash: string; request: EvalRunRequest; projectId: string; workflow: EvalWorkflowId;
  agentContextId: string; contextName: string; prompts: EvalRunPrompt[]; inputs: Record<string, CompareCanvasCopy>;
  /** AgentContext inputs, recorded with the hash they had when the run started. */
  contexts?: Record<string, EvalRunContext>;
  /** Pinned copies of earlier alternatives attached to every prompt. */
  previous?: CompareCanvasCopy[];
  status: EvalRunStatus; createdAt: string; completedAt?: string; error?: string; cells: EvalRunCell[];
  /** The original run this one reruns; always a root run, never another rerun. */
  parentRunId?: string;
  /** Shown in place of the prompt names in the explorer. */
  name?: string;
  /** Pre-Evals roll-up runs. Their prompt text was not recorded. */
  legacy?: boolean;
}
export interface EvalRunContext { agentContextId: string; name: string; contentHash: string }
export interface EvalRunInputSummary { source: CompareSource; name: string; canvasName: string; generated?: import('../../core/diagrams/generatedCanvas').GeneratedCanvas }
export type EvalRunSummary = Omit<EvalRun, 'inputs' | 'previous' | 'requestHash' | 'outputSnapshots'> & { inputs: Record<string, EvalRunInputSummary>; previousNames?: string[]; previousInputs?: EvalRunInputSummary[] };

export const cellKey = (promptId: string | undefined, pass: number, stage: string) => `${promptId ?? 'unknown'}:${pass}:${stage}`;
export function summarizeEvalRun({ inputs, previous, outputSnapshots: _snapshots, requestHash: _, ...run }: EvalRun): EvalRunSummary {
  return { ...run, ...(previous?.length ? { previousNames: previous.map(copy => copy.view.name), previousInputs: previous.map(copy => ({ source: copy.source, name: copy.view.name, canvasName: copy.canvasName, ...(copy.generated ? { generated: copy.generated } : {}) })) } : {}), inputs: Object.fromEntries(Object.entries(inputs).map(([name, copy]) => [name, { source: copy.source, name: copy.view.name, canvasName: copy.canvasName }])) };
}
export function runStatus(cells: EvalRunCell[]): EvalRunStatus {
  if (cells.some(cell => cell.status === 'generating')) return 'generating';
  if (cells.some(cell => cell.status === 'queued')) return cells.some(cell => cell.status !== 'queued') ? 'generating' : 'queued';
  if (cells.every(cell => cell.status === 'finished')) return 'finished';
  if (cells.some(cell => cell.status === 'finished')) return 'partial';
  return !cells.some(cell => cell.status === 'failed') && cells.some(cell => cell.status === 'cancelled') ? 'cancelled' : 'failed';
}

export function legacyRollUpRun(run: RollUpRun): EvalRun {
  const passes = run.request.passes;
  const cells: EvalRunCell[] = [];
  for (let pass = 1; pass <= passes; pass++) for (const stage of ['r2', 'g2']) {
    const output = run.outputs.find(item => item.pass === pass && item.stage === stage);
    cells.push({ key: cellKey(undefined, pass, stage), pass, stage, canvasId: output?.canvasId, explanation: output?.explanation, usage: output?.usage,
      status: output ? 'finished' : run.status === 'failed' ? 'failed' : run.status === 'finished' ? 'skipped' : 'queued',
      ...(!output && run.status === 'failed' ? { error: run.error } : {}) });
  }
  return { schemaVersion: 1, id: run.id, requestHash: run.requestHash, projectId: run.projectId, workflow: 'roll-up', legacy: true,
    request: { requestId: run.id, workflow: 'roll-up', prompts: [], inputs: { child: run.request.child, parent: run.request.parent },
      passes, model: run.request.model, effort: run.request.effort as EvalRunRequest['effort'] },
    agentContextId: run.agentContextId, contextName: run.contextName, prompts: [], inputs: { child: run.child, parent: run.parent },
    status: run.status, createdAt: run.createdAt, completedAt: run.completedAt, error: run.error, cells };
}
