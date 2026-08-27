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
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  assertSourceRange,
  createCodeEntityPromptAliases,
  DEFAULT_DIAGRAM_MODEL_ID,
  resolveCodeEntityPromptAliases,
  type AgentProgress,
  type ArtifactEditDraft,
  type CodeEntityDraft,
  type CodeEntityPromptAlias,
  type CodeEntityPromptConfigRecord,
  type CodeEntityRecord,
  type DiagramElementMappingDraft,
  type DiagramModelId,
  type GeneratedArtifactDraft,
  type GenerationOutputKind,
  type GenerationPromptConfigRecord
} from "../src/domain";
import { diagramMappingValidationError } from "./diagramMapping";
import { createValidatedSubmission } from "./validatedSubmission";
import {
  DEFAULT_MAPPING_FOLLOW_UP_PROMPT,
  renderMappingPromptTemplate
} from "../src/prompt";

export interface EntityCollectionRequest {
  sourceRoot: string;
  diagramSetName: string;
  promptConfig: CodeEntityPromptConfigRecord;
}

export interface ArtifactGenerationRequest {
  sourceRoot: string;
  diagramSetName: string;
  promptConfig: GenerationPromptConfigRecord;
  allowedCodeEntityAliases: CodeEntityPromptAlias[];
  codeEntities: CodeEntityRecord[];
  allowedDiagramIds: string[];
  allowedDiagramComponentIds: string[];
  slot: number;
  total: number;
}

export interface ArtifactEditRequest {
  sourceRoot: string;
  diagramSetName: string;
  artifactKind: GenerationOutputKind;
  artifactName: string;
  artifactHandle: string;
  currentAscii: string;
  instruction: string;
  modelId: DiagramModelId;
  markers: Array<{ token: string; character: string; originalCharacter: string }>;
}

export interface ArtifactEntityMappingRequest {
  sourceRoot: string;
  diagramSetName: string;
  artifactKind: GenerationOutputKind;
  artifactName: string;
  artifactHandle: string;
  ascii: string;
  codeEntityIds: string[];
  codeEntities: CodeEntityRecord[];
}

