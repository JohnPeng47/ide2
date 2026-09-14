import { randomUUID } from "node:crypto";
import type { CorpusBinding } from "../../../../domain/core/profiles/domainProfile";
import type { FileCompactionEvent, FileCompactionRequest, FileCompactionResult, FileCompactionStage } from "../../../../domain/mapping/compaction/fileCompaction";
import { runAgentWorkflow } from "../../../infrastructure/agents/agentWorkflow";
import type { CoreApplication } from "../../../core/application";
import { corpusProvider } from "../../../core/corpus/corpus";
import { ProjectDiagramConflict } from "../../../core/persistence/projectCatalogStore";
import type { FileCompactionRuntime, FileCompactionSession } from "./fileCompactionRuntime";
import { FileCompactionStore, type FileCompactionRun } from "./fileCompactionStore";
import { resolveFileCompactionSettings, type FileCompactionAgentSettings } from "./fileCompactionSettings";
import { compactionSnapshot, createFileCompactionWorkflow, loadFileCompactionPrompts, sha256,
  type FileCompactionPrompts, type FileCompactionSource } from "./fileCompactionWorkflow";

interface PreparedCompaction {
  projectId: string;
  corpus: CorpusBinding;
  bytes: Buffer;
  source: FileCompactionSource;
  prompts: FileCompactionPrompts;
  agent: FileCompactionAgentSettings;
}

export class FileCompactionService {
  private readonly store: FileCompactionStore;
  private readonly active = new Map<string, AbortController>();
  constructor(private readonly application: CoreApplication, private readonly runtime: FileCompactionRuntime) {
    this.store = new FileCompactionStore(application.store.projectCatalogs.storeRoot);
  }

  async prepare(input: unknown): Promise<PreparedCompaction> {
    const request = input as FileCompactionRequest | null;
    if (!request || typeof request.projectId !== "string" || !request.projectId.trim()
      || typeof request.sourceFile !== "string" || !request.sourceFile.trim()
      || request.sourceFile.length > 2000 || /[^\x20-\x7e]/.test(request.sourceFile)) {
      throw new Error("projectId and a printable ASCII sourceFile path are required");
    }
    const project = await this.application.store.loadProject();
    if (!project || project.id !== request.projectId) throw new ProjectDiagramConflict("Compaction belongs to another Project");
    if (project.domainProfileId !== "source-code") throw new Error("File compaction requires a source-code project");
    const bytes = await corpusProvider(project.corpus).readDocumentBytes(project.corpus, request.sourceFile);
    if (!bytes.length || bytes.length > 256 * 1024) throw new Error("Source must contain 1 to 262,144 bytes; it will not be truncated");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("Source must be a UTF-8 text file");
    const source = { sourceFile: request.sourceFile, sourceSha256: sha256(bytes), text,
      lineCount: text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0) };
    return { projectId: project.id, corpus: project.corpus, source, bytes,
      prompts: await loadFileCompactionPrompts(), agent: await resolveFileCompactionSettings(request) };
  }

  async run(prepared: PreparedCompaction, options: {
    signal?: AbortSignal;
    onEvent(event: FileCompactionEvent): void;
  }): Promise<void> {
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(1800000), ...(options.signal ? [options.signal] : [])]);
    const id = `compaction-${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const run: FileCompactionRun = { schemaVersion: 1, id, projectId: prepared.projectId,
      sourceFile: prepared.source.sourceFile, sourceSha256: prepared.source.sourceSha256,
      workflowId: "single-file-compaction", status: "running", stage: "compact",
      createdAt: timestamp, updatedAt: timestamp, prompts: prepared.prompts, agent: prepared.agent, steps: {} };
    this.active.set(id, controller);
    let session: FileCompactionSession | undefined;
    try {
      await this.store.create(run, prepared.bytes);
      options.onEvent({ type: "started", runId: id, sourceSha256: run.sourceSha256 });
      const workflow = createFileCompactionWorkflow(prepared.source, prepared.prompts);
      session = await this.runtime.openSession({ source: prepared.source, sourceRoot: prepared.corpus.root, agent: prepared.agent, signal });
      const draft = await runAgentWorkflow(workflow, async (request) => {
        const stage = request.stepId as FileCompactionStage;
        run.stage = stage;
        run.steps[stage] = { prompt: request.prompt };
        await this.store.save(run);
        signal.throwIfAborted();
        const onProgress = (message: string) => options.onEvent({ type: "progress", runId: id, stage, message });
        onProgress(stage === "compact" ? "Compacting the source snapshot" : "Refining the accepted first pass");
        const { draft, model, sessionId } = await session!.runStep(request, onProgress);
        signal.throwIfAborted();
        onProgress("Validating and saving this pass");
        const snapshot = compactionSnapshot(draft, prepared.source);
        await this.store.savePass(id, stage, snapshot);
        run.steps[stage] = { prompt: request.prompt, model, ...(sessionId ? { sessionId } : {}), snapshot };
        await this.store.save(run);
        return draft;
      }, { signal });
      let sourceStale = true;
      try {
        const current = await corpusProvider(prepared.corpus).readDocumentBytes(prepared.corpus, prepared.source.sourceFile);
        sourceStale = sha256(current) !== prepared.source.sourceSha256;
      } catch { /* Removed or unreadable source is stale relative to the saved snapshot. */ }
      signal.throwIfAborted();
      const result: FileCompactionResult = { runId: id, sourceStale,
        snapshot: compactionSnapshot(draft, prepared.source), artifacts: this.store.artifacts(id) };
      run.result = result;
      run.status = "completed";
      await this.store.save(run);
      options.onEvent({ type: "result", result });
    } catch (error) {
      run.status = signal.aborted ? "cancelled" : "failed";
      run.error = error instanceof Error ? error.message : "Compaction failed";
      await this.store.save(run);
      options.onEvent({ type: "error", runId: id, stage: run.stage, error: run.error });
    } finally {
      session?.dispose();
      this.active.delete(id);
    }
  }

  async get(id: string): Promise<FileCompactionRun | null> {
    const run = await this.store.load(id);
    if (!run) return null;
    const project = await this.application.store.loadProject();
    if (!project || project.id !== run.projectId) throw new ProjectDiagramConflict("Compaction belongs to another Project");
    if (run.status === "running" && !this.active.has(id)) run.status = "interrupted";
    return run;
  }

  dispose(): void {
    for (const controller of this.active.values()) controller.abort(new Error("Server is shutting down"));
    this.runtime.dispose();
  }
}
