import { z } from 'zod';
import { evalWorkflowIds, type EvalWorkflowId } from './evalWorkflows';

/** Versions are immutable so a run can always show the exact text it used. */
export interface EvalPromptVersion { version: number; createdAt: string; format?: 'explicit-v1'; note?: string; stages: Record<string, string> }
export interface EvalPrompt {
  schemaVersion: 1; id: string; projectId: string; workflow: EvalWorkflowId; name: string; description?: string;
  createdAt: string; updatedAt: string; archivedAt?: string; builtin?: boolean;
  versions: EvalPromptVersion[];
}
export const latestVersion = (prompt: EvalPrompt) => prompt.versions[prompt.versions.length - 1];

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);
export const saveEvalPromptSchema = z.object({
  requestId: z.string().uuid(),
  promptId: id.optional(), workflow: z.enum(evalWorkflowIds),
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
  /** The version the edit started from. Saving over a newer version is a conflict. */
  baseVersion: z.number().int().positive().optional(),
  stages: z.record(z.string(), z.string().max(50000))
}).strict().refine(input => !input.promptId === !input.baseVersion, 'Edits need promptId and baseVersion together.');
export type SaveEvalPrompt = z.infer<typeof saveEvalPromptSchema>;
export const archiveEvalPromptSchema = z.object({ archived: z.boolean() }).strict();