export interface DiagramAgentRuntime {
  collectEntities(
    request: EntityCollectionRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<CodeEntityDraft[]>;
  generateArtifact(
    request: ArtifactGenerationRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<GeneratedArtifactDraft>;
  mapArtifactEntities(
    request: ArtifactEntityMappingRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<DiagramElementMappingDraft[]>;
  editArtifact(
    request: ArtifactEditRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<ArtifactEditDraft>;
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

export async function runGenerationPromptTurns(input: {
  initialPrompt: string;
  referencePrompt?: string;
  mappingPrompt(artifact: GeneratedArtifactDraft): string;
  prompt(text: string): Promise<void>;
  takeSubmission(): GeneratedArtifactDraft | undefined;
  artifactLabel: string;
  onReferenceTurn?(): void;
  onMappingTurn?(artifact: GeneratedArtifactDraft): void;
}): Promise<GeneratedArtifactDraft> {
  await input.prompt(input.initialPrompt);
  const initialSubmission = input.takeSubmission();
  if (!initialSubmission) {
    throw new Error(`${input.artifactLabel} agent finished without submitting an artifact`);
  }
  let finalArtifact = initialSubmission;
  if (input.referencePrompt) {
    input.onReferenceTurn?.();
    await input.prompt(input.referencePrompt);
    const referenceSubmission = input.takeSubmission();
    if (!referenceSubmission) {
      throw new Error(`${input.artifactLabel} agent finished the reference turn without submitting an artifact`);
    }
    finalArtifact = referenceSubmission;
  }

  input.onMappingTurn?.(finalArtifact);
  await input.prompt(input.mappingPrompt(finalArtifact));
  const mappingSubmission = input.takeSubmission();
  if (!mappingSubmission) {
    throw new Error(`${input.artifactLabel} agent finished the mapping turn without submitting an artifact`);
  }
  if (!mappingSubmission.mappings) {
    throw new Error(`${input.artifactLabel} agent submitted no mappings in the mapping turn`);
  }
  return mappingSubmission;
}

const artifactSubmissionParameters = () => Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  ascii: Type.String({ minLength: 1, maxLength: 20000 }),
  codeEntityIds: Type.Array(Type.String({
    description: "Readable CodeEntity aliases used by this artifact, such as entity-request-handler."
  }), { maxItems: 200 }),
  mappings: Type.Optional(Type.Array(Type.Object({
    entityId: Type.String({
      minLength: 1,
      maxLength: 120,
      description: "Readable CodeEntity alias represented by this exact ASCII span."
    }),
    sourceRangeIndex: Type.Integer({ minimum: 0 }),
    line: Type.Integer({ minimum: 1 }),
    startColumn: Type.Integer({ minimum: 1 }),
    endColumn: Type.Integer({ minimum: 1 })
  }), { maxItems: 200 }))
});

function unchangedArtifactError(
  expected: GeneratedArtifactDraft,
  candidate: GeneratedArtifactDraft
): string | undefined {
  if (candidate.name !== expected.name) return "mapping turn changed the artifact name";
  if (candidate.ascii !== expected.ascii) return "mapping turn changed the artifact ASCII";
  if (JSON.stringify(candidate.codeEntityIds) !== JSON.stringify(expected.codeEntityIds)) {
    return "mapping turn changed the artifact CodeEntity list";
  }
  return undefined;
}

async function validateSubmittedSourceRanges(
  sourceRoot: string,
  entities: CodeEntityDraft[]
): Promise<string | undefined> {
  const canonicalRoot = await realpath(sourceRoot);
  for (const entity of entities) {
    for (const range of entity.sourceRanges) {
      try {
        assertSourceRange(range);
      } catch (error) {
        return error instanceof Error ? error.message : `invalid source range for ${range.path}`;
      }
      const absolute = await realpath(path.resolve(canonicalRoot, range.path)).catch(() => null);
      if (!absolute || (absolute !== canonicalRoot && !absolute.startsWith(`${canonicalRoot}${path.sep}`))) {
        return `${range.path} does not resolve to a repository file`;
      }
      if (!(await stat(absolute)).isFile()) return `${range.path} is not a file`;
      const lineCount = (await readFile(absolute, "utf8")).split(/\r?\n/).length;
      if (range.endLine > lineCount) {
        return `${range.path}:${range.startLine}-${range.endLine} exceeds the file's ${lineCount} lines`;
      }
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

  private async model(overrideModelId?: string): Promise<{
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

  async collectEntities(
    request: EntityCollectionRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<CodeEntityDraft[]> {
    const configured = await this.model();
    const submission = createValidatedSubmission<{ entities: CodeEntityDraft[] }>({
      toolName: "submit_code_entities",
      validate: ({ entities }) => validateSubmittedSourceRanges(request.sourceRoot, entities),
      acceptedMessage: ({ entities }) => `Recorded ${entities.length} code entities.`,
      acceptedDetails: ({ entities }) => ({ count: entities.length }),
      correctionPrompt: "Inspect the current file and correct the source coordinates."
    });
    const submit = defineTool({
      name: "submit_code_entities",
      label: "Submit code entities",
      description: "Submit the source-backed code entities for this diagram set.",
      promptSnippet: "Submit the final code entity set",
      promptGuidelines: [submission.promptGuideline],
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
            symbol: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
            compactedSource: Type.Object({
              level: Type.Union([
                Type.Literal("low"),
                Type.Literal("medium"),
                Type.Literal("high")
              ]),
              sections: Type.Array(Type.Union([
                Type.Object({
                  kind: Type.Literal("source"),
                  startLine: Type.Integer({ minimum: 1 }),
                  endLine: Type.Integer({ minimum: 1 })
                }),
                Type.Object({
                  kind: Type.Literal("collapsed-comment"),
                  startLine: Type.Integer({ minimum: 1 }),
                  endLine: Type.Integer({ minimum: 1 }),
                  comment: Type.String({
                    minLength: 1,
                    maxLength: 1200,
                    description: "A source-backed, 7-bit ASCII call-graph body without comment markers or a line-range heading."
                  }),
                  nodes: Type.Array(Type.Object({
                    graphLine: Type.Integer({
                      minimum: 1,
                      description: "One-based line number of the semantic node in the comment graph body."
                    }),
                    startLine: Type.Integer({ minimum: 1 }),
                    endLine: Type.Integer({ minimum: 1 })
                  }), {
                    minItems: 1,
                    maxItems: 100,
                    description: "Map every semantic graph node to its exact source block; omit connector-only graph lines."
                  })
                })
              ]), { minItems: 1, maxItems: 100 })
            })
          }), { minItems: 1, maxItems: 12 })
        }), { minItems: 1, maxItems: 200 })
      }),
      execute: submission.execute
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
      systemPrompt: "Inspect repository source without modifying it. Collect source-backed CodeEntities with compacted source presentations and finish through submit_code_entities."
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
      await session.prompt(request.promptConfig.contextPrompt.rendered);
      const accepted = submission.value;
      if (!accepted) throw new Error("collector finished without submitting code entities");
      return accepted.entities;
    } finally {
      unsubscribe();
      session.dispose();
      this.sessions.delete(session);
    }
  }

