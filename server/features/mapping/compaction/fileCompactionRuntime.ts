import { Type } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager, defineTool } from "@earendil-works/pi-coding-agent";
import type { FileCompactionDraft } from "../../../../domain/mapping/compaction/fileCompaction";
import { PiAgentRuntime, progressFor } from "../../../infrastructure/agents/agentRuntime";
import type { AgentStepRequest } from "../../../infrastructure/agents/agentWorkflow";
import { createValidatedSubmission } from "../../../infrastructure/agents/validatedSubmission";
import { validateFileCompactionDraft, type FileCompactionSource } from "./fileCompactionWorkflow";
import type { FileCompactionAgentSettings } from "./fileCompactionSettings";

export interface FileCompactionSession {
  runStep(request: AgentStepRequest, onProgress: (message: string) => void): Promise<{ draft: FileCompactionDraft; model: string; sessionId?: string }>;
  dispose(): void;
}

export interface FileCompactionContext {
  sourceRoot: string;
  source: FileCompactionSource;
  agent: FileCompactionAgentSettings;
  signal?: AbortSignal;
}

export interface FileCompactionRuntime {
  openSession(context: FileCompactionContext): Promise<FileCompactionSession>;
  dispose(): void;
}

/** One chat per workflow run; each turn gets a new submission collector. */
export class PiFileCompactionRuntime extends PiAgentRuntime implements FileCompactionRuntime {
  async openSession(context: FileCompactionContext): Promise<FileCompactionSession> {
    context.signal?.throwIfAborted();
    const configured = await this.model(context.agent.modelId);
    context.signal?.throwIfAborted();
    const newSubmission = () => createValidatedSubmission<FileCompactionDraft>({
      toolName: "submit_file_compaction",
      validate: (candidate) => {
        try { validateFileCompactionDraft(candidate, context.source); }
        catch (error) { return error instanceof Error ? error.message : "Invalid compaction"; }
      },
      acceptedMessage: () => "Accepted this compaction pass."
    });
    let submission: ReturnType<typeof newSubmission> | undefined;
    const submit = defineTool({
      name: "submit_file_compaction", label: "Submit file compaction",
      description: "Submit the complete ASCII file representation with one-based inclusive source ranges for each semantic row.",
      promptSnippet: "Submit the complete mapped file compaction",
      promptGuidelines: [newSubmission().promptGuideline],
      parameters: Type.Object({
        ascii: Type.String({ minLength: 1, maxLength: 200000 }),
        mappings: Type.Array(Type.Object({
          treeLine: Type.Integer({ minimum: 1 }),
          sourceRanges: Type.Array(Type.Object({
            startLine: Type.Integer({ minimum: 1 }), endLine: Type.Integer({ minimum: 1 })
          }), { minItems: 1 })
        }), { minItems: 1 })
      }),
      execute: async (toolCallId, candidate) => {
        if (!submission) throw new Error("No compaction turn is active");
        return submission.execute(toolCallId, candidate);
      }
    });
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: configured.provider,
      defaultModel: configured.modelId, defaultThinkingLevel: context.agent.thinkingLevel
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: context.sourceRoot, agentDir: getAgentDir(), settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: context.agent.systemPrompt.effectiveText
    });
    await resourceLoader.reload();
    context.signal?.throwIfAborted();
    const { session } = await createAgentSession({
      cwd: context.sourceRoot, modelRuntime: configured.runtime, model: configured.model,
      thinkingLevel: context.agent.thinkingLevel, tools: ["submit_file_compaction"], customTools: [submit],
      resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(context.sourceRoot)
    });
    const model = `${configured.provider}/${configured.modelId}`;
    let onProgress: ((message: string) => void) | undefined;
    const unsubscribe = session.subscribe((event) => {
      const progress = progressFor(event, model, session.sessionId);
      if (progress) onProgress?.(progress.message);
    });
    let disposed = false;
    let aborted = false;
    const abort = async () => {
      if (aborted || disposed) return;
      aborted = true;
      await session.abort().catch(() => { });
    };
    const onAbort = () => { void abort(); };
    const managed = {
      abort,
      dispose: () => {
        if (disposed) return;
        if (submission) void abort();
        disposed = true;
        context.signal?.removeEventListener("abort", onAbort);
        unsubscribe();
        session.dispose();
        this.sessions.delete(managed);
      }
    };
    this.sessions.add(managed);
    context.signal?.addEventListener("abort", onAbort, { once: true });
    if (context.signal?.aborted) {
      managed.dispose();
      context.signal.throwIfAborted();
    }
    return {
      async runStep(request, progress) {
        context.signal?.throwIfAborted();
        request.signal?.throwIfAborted();
        if (disposed || aborted) throw new Error("Compaction session is closed");
        if (submission) throw new Error("A compaction turn is already running");
        submission = newSubmission();
        onProgress = progress;
        request.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          await session.prompt(request.prompt);
          context.signal?.throwIfAborted();
          request.signal?.throwIfAborted();
          if (disposed || aborted) throw new Error("Compaction session is closed");
          if (!submission.value) throw new Error(`${request.stepId} finished without an accepted compaction`);
          return { draft: submission.value, model, sessionId: session.sessionId };
        } finally {
          request.signal?.removeEventListener("abort", onAbort);
          submission = undefined;
          onProgress = undefined;
        }
      },
      dispose: managed.dispose
    };
  }
}

export class FakeFileCompactionRuntime implements FileCompactionRuntime {
  async openSession(context: FileCompactionContext): Promise<FileCompactionSession> {
    context.signal?.throwIfAborted();
    let disposed = false;
    return {
      async runStep(request, onProgress) {
        context.signal?.throwIfAborted();
        request.signal?.throwIfAborted();
        if (disposed) throw new Error("Compaction session is closed");
        onProgress(`Generating fake ${request.stepId} pass`);
        return {
          model: "fake/test", draft: {
            ascii: `${context.source.sourceFile}\n\\-- ${request.stepId === "compact" ? "Read the source snapshot" : "read(source)"}`,
            mappings: [1, 2].map((treeLine) => ({ treeLine, sourceRanges: [{ startLine: 1, endLine: context.source.lineCount }] }))
          }
        };
      },
      dispose() { disposed = true; }
    };
  }
  dispose(): void { }
}
