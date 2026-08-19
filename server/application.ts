import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  CodeEntity,
  SCHEMA_VERSION,
  assertSevenBitAscii,
  assertSourceRange,
  isDiagramArchived,
  normalizeAscii,
  slugify,
  type AgentProgress,
  type AgentRunRecord,
  type CodeEntityDraft,
  type CodeEntityRecord,
  type DiagramDraft,
  type DiagramRecord,
  type DiagramSetRecord,
  type GenerationBatchRecord,
  type WorkspaceSnapshot
} from "../src/domain";
import { resolveGenerationPrompt } from "../src/prompt";
import type { DiagramAgentRuntime } from "./agentRuntime";
import { DiagramStore, discoverRepository } from "./store";

const MAX_GENERATION_COUNT = 12;
const MAX_ATTEMPTS = 3;

export interface ServiceEvent {
  type: "progress" | "workspace";
  message: string;
  workspace?: WorkspaceSnapshot;
}

function timestamp(): string {
  return new Date().toISOString();
}

export class DiagramApplication {
  private readonly activeBatches = new Set<string>();

  constructor(readonly store: DiagramStore, private readonly agents: DiagramAgentRuntime) {}

  async createDiagramSet(input: { path: string; name: string; prompt: string }): Promise<DiagramSetRecord> {
    if (!input.name.trim()) throw new Error("DiagramSet name is required");
    const location = await discoverRepository(input.path);
    if (path.resolve(location.checkoutRoot) !== this.store.checkoutRoot) {
      throw new Error(`application store is rooted at ${this.store.checkoutRoot}, not ${location.checkoutRoot}`);
    }
    const project = await this.store.ensureProject(location);
    const created = await this.store.createDiagramSet({
      project,
      name: input.name,
      initialPrompt: input.prompt,
      location
    });
    return created.diagramSet;
  }