  async generateArtifact(
    request: ArtifactGenerationRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<GeneratedArtifactDraft> {
    const configured = await this.model(request.promptConfig.modelId);
    const componentMode = request.promptConfig.outputKind === "diagram-component";
    const artifactLabel = componentMode ? "DiagramComponent" : "diagram";
    const toolName = componentMode ? "submit_diagram_component" : "submit_diagram";
    const state: {
      submissions: GeneratedArtifactDraft[];
      mappingSource?: GeneratedArtifactDraft;
    } = { submissions: [] };
    const submit = defineTool({
      name: toolName,
      label: `Submit ${artifactLabel}`,
      description: `Submit exactly one source-backed 7-bit ASCII ${artifactLabel}.`,
      promptSnippet: `Submit the final ASCII ${artifactLabel}`,
      promptGuidelines: [
        "Give the diagram a compact, specific name, ideally two to five words.",
        `End each generation turn by calling ${toolName} exactly once.`
      ],
      parameters: artifactSubmissionParameters(),
      async execute(_toolCallId, params) {
        const codeEntityIds = resolveCodeEntityPromptAliases(
          params.codeEntityIds,
          request.allowedCodeEntityAliases
        );
        const mappingEntityIds = params.mappings
          ? resolveCodeEntityPromptAliases(
              params.mappings.map((mapping) => mapping.entityId),
              request.allowedCodeEntityAliases
            )
          : undefined;
        const candidate: GeneratedArtifactDraft = {
          name: params.name,
          ascii: params.ascii,
          codeEntityIds,
          ...(params.mappings ? {
            mappings: params.mappings.map((mapping, index) => ({
              ...mapping,
              entityId: mappingEntityIds![index]
            }))
          } : {})
        };
        if (state.mappingSource) {
          const artifactError = unchangedArtifactError(state.mappingSource, candidate);
          const mappedEntities = request.codeEntities.filter(
            (entity) => state.mappingSource!.codeEntityIds.includes(entity.id)
          );
          const mappingError = candidate.mappings
            ? diagramMappingValidationError(candidate.ascii, candidate.mappings, mappedEntities)
            : "mapping turn omitted mappings";
          const validationError = artifactError ?? mappingError;
          if (validationError) {
            return {
              content: [{
                type: "text" as const,
                text: `Submission rejected: ${validationError}. Resubmit the unchanged artifact with corrected mappings through ${toolName}.`
              }],
              details: { accepted: false, name: params.name },
              terminate: false
            };
          }
        }
        state.submissions.push(candidate);
        return {
          content: [{ type: "text", text: `Recorded one ${artifactLabel}.` }],
          details: { accepted: true, name: params.name },
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
      systemPrompt: request.promptConfig.systemPrompt.rendered
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: request.sourceRoot,
      modelRuntime: configured.runtime,
      model: configured.model,
      thinkingLevel: "medium",
      tools: [toolName],
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
      return await runGenerationPromptTurns({
        initialPrompt: `${request.promptConfig.contextPrompt.rendered}

Parallel generation slot: ${request.slot} of ${request.total}.
Independently choose a clear organizing shape for this slot. Return one ${artifactLabel} only.
Allowed CodeEntity aliases: ${request.allowedCodeEntityAliases.map(({ alias }) => alias).join(", ") || "none"}
Use aliases in the codeEntityIds submission field. Never print persisted CodeEntity identifiers.
Referenced Diagram ids: ${request.allowedDiagramIds.join(", ") || "none"}
Referenced DiagramComponent ids: ${request.allowedDiagramComponentIds.join(", ") || "none"}`,
        referencePrompt: request.promptConfig.referencePrompt?.rendered,
        mappingPrompt: (artifact) => renderMappingPromptTemplate({
          template: request.promptConfig.mappingPrompt.template,
          targetKind: componentMode
            ? "diagram-component"
            : request.promptConfig.viewKind ?? "diagram",
          artifact,
          codeEntities: request.codeEntities.filter((entity) => artifact.codeEntityIds.includes(entity.id)),
          aliases: request.allowedCodeEntityAliases
        }),
        prompt: (text) => session.prompt(text),
        takeSubmission: () => state.submissions.shift(),
        artifactLabel,
        onReferenceTurn: () => onProgress?.({
          status: "generating",
          message: "agent is applying the reference prompt in a follow-up turn",
          model: modelName,
          sessionId: session.sessionId
        }),
        onMappingTurn: (artifact) => {
          state.mappingSource = artifact;
          onProgress?.({
            status: "generating",
            message: "agent is mapping the final artifact in a follow-up turn",
            model: modelName,
            sessionId: session.sessionId
          });
        }
      });
    } finally {
      unsubscribe();
      session.dispose();
      this.sessions.delete(session);
    }
  }

  async editArtifact(
    request: ArtifactEditRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<ArtifactEditDraft> {
    const configured = await this.model(request.modelId);
    const state: { submission?: ArtifactEditDraft } = {};
    const submit = defineTool({
      name: "submit_artifact_edit",
      label: "Submit artifact edit",
      description: "Submit the complete revised 7-bit ASCII artifact.",
      promptSnippet: "Submit the complete revised ASCII",
      promptGuidelines: ["End by calling submit_artifact_edit exactly once."],
      parameters: Type.Object({
        ascii: Type.String({ minLength: 1, maxLength: 20000 })
      }),
      async execute(_toolCallId, params) {
        state.submission = params;
        return {
          content: [{ type: "text", text: "Recorded the revised artifact." }],
          details: {},
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
      systemPrompt: "Edit the supplied ASCII artifact exactly as instructed. Preserve unrelated content, use 7-bit ASCII only, remove location marker characters from the final result, never modify files, and finish through submit_artifact_edit."
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: request.sourceRoot,
      modelRuntime: configured.runtime,
      model: configured.model,
      thinkingLevel: "medium",
      tools: ["submit_artifact_edit"],
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
    const markerGuide = request.markers.length
      ? request.markers.map((marker) => (
        `${marker.token} identifies the unique '${marker.character}' character; it replaced ${JSON.stringify(marker.originalCharacter)}.`
      )).join("\n")
      : "none";
    try {
      await session.prompt(`DiagramSet: ${request.diagramSetName}
Artifact: ${request.artifactKind === "diagram" ? "Diagram" : "DiagramComponent"} @${request.artifactKind === "diagram" ? "diagram" : "component"}/${request.artifactHandle}
Name: ${request.artifactName}

Current complete ASCII artifact:
${request.currentAscii}

Location markers:
${markerGuide}

Edit instruction:
${request.instruction}`);
      if (!state.submission) throw new Error("edit agent finished without submitting an artifact");
      return state.submission;
    } finally {
      unsubscribe();
      session.dispose();
      this.sessions.delete(session);
    }
  }

  async mapArtifactEntities(
    request: ArtifactEntityMappingRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<DiagramElementMappingDraft[]> {
    const configured = await this.model();
    const componentMode = request.artifactKind === "diagram-component";
    const artifactLabel = componentMode ? "DiagramComponent" : "diagram";
    const toolName = componentMode ? "submit_diagram_component" : "submit_diagram";
    const aliases = createCodeEntityPromptAliases(request.codeEntities);
    const expected: GeneratedArtifactDraft = {
      name: request.artifactName,
      ascii: request.ascii,
      codeEntityIds: request.codeEntityIds
    };
    const state: { submission?: GeneratedArtifactDraft } = {};
    const submit = defineTool({
      name: toolName,
      label: `Submit ${artifactLabel}`,
      description: `Resubmit the unchanged ${artifactLabel} with exact CodeEntity mappings.`,
      promptSnippet: `Submit the complete mapped ${artifactLabel}`,
      promptGuidelines: [`Call ${toolName} with the unchanged artifact and corrected mappings.`],
      parameters: artifactSubmissionParameters(),
      async execute(_toolCallId, params) {
        let candidate: GeneratedArtifactDraft;
        try {
          const codeEntityIds = resolveCodeEntityPromptAliases(params.codeEntityIds, aliases);
          const mappingEntityIds = params.mappings
            ? resolveCodeEntityPromptAliases(params.mappings.map((mapping) => mapping.entityId), aliases)
            : undefined;
          candidate = {
            name: params.name,
            ascii: params.ascii,
            codeEntityIds,
            ...(params.mappings ? {
              mappings: params.mappings.map((mapping, index) => ({
                ...mapping,
                entityId: mappingEntityIds![index]
              }))
            } : {})
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "invalid CodeEntity alias";
          return {
            content: [{ type: "text" as const, text: `Submission rejected: ${message}. Call ${toolName} again.` }],
            details: { accepted: false, count: 0 },
            terminate: false
          };
        }
        const validationError = unchangedArtifactError(expected, candidate)
          ?? (candidate.mappings
            ? diagramMappingValidationError(candidate.ascii, candidate.mappings, request.codeEntities)
            : "mapping turn omitted mappings");
        if (validationError) {
          return {
            content: [{
              type: "text" as const,
              text: `Submission rejected: ${validationError}. Resubmit the unchanged artifact with corrected mappings through ${toolName}.`
            }],
            details: { accepted: false, count: 0 },
            terminate: false
          };
        }
        state.submission = candidate;
        return {
          content: [{ type: "text" as const, text: `Recorded ${candidate.mappings!.length} diagram mappings.` }],
          details: { accepted: true, count: candidate.mappings!.length },
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
      systemPrompt: `Map visible semantic text in the supplied ASCII artifact to the supplied CodeEntities. Never modify files and finish through ${toolName}.`
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: request.sourceRoot,
      modelRuntime: configured.runtime,
      model: configured.model,
      thinkingLevel: "medium",
      tools: [toolName],
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
      await session.prompt(`DiagramSet: ${request.diagramSetName}
Artifact: ${request.artifactKind === "diagram" ? "Diagram" : "DiagramComponent"} @${request.artifactKind === "diagram" ? "diagram" : "component"}/${request.artifactHandle}
Name: ${request.artifactName}

${renderMappingPromptTemplate({
  template: DEFAULT_MAPPING_FOLLOW_UP_PROMPT,
  targetKind: componentMode ? "diagram-component" : "diagram",
  artifact: expected,
  codeEntities: request.codeEntities,
  aliases
})}`);
      if (!state.submission?.mappings) throw new Error("mapping agent finished without submitting mappings");
      return state.submission.mappings;
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
      sourceRanges: [{
        path: "fixture.ts",
        startLine: 1,
        endLine: 4,
        symbol: "workspace",
        compactedSource: {
          level: "medium",
          sections: [
            { kind: "source", startLine: 1, endLine: 1 },
            {
              kind: "collapsed-comment",
              startLine: 2,
              endLine: 3,
              comment: [
                "workspace",
                "  |",
                "  +--> status = 'collecting'",
                "  \\--> status = 'ready'"
              ].join("\n"),
              nodes: [
                { graphLine: 1, startLine: 2, endLine: 3 },
                { graphLine: 3, startLine: 2, endLine: 2 },
                { graphLine: 4, startLine: 3, endLine: 3 }
              ]
            },
            { kind: "source", startLine: 4, endLine: 4 }
          ]
        }
      }]
    }];
  }

  async generateArtifact(
    request: ArtifactGenerationRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<GeneratedArtifactDraft> {
    onProgress?.({ status: "generating", message: `generating fixture slot ${request.slot}`, model: "fake/test" });
    const entity = request.allowedCodeEntityAliases[0];
    const callGraphAscii = entity
      ? `parallel slot ${String(request.slot).padStart(2, "0")} [${entity.alias}]\n` +
        "`--> internal step"
      : `parallel slot ${String(request.slot).padStart(2, "0")}`;
    const ascii = request.promptConfig.outputKind === "diagram-component"
      ? `+-------------------+\n| component slot ${String(request.slot).padStart(2, "0")} |\n+-------------------+`
      : request.promptConfig.viewKind === "call-graph"
        ? callGraphAscii
        : `+------------------+\n| parallel slot ${String(request.slot).padStart(2, "0")} |\n+------------------+`;
    const lines = ascii.split("\n");
    const lineIndex = lines.findIndex((line) => /[A-Za-z]/.test(line));
    const match = lineIndex >= 0 ? /[A-Za-z][A-Za-z0-9_-]*/.exec(lines[lineIndex]) : null;
    return {
      name: request.promptConfig.outputKind === "diagram-component"
        ? `Component ${request.slot}`
        : `Diagram ${request.slot}`,
      ascii,
      codeEntityIds: entity ? [entity.id] : [],
      mappings: entity && match ? [{
        entityId: entity.id,
        sourceRangeIndex: 0,
        line: lineIndex + 1,
        startColumn: match.index + 1,
        endColumn: match.index + match[0].length
      }] : []
    };
  }

  async editArtifact(
    request: ArtifactEditRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<ArtifactEditDraft> {
    onProgress?.({ status: "generating", message: "editing fixture artifact", model: "fake/test" });
    let ascii = request.currentAscii;
    for (const marker of request.markers) {
      ascii = ascii.replace(marker.character, marker.originalCharacter);
    }
    return { ascii: `${ascii}\n[edited: ${request.instruction.trim()}]` };
  }

  async mapArtifactEntities(
    request: ArtifactEntityMappingRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<DiagramElementMappingDraft[]> {
    onProgress?.({ status: "generating", message: "mapping fixture labels", model: "fake/test" });
    const entity = request.codeEntities[0];
    if (!entity) return [];
    const lines = request.ascii.split("\n");
    for (const [index, line] of lines.entries()) {
      const match = /[A-Za-z][A-Za-z0-9_-]*/.exec(line);
      if (match) {
        return [{
          entityId: entity.id,
          sourceRangeIndex: 0,
          line: index + 1,
          startColumn: match.index + 1,
          endColumn: match.index + match[0].length
        }];
      }
    }
    return [];
  }

  dispose(): void {}
}
