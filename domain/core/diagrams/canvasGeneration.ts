import { z } from 'zod';

export const generationUsageSchema = z.object({
  totalTokens: z.number().nonnegative(), inputTokens: z.number().nonnegative(), cachedInputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(), reasoningOutputTokens: z.number().nonnegative()
});
export const canvasGenerationSchema = z.object({
  runId: z.string(), chatId: z.string(), parentChatId: z.string(), parentTurnId: z.string().optional(), triggerMessageId: z.string().optional(),
  triggerPrompt: z.string(), taskPrompt: z.string().optional(), prompt: z.string(), model: z.string(), effort: z.string(),
  status: z.enum(['queued', 'generating', 'finished', 'failed', 'cancelled']),
  startedAt: z.string(), completedAt: z.string().optional(), durationMs: z.number().nonnegative().optional(),
  usage: generationUsageSchema.optional(), error: z.string().optional()
}).strict();
export type CanvasGeneration = z.infer<typeof canvasGenerationSchema>;
export const genAlternativesSchema = z.object({
  viewId: z.string().min(1).max(200), prompt: z.string().trim().min(1).max(50000),
  alternatives: z.array(z.object({ name: z.string().trim().min(1).max(120), prompt: z.string().trim().min(1).max(50000) }).strict())
    .min(1).max(8).refine(items => new Set(items.map(item => item.name)).size === items.length, 'Use unique alternative names'),
  requestId: z.string().min(1).max(200)
}).strict();
export type GenAlternativesInput = z.infer<typeof genAlternativesSchema>;
export const genAlternativesDescription = 'Generate independent canvas alternatives in parallel from one saved view. Supply viewId, a shared task prompt, alternatives [{name, prompt}] (1–8 candidate-specific generation prompts), and a unique requestId. The application manages isolated child chats and canvases, inheriting this chat\'s model, reasoning effort, conversation context and tools. Returns runId and candidate view/chat IDs immediately; generation continues in the background. Read canvas-view list for generating/finished/failed/cancelled status, prompts, timing and token usage. Do not manually open/edit the candidates while generation is running. Retry identical arguments with the same requestId; this does not launch duplicate agents. Requires Workspace access.';
export const generationRunning = (generation?: CanvasGeneration) => generation?.status === 'queued' || generation?.status === 'generating';
