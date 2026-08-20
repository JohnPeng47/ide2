import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  CodeEntity,
  DEFAULT_EDIT_MODEL_ID,
  SCHEMA_VERSION,
  assertSevenBitAscii,
  assertSourceRange,
  isDiagramComponentArchived,
  isDiagramArchived,
  isEditModelId,
  normalizeAscii,
  slugify,
  type AgentProgress,
  type AgentRunRecord,
  type ArtifactImportInput,
  type CodeEntityDraft,
  type CodeEntityRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSelectionBounds,
  type DiagramSetRecord,
  type EditOperationRecord,
  type EditSessionRecord,
  type GeneratedArtifactDraft,
  type GenerationOutputKind,
  type GenerationBatchRecord,
  type WorkspaceSnapshot
} from "../src/domain";
import { resolveGenerationPrompt } from "../src/prompt";
import type { DiagramAgentRuntime } from "./agentRuntime";
import { DiagramStore, discoverRepository } from "./store";

const MAX_GENERATION_COUNT = 12;
const MAX_ATTEMPTS = 3;
const MARKER_CHARACTERS = ["`", "~", "^", "{", "}"] as const;

export interface ServiceEvent {
  type: "progress" | "workspace";
  message: string;
  workspace?: WorkspaceSnapshot;
}

function timestamp(): string {
  return new Date().toISOString();
}

function textPatch(before: string, after: string): EditOperationRecord["patch"] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    start,
    deletedText: before.slice(start, beforeEnd),
    insertedText: after.slice(start, afterEnd)
  };
}

function applyPatch(value: string, patch: EditOperationRecord["patch"], reverse = false): string {
  const deletedText = reverse ? patch.insertedText : patch.deletedText;
  const insertedText = reverse ? patch.deletedText : patch.insertedText;
  if (value.slice(patch.start, patch.start + deletedText.length) !== deletedText) {
    throw new Error("edit operation no longer matches the working copy");
  }
  return `${value.slice(0, patch.start)}${insertedText}${value.slice(patch.start + deletedText.length)}`;
}

function characterOffset(ascii: string, line: number, column: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
    throw new Error("marker coordinates must be positive integers");
  }
  const lines = ascii.split("\n");
  if (line > lines.length || column > lines[line - 1].length) {
    throw new Error("marker location exceeds the artifact bounds");
  }
  return lines.slice(0, line - 1).reduce((total, row) => total + row.length + 1, 0) + column - 1;
}

