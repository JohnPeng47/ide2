import { representationKindForArtifact } from "../../../domain/core/profiles/domainProfiles";
import {
  DEFAULT_DIAGRAM_MODEL_ID,
  SCHEMA_VERSION,
  assertSevenBitAscii,
  isDiagramArchived,
  isDiagramComponentArchived,
  isDiagramModelId,
  normalizeAscii,
  slugify,
  type AgentRunRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSelectionBounds,
  type DiagramSetRecord,
  type EditOperationRecord,
  type EditSessionRecord,
  type GenerationOutputKind,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import { applyPatch, characterOffset, cropAsciiSelection, textPatch } from '../../../domain/studio/editing/operations';
import type { StudioContext } from '../context';
import { MARKER_CHARACTERS, ServiceEvent, timestamp } from '../shared';

export async function captureDiagramComponent(context: StudioContext, setId: string, diagramId: string, bounds: DiagramSelectionBounds): Promise<WorkspaceSnapshot> {
  const set = await context.store.loadDiagramSet(setId);
  const { artifact } = await context.core.artifactForDiagramSet(setId, "diagram", diagramId);
  const diagram = artifact as DiagramRecord;
  if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be captured");
  return captureComponentSelection(context, set, { kind: "diagram", artifact: diagram }, bounds);
}

export async function createEditSession(context: StudioContext, setId: string, artifactKind: GenerationOutputKind, artifactId: string): Promise<WorkspaceSnapshot> {
  const { artifact } = await context.core.artifactForDiagramSet(setId, artifactKind, artifactId);
  if (artifact.archivedAt) throw new Error("archived artifacts cannot be edited");
  const createdAt = timestamp();
  const session: EditSessionRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: context.store.ids.editSession(),
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
  await context.store.addEditSession(session);
  return context.core.workspace();
}

export async function activeEditSession(context: StudioContext, setId: string, sessionId: string): Promise<EditSessionRecord> {
  const set = await context.store.loadDiagramSet(setId);
  if (!set.editSessionIds.includes(sessionId)) throw new Error(`unknown EditSession: ${sessionId}`);
  const session = await context.store.loadEditSession(setId, sessionId);
  if (session.status !== "active") throw new Error(`EditSession is ${session.status}`);
  return session;
}

export async function appendEditOperation(context: StudioContext, session: EditSessionRecord, operation: Omit<EditOperationRecord, "id" | "createdAt">): Promise<EditSessionRecord> {
  const createdAt = timestamp();
  const nextOperation: EditOperationRecord = {
    ...operation,
    id: context.store.ids.editOperation(),
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
  await context.store.saveEditSession(next);
  return next;
}

export async function manualEdit(context: StudioContext, setId: string, sessionId: string, ascii: string): Promise<WorkspaceSnapshot> {
  const session = await activeEditSession(context, setId, sessionId);
  const normalized = normalizeAscii(ascii);
  assertSevenBitAscii(normalized);
  if (normalized === session.workingAscii) return context.core.workspace();
  const patch = textPatch(session.workingAscii, normalized);
  const changed = Math.max(patch.deletedText.length, patch.insertedText.length);
  await appendEditOperation(context, session, {
    kind: "manual",
    label: `Manual edit · ${changed} character${changed === 1 ? "" : "s"}`,
    patch
  });
  return context.core.workspace();
}

export async function placeEditMarker(context: StudioContext, setId: string, sessionId: string, line: number, column: number): Promise<{ workspace: WorkspaceSnapshot; markerToken: string }> {
  const session = await activeEditSession(context, setId, sessionId);
  const markerChar = MARKER_CHARACTERS.find((candidate) => !session.workingAscii.includes(candidate));
  if (!markerChar) throw new Error("no unused marker characters remain in this artifact");
  const offset = characterOffset(session.workingAscii, line, column);
  const replacedChar = session.workingAscii[offset];
  const markerToken = `@${markerChar}`;
  await appendEditOperation(context, session, {
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
  return { workspace: await context.core.workspace(), markerToken };
}

export async function undoEdit(context: StudioContext, setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
  const session = await activeEditSession(context, setId, sessionId);
  if (session.operationCursor === 0) return context.core.workspace();
  const operation = session.operations[session.operationCursor - 1];
  const updated: EditSessionRecord = {
    ...session,
    workingAscii: applyPatch(session.workingAscii, operation.patch, true),
    operationCursor: session.operationCursor - 1,
    revision: session.revision + 1,
    updatedAt: timestamp()
  };
  await context.store.saveEditSession(updated);
  return context.core.workspace();
}

export async function redoEdit(context: StudioContext, setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
  const session = await activeEditSession(context, setId, sessionId);
  if (session.operationCursor === session.operations.length) return context.core.workspace();
  const operation = session.operations[session.operationCursor];
  const updated: EditSessionRecord = {
    ...session,
    workingAscii: applyPatch(session.workingAscii, operation.patch),
    operationCursor: session.operationCursor + 1,
    revision: session.revision + 1,
    updatedAt: timestamp()
  };
  await context.store.saveEditSession(updated);
  return context.core.workspace();
}

export async function llmEdit(context: StudioContext, setId: string, sessionId: string, instruction: string, modelId: unknown = DEFAULT_DIAGRAM_MODEL_ID, onEvent?: (event: ServiceEvent) => void): Promise<WorkspaceSnapshot> {
  if (!instruction.trim()) throw new Error("edit instruction is required");
  if (!isDiagramModelId(modelId)) throw new Error(`unsupported edit model: ${String(modelId)}`);
  const session = await activeEditSession(context, setId, sessionId);
  const set = await context.store.loadDiagramSet(setId);
  const runId = context.store.ids.run();
  const createdAt = timestamp();
  let run: AgentRunRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: runId,
    diagramSetId: setId,
    kind: "edit-artifact",
    status: "queued",
    statusMessage: "queued artifact edit",
    codeEntitiesRevision: (await context.store.loadCodeEntities(setId)).revision,
    outputCodeEntityIds: [...session.codeEntityIds],
    startedAt: createdAt,
    updatedAt: createdAt
  };
  await context.store.saveRun(run);
  await context.store.attachRun(setId, run.id);
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
    const draft = await context.agents.editArtifact({
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
      void context.store.saveRun(run);
      onEvent?.({ type: "progress", message: progress.message });
    });
    const normalized = normalizeAscii(draft.ascii);
    assertSevenBitAscii(normalized);
    if (normalized.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");
    const patch = textPatch(session.workingAscii, normalized);
    const updated = await appendEditOperation(context, session, {
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
    await context.store.saveRun(run);
    const workspace = await context.core.workspace();
    onEvent?.({ type: "workspace", message: updated.operations.at(-1)?.label ?? "edit applied", workspace });
    return workspace;
  } catch (error) {
    const message = error instanceof Error ? error.message : "artifact edit failed";
    await context.store.saveRun({
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

export async function finishEdit(context: StudioContext, setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
  const session = await activeEditSession(context, setId, sessionId);
  if (session.operationCursor === 0) throw new Error("make at least one edit before saving a copy");
  const appliedOperations = session.operations.slice(0, session.operationCursor);
  const unresolvedMarker = appliedOperations.find((operation, index) => (
    operation.markerChar
    && session.workingAscii.includes(operation.markerChar)
    && !appliedOperations.slice(index + 1).some((candidate) => candidate.kind === "llm")
  ));
  if (unresolvedMarker) throw new Error(`resolve ${unresolvedMarker.markerToken} before saving`);
  const set = await context.store.loadDiagramSet(setId);
  const { artifact: source } = await context.core.artifactForDiagramSet(
    setId,
    session.sourceArtifactKind,
    session.sourceArtifactId
  );
  const name = `${source.name} Edit`.slice(0, 120);
  const existing = session.sourceArtifactKind === "diagram"
    ? await Promise.all(set.diagramIds.map((id) => context.store.loadDiagram(setId, id)))
    : await Promise.all(set.diagramComponentIds.map((id) => context.store.loadDiagramComponent(setId, id)));
  const library = await context.store.loadImportedArtifactLibrary();
  const imported = session.sourceArtifactKind === "diagram"
    ? await Promise.all(library.diagramIds.map((id) => context.store.loadImportedDiagram(id)))
    : await Promise.all(
      library.diagramComponentIds.map((id) => context.store.loadImportedDiagramComponent(id))
    );
  const handles = new Set([...existing, ...imported].map((artifact) => artifact.handle));
  const baseHandle = slugify(name, session.sourceArtifactKind === "diagram" ? "diagram-edit" : "component-edit");
  let handle = baseHandle;
  let suffix = 2;
  while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;
  let outputArtifactId: string;
  if (session.sourceArtifactKind === "diagram") {
    outputArtifactId = context.store.ids.diagram();
    await context.store.addDiagram({
      schemaVersion: SCHEMA_VERSION,
      id: outputArtifactId,
      recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
      diagramSetId: setId,
      viewKind: (source as DiagramRecord).viewKind,
      representationKind: representationKindForArtifact(source as DiagramRecord),
      ...((source as DiagramRecord).basedOnDiagramId
        ? { basedOnDiagramId: (source as DiagramRecord).basedOnDiagramId }
        : {}),
      handle,
      name,
      ascii: session.workingAscii,
      codeEntityIds: [...session.codeEntityIds],
      origin: "edited",
      generationPromptConfigId: source.generationPromptConfigId,
      editSessionId: session.id,
      derivedFromDiagramIds: [source.id],
      createdAt: timestamp()
    });
  } else {
    const component = source as DiagramComponentRecord;
    outputArtifactId = context.store.ids.diagramComponent();
    await context.store.addDiagramComponent({
      schemaVersion: SCHEMA_VERSION,
      id: outputArtifactId,
      recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
      diagramSetId: setId,
      handle,
      name,
      ascii: session.workingAscii,
      representationKind: representationKindForArtifact(component),
      codeEntityIds: [...session.codeEntityIds],
      origin: "edited",
      generationPromptConfigId: component.generationPromptConfigId,
      sourceDiagramId: component.sourceDiagramId,
      sourceDiagramComponentId: component.id,
      editSessionId: session.id,
      derivedFromDiagramIds: [...component.derivedFromDiagramIds],
      derivedFromDiagramComponentIds: [component.id],
      createdAt: timestamp()
    });
  }
  await context.store.saveEditSession({
    ...session,
    status: "committed",
    outputArtifactId,
    revision: session.revision + 1,
    updatedAt: timestamp()
  });
  return context.core.workspace();
}

export async function discardEdit(context: StudioContext, setId: string, sessionId: string): Promise<WorkspaceSnapshot> {
  const session = await activeEditSession(context, setId, sessionId);
  await context.store.saveEditSession({
    ...session,
    status: "discarded",
    revision: session.revision + 1,
    updatedAt: timestamp()
  });
  return context.core.workspace();
}

export async function captureNestedDiagramComponent(context: StudioContext, setId: string, componentId: string, bounds: DiagramSelectionBounds): Promise<WorkspaceSnapshot> {
  const set = await context.store.loadDiagramSet(setId);
  const { artifact } = await context.core.artifactForDiagramSet(
    setId,
    "diagram-component",
    componentId
  );
  const component = artifact as DiagramComponentRecord;
  if (isDiagramComponentArchived(component)) {
    throw new Error("archived DiagramComponents cannot be captured");
  }
  return captureComponentSelection(context, set, { kind: "diagram-component", artifact: component }, bounds);
}

export async function captureComponentSelection(context: StudioContext, set: DiagramSetRecord, source:
  | { kind: "diagram"; artifact: DiagramRecord }
  | { kind: "diagram-component"; artifact: DiagramComponentRecord }, bounds: DiagramSelectionBounds): Promise<WorkspaceSnapshot> {
  const { ascii, selection } = cropAsciiSelection(source.artifact.ascii, bounds);
  const existing = await Promise.all(
    set.diagramComponentIds.map((id) => context.store.loadDiagramComponent(set.id, id))
  );
  const sequence = existing.length + 1;
  const library = await context.store.loadImportedArtifactLibrary();
  const imported = await Promise.all(
    library.diagramComponentIds.map((id) => context.store.loadImportedDiagramComponent(id))
  );
  const handles = new Set([...existing, ...imported].map((component) => component.handle));
  const baseHandle = slugify(
    `${source.artifact.handle}-component-${sequence}`,
    `component-${sequence}`
  );
  let handle = baseHandle;
  let suffix = 2;
  while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;
  const component: DiagramComponentRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: context.store.ids.diagramComponent(),
    recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
    diagramSetId: set.id,
    handle,
    name: `${source.artifact.name} - Component ${sequence}`,
    ascii,
    representationKind: representationKindForArtifact(source.artifact),
    codeEntityIds: [...source.artifact.codeEntityIds],
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
  await context.store.addDiagramComponent(component);
  return context.core.workspace();
}
