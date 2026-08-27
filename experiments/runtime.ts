import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { Type, type Model } from "@earendil-works/pi-ai";
import { PiDiagramAgentRuntime, type ArtifactGenerationRequest } from "../server/agentRuntime";
import type {
  AxisDefinition,
  CrossJudgment,
  DiagramLabel,
  LabeledDiagram,
  PromptAnalysis,
  WithinJudgment
} from "./types";

export const EXPERIMENT_MODEL_ID = "gpt-5.6-sol" as const;

export interface ExperimentGenerationRequest {
  axis: AxisDefinition;
  value: number;
  replicate: number;
  generation: ArtifactGenerationRequest;
}

export interface ExperimentRuntime {
  generate(request: ExperimentGenerationRequest): ReturnType<PiDiagramAgentRuntime["generateArtifact"]>;
  judgeCross(axis: AxisDefinition, diagrams: LabeledDiagram[]): Promise<CrossJudgment>;
  judgeWithin(axis: AxisDefinition, diagrams: LabeledDiagram[]): Promise<WithinJudgment>;
  analyze(input: {
    axis: AxisDefinition;
    iteration: 1 | 2;
    currentPrompt: string;
    aggregateJson: string;
    judgeNotes: string[];
  }): Promise<PromptAnalysis>;
  dispose(): void;
}

const labelSchema = Type.Union([Type.Literal("A"), Type.Literal("B"), Type.Literal("C")]);

function diagramsPrompt(diagrams: LabeledDiagram[]): string {
  return diagrams.map((diagram) => `DIAGRAM ${diagram.label}\nName: ${diagram.artifact.name}\n\n${diagram.artifact.ascii}`).join("\n\n---\n\n");
}

export class SolExperimentRuntime implements ExperimentRuntime {
  private readonly generator = new PiDiagramAgentRuntime();
  private modelRuntime?: Promise<ModelRuntime>;
  private readonly sessions = new Set<{ dispose(): void }>();

  private runtime(): Promise<ModelRuntime> {
    this.modelRuntime ??= ModelRuntime.create({ allowModelNetwork: false });
    return this.modelRuntime;
  }

  private async configured(): Promise<{ runtime: ModelRuntime; model: Model<any> }> {
    const runtime = await this.runtime();
    const model = runtime.getModel("openai-codex", EXPERIMENT_MODEL_ID);
    if (!model) throw new Error(`Pi model is unavailable: openai-codex/${EXPERIMENT_MODEL_ID}`);
    if (!runtime.hasConfiguredAuth("openai-codex")) throw new Error("Pi provider is not authenticated: openai-codex");
    return { runtime, model };
  }

  async generate(request: ExperimentGenerationRequest) {
    if (request.generation.promptConfig.modelId !== EXPERIMENT_MODEL_ID) throw new Error("experiment generation must use gpt-5.6-sol");
    return this.generator.generateArtifact(request.generation);
  }

