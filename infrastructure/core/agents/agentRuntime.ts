import type { AgentContext } from '../../../domain/core/agents/agentContext';
import { type Model } from "@earendil-works/pi-ai";
import { createAgentSession, SessionManager, type CreateAgentSessionOptions, ModelRuntime, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { DEFAULT_DIAGRAM_MODEL_ID, type AgentProgress } from "../../../domain/core/records/domain";
export function progressFor(event: AgentSessionEvent, model: string, sessionId: string): AgentProgress | undefined {
  const shared = { model, sessionId };
  if (event.type === "agent_start" || event.type === "turn_start" || event.type === "message_start") {
    return { ...shared, status: "generating", message: "agent is composing a structured result" };
  }
  if (event.type === "tool_execution_start") {
    if (["read", "grep", "find", "ls"].includes(event.toolName)) {
      return { ...shared, status: "reading-context", message: `inspecting source with ${event.toolName}` };
    }
    if (event.toolName.startsWith("submit_")) {
      return { ...shared, status: "validating", message: "validating structured submission" };
    }
  }
  return undefined;
}
export class PiAgentRuntime {

  protected modelRuntime?: Promise<ModelRuntime>;

  protected readonly sessions = new Set<{ abort(): Promise<void>; dispose(): void }>();

  protected async createSession(configuration: Omit<CreateAgentSessionOptions, 'sessionManager'>, context?: AgentContext) {
    const sessionManager = SessionManager.inMemory(configuration.cwd);
    for (const message of context?.toPiMessages() ?? []) sessionManager.appendMessage(message);
    const result = await createAgentSession({ ...configuration, sessionManager });
    this.sessions.add(result.session);
    return result;
  }

  protected runtime(): Promise<ModelRuntime> {
    this.modelRuntime ??= ModelRuntime.create({ allowModelNetwork: false });
    return this.modelRuntime;
  }

  protected async model(overrideModelId?: string): Promise<{
    runtime: ModelRuntime;
    model: Model<any>;
    provider: string;
    modelId: string;
  }> {
    const runtime = await this.runtime();
    const provider = "openai-codex";
    const modelId = overrideModelId || process.env.NEW_DIAGRAM_MODEL || DEFAULT_DIAGRAM_MODEL_ID;
    const model = runtime.getModel(provider, modelId);
    if (!model) throw new Error(`Pi model is unavailable: ${provider}/${modelId}`);
    if (!runtime.hasConfiguredAuth(provider)) {
      throw new Error(`Pi provider is not authenticated: ${provider}`);
    }
    return { runtime, model, provider, modelId };
  }
  dispose(): void {
    for (const session of this.sessions) { void session.abort(); session.dispose(); }
    this.sessions.clear();
  }
}