function cropAsciiSelection(ascii: string, bounds: DiagramSelectionBounds): {
  ascii: string;
  selection: DiagramSelectionBounds;
} {
  const values = [bounds.startLine, bounds.endLine, bounds.startColumn, bounds.endColumn];
  if (!values.every((value) => Number.isInteger(value) && value >= 1)) {
    throw new Error("component selection coordinates must be positive integers");
  }
  const selection: DiagramSelectionBounds = {
    startLine: Math.min(bounds.startLine, bounds.endLine),
    endLine: Math.max(bounds.startLine, bounds.endLine),
    startColumn: Math.min(bounds.startColumn, bounds.endColumn),
    endColumn: Math.max(bounds.startColumn, bounds.endColumn)
  };
  const lines = normalizeAscii(ascii).split("\n");
  const width = Math.max(...lines.map((line) => line.length));
  if (selection.endLine > lines.length || selection.endColumn > width) {
    throw new Error("component selection exceeds the artifact bounds");
  }
  let rows = lines.slice(selection.startLine - 1, selection.endLine)
    .map((line) => line.padEnd(selection.endColumn, " ").slice(
      selection.startColumn - 1,
      selection.endColumn
    ));
  while (rows.length && !rows[0].trim()) rows = rows.slice(1);
  while (rows.length && !rows.at(-1)?.trim()) rows = rows.slice(0, -1);
  if (!rows.length) throw new Error("component selection cannot be blank");
  const occupiedColumns = rows.flatMap((row) => [...row].flatMap(
    (character, index) => character === " " ? [] : [index]
  ));
  const left = Math.min(...occupiedColumns);
  const right = Math.max(...occupiedColumns);
  const cropped = normalizeAscii(rows.map((row) => row.slice(left, right + 1)).join("\n"));
  assertSevenBitAscii(cropped);
  return { ascii: cropped, selection };
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
      const sourceRanges: CodeEntityRecord["sourceRanges"] = [];
      for (const range of draft.sourceRanges) {
        assertSourceRange(range);
        const absolute = await realpath(path.resolve(sourceRoot, range.path)).catch(() => null);
        if (!absolute || (absolute !== sourceRoot && !absolute.startsWith(`${sourceRoot}${path.sep}`))) {
          throw new Error(`source range escapes or does not exist: ${range.path}`);
        }
        const info = await stat(absolute);
        if (!info.isFile()) throw new Error(`source range is not a file: ${range.path}`);
        const sourceLines = (await readFile(absolute, "utf8")).split(/\r?\n/);
        const lineCount = sourceLines.length;
        if (range.endLine > lineCount) {
          throw new Error(`source range exceeds ${range.path} (${lineCount} lines)`);
        }
        sourceRanges.push({
          ...range,
          originalLines: sourceLines.slice(range.startLine - 1, range.endLine)
        });
      }
      const record: CodeEntityRecord = {
        id: `entity-${handle}`,
        handle,
        label: draft.label.trim(),
        category: draft.category,
        summary: draft.summary.trim(),
        sourceRanges
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

  async importArtifact(projectId: string, input: ArtifactImportInput): Promise<WorkspaceSnapshot> {
    const project = await this.store.loadProject();
    if (!project || project.id !== projectId) throw new Error(`unknown Project: ${projectId}`);
    if (!project.diagramSetIds.includes(input.diagramSetId)) {
      throw new Error(`DiagramSet does not belong to Project: ${input.diagramSetId}`);
    }
    if (input.artifactKind !== "diagram" && input.artifactKind !== "diagram-component") {
      throw new Error("artifact kind must be diagram or diagram-component");
    }
    const name = input.name.trim();
    if (!name) throw new Error("artifact name is required");
    if (name.length > 120) throw new Error("artifact name cannot exceed 120 characters");
    const ascii = normalizeAscii(input.ascii);
    assertSevenBitAscii(ascii);
    if (ascii.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");

    const set = await this.store.loadDiagramSet(input.diagramSetId);
    const entities = await this.store.loadCodeEntities(set.id);
    const availableEntityIds = new Set(entities.entities.map((entity) => entity.id));
    const codeEntityIds = [...new Set(input.codeEntityIds ?? [])];
    for (const id of codeEntityIds) {
      if (!availableEntityIds.has(id)) {
        throw new Error(`import references unavailable CodeEntity: ${id}`);
      }
    }

    const existing = input.artifactKind === "diagram"
      ? await Promise.all(set.diagramIds.map((id) => this.store.loadDiagram(set.id, id)))
      : await Promise.all(
        set.diagramComponentIds.map((id) => this.store.loadDiagramComponent(set.id, id))
      );
    const handles = new Set(existing.map((artifact) => artifact.handle));
    const fallback = input.artifactKind === "diagram" ? "imported-diagram" : "imported-component";
    const baseHandle = slugify(name, fallback);
    let handle = baseHandle;
    let suffix = 2;
    while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;

    if (input.artifactKind === "diagram") {
      const diagram: DiagramRecord = {
        schemaVersion: SCHEMA_VERSION,
        id: this.store.ids.diagram(),
        diagramSetId: set.id,
        handle,
        name,
        ascii,
        codeEntityIds,
        promptReferences: [],
        origin: "imported",
        derivedFromDiagramIds: [],
        createdAt: timestamp()
      };
      await this.store.addDiagram(diagram);
    } else {
      const component: DiagramComponentRecord = {
        schemaVersion: SCHEMA_VERSION,
        id: this.store.ids.diagramComponent(),
        diagramSetId: set.id,
        handle,
        name,
        ascii,
        codeEntityIds,
        promptReferences: [],
        origin: "imported",
        derivedFromDiagramIds: [],
        derivedFromDiagramComponentIds: [],
        createdAt: timestamp()
      };
      await this.store.addDiagramComponent(component);
    }
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

  async archiveDiagramComponent(setId: string, componentId: string): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    if (!set.diagramComponentIds.includes(componentId)) {
      throw new Error(`unknown DiagramComponent: ${componentId}`);
    }
    await this.store.archiveDiagramComponent(setId, componentId);
    return this.workspace();
  }

  async captureDiagramComponent(
    setId: string,
    diagramId: string,
    bounds: DiagramSelectionBounds
  ): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    if (!set.diagramIds.includes(diagramId)) throw new Error(`unknown Diagram: ${diagramId}`);
    const diagram = await this.store.loadDiagram(setId, diagramId);
    if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be captured");
    return this.captureComponentSelection(set, { kind: "diagram", artifact: diagram }, bounds);
  }

  async createEditSession(
    setId: string,
    artifactKind: GenerationOutputKind,
    artifactId: string
  ): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    const artifact = artifactKind === "diagram"
      ? await this.store.loadDiagram(setId, artifactId)
      : await this.store.loadDiagramComponent(setId, artifactId);
    const known = artifactKind === "diagram"
      ? set.diagramIds.includes(artifactId)
      : set.diagramComponentIds.includes(artifactId);
    if (!known) throw new Error(`unknown ${artifactKind}: ${artifactId}`);
    if (artifact.archivedAt) throw new Error("archived artifacts cannot be edited");
    const createdAt = timestamp();
    const session: EditSessionRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: this.store.ids.editSession(),
      diagramSetId: setId,
      sourceArtifactKind: artifactKind,
      sourceArtifactId: artifact.id,
      sourceHandle: artifact.handle,
      sourceName: artifact.name,
      baseAscii: artifact.ascii,
      workingAscii: artifact.ascii,
      codeEntityIds: [...artifact.codeEntityIds],
      operations: [],
      operationCursor: 0,
      revision: 0,
      status: "active",
      createdAt,
      updatedAt: createdAt
    };
    await this.store.addEditSession(session);
    return this.workspace();
  }

  private async activeEditSession(setId: string, sessionId: string): Promise<EditSessionRecord> {
    const set = await this.store.loadDiagramSet(setId);
    if (!set.editSessionIds.includes(sessionId)) throw new Error(`unknown EditSession: ${sessionId}`);
    const session = await this.store.loadEditSession(setId, sessionId);
    if (session.status !== "active") throw new Error(`EditSession is ${session.status}`);
    return session;
  }

  private async appendEditOperation(
    session: EditSessionRecord,
    operation: Omit<EditOperationRecord, "id" | "createdAt">
  ): Promise<EditSessionRecord> {
    const createdAt = timestamp();
    const nextOperation: EditOperationRecord = {
      ...operation,
      id: this.store.ids.editOperation(),
      createdAt
    };
    const next: EditSessionRecord = {
      ...session,
      workingAscii: applyPatch(session.workingAscii, nextOperation.patch),
      operations: [...session.operations.slice(0, session.operationCursor), nextOperation],
      operationCursor: session.operationCursor + 1,
      revision: session.revision + 1,
      updatedAt: createdAt
    };
    assertSevenBitAscii(next.workingAscii);
    if (next.workingAscii.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");
    await this.store.saveEditSession(next);
    return next;
  }

  async manualEdit(setId: string, sessionId: string, ascii: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    const normalized = normalizeAscii(ascii);
    assertSevenBitAscii(normalized);
    if (normalized === session.workingAscii) return this.workspace();
    const patch = textPatch(session.workingAscii, normalized);
    const changed = Math.max(patch.deletedText.length, patch.insertedText.length);
    await this.appendEditOperation(session, {
      kind: "manual",
      label: `Manual edit · ${changed} character${changed === 1 ? "" : "s"}`,
      patch
    });
    return this.workspace();
  }

  async placeEditMarker(
    setId: string,
    sessionId: string,
    line: number,
    column: number
  ): Promise<{ workspace: WorkspaceSnapshot; markerToken: string }> {
    const session = await this.activeEditSession(setId, sessionId);
    const markerChar = MARKER_CHARACTERS.find((candidate) => !session.workingAscii.includes(candidate));
    if (!markerChar) throw new Error("no unused marker characters remain in this artifact");
    const offset = characterOffset(session.workingAscii, line, column);
    const replacedChar = session.workingAscii[offset];
    const markerToken = `@${markerChar}`;
    await this.appendEditOperation(session, {
      kind: "manual",
      subtype: "marker",
      label: `Marker ${markerToken} · L${line}:C${column}`,
      patch: { start: offset, deletedText: replacedChar, insertedText: markerChar },
      markerChar,
      markerToken,
      replacedChar,
      line,
      column
    });
    return { workspace: await this.workspace(), markerToken };
  }

  async undoEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    if (session.operationCursor === 0) return this.workspace();
    const operation = session.operations[session.operationCursor - 1];
    const updated: EditSessionRecord = {
      ...session,
      workingAscii: applyPatch(session.workingAscii, operation.patch, true),
      operationCursor: session.operationCursor - 1,
      revision: session.revision + 1,
      updatedAt: timestamp()
    };
    await this.store.saveEditSession(updated);
    return this.workspace();
  }

  async redoEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    if (session.operationCursor === session.operations.length) return this.workspace();
    const operation = session.operations[session.operationCursor];
    const updated: EditSessionRecord = {
      ...session,
      workingAscii: applyPatch(session.workingAscii, operation.patch),
      operationCursor: session.operationCursor + 1,
      revision: session.revision + 1,
      updatedAt: timestamp()
    };
    await this.store.saveEditSession(updated);
    return this.workspace();
  }

  async llmEdit(
    setId: string,
    sessionId: string,
    instruction: string,
    modelId: unknown = DEFAULT_EDIT_MODEL_ID,
    onEvent?: (event: ServiceEvent) => void
  ): Promise<WorkspaceSnapshot> {
    if (!instruction.trim()) throw new Error("edit instruction is required");
    if (!isEditModelId(modelId)) throw new Error(`unsupported edit model: ${String(modelId)}`);
    const session = await this.activeEditSession(setId, sessionId);
    const set = await this.store.loadDiagramSet(setId);
    const runId = this.store.ids.run();
    const createdAt = timestamp();
    let run: AgentRunRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: runId,
      diagramSetId: setId,
      kind: "edit-artifact",
      status: "queued",
      statusMessage: "queued artifact edit",
      codeEntitiesRevision: (await this.store.loadCodeEntities(setId)).revision,
      outputCodeEntityIds: [...session.codeEntityIds],
      startedAt: createdAt,
      updatedAt: createdAt
    };
    await this.store.saveRun(run);
    await this.store.attachRun(setId, run.id);
    const appliedOperations = session.operations.slice(0, session.operationCursor);
    const markers = appliedOperations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation, index }) => operation.subtype === "marker" && operation.markerChar
        && session.workingAscii.includes(operation.markerChar)
        && !appliedOperations.slice(index + 1).some((candidate) => candidate.kind === "llm"))
      .map(({ operation }) => ({
        token: operation.markerToken!,
        character: operation.markerChar!,
        originalCharacter: operation.replacedChar ?? " "
      }));
    try {
      const draft = await this.agents.editArtifact({
        sourceRoot: set.sourceCheckoutRoot,
        diagramSetName: set.name,
        artifactKind: session.sourceArtifactKind,
        artifactName: session.sourceName,
        artifactHandle: session.sourceHandle,
        currentAscii: session.workingAscii,
        instruction: instruction.trim(),
        modelId,
        markers
      }, (progress) => {
        run = {
          ...run,
          status: progress.status,
          statusMessage: progress.message,
          model: progress.model ?? run.model,
          sessionId: progress.sessionId ?? run.sessionId,
          updatedAt: timestamp()
        };
        void this.store.saveRun(run);
        onEvent?.({ type: "progress", message: progress.message });
      });
      const normalized = normalizeAscii(draft.ascii);
      assertSevenBitAscii(normalized);
      if (normalized.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");
      const patch = textPatch(session.workingAscii, normalized);
      const updated = await this.appendEditOperation(session, {
        kind: "llm",
        label: `LLM edit · ${instruction.trim().slice(0, 72)}`,
        patch,
        instruction: instruction.trim(),
        modelId,
        agentRunId: run.id
      });
      run = {
        ...run,
        status: "complete",
        statusMessage: "artifact edit applied",
        updatedAt: timestamp(),
        completedAt: timestamp()
      };
      await this.store.saveRun(run);
      const workspace = await this.workspace();
      onEvent?.({ type: "workspace", message: updated.operations.at(-1)?.label ?? "edit applied", workspace });
      return workspace;
    } catch (error) {
      const message = error instanceof Error ? error.message : "artifact edit failed";
      await this.store.saveRun({
        ...run,
        status: "failed",
        statusMessage: message,
        error: message,
        updatedAt: timestamp(),
        completedAt: timestamp()
      });
      throw error;
    }
  }

  async finishEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    if (session.operationCursor === 0) throw new Error("make at least one edit before saving a copy");
    const appliedOperations = session.operations.slice(0, session.operationCursor);
    const unresolvedMarker = appliedOperations.find((operation, index) => (
      operation.markerChar
      && session.workingAscii.includes(operation.markerChar)
      && !appliedOperations.slice(index + 1).some((candidate) => candidate.kind === "llm")
    ));
    if (unresolvedMarker) throw new Error(`resolve ${unresolvedMarker.markerToken} before saving`);
    const set = await this.store.loadDiagramSet(setId);
    const source = session.sourceArtifactKind === "diagram"
      ? await this.store.loadDiagram(setId, session.sourceArtifactId)
      : await this.store.loadDiagramComponent(setId, session.sourceArtifactId);
    const name = `${source.name} Edit`.slice(0, 120);
    const existing = session.sourceArtifactKind === "diagram"
      ? await Promise.all(set.diagramIds.map((id) => this.store.loadDiagram(setId, id)))
      : await Promise.all(set.diagramComponentIds.map((id) => this.store.loadDiagramComponent(setId, id)));
    const handles = new Set(existing.map((artifact) => artifact.handle));
    const baseHandle = slugify(name, session.sourceArtifactKind === "diagram" ? "diagram-edit" : "component-edit");
    let handle = baseHandle;
    let suffix = 2;
    while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;
    const referenceKind = session.sourceArtifactKind === "diagram" ? "diagram" : "diagram-component";
    const reference = {
      kind: referenceKind,
      targetId: source.id,
      token: `@${referenceKind === "diagram" ? "diagram" : "component"}/${source.handle}`,
      handle: source.handle
    } as const;
    let outputArtifactId: string;
    if (session.sourceArtifactKind === "diagram") {
      outputArtifactId = this.store.ids.diagram();
      await this.store.addDiagram({
        schemaVersion: SCHEMA_VERSION,
        id: outputArtifactId,
        diagramSetId: setId,
        handle,
        name,
        ascii: session.workingAscii,
        codeEntityIds: [...session.codeEntityIds],
        promptReferences: [reference],
        origin: "edited",
        editSessionId: session.id,
        derivedFromDiagramIds: [source.id],
        createdAt: timestamp()
      });
    } else {
      const component = source as DiagramComponentRecord;
      outputArtifactId = this.store.ids.diagramComponent();
      await this.store.addDiagramComponent({
        schemaVersion: SCHEMA_VERSION,
        id: outputArtifactId,
        diagramSetId: setId,
        handle,
        name,
        ascii: session.workingAscii,
        codeEntityIds: [...session.codeEntityIds],
        promptReferences: [reference],
        origin: "edited",
        sourceDiagramId: component.sourceDiagramId,
        sourceDiagramComponentId: component.id,
        editSessionId: session.id,
        derivedFromDiagramIds: [...component.derivedFromDiagramIds],
        derivedFromDiagramComponentIds: [component.id],
        createdAt: timestamp()
      });
    }
    await this.store.saveEditSession({
      ...session,
      status: "committed",
      outputArtifactId,
      revision: session.revision + 1,
      updatedAt: timestamp()
    });
    return this.workspace();
  }

  async discardEdit(setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
    const session = await this.activeEditSession(setId, sessionId);
    await this.store.saveEditSession({
      ...session,
      status: "discarded",
      revision: session.revision + 1,
      updatedAt: timestamp()
    });
    return this.workspace();
  }

  async captureNestedDiagramComponent(
    setId: string,
    componentId: string,
    bounds: DiagramSelectionBounds
  ): Promise<WorkspaceSnapshot> {
    const set = await this.store.loadDiagramSet(setId);
    if (!set.diagramComponentIds.includes(componentId)) {
      throw new Error(`unknown DiagramComponent: ${componentId}`);
    }
    const component = await this.store.loadDiagramComponent(setId, componentId);
    if (isDiagramComponentArchived(component)) {
      throw new Error("archived DiagramComponents cannot be captured");
    }
    return this.captureComponentSelection(set, { kind: "diagram-component", artifact: component }, bounds);
  }

  private async captureComponentSelection(
    set: DiagramSetRecord,
    source:
      | { kind: "diagram"; artifact: DiagramRecord }
      | { kind: "diagram-component"; artifact: DiagramComponentRecord },
    bounds: DiagramSelectionBounds
  ): Promise<WorkspaceSnapshot> {
    const { ascii, selection } = cropAsciiSelection(source.artifact.ascii, bounds);
    const existing = await Promise.all(
      set.diagramComponentIds.map((id) => this.store.loadDiagramComponent(set.id, id))
    );
    const sequence = existing.length + 1;
    const handles = new Set(existing.map((component) => component.handle));
    const baseHandle = slugify(
      `${source.artifact.handle}-component-${sequence}`,
      `component-${sequence}`
    );
    let handle = baseHandle;
    let suffix = 2;
    while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;
    const referenceKind = source.kind === "diagram" ? "diagram" : "diagram-component";
    const component: DiagramComponentRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: this.store.ids.diagramComponent(),
      diagramSetId: set.id,
      handle,
      name: `${source.artifact.name} - Component ${sequence}`,
      ascii,
      codeEntityIds: [...source.artifact.codeEntityIds],
      promptReferences: [{
        kind: referenceKind,
        targetId: source.artifact.id,
        token: `@${referenceKind === "diagram" ? "diagram" : "component"}/${source.artifact.handle}`,
        handle: source.artifact.handle
      }],
      origin: "selection",
      ...(source.kind === "diagram"
        ? { sourceDiagramId: source.artifact.id }
        : {
          sourceDiagramId: source.artifact.sourceDiagramId,
          sourceDiagramComponentId: source.artifact.id
        }),
      selectionBounds: selection,
      derivedFromDiagramIds: source.kind === "diagram"
        ? [source.artifact.id]
        : [...source.artifact.derivedFromDiagramIds],
      derivedFromDiagramComponentIds: source.kind === "diagram-component"
        ? [source.artifact.id]
        : [],
      createdAt: timestamp()
    };
    await this.store.addDiagramComponent(component);
    return this.workspace();
  }

  async generate(
    setId: string,
    input: {
      prompt: string;
      selectedCodeEntityIds: string[];
      count: number;
      outputKind: GenerationOutputKind;
    },
    onEvent?: (event: ServiceEvent) => void
  ): Promise<WorkspaceSnapshot> {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_GENERATION_COUNT) {
      throw new Error(`output count must be between 1 and ${MAX_GENERATION_COUNT}`);
    }
    if (input.outputKind !== "diagram" && input.outputKind !== "diagram-component") {
      throw new Error("output kind must be diagram or diagram-component");
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
      const storedComponents = await Promise.all(
        set.diagramComponentIds.map((id) => this.store.loadDiagramComponent(setId, id))
      );
      const existingComponents = storedComponents.filter(
        (component) => !isDiagramComponentArchived(component)
      );
      const resolved = resolveGenerationPrompt({
        diagramSet: set,
        codeEntities: entities,
        diagrams: existingDiagrams,
        components: existingComponents,
        outputKind: input.outputKind,
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
        outputKind: input.outputKind,
        userPrompt: input.prompt,
        selectedCodeEntityIds: resolved.selectedCodeEntityIds,
        promptReferences: resolved.references,
        resolvedPrompt: resolved.resolvedPrompt,
        codeEntitiesRevision: entities.revision,
        childRunIds: [],
        outputDiagramIds: [],
        outputDiagramComponentIds: [],
        status: "queued",
        createdAt,
        updatedAt: createdAt
      };
      let runs: AgentRunRecord[] = Array.from({ length: input.count }, (_, index) => ({
        schemaVersion: SCHEMA_VERSION,
        id: this.store.ids.run(),
        diagramSetId: setId,
        kind: input.outputKind === "diagram"
          ? "generate-one-diagram"
          : "generate-one-diagram-component",
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
      const outputLabel = input.outputKind === "diagram" ? "diagram" : "component";
      onEvent?.({ type: "progress", message: `started ${input.count} parallel ${outputLabel} agents` });

      const accepted = new Map<number, GeneratedArtifactDraft>();
      let pending = runs.map((_, index) => index);
      let lastErrors = new Map<number, string>();
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt += 1) {
        const results: Array<{ index: number; draft: GeneratedArtifactDraft } | { index: number; error: string }> = await Promise.all(pending.map(async (index) => {
          const run = runs[index];
          const setRun = (update: Partial<AgentRunRecord>) => {
            runs[index] = { ...runs[index], ...update, updatedAt: timestamp() };
            void this.store.saveRun(runs[index]);
          };
          try {
            const draft = await this.agents.generateArtifact({
              sourceRoot: set.sourceCheckoutRoot,
              diagramSetName: set.name,
              resolvedPrompt: resolved.resolvedPrompt,
              allowedCodeEntityIds: resolved.allowedCodeEntityIds,
              allowedDiagramIds: resolved.references
                .filter((reference) => reference.kind === "diagram")
                .map((reference) => reference.targetId),
              allowedDiagramComponentIds: resolved.references
                .filter((reference) => reference.kind === "diagram-component")
                .map((reference) => reference.targetId),
              outputKind: input.outputKind,
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
            this.validateGeneratedArtifactDraft(draft, resolved.allowedCodeEntityIds);
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
      const derivedFromDiagramIds = resolved.references
        .filter((reference) => reference.kind === "diagram")
        .map((reference) => reference.targetId);
      const derivedFromDiagramComponentIds = resolved.references
        .filter((reference) => reference.kind === "diagram-component")
        .map((reference) => reference.targetId);
      const handles = new Set((input.outputKind === "diagram" ? storedDiagrams : storedComponents)
        .map((artifact) => artifact.handle));
      const generated = runs.map((run, index) => {
        const draft = accepted.get(index)!;
        const sequence = input.outputKind === "diagram"
          ? set.diagramIds.length + index + 1
          : set.diagramComponentIds.length + index + 1;
        const base = slugify(draft.name, `${outputLabel}-${sequence}`);
        let handle = base;
        let suffix = 2;
        while (handles.has(handle)) {
          handle = `${base}-${suffix}`;
          suffix += 1;
        }
        handles.add(handle);
        return { run, draft, handle };
      });
      const diagrams: DiagramRecord[] = input.outputKind === "diagram"
        ? generated.map(({ run, draft, handle }) => ({
          schemaVersion: SCHEMA_VERSION,
          id: this.store.ids.diagram(),
          diagramSetId: setId,
          handle,
          name: draft.name.trim(),
          ascii: normalizeAscii(draft.ascii),
          codeEntityIds: [...new Set(draft.codeEntityIds)],
          promptReferences: resolved.references,
          origin: "generated",
          producedByRunId: run.id,
          derivedFromDiagramIds: [...new Set(derivedFromDiagramIds)],
          createdAt: timestamp()
        }))
        : [];
      const components: DiagramComponentRecord[] = input.outputKind === "diagram-component"
        ? generated.map(({ run, draft, handle }) => ({
          schemaVersion: SCHEMA_VERSION,
          id: this.store.ids.diagramComponent(),
          diagramSetId: setId,
          handle,
          name: draft.name.trim(),
          ascii: normalizeAscii(draft.ascii),
          codeEntityIds: [...new Set(draft.codeEntityIds)],
          promptReferences: resolved.references,
          origin: "generated",
          producedByRunId: run.id,
          derivedFromDiagramIds: [...new Set(derivedFromDiagramIds)],
          derivedFromDiagramComponentIds: [...new Set(derivedFromDiagramComponentIds)],
          createdAt: timestamp()
        }))
        : [];
      runs = runs.map((run, index) => ({
        ...run,
        status: "complete",
        statusMessage: `${outputLabel} committed`,
        outputCodeEntityIds: (diagrams[index] ?? components[index]).codeEntityIds,
        ...(input.outputKind === "diagram"
          ? { outputDiagramId: diagrams[index].id }
          : { outputDiagramComponentId: components[index].id }),
        error: undefined,
        updatedAt: timestamp(),
        completedAt: timestamp()
      }));
      batch = {
        ...batch,
        status: "complete",
        outputDiagramIds: diagrams.map((diagram) => diagram.id),
        outputDiagramComponentIds: components.map((component) => component.id),
        error: undefined,
        updatedAt: timestamp()
      };
      await this.store.completeBatch(batch, runs, diagrams, components);
      const workspace = await this.workspace();
      onEvent?.({
        type: "workspace",
        message: `generated ${input.count} ${outputLabel}${input.count === 1 ? "" : "s"}`,
        workspace
      });
      return workspace;
    } finally {
      this.activeBatches.delete(setId);
    }
  }

  private validateGeneratedArtifactDraft(
    draft: GeneratedArtifactDraft,
    allowedCodeEntityIds: string[]
  ): void {
    if (!draft.name.trim()) throw new Error("generated artifact name cannot be blank");
    assertSevenBitAscii(draft.ascii);
    const allowedEntities = new Set(allowedCodeEntityIds);
    for (const id of draft.codeEntityIds) {
      if (!allowedEntities.has(id)) throw new Error(`artifact references unavailable CodeEntity: ${id}`);
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
    if (range.originalLines !== undefined) {
      return {
        path: range.path,
        startLine: range.startLine,
        lines: [...range.originalLines]
      };
    }
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