  private async structured<T>(input: {
    cwd: string;
    systemPrompt: string;
    userPrompt: string;
    toolName: string;
    description: string;
    parameters: object;
  }): Promise<T> {
    const configured = await this.configured();
    const state: { submission?: T } = {};
    const submit = defineTool({
      name: input.toolName,
      label: input.description,
      description: input.description,
      promptSnippet: input.description,
      promptGuidelines: [`End by calling ${input.toolName} exactly once.`],
      parameters: input.parameters as never,
      async execute(_toolCallId: string, params: T) {
        state.submission = params;
        return { content: [{ type: "text" as const, text: "Recorded." }], details: {}, terminate: true };
      }
    });
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: "openai-codex",
      defaultModel: EXPERIMENT_MODEL_ID,
      defaultThinkingLevel: "medium"
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: getAgentDir(),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: input.systemPrompt
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: input.cwd,
      modelRuntime: configured.runtime,
      model: configured.model,
      thinkingLevel: "medium",
      tools: [input.toolName],
      customTools: [submit],
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(input.cwd)
    });
    this.sessions.add(session);
    try {
      await session.prompt(input.userPrompt);
      if (!state.submission) throw new Error(`${input.toolName} agent finished without submitting`);
      return state.submission;
    } finally {
      session.dispose();
      this.sessions.delete(session);
    }
  }

  async judgeCross(axis: AxisDefinition, diagrams: LabeledDiagram[]): Promise<CrossJudgment> {
    return this.structured<CrossJudgment>({
      cwd: process.cwd(),
      systemPrompt: "You are a blind ASCII-diagram experiment judge. Evaluate only the named target axis. Do not reward general aesthetics. Infer relative positions without access to the hidden numeric settings and submit one structured judgment.",
      userPrompt: `Target axis: ${axis.label}\nLow endpoint: ${axis.lowEndpoint}\nHigh endpoint: ${axis.highEndpoint}\nControls: ${axis.controls}\n\nOrder the three diagrams from low to high on this axis. Score each adjacent perceived gap from 0 (indistinguishable) to 4 (very large), off-axis change from 0 (none) to 4 (dominant), and confidence from 0 to 1.\n\n${diagramsPrompt(diagrams)}`,
      toolName: "submit_cross_judgment",
      description: "Submit the blind cross-value judgment",
      parameters: Type.Object({
        orderLowToHigh: Type.Array(labelSchema, { minItems: 3, maxItems: 3 }),
        confidence: Type.Number({ minimum: 0, maximum: 1 }),
        gapLowMid: Type.Number({ minimum: 0, maximum: 4 }),
        gapMidHigh: Type.Number({ minimum: 0, maximum: 4 }),
        offAxisChange: Type.Number({ minimum: 0, maximum: 4 }),
        invalidLabels: Type.Array(labelSchema, { maxItems: 3 }),
        rationale: Type.String({ minLength: 1, maxLength: 1000 })
      })
    });
  }

  async judgeWithin(axis: AxisDefinition, diagrams: LabeledDiagram[]): Promise<WithinJudgment> {
    return this.structured<WithinJudgment>({
      cwd: process.cwd(),
      systemPrompt: "You are a blind ASCII-diagram experiment judge. These outputs share one hidden input setting. Measure stochastic variation on the named axis separately from unrelated visual variation and submit one structured judgment.",
      userPrompt: `Target axis: ${axis.label}\nLow endpoint: ${axis.lowEndpoint}\nHigh endpoint: ${axis.highEndpoint}\nControls: ${axis.controls}\n\nScore perceived target-axis spread from 0 (effectively identical position) to 4 (spans most of the axis). Score off-axis spread from 0 to 4.\n\n${diagramsPrompt(diagrams)}`,
      toolName: "submit_within_judgment",
      description: "Submit the same-value variation judgment",
      parameters: Type.Object({
        perceivedSpread: Type.Number({ minimum: 0, maximum: 4 }),
        offAxisSpread: Type.Number({ minimum: 0, maximum: 4 }),
        invalidLabels: Type.Array(labelSchema, { maxItems: 3 }),
        rationale: Type.String({ minLength: 1, maxLength: 1000 })
      })
    });
  }

  async analyze(input: {
    axis: AxisDefinition;
    iteration: 1 | 2;
    currentPrompt: string;
    aggregateJson: string;
    judgeNotes: string[];
  }): Promise<PromptAnalysis> {
    const final = input.iteration === 2;
    return this.structured<PromptAnalysis>({
      cwd: process.cwd(),
      systemPrompt: "You are a prompt-control experiment analyst. Optimize for a monotonic, distinguishable response to a normalized scalar while keeping non-target properties stable. Be concise and preserve source fidelity. Submit structured analysis only.",
      userPrompt: `Axis: ${input.axis.label} (${input.axis.lowEndpoint} <-> ${input.axis.highEndpoint})\nIteration: ${input.iteration}\nCurrent control block:\n${input.currentPrompt}\n\nAggregate:\n${input.aggregateJson}\n\nJudge notes:\n${input.judgeNotes.join("\n")}\n\n${final ? "Give the best final recommended control block based on both iterations' scores and failure evidence. It must accept the literal placeholder {{value}} in range 0-1 and remain under 240 words." : "Produce one revised control block for iteration 2. It must accept the literal placeholder {{value}} in range 0-1 and remain under 180 words."}`,
      toolName: "submit_prompt_analysis",
      description: "Submit prompt analysis and recommendation",
      parameters: Type.Object({
        revisedPromptBlock: Type.String({ minLength: 1, maxLength: 2000 }),
        hypothesis: Type.String({ minLength: 1, maxLength: 1000 }),
        evidence: Type.String({ minLength: 1, maxLength: 1600 }),
        risks: Type.String({ minLength: 1, maxLength: 1000 })
      })
    });
  }

  dispose(): void {
    this.generator.dispose();
    for (const session of this.sessions) session.dispose();
    this.sessions.clear();
  }
}

export class FakeExperimentRuntime implements ExperimentRuntime {
  async generate(request: ExperimentGenerationRequest) {
    const semantic = request.axis.id === "semantic_zoom";
    const detail = semantic && request.value >= 0.5 ? "parse_config() -> TrainingConfig.reward.weights" : "Training setup";
    const route = !semantic && request.value >= 0.5 ? "+--> branch A --+\n|              +--> join\n+--> branch B --+" : "input --> process --> output";
    return {
      name: `${request.axis.label} ${request.value.toFixed(2)} r${request.replicate}`,
      ascii: semantic ? `+------------------------------------------------+\n| ${detail}\n+------------------------------------------------+` : route,
      codeEntityIds: request.generation.allowedCodeEntityAliases.slice(0, 1).map(({ id }) => id)
    };
  }

  async judgeCross(_axis: AxisDefinition, diagrams: LabeledDiagram[]): Promise<CrossJudgment> {
    const order = [...diagrams].sort((a, b) => a.axisValue - b.axisValue).map((item) => item.label) as [DiagramLabel, DiagramLabel, DiagramLabel];
    return { orderLowToHigh: order, confidence: 0.9, gapLowMid: 3, gapMidHigh: 3, offAxisChange: 0, invalidLabels: [], rationale: "Fake judge follows hidden order." };
  }

  async judgeWithin(): Promise<WithinJudgment> {
    return { perceivedSpread: 0.5, offAxisSpread: 0.5, invalidLabels: [], rationale: "Fake outputs have low replicate spread." };
  }

  async analyze(input: { currentPrompt: string }): Promise<PromptAnalysis> {
    return { revisedPromptBlock: input.currentPrompt, hypothesis: "Fake revision.", evidence: "Fake aggregate.", risks: "None." };
  }

  dispose(): void {}
}
