import { createHash } from "node:crypto";
import { validateDiagramMappings } from "../../../domain/core/diagrams/diagramMapping";
import { representationKindForArtifact, resolveDomainProfile } from "../../../domain/core/profiles/domainProfiles";
import {
  DEFAULT_DIAGRAM_MODEL_ID,
  DEFAULT_GENERATION_COUNT,
  SCHEMA_VERSION,
  assertSevenBitAscii,
  isDiagramArchived,
  isDiagramComponentArchived,
  isDiagramModelId,
  isDiagramViewKind,
  normalizeAscii,
  slugify,
  type AgentRunRecord,
  type CodeEntityRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramViewKind,
  type GeneratedArtifactDraft,
  type GenerationBatchRecord,
  type GenerationDerivationRecord,
  type GenerationOutputKind,
  type GenerationReferenceSelection,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import { createGenerationPromptConfig } from "../../../domain/studio/generation/prompt";
import type { StudioContext } from '../context';
import { resolveSystemPromptTemplate } from '../prompt-settings/service';
import { MAX_ATTEMPTS, MAX_GENERATION_COUNT, ServiceEvent, timestamp } from '../shared';

export async function generateInitialDiagrams(context: StudioContext, setId: string, input: {
  promptTemplateId?: unknown;
  runReferencePrompt?: boolean;
  referencePrompt?: string;
} = {}, onEvent?: (event: ServiceEvent) => void): Promise<WorkspaceSnapshot> {
  const entities = await context.store.loadCodeEntities(setId);
  return generate(context, setId, {
    prompt: "",
    selectedCodeEntityIds: entities.entities.map((entity) => entity.id),
    count: DEFAULT_GENERATION_COUNT,
    outputKind: "diagram",
    promptProfileId: input.promptTemplateId,
    runReferencePrompt: input.runReferencePrompt,
    referencePrompt: input.referencePrompt
  }, onEvent);
}

export async function generate(context: StudioContext, setId: string, input: {
  prompt: string;
  runReferencePrompt?: boolean;
  referencePrompt?: string;
  selectedCodeEntityIds: string[];
  count: number;
  outputKind: GenerationOutputKind;
  viewKind?: DiagramViewKind;
  modelId?: unknown;
  promptProfileId?: unknown;
  referenceSelections?: GenerationReferenceSelection[];
  referencePromptSelections?: GenerationReferenceSelection[];
  derivation?: GenerationDerivationRecord;
}, onEvent?: (event: ServiceEvent) => void): Promise<WorkspaceSnapshot> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_GENERATION_COUNT) {
    throw new Error(`output count must be between 1 and ${MAX_GENERATION_COUNT}`);
  }
  if (input.outputKind !== "diagram" && input.outputKind !== "diagram-component") {
    throw new Error("output kind must be diagram or diagram-component");
  }
  if (input.outputKind === "diagram" && !isDiagramViewKind(input.viewKind ?? "diagram")) {
    throw new Error("view kind must be diagram, call-graph, or dir-view");
  }
  if (input.outputKind === "diagram-component" && input.viewKind !== undefined) {
    throw new Error("DiagramComponents do not have a view kind");
  }
  const set = await context.store.loadDiagramSet(setId);
  const { domainProfileId } = await context.core.projectCorpus(set);
  if (input.outputKind === "diagram"
    && !resolveDomainProfile(domainProfileId).workspace.diagramViews.includes(input.viewKind ?? "diagram")) {
    throw new Error(`${input.viewKind ?? "diagram"} is not available in the ${domainProfileId} domain`);
  }
  const modelId = input.modelId ?? DEFAULT_DIAGRAM_MODEL_ID;
  if (!isDiagramModelId(modelId)) throw new Error(`unsupported generation model: ${String(modelId)}`);
  if (context.activeBatches.has(setId)) throw new Error("a generation batch is already active for this DiagramSet");
  context.activeBatches.add(setId);
  try {
    const entities = await context.store.loadCodeEntities(setId);
    const promptProfile = await resolveSystemPromptTemplate(context, input.promptProfileId);
    if (entities.status !== "finalized" || set.readiness !== "ready") {
      throw new Error("CodeEntitiesSet must be finalized before generation");
    }
    const storedDiagrams = await Promise.all(set.diagramIds.map((id) => context.store.loadDiagram(setId, id)));
    const library = await context.store.loadImportedArtifactLibrary();
    const importedCodeEntities = await Promise.all(
      (library.codeEntityIds ?? []).map((id) => context.store.loadImportedCodeEntity(id))
    );
    const importedDiagrams = await Promise.all(
      library.diagramIds.map((id) => context.store.loadImportedDiagram(id))
    );
    const existingDiagrams = [...storedDiagrams, ...importedDiagrams]
      .filter((diagram) => !isDiagramArchived(diagram));
    const settledViewIds = await context.core.settledViewIdsForSession(set);
    const storedComponents = await Promise.all(
      set.diagramComponentIds.map((id) => context.store.loadDiagramComponent(setId, id))
    );
    const importedComponents = await Promise.all(
      library.diagramComponentIds.map((id) => context.store.loadImportedDiagramComponent(id))
    );
    const existingComponents = [...storedComponents, ...importedComponents].filter(
      (component) => !isDiagramComponentArchived(component)
    );
    const createdAt = timestamp();
    const promptBuild = createGenerationPromptConfig({
      id: context.store.ids.promptConfig(),
      diagramSet: { ...set, featuredViewIds: settledViewIds },
      codeEntities: {
        ...entities,
        entities: [...entities.entities, ...importedCodeEntities]
      },
      diagrams: [...storedDiagrams, ...importedDiagrams],
      components: [...storedComponents, ...importedComponents],
      outputKind: input.outputKind,
      viewKind: input.viewKind,
      modelId,
      profile: promptProfile,
      domainProfileId,
      instruction: input.prompt,
      runReferencePrompt: input.runReferencePrompt,
      referencePrompt: input.referencePrompt,
      selectedCodeEntityIds: input.selectedCodeEntityIds,
      referenceSelections: input.referenceSelections,
      referencePromptSelections: input.referencePromptSelections,
      derivation: input.derivation,
      createdAt
    });
    const promptConfig = promptBuild.config;
    const batchId = context.store.ids.batch();
    let batch: GenerationBatchRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: batchId,
      diagramSetId: setId,
      requestedCount: input.count,
      promptConfigId: promptConfig.id,
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
      id: context.store.ids.run(),
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
    await context.store.beginBatch(promptConfig, batch, runs);
    const persistedPromptConfig = await context.store.loadGenerationPromptConfig(
      setId,
      promptConfig.id
    );
    batch = { ...batch, status: "running", updatedAt: timestamp() };
    await context.store.saveBatch(batch);
    const outputViewKind = input.outputKind === "diagram" ? input.viewKind ?? "diagram" : undefined;
    const outputLabel = input.outputKind === "diagram-component"
      ? "component"
      : outputViewKind === "call-graph"
        ? "call graph"
        : outputViewKind === "dir-view"
          ? "directory view"
          : "diagram";
    onEvent?.({ type: "progress", message: `started ${input.count} parallel ${outputLabel} agents` });

    const accepted = new Map<number, GeneratedArtifactDraft>();
    let pending = runs.map((_, index) => index);
    let lastErrors = new Map<number, string>();
    for (let attempt = 1;attempt <= MAX_ATTEMPTS && pending.length > 0;attempt += 1) {
      const results: Array<{ index: number; draft: GeneratedArtifactDraft } | { index: number; error: string }> = await Promise.all(pending.map(async (index) => {
        const run = runs[index];
        const setRun = (update: Partial<AgentRunRecord>) => {
          runs[index] = { ...runs[index], ...update, updatedAt: timestamp() };
          void context.store.saveRun(runs[index]);
        };
        try {
          const draft = await context.agents.generateArtifact({
            sourceRoot: set.sourceCheckoutRoot,
            diagramSetName: set.name,
            promptConfig: persistedPromptConfig,
            allowedCodeEntityAliases: promptBuild.allowedCodeEntityAliases,
            codeEntities: promptBuild.allowedCodeEntities,
            allowedDiagramIds: promptBuild.allowedDiagramIds,
            allowedDiagramComponentIds: promptBuild.allowedDiagramComponentIds,
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
          validateGeneratedArtifactDraft(context,
            draft,
            promptBuild.allowedCodeEntityIds,
            promptBuild.allowedCodeEntities
          );
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
        await context.store.saveRun(runs[index]);
      }
    }

    if (accepted.size !== input.count) {
      const message = [...lastErrors.entries()]
        .map(([index, error]) => `slot ${index + 1}: ${error}`)
        .join("; ") || "one or more diagram agents failed";
      batch = { ...batch, status: "failed", error: message, updatedAt: timestamp() };
      await context.store.saveBatch(batch);
      throw new Error(message);
    }

    batch = { ...batch, status: "validating", updatedAt: timestamp() };
    await context.store.saveBatch(batch);
    onEvent?.({ type: "progress", message: "validating complete parallel batch" });
    const derivedFromDiagramIds = promptConfig.references
      .filter((reference) => reference.kind === "diagram")
      .map((reference) => reference.targetId);
    const sameViewDerivedFromDiagramIds = input.outputKind === "diagram"
      ? derivedFromDiagramIds.filter((id) => existingDiagrams.find(
        (diagram) => diagram.id === id && diagram.viewKind === outputViewKind
      ))
      : derivedFromDiagramIds;
    const derivedFromDiagramComponentIds = promptConfig.references
      .filter((reference) => reference.kind === "diagram-component")
      .map((reference) => reference.targetId);
    const handles = new Set((input.outputKind === "diagram" ? existingDiagrams : existingComponents)
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
        id: context.store.ids.diagram(),
        recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
        diagramSetId: setId,
        viewKind: outputViewKind!,
        representationKind: outputViewKind === "diagram" ? "diagram" : "tree",
        ...(outputViewKind !== "diagram" && settledViewIds.diagram
          ? { basedOnDiagramId: settledViewIds.diagram }
          : {}),
        handle,
        name: draft.name.trim(),
        ascii: normalizeAscii(draft.ascii),
        codeEntityIds: [...new Set(draft.codeEntityIds)],
        origin: "generated",
        producedByRunId: run.id,
        generationPromptConfigId: promptConfig.id,
        derivedFromDiagramIds: [...new Set(sameViewDerivedFromDiagramIds)],
        createdAt: timestamp()
      }))
      : [];
    const components: DiagramComponentRecord[] = input.outputKind === "diagram-component"
      ? generated.map(({ run, draft, handle }) => ({
        schemaVersion: SCHEMA_VERSION,
        id: context.store.ids.diagramComponent(),
        recordOrigin: { projectId: set.projectId, diagramSetId: set.id },
        diagramSetId: setId,
        handle,
        name: draft.name.trim(),
        ascii: normalizeAscii(draft.ascii),
        representationKind: (() => {
          const sourceId = input.derivation?.sourceArtifactId;
          if (!sourceId) return "diagram" as const;
          const source = input.derivation?.sourceArtifactKind === "diagram"
            ? existingDiagrams.find((artifact) => artifact.id === sourceId)
            : existingComponents.find((artifact) => artifact.id === sourceId);
          return source ? representationKindForArtifact(source) : "diagram";
        })(),
        codeEntityIds: [...new Set(draft.codeEntityIds)],
        origin: "generated",
        producedByRunId: run.id,
        generationPromptConfigId: promptConfig.id,
        derivedFromDiagramIds: [...new Set(derivedFromDiagramIds)],
        derivedFromDiagramComponentIds: [...new Set(derivedFromDiagramComponentIds)],
        createdAt: timestamp()
      }))
      : [];
    const artifacts = input.outputKind === "diagram" ? diagrams : components;
    const codeEntityMaps: DiagramCodeEntityMapRecord[] = generated.map(({ run, draft }, index) => {
      const artifact = artifacts[index];
      const mappedEntities = promptBuild.allowedCodeEntities.filter(
        (entity) => artifact.codeEntityIds.includes(entity.id)
      );
      const mappings = validateDiagramMappings(
        artifact.ascii,
        draft.mappings ?? [],
        mappedEntities
      );
      return {
        schemaVersion: SCHEMA_VERSION,
        diagramSetId: setId,
        artifactKind: input.outputKind,
        artifactId: artifact.id,
        asciiSha256: createHash("sha256").update(artifact.ascii).digest("hex"),
        mappings,
        producedByRunId: run.id,
        origin: "agent",
        createdAt: timestamp()
      };
    });
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
    await context.store.completeBatch(batch, runs, diagrams, components, codeEntityMaps);
    const workspace = await context.core.workspace();
    onEvent?.({
      type: "workspace",
      message: `generated ${input.count} ${outputLabel}${input.count === 1 ? "" : "s"}`,
      workspace
    });
    return workspace;
  } finally {
    context.activeBatches.delete(setId);
  }
}

export function validateGeneratedArtifactDraft(context: StudioContext, draft: GeneratedArtifactDraft, allowedCodeEntityIds: string[], allowedCodeEntities: CodeEntityRecord[]): void {
  if (!draft.name.trim()) throw new Error("generated artifact name cannot be blank");
  assertSevenBitAscii(draft.ascii);
  const allowedEntities = new Set(allowedCodeEntityIds);
  for (const id of draft.codeEntityIds) {
    if (!allowedEntities.has(id)) throw new Error(`artifact references unavailable CodeEntity: ${id}`);
  }
  if (!draft.mappings) throw new Error("generated artifact is missing its final entity mappings");
  const mappedEntities = allowedCodeEntities.filter((entity) => draft.codeEntityIds.includes(entity.id));
  validateDiagramMappings(draft.ascii, draft.mappings, mappedEntities);
}
