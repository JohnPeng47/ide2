import type { AgentWorkflow, AgentStepRequest } from '../../core/agents/agentWorkflow';
import type { ChangeSessionCapture } from './changeSessionService';

export const DIFF_SESSION_MODEL = { preset: 'astra-high', modelId: 'gpt-6-astra', thinkingLevel: 'high' } as const;
export type DiffSessionStep = 'analyze' | 'materialize';
export interface DiffSessionStepResult { text: string; changeSessionId?: string }
export interface DiffSessionTool {
  name: string; description: string; schema: Record<string, unknown>;
  execute(input: unknown): Promise<unknown>;
}
export interface DiffSessionAgentSession {
  sessionId: string;
  runStep(request: AgentStepRequest): Promise<DiffSessionStepResult>;
  transcript(): unknown;
  dispose(): void;
}
export interface DiffSessionMetric {
  kind: 'step' | 'tool' | 'model' | 'compaction'; step: DiffSessionStep; name: string;
  startedAt: string; durationMs: number; responseBytes?: number; error?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };
}
export interface DiffSessionRuntime {
  openSession(input: {
    sourceRoot: string; signal: AbortSignal;
    tools(step: DiffSessionStep): DiffSessionTool[];
    onProgress(message: string): void;
    onMetric?(metric: DiffSessionMetric): void;
  }): Promise<DiffSessionAgentSession>;
  dispose(): void;
}
export interface DiffSessionPrompts { analyze: string; materialize: string }

/** Each step is a new user message; the executor owns the shared conversation. */
export function createDiffSessionWorkflow(prompts: DiffSessionPrompts, capture: ChangeSessionCapture): AgentWorkflow<DiffSessionStepResult> {
  const context = JSON.stringify({ ...capture.context, baselineChangeSessionId: capture.baselineChangeSessionId,
    documents: capture.documents.map(doc => ({ documentId: doc.id, name: doc.name })), hunkCount: capture.hunks.length,
    ...(capture.context?.comparisonBase !== undefined ? { comparison: "These hunks represent the net push change from comparisonBase (null = empty tree) to head, including removals on force-push. commits lists commits newly reachable in this push and may be empty for a rollback. Hunk parent means comparison base in this mode." } : {}) });
  return {
    id: 'diff-session-create',
    steps: [
      { id: 'analyze', prompt: () => `${prompts.analyze}\n\n[PINNED CONTEXT]\n${context}`,
        validate: result => { if (!result.text.trim()) throw Error('Analysis finished without a response'); } },
      { id: 'materialize', prompt: () => prompts.materialize,
        validate: result => { if (!result.changeSessionId) throw Error('Materialization finished without a validated ChangeSession'); } }
    ]
  };
}
