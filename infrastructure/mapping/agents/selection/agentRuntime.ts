import { Type } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type { MappingAgentRuntime } from "../../../../application/mapping/selection/agent";
import { mappingPocSourceContextForSelection } from "../../../../application/mapping/selection/mappingPocSourceContext";
import { type AgentProgress, type DiagramElementMapping } from "../../../../domain/core/records/domain";
import { initialMappingPocElementMappings, mappingPocElementMappingsAfterPatch } from '../../../../domain/mapping/selection/mappingPocMappings';
import {
  applyMappingPocPromptPatch,
  generatedMappingPocResult,
  mappingPocPromptHunk,
  renderMappingPocAgentSystemPrompt,
  renderMappingPocEditPrompt,
  validateMappingPocMappings,
  type MappingPocPromptHunk,
  type MappingPocPromptRequest,
  type MappingPocPromptResult
} from "../../../../domain/mapping/selection/mappingPocPrompt";
import { PiAgentRuntime, progressFor } from "../../../core/agents/agentRuntime";
import { corpusProvider } from '../../../core/corpus/corpus';
export type { MappingAgentRuntime } from "../../../../application/mapping/selection/agent";

type PiAgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

interface MappingPocPendingPrompt {
  selectionId: string;
  expectedRevision: number;
  hunk: MappingPocPromptHunk;
  submission?: MappingPocPromptResult;
}

interface MappingPocAgentSession {
  session: PiAgentSession;
  unsubscribe: () => void;
  ascii: string;
  revision: number;
  mappings: DiagramElementMapping[];
  pending?: MappingPocPendingPrompt;
  onProgress?: (progress: AgentProgress) => void;
  modelName: string;
  lastUsedAt: number;
}
export class PiMappingAgentRuntime extends PiAgentRuntime implements MappingAgentRuntime {

  private readonly mappingPocSessions = new Map<string, MappingPocAgentSession>();

  private mappingPocPromptBusy = false;

  private collisionSafePromptNonce(...content: string[]): string {
    let nonce = "";
    do nonce = randomUUID().replaceAll("-", "").toUpperCase();
    while (content.some((value) => value.includes(nonce)));
    return nonce;
  }

  private disposeMappingPocSession(clientSessionId: string): void {
    const state = this.mappingPocSessions.get(clientSessionId);
    if (!state) return;
    state.unsubscribe();
    void state.session.abort();
    state.session.dispose();
    this.sessions.delete(state.session);
    this.mappingPocSessions.delete(clientSessionId);
  }