  async collectCodeEntities(
    setId: string,
    onEvent?: (event: ServiceEvent) => void
  ): Promise<void> {
    const set = await this.store.loadDiagramSet(setId);
    const entitySet = await this.store.loadCodeEntities(setId);
    if (entitySet.status === "finalized") throw new Error("CodeEntitiesSet is immutable after finalization");
    const runId = this.store.ids.run();
    let run: AgentRunRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: runId,
      diagramSetId: setId,
      kind: "collect-entities",
      status: "queued",
      statusMessage: "opening code-entity collector",
      codeEntitiesRevision: entitySet.revision,
      outputCodeEntityIds: [],
      startedAt: timestamp(),
      updatedAt: timestamp()
    };
    await this.store.saveRun(run);
    await this.store.attachRun(setId, run.id);
    let progressWrites = Promise.resolve();
    const progress = (update: AgentProgress) => {
      run = {
        ...run,
        status: update.status,
        statusMessage: update.message,
        model: update.model ?? run.model,
        sessionId: update.sessionId ?? run.sessionId,
        updatedAt: timestamp()
      };
      const snapshot = run;
      progressWrites = progressWrites.then(() => this.store.saveRun(snapshot));
      onEvent?.({ type: "progress", message: update.message });
    };
    try {
      const drafts = await this.agents.collectEntities({
        sourceRoot: set.sourceCheckoutRoot,
        diagramSetName: set.name,
        initialPrompt: set.initialPrompt
      }, progress);
      await progressWrites;
      const entities = await this.validateEntityDrafts(set, drafts);
      await this.store.completeCollection(setId, entities);
      run = {
        ...run,
        status: "complete",
        statusMessage: `collected ${entities.length} code entities`,
        outputCodeEntityIds: entities.map((entity) => entity.id),
        updatedAt: timestamp(),
        completedAt: timestamp()
      };
      await this.store.saveRun(run);
      onEvent?.({ type: "workspace", message: run.statusMessage, workspace: await this.workspace() });
    } catch (error) {
      await progressWrites.catch(() => undefined);
      const message = error instanceof Error ? error.message : "code-entity collection failed";
      run = {
        ...run,
        status: "failed",
        statusMessage: message,
        error: message,
        updatedAt: timestamp(),
        completedAt: timestamp()
      };
      await this.store.saveRun(run);
      await this.store.failCollection(setId, message);
      throw error;
    }
  }

  private async validateEntityDrafts(
    set: DiagramSetRecord,
    drafts: CodeEntityDraft[]
  ): Promise<CodeEntityRecord[]> {
    if (drafts.length === 0) throw new Error("collector submitted no CodeEntities");
    const handles = new Set<string>();
    const sourceRoot = await realpath(set.sourceCheckoutRoot);
    const entities: CodeEntityRecord[] = [];
    for (const [index, draft] of drafts.entries()) {
      const baseHandle = slugify(draft.handle || draft.label, `entity-${index + 1}`);
      let handle = baseHandle;
      let suffix = 2;
      while (handles.has(handle)) {
        handle = `${baseHandle}-${suffix}`;
        suffix += 1;
      }
      handles.add(handle);
      if (!draft.label.trim() || !draft.summary.trim()) throw new Error("CodeEntity label and summary are required");
      if (!(["state", "interface-data-struct", "operation"] as const).includes(draft.category)) {
        throw new Error(`invalid CodeEntity category: ${draft.category}`);
      }
      if (draft.sourceRanges.length === 0) throw new Error(`CodeEntity ${handle} has no source ranges`);
      for (const range of draft.sourceRanges) {
        assertSourceRange(range);
        const absolute = await realpath(path.resolve(sourceRoot, range.path)).catch(() => null);
        if (!absolute || (absolute !== sourceRoot && !absolute.startsWith(`${sourceRoot}${path.sep}`))) {
          throw new Error(`source range escapes or does not exist: ${range.path}`);
        }
        const info = await stat(absolute);
        if (!info.isFile()) throw new Error(`source range is not a file: ${range.path}`);
        const lineCount = (await readFile(absolute, "utf8")).split(/\r?\n/).length;
        if (range.endLine > lineCount) {
          throw new Error(`source range exceeds ${range.path} (${lineCount} lines)`);
        }
      }
      const record: CodeEntityRecord = {
        id: `entity-${handle}`,
        handle,
        label: draft.label.trim(),
        category: draft.category,
        summary: draft.summary.trim(),
        sourceRanges: draft.sourceRanges
      };
      new CodeEntity(record).prompt_str();
      entities.push(record);
    }
    return entities;
  }

  async finalizeCodeEntities(setId: string, actor = "human"): Promise<WorkspaceSnapshot> {
    await this.store.finalizeCodeEntities(setId, actor);
    return this.workspace();
  }

  async renameDiagram(setId: string, diagramId: string, name: string): Promise<WorkspaceSnapshot> {
    const normalized = name.trim();
    if (!normalized) throw new Error("Diagram name is required");
    if (normalized.length > 120) throw new Error("Diagram name cannot exceed 120 characters");
    const set = await this.store.loadDiagramSet(setId);
    if (!set.diagramIds.includes(diagramId)) throw new Error(`unknown Diagram: ${diagramId}`);
    const diagram = await this.store.loadDiagram(setId, diagramId);
    if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be renamed");
    await this.store.renameDiagram(setId, diagramId, normalized);
    return this.workspace();
  }

  async archiveDiagram(setId: string, diagramId: string): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    if (!set.diagramIds.includes(diagramId)) throw new Error(`unknown Diagram: ${diagramId}`);
    await this.store.archiveDiagram(setId, diagramId);
    return this.workspace();
  }

  async generate(
    setId: string,
    input: { prompt: string; selectedCodeEntityIds: string[]; count: number },
    onEvent?: (event: ServiceEvent) => void
  ): Promise<WorkspaceSnapshot> {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_GENERATION_COUNT) {
      throw new Error(`diagram count must be between 1 and ${MAX_GENERATION_COUNT}`);
    }
    if (this.activeBatches.has(setId)) throw new Error("a generation batch is already active for this DiagramSet");
    this.activeBatches.add(setId);
    try {
      const set = await this.store.loadDiagramSet(setId);
      const entities = await this.store.loadCodeEntities(setId);
      if (entities.status !== "finalized" || set.readiness !== "ready") {
        throw new Error("CodeEntitiesSet must be finalized before generation");
      }
      const storedDiagrams = await Promise.all(set.diagramIds.map((id) => this.store.loadDiagram(setId, id)));
      const existingDiagrams = storedDiagrams.filter((diagram) => !isDiagramArchived(diagram));
      const resolved = resolveGenerationPrompt({
        diagramSet: set,
        codeEntities: entities,
        diagrams: existingDiagrams,
        userPrompt: input.prompt,
        selectedCodeEntityIds: input.selectedCodeEntityIds
      });
      const batchId = this.store.ids.batch();
      const createdAt = timestamp();
      let batch: GenerationBatchRecord = {
        schemaVersion: SCHEMA_VERSION,
        id: batchId,
        diagramSetId: setId,
        requestedCount: input.count,
        userPrompt: input.prompt,
        selectedCodeEntityIds: resolved.selectedCodeEntityIds,
        promptReferences: resolved.references,
        resolvedPrompt: resolved.resolvedPrompt,
        codeEntitiesRevision: entities.revision,
        childRunIds: [],
        outputDiagramIds: [],
        status: "queued",
        createdAt,
        updatedAt: createdAt
      };
      let runs: AgentRunRecord[] = Array.from({ length: input.count }, (_, index) => ({
        schemaVersion: SCHEMA_VERSION,
        id: this.store.ids.run(),
        diagramSetId: setId,
        kind: "generate-one-diagram",
        status: "queued",
        statusMessage: `queued parallel slot ${index + 1}`,
        generationBatchId: batchId,
        outputSlot: index + 1,
        codeEntitiesRevision: entities.revision,
        outputCodeEntityIds: [],
        startedAt: createdAt,
        updatedAt: createdAt
      }));
      batch = { ...batch, childRunIds: runs.map((run) => run.id) };
      await this.store.beginBatch(batch, runs);
      batch = { ...batch, status: "running", updatedAt: timestamp() };
      await this.store.saveBatch(batch);
      onEvent?.({ type: "progress", message: `started ${input.count} parallel diagram agents` });

      const accepted = new Map<number, DiagramDraft>();
      let pending = runs.map((_, index) => index);
      let lastErrors = new Map<number, string>();
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt += 1) {
        const results: Array<{ index: number; draft: DiagramDraft } | { index: number; error: string }> = await Promise.all(pending.map(async (index) => {
          const run = runs[index];
          const setRun = (update: Partial<AgentRunRecord>) => {
            runs[index] = { ...runs[index], ...update, updatedAt: timestamp() };
            void this.store.saveRun(runs[index]);
          };
          try {
            const draft = await this.agents.generateDiagram({
              sourceRoot: set.sourceCheckoutRoot,
              diagramSetName: set.name,
              resolvedPrompt: resolved.resolvedPrompt,
              allowedCodeEntityIds: resolved.allowedCodeEntityIds,
              allowedDiagramIds: existingDiagrams.map((diagram) => diagram.id),
              slot: index + 1,
              total: input.count
            }, (progress) => {
              setRun({
                status: progress.status,
                statusMessage: progress.message,
                model: progress.model ?? run.model,
                sessionId: progress.sessionId ?? run.sessionId
              });
              onEvent?.({ type: "progress", message: `slot ${index + 1}: ${progress.message}` });
            });
            this.validateDiagramDraft(draft, resolved.allowedCodeEntityIds, existingDiagrams);
            return { index, draft };
          } catch (error) {
            return { index, error: error instanceof Error ? error.message : "diagram generation failed" };
          }
        }));

        const usedAscii = new Set([...accepted.values()].map((draft) => normalizeAscii(draft.ascii)));
        const retry: number[] = [];
        lastErrors = new Map();
        for (const result of results) {
          if ("error" in result) {
            retry.push(result.index);
            lastErrors.set(result.index, result.error);
            continue;
          }
          const normalized = normalizeAscii(result.draft.ascii);
          if (usedAscii.has(normalized)) {
            retry.push(result.index);
            lastErrors.set(result.index, "duplicate normalized ASCII output");
            continue;
          }
          usedAscii.add(normalized);
          accepted.set(result.index, { ...result.draft, ascii: normalized });
        }
        pending = retry;
        for (const index of pending) {
          runs[index] = {
            ...runs[index],
            status: attempt === MAX_ATTEMPTS ? "failed" : "queued",
            statusMessage: lastErrors.get(index) ?? "invalid diagram result",
            error: lastErrors.get(index),
            updatedAt: timestamp(),
            ...(attempt === MAX_ATTEMPTS ? { completedAt: timestamp() } : {})
          };
          await this.store.saveRun(runs[index]);
        }
      }

      if (accepted.size !== input.count) {
        const message = [...lastErrors.entries()]
          .map(([index, error]) => `slot ${index + 1}: ${error}`)
          .join("; ") || "one or more diagram agents failed";
        batch = { ...batch, status: "failed", error: message, updatedAt: timestamp() };
        await this.store.saveBatch(batch);
        throw new Error(message);
      }

      batch = { ...batch, status: "validating", updatedAt: timestamp() };
      await this.store.saveBatch(batch);
      onEvent?.({ type: "progress", message: "validating complete parallel batch" });
      const handles = new Set(storedDiagrams.map((diagram) => diagram.handle));
      const diagrams: DiagramRecord[] = runs.map((run, index) => {
        const draft = accepted.get(index)!;
        const base = slugify(draft.name, `diagram-${set.diagramIds.length + index + 1}`);
        let handle = base;
        let suffix = 2;
        while (handles.has(handle)) {
          handle = `${base}-${suffix}`;
          suffix += 1;
        }
        handles.add(handle);
        return {
          schemaVersion: SCHEMA_VERSION,
          id: this.store.ids.diagram(),
          diagramSetId: setId,
          handle,
          name: draft.name.trim(),
          ascii: normalizeAscii(draft.ascii),
          codeEntityIds: [...new Set(draft.codeEntityIds)],
          promptReferences: resolved.references,
          producedByRunId: run.id,
          derivedFromDiagramIds: [...new Set(draft.derivedFromDiagramIds)],
          createdAt: timestamp()
        };
      });
      runs = runs.map((run, index) => ({
        ...run,
        status: "complete",
        statusMessage: "diagram committed",
        outputCodeEntityIds: diagrams[index].codeEntityIds,
        outputDiagramId: diagrams[index].id,
        error: undefined,
        updatedAt: timestamp(),
        completedAt: timestamp()
      }));
      batch = {
        ...batch,
        status: "complete",
        outputDiagramIds: diagrams.map((diagram) => diagram.id),
        error: undefined,
        updatedAt: timestamp()
      };
      await this.store.completeBatch(batch, runs, diagrams);
      const workspace = await this.workspace();
      onEvent?.({ type: "workspace", message: `generated ${diagrams.length} diagrams`, workspace });
      return workspace;
    } finally {
      this.activeBatches.delete(setId);
    }
  }

  private validateDiagramDraft(
    draft: DiagramDraft,
    allowedCodeEntityIds: string[],
    existingDiagrams: DiagramRecord[]
  ): void {
    if (!draft.name.trim()) throw new Error("diagram name cannot be blank");
    assertSevenBitAscii(draft.ascii);
    const allowedEntities = new Set(allowedCodeEntityIds);
    for (const id of draft.codeEntityIds) {
      if (!allowedEntities.has(id)) throw new Error(`diagram references unavailable CodeEntity: ${id}`);
    }
    const allowedDiagrams = new Set(existingDiagrams.map((diagram) => diagram.id));
    for (const id of draft.derivedFromDiagramIds) {
      if (!allowedDiagrams.has(id)) throw new Error(`diagram has invalid parent: ${id}`);
    }
  }

  async sourceSnippet(setId: string, entityId: string, rangeIndex: number): Promise<{
    path: string;
    startLine: number;
    lines: string[];
  }> {
    const set = await this.store.loadDiagramSet(setId);
    const entities = await this.store.loadCodeEntities(setId);
    const entity = entities.entities.find((candidate) => candidate.id === entityId);
    if (!entity) throw new Error(`unknown CodeEntity: ${entityId}`);
    const range = entity.sourceRanges[rangeIndex];
    if (!range) throw new Error("unknown source range");
    assertSourceRange(range);
    const root = await realpath(set.sourceCheckoutRoot);
    const absolute = await realpath(path.resolve(root, range.path));
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error("source range escapes repository root");
    }
    const lines = (await readFile(absolute, "utf8")).split(/\r?\n/);
    return {
      path: range.path,
      startLine: range.startLine,
      lines: lines.slice(range.startLine - 1, range.endLine)
    };
  }

  workspace(): Promise<WorkspaceSnapshot> {
    return this.store.loadWorkspace();
  }

  async recoverInterruptedRuns(): Promise<void> {
    const workspace = await this.workspace();
    for (const run of Object.values(workspace.agentRuns)) {
      if (["queued", "reading-context", "generating", "validating"].includes(run.status)) {
        await this.store.saveRun({
          ...run,
          status: "interrupted",
          statusMessage: "server restarted before the run completed",
          error: "interrupted by server restart",
          updatedAt: timestamp(),
          completedAt: timestamp()
        });
      }
    }
    for (const batch of Object.values(workspace.generationBatches)) {
      if (["queued", "running", "validating"].includes(batch.status)) {
        await this.store.saveBatch({
          ...batch,
          status: "failed",
          error: "interrupted by server restart",
          updatedAt: timestamp()
        });
      }
    }
  }

  dispose(): void {
    this.agents.dispose();
  }
}
