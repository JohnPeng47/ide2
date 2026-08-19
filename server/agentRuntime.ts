import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent
} from "@earendil-works/pi-coding-agent";
import { Type, type Model } from "@earendil-works/pi-ai";
import type {
  AgentProgress,
  CodeEntityDraft,
  DiagramDraft
} from "../src/domain";

export interface EntityCollectionRequest {
  sourceRoot: string;
  diagramSetName: string;
  initialPrompt: string;
}

export interface DiagramGenerationRequest {
  sourceRoot: string;
  diagramSetName: string;
  resolvedPrompt: string;
  allowedCodeEntityIds: string[];
  allowedDiagramIds: string[];
  slot: number;
  total: number;
}

export interface DiagramAgentRuntime {
  collectEntities(
    request: EntityCollectionRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<CodeEntityDraft[]>;
  generateDiagram(
    request: DiagramGenerationRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<DiagramDraft>;
  dispose(): void;
}

function progressFor(event: AgentSessionEvent, model: string, sessionId: string): AgentProgress | undefined {
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

export class PiDiagramAgentRuntime implements DiagramAgentRuntime {
  private modelRuntime?: Promise<ModelRuntime>;
  private readonly sessions = new Set<{ abort(): Promise<void>; dispose(): void }>();

  private runtime(): Promise<ModelRuntime> {
    this.modelRuntime ??= ModelRuntime.create({ allowModelNetwork: false });
    return this.modelRuntime;
  }

  private async model(): Promise<{ runtime: ModelRuntime; model: Model<any>; provider: string; modelId: string }> {
    const runtime = await this.runtime();
    const provider = "openai-codex";
    const modelId = process.env.NEW_DIAGRAM_MODEL || "gpt-5.6-terra";
    const model = runtime.getModel(provider, modelId);
    if (!model) throw new Error(`Pi model is unavailable: ${provider}/${modelId}`);
    if (!runtime.hasConfiguredAuth(provider)) {
      throw new Error(`Pi provider is not authenticated: ${provider}`);
    }
    return { runtime, model, provider, modelId };
  }

  async collectEntities(
    request: EntityCollectionRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<CodeEntityDraft[]> {
    const configured = await this.model();
    const state: { submission?: { entities: CodeEntityDraft[] } } = {};
    const submit = defineTool({
      name: "submit_code_entities",
      label: "Submit code entities",
      description: "Submit the source-backed code entities for this diagram set.",
      promptSnippet: "Submit the final code entity set",
      promptGuidelines: ["End by calling submit_code_entities exactly once."],
      parameters: Type.Object({
        entities: Type.Array(Type.Object({
          handle: Type.String({ minLength: 1, maxLength: 64 }),
          label: Type.String({ minLength: 1, maxLength: 120 }),
          category: Type.Union([
            Type.Literal("state"),
            Type.Literal("interface-data-struct"),
            Type.Literal("operation")
          ]),
          summary: Type.String({ minLength: 1, maxLength: 600 }),
          sourceRanges: Type.Array(Type.Object({
            path: Type.String({ minLength: 1, maxLength: 500 }),
            startLine: Type.Integer({ minimum: 1 }),
            endLine: Type.Integer({ minimum: 1 }),
            symbol: Type.Optional(Type.String({ minLength: 1, maxLength: 200 }))
          }), { minItems: 1, maxItems: 12 })
        }), { minItems: 1, maxItems: 200 })
      }),
      async execute(_toolCallId, params) {
        state.submission = params;
        return {
          content: [{ type: "text", text: `Recorded ${params.entities.length} code entities.` }],
          details: { count: params.entities.length },
          terminate: true
        };
      }
    });
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: configured.provider,
      defaultModel: configured.modelId,
      defaultThinkingLevel: "medium"
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: request.sourceRoot,
      agentDir: getAgentDir(),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "Inspect repository source without modifying it. Collect only source-backed code entities and finish through submit_code_entities."
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: request.sourceRoot,
      modelRuntime: configured.runtime,
      model: configured.model,
      thinkingLevel: "medium",
      tools: ["read", "grep", "find", "ls", "submit_code_entities"],
      customTools: [submit],
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(request.sourceRoot)
    });
    this.sessions.add(session);
    const modelName = `${configured.provider}/${configured.modelId}`;
    const unsubscribe = session.subscribe((event) => {
      const progress = progressFor(event, modelName, session.sessionId);
      if (progress) onProgress?.(progress);
    });
    try {
      await session.prompt(`Collect code entities for the diagram set "${request.diagramSetName}".

Request:
${request.initialPrompt || "Map the requested code feature."}

By code-entities, I mean labels in a diagram that map to ranges of source code. Classify each as State, Interface / Data Struct, or Operation. These categories are intentionally broad; use your best judgement. Return concise summaries and exact repo-relative source ranges.`);
      if (!state.submission) throw new Error("collector finished without submitting code entities");
      return state.submission.entities;
    } finally {
      unsubscribe();
      session.dispose();
      this.sessions.delete(session);
    }
  }

  async generateDiagram(
    request: DiagramGenerationRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<DiagramDraft> {
    const configured = await this.model();
    const state: { submission?: DiagramDraft } = {};
    const submit = defineTool({
      name: "submit_diagram",
      label: "Submit diagram",
      description: "Submit exactly one source-backed 7-bit ASCII architecture diagram.",
      promptSnippet: "Submit the final ASCII diagram",
      promptGuidelines: [
        "Give the diagram a compact, specific name, ideally two to five words.",
        "End by calling submit_diagram exactly once."
      ],
      parameters: Type.Object({
        name: Type.String({ minLength: 1, maxLength: 120 }),
        ascii: Type.String({ minLength: 1, maxLength: 20000 }),
        codeEntityIds: Type.Array(Type.String(), { maxItems: 200 }),
        derivedFromDiagramIds: Type.Array(Type.String(), { maxItems: 50 })
      }),
      async execute(_toolCallId, params) {
        state.submission = params;
        return {
          content: [{ type: "text", text: "Recorded one diagram." }],
          details: { name: params.name },
          terminate: true
        };
      }
    });
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: configured.provider,
      defaultModel: configured.modelId,
      defaultThinkingLevel: "medium"
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: request.sourceRoot,
      agentDir: getAgentDir(),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "Generate exactly one architecture diagram from the supplied explicit context. Give it a compact, specific name, ideally two to five words; omit redundant words such as the DiagramSet name. Never modify files. Use 7-bit ASCII only and finish through submit_diagram."
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: request.sourceRoot,
      modelRuntime: configured.runtime,
      model: configured.model,
      thinkingLevel: "medium",
      tools: ["submit_diagram"],
      customTools: [submit],
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(request.sourceRoot)
    });
    this.sessions.add(session);
    const modelName = `${configured.provider}/${configured.modelId}`;
    const unsubscribe = session.subscribe((event) => {
      const progress = progressFor(event, modelName, session.sessionId);
      if (progress) onProgress?.(progress);
    });
    try {
      await session.prompt(`${request.resolvedPrompt}

Parallel generation slot: ${request.slot} of ${request.total}.
Independently choose a clear organizing shape for this slot. Return one diagram only.
Allowed CodeEntity ids: ${request.allowedCodeEntityIds.join(", ") || "none"}
Allowed derived-from Diagram ids: ${request.allowedDiagramIds.join(", ") || "none"}`);
      if (!state.submission) throw new Error("diagram agent finished without submitting a diagram");
      return state.submission;
    } finally {
      unsubscribe();
      session.dispose();
      this.sessions.delete(session);
    }
  }

  dispose(): void {
    for (const session of this.sessions) {
      void session.abort();
      session.dispose();
    }
    this.sessions.clear();
  }
}

export class FakeDiagramAgentRuntime implements DiagramAgentRuntime {
  async collectEntities(
    _request: EntityCollectionRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<CodeEntityDraft[]> {
    onProgress?.({ status: "reading-context", message: "reading fixture source", model: "fake/test" });
    const delayMs = Number(process.env.NEW_DIAGRAM_FAKE_COLLECTION_DELAY_MS ?? "0");
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return [{
      handle: "workspace-store",
      label: "Workspace Store",
      category: "state",
      summary: "Persists the diagram workspace.",
      sourceRanges: [{ path: "fixture.ts", startLine: 1, endLine: 1, symbol: "workspace" }]
    }];
  }

  async generateDiagram(
    request: DiagramGenerationRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<DiagramDraft> {
    onProgress?.({ status: "generating", message: `generating fixture slot ${request.slot}`, model: "fake/test" });
    const entityId = request.allowedCodeEntityIds[0];
    return {
      name: `Diagram ${request.slot}`,
      ascii: `+------------------+\n| parallel slot ${String(request.slot).padStart(2, "0")} |\n+------------------+`,
      codeEntityIds: entityId ? [entityId] : [],
      derivedFromDiagramIds: request.allowedDiagramIds.slice(0, 1)
    };
  }

  dispose(): void {}
}