  private async createMappingPocSession(
    request: MappingPocPromptRequest & { sourceRoot: string; projectEvidence?: Record<string, import("../../../../domain/core/representations/projectCatalog").ProjectRepresentationEvidenceRecord> }
  ): Promise<MappingPocAgentSession> {
    if (this.mappingPocSessions.size >= 12) {
      const oldest = [...this.mappingPocSessions.entries()]
        .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
      if (oldest) this.disposeMappingPocSession(oldest[0]);
    }
    const configured = await this.model();
    let state!: MappingPocAgentSession;
    const generating = request.operation === "generate";
    const submit = defineTool({
      name: "submit_diagram_patch",
      label: generating ? "Submit sub-diagram" : "Submit diagram patch",
      description: generating
        ? "Submit the complete standalone sub-diagram and exact local source mappings, using the active selectionId."
        : "Replace the exact full-row hunk identified by the active selection.",
      promptSnippet: generating ? "Submit a complete mapped sub-diagram" : "Submit replacement rows for the selected diagram hunk",
      promptGuidelines: ["End each edit request by calling submit_diagram_patch exactly once."],
      parameters: Type.Object({
        selectionId: Type.String({ minLength: 1, maxLength: 120 }),
        replacementLines: Type.Array(Type.String({ maxLength: 500 }), {
          minItems: 1,
          maxItems: 500
        }),
        mappings: Type.Optional(Type.Array(Type.Object({
          id: Type.String(), entityId: Type.String(), sourceRangeIndex: Type.Integer({ minimum: 0 }),
          line: Type.Integer({ minimum: 1 }), startColumn: Type.Integer({ minimum: 1 }), endColumn: Type.Integer({ minimum: 1 })
        })))
      }),
      async execute(_toolCallId, params) {
        const pending = state.pending;
        if (!pending) {
          return {
            content: [{ type: "text" as const, text: "Submission rejected: there is no active selection request." }],
            details: { accepted: false },
            terminate: false
          };
        }
        if (params.selectionId !== pending.selectionId) {
          return {
            content: [{
              type: "text" as const,
              text: `Submission rejected: selectionId must be ${pending.selectionId}. Call submit_diagram_patch again.`
            }],
            details: { accepted: false },
            terminate: false
          };
        }
        try {
          const result = generating ? generatedMappingPocResult(
            params.replacementLines, params.mappings ?? [],
            state.mappings.filter((mapping) => mapping.line >= request.selection.startLine
              && mapping.line <= request.selection.endLine
              && mapping.startColumn <= request.selection.endColumn && mapping.endColumn >= request.selection.startColumn)
          ) : applyMappingPocPromptPatch({
            currentAscii: state.ascii,
            currentRevision: state.revision,
            expectedRevision: pending.expectedRevision,
            hunk: pending.hunk,
            replacementLines: params.replacementLines
          });
          state.ascii = result.diagramAscii;
          state.revision = result.diagramRevision;
          state.mappings = generating ? result.mappings! : mappingPocElementMappingsAfterPatch(state.mappings, result);
          result.mappings = state.mappings;
          pending.submission = result;
          return {
            content: [{
              type: "text" as const,
              text: generating ? "Generated the standalone sub-diagram with validated source mappings."
                : `Applied the exact row patch at revision ${result.diagramRevision} (${result.verticalDelta >= 0 ? "+" : ""}${result.verticalDelta} rows).`
            }],
            details: { accepted: true },
            terminate: true
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "invalid diagram patch";
          return {
            content: [{
              type: "text" as const,
              text: `Submission rejected: ${message}. Correct replacementLines and call submit_diagram_patch again.`
            }],
            details: { accepted: false },
            terminate: false
          };
        }
      }
    });
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: configured.provider,
      defaultModel: configured.modelId,
      defaultThinkingLevel: "medium"
    });
    const systemNonce = this.collisionSafePromptNonce(request.diagramAscii);
    const resourceLoader = new DefaultResourceLoader({
      cwd: request.sourceRoot,
      agentDir: getAgentDir(),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: generating
        ? "Generate a standalone printable ASCII sub-diagram from the supplied source evidence and instruction. Its first character is at local row 1, column 1. Call submit_diagram_patch with replacementLines containing the COMPLETE new diagram and mappings containing exact one-based inclusive spans for visible labels. Each mapping must use a supplied elementId as entityId and its sourceRangeIndex. Include at least one mapping. Do not edit the source diagram. No Markdown fences. End with exactly one accepted tool submission."
        : renderMappingPocAgentSystemPrompt(
          request.diagramAscii,
          request.diagramRevision,
          systemNonce
        )
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: request.sourceRoot,
      modelRuntime: configured.runtime,
      model: configured.model,
      thinkingLevel: "medium",
      tools: ["submit_diagram_patch"],
      customTools: [submit],
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(request.sourceRoot)
    });
    const modelName = `${configured.provider}/${configured.modelId}`;
    state = {
      session,
      unsubscribe: () => { },
      ascii: request.diagramAscii,
      revision: request.diagramRevision,
      mappings: request.mappings ?? initialMappingPocElementMappings(),
      modelName,
      lastUsedAt: Date.now()
    };
    state.unsubscribe = session.subscribe((event) => {
      const progress = progressFor(event, state.modelName, session.sessionId);
      if (progress) state.onProgress?.(progress);
    });
    this.mappingPocSessions.set(request.clientSessionId, state);
    this.sessions.add(session);
    return state;
  }

  async promptDiagramSelection(
    request: MappingPocPromptRequest & { sourceRoot: string; projectEvidence?: Record<string, import("../../../../domain/core/representations/projectCatalog").ProjectRepresentationEvidenceRecord> },
    onProgress?: (progress: AgentProgress) => void
  ): Promise<MappingPocPromptResult> {
    this.requireEnabled();
    if (this.mappingPocPromptBusy) throw new Error("another diagram prompt is already running");
    const instruction = request.instruction.trim();
    if (!instruction) throw new Error("diagram prompt instruction is required");
    if (instruction.length > 4000) throw new Error("diagram prompt instruction is too long");
    this.mappingPocPromptBusy = true;
    let state: MappingPocAgentSession | undefined;
    try {
      state = this.mappingPocSessions.get(request.clientSessionId)
        ?? await this.createMappingPocSession(request);
      if (state.revision !== request.diagramRevision || state.ascii !== request.diagramAscii) {
        throw new Error("diagram prompt session is stale; reload the mapping page to start a new session");
      }
      if (state.pending) throw new Error("this diagram prompt session already has an active request");
      validateMappingPocMappings(state.ascii, state.mappings);
      const hunk = mappingPocPromptHunk(state.ascii, request.selection);
      onProgress?.({
        status: "reading-context",
        message: "resolving mapped corpus ranges for the selected elements",
        model: state.modelName,
        sessionId: state.session.sessionId
      });
      const sourceContext = await mappingPocSourceContextForSelection({
        sourceRoot: request.sourceRoot,
        projectEvidence: request.projectEvidence,
        mappings: state.mappings,
        selection: request.selection
      }, { provider: corpusProvider });
      const selectionId = `selection-${randomUUID()}`;
      const promptNonce = this.collisionSafePromptNonce(
        state.ascii,
        instruction,
        selectionId,
        ...sourceContext.flatMap((context) => [context.path, ...context.lines])
      );
      const pending: MappingPocPendingPrompt = {
        selectionId,
        expectedRevision: state.revision,
        hunk
      };
      state.pending = pending;
      state.onProgress = onProgress;
      state.lastUsedAt = Date.now();
      onProgress?.({
        status: "generating",
        message: "sending selection context to the diagram agent",
        model: state.modelName,
        sessionId: state.session.sessionId
      });
      await state.session.prompt(request.operation === "generate"
        ? JSON.stringify({
          instruction, selectionId, sourceDiagram: state.ascii, selection: request.selection,
          evidence: sourceContext.map((context) => ({
            ...context,
            sourceRangeIndex: state!.mappings.find((mapping) => mapping.id === context.mappingId)!.sourceRangeIndex
          }))
        })
        : renderMappingPocEditPrompt({
          instruction,
          selectionId,
          diagramRevision: state.revision,
          selection: request.selection,
          hunk,
          sourceContext,
          nonce: promptNonce
        }));
      if (!pending.submission) throw new Error("diagram edit agent finished without submitting a patch");
      return pending.submission;
    } catch (error) {
      if (state) this.disposeMappingPocSession(request.clientSessionId);
      throw error;
    } finally {
      if (state) {
        state.pending = undefined;
        state.onProgress = undefined;
      }
      this.mappingPocPromptBusy = false;
    }
  }
  override dispose(): void {
    for (const state of this.mappingPocSessions.values()) state.unsubscribe();
    this.mappingPocSessions.clear();
    super.dispose();
  }
}
export class FakeMappingAgentRuntime implements MappingAgentRuntime {

