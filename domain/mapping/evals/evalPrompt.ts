import { promptTemplateBaseSchema, type PromptTemplateBase } from './promptTemplateBase';
import { z } from 'zod';
import { evalWorkflowIds, type EvalWorkflowId } from './evalWorkflows';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);
export const promptVersionRefSchema = z.object({ promptId: id, version: z.number().int().positive() }).strict();
export type PromptVersionRef = z.infer<typeof promptVersionRefSchema>;
export const promptDerivationSchema = z.object({
  parent: promptVersionRefSchema,
  kind: z.enum(['revision', 'variation', 'relaunch', 'fork', 'merge']),
  dimension: z.object({ id, name: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(500) }).strict().optional()
}).strict();
export type PromptDerivation = z.infer<typeof promptDerivationSchema>;
export const trackPromptLineageSchema = z.object({
  requestId: z.string().uuid(), version: z.number().int().positive(), expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  derivation: promptDerivationSchema
}).strict();
/** Versions are immutable so a run can always show the exact text it used. */
export interface EvalPromptVersion { templateBase?: PromptTemplateBase; parents?: PromptParent[]; version: number; createdAt: string; format?: 'explicit-v1'; note?: string; stages: Record<string, string>; contentHash?: string; derivation?: PromptDerivation; lineageRecordedAt?: string }
export interface EvalPrompt {
  schemaVersion: 1; id: string; projectId: string; workflow: EvalWorkflowId; name: string; description?: string;
  createdAt: string; updatedAt: string; archivedAt?: string; builtin?: boolean;
  versions: EvalPromptVersion[];
}
export const latestVersion = (prompt: EvalPrompt) => prompt.versions[prompt.versions.length - 1];

export const saveEvalPromptSchema = z.object({
  requestId: z.string().uuid(),
  promptId: id.optional(), workflow: z.enum(evalWorkflowIds),
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
  /** The version the edit started from. Saving over a newer version is a conflict. */
  baseVersion: z.number().int().positive().optional(),
  templateBase: promptTemplateBaseSchema.optional(),
  parents: z.array(promptVersionRefSchema.extend({ relation: z.enum(['fork', 'merge', 'revision', 'variation', 'relaunch']) })).max(20).optional(),
  derivation: promptDerivationSchema.optional(),
  stages: z.record(z.string(), z.string().max(50000))
}).strict().refine(input => !input.promptId === !input.baseVersion, 'Edits need promptId and baseVersion together.');
export type SaveEvalPrompt = z.infer<typeof saveEvalPromptSchema>;
export const archiveEvalPromptSchema = z.object({ archived: z.boolean() }).strict();

export interface PromptParent extends PromptVersionRef { relation: 'fork' | 'merge' | 'revision' | 'variation' | 'relaunch' }
export interface PromptProjectSnapshot { id: string; projectId: string; createdAt: string; name: string; prompts: EvalPrompt[] }
