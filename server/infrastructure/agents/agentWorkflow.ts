/** Feature-owned prompts and validation; session/tool ownership stays with the executor. */
export interface AgentWorkflowStep<T> {
  id: string;
  prompt(previous: T | undefined): string;
  before?(previous: T | undefined): void | Promise<void>;
  validate?(output: T, previous: T | undefined): void | Promise<void>;
}

export interface AgentWorkflow<T> {
  id: string;
  steps: readonly AgentWorkflowStep<T>[];
}

export interface AgentStepRequest {
  workflowId: string;
  stepId: string;
  prompt: string;
  signal?: AbortSignal;
}

/** Return only this turn's accepted submission. Honor signal for in-flight cancellation. */
export type AgentStepExecutor<T> = (request: AgentStepRequest) => Promise<T | undefined>;

export async function runAgentWorkflow<T>(
  workflow: AgentWorkflow<T>,
  execute: AgentStepExecutor<T>,
  options: { signal?: AbortSignal; onStepStart?(stepId: string): void } = {}
): Promise<T> {
  if (!workflow.id.trim() || !workflow.steps.length) throw new Error("An agent workflow needs an id and at least one step");
  const ids = new Set<string>();
  for (const step of workflow.steps) {
    if (!step.id.trim() || ids.has(step.id)) throw new Error(`Invalid or duplicate workflow step: ${step.id}`);
    ids.add(step.id);
  }

  let previous: T | undefined;
  for (const step of workflow.steps) {
    options.signal?.throwIfAborted();
    options.onStepStart?.(step.id);
    await step.before?.(previous);
    options.signal?.throwIfAborted();
    const output = await execute({
      workflowId: workflow.id, stepId: step.id, prompt: step.prompt(previous), signal: options.signal
    });
    options.signal?.throwIfAborted();
    if (output === undefined) throw new Error(`${workflow.id}/${step.id} finished without an accepted submission`);
    await step.validate?.(output, previous);
    options.signal?.throwIfAborted();
    previous = output;
  }
  return previous!;
}