  async promptDiagramSelection(
    request: MappingPocPromptRequest & { sourceRoot: string; projectEvidence?: Record<string, import("../../../../domain/core/representations/projectCatalog").ProjectRepresentationEvidenceRecord> },
    onProgress?: (progress: AgentProgress) => void
  ): Promise<MappingPocPromptResult> {
    onProgress?.({ status: "generating", message: "editing selected diagram rows", model: "fake/test" });
    const delayMs = Number(process.env.NEW_DIAGRAM_FAKE_PROMPT_DELAY_MS ?? "0");
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const hunk = mappingPocPromptHunk(request.diagramAscii, request.selection);
    const sourceContext = await mappingPocSourceContextForSelection({
      sourceRoot: request.sourceRoot,
      projectEvidence: request.projectEvidence,
      mappings: request.mappings ?? initialMappingPocElementMappings(),
      selection: request.selection
    }, { provider: corpusProvider });
    onProgress?.({
      status: "reading-context",
      message: `resolved ${sourceContext.length} mapped corpus range${sourceContext.length === 1 ? "" : "s"}`,
      model: "fake/test"
    });
    const safeInstruction = request.instruction.trim().replace(/[^\x20-\x7e]/g, "?");
    if (request.operation === "generate") {
      const contexts = sourceContext.filter((context, index) => sourceContext.findIndex((other) => other.elementId === context.elementId) === index);
      const lines = [request.instruction.split("\n")[0].replace(/[^\x20-\x7e]/g, "?").slice(0, 100), ...contexts.map((context) => ` +-- ${context.elementLabel}`)];
      const allowed = request.mappings ?? initialMappingPocElementMappings();
      return generatedMappingPocResult(lines, contexts.map((context, index) => ({
        id: `generated-${index}`, entityId: context.elementId,
        sourceRangeIndex: allowed.find((mapping) => mapping.id === context.mappingId)!.sourceRangeIndex,
        line: index + 2, startColumn: 6, endColumn: lines[index + 1].length
      })), allowed);
    }
    onProgress?.({ status: "validating", message: "validating structured submission", model: "fake/test" });
    const result = applyMappingPocPromptPatch({
      currentAscii: request.diagramAscii,
      currentRevision: request.diagramRevision,
      expectedRevision: request.diagramRevision,
      hunk,
      replacementLines: [...hunk.expectedOldLines, `[edited: ${safeInstruction}]`]
    });
    result.mappings = mappingPocElementMappingsAfterPatch(request.mappings ?? initialMappingPocElementMappings(), result);
    return result;
  }

  dispose(): void { }
}
