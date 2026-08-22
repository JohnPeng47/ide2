import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyLlmEdit,
  applyManualEdit,
  archiveDiagram,
  archiveDiagramComponent,
  archiveImportedDiagram,
  archiveImportedDiagramComponent,
  captureDiagramComponent,
  captureNestedDiagramComponent,
  createEditSession,
  deleteCodeEntityPromptTemplate,
  deleteDiagramSet,
  discardEdit,
  fetchWorkspace,
  generateArtifacts,
  finishEdit,
  importGlobalArtifact,
  mapCodeEntities,
  placeEditMarker,
  redoEdit,
  renameDiagram,
  renameImportedDiagram,
  resetSystemPromptTemplate,
  resetCodeEntityPromptTemplate,
  saveCodeEntityPromptTemplate,
  saveSystemPromptTemplate,
  deleteSystemPromptTemplate,
  undoEdit
} from "./api";
import { DiagramContextPanel, type ContextTab } from "./components/DiagramContextPanel";
import { DiagramSetPicker } from "./components/DiagramSetPicker";
import type { CodeEntityReveal } from "./components/CodeEntitiesPanel";
import { DiagramView } from "./components/DiagramView";
import { GeneratorOptions } from "./components/GeneratorOptions";
import { ImportArtifactDialog } from "./components/ImportArtifactDialog";
import { SplitPane } from "./components/SplitPane";
import {
  buildDerivativePrompt,
  diagramReferencesInPrompt,
  promptCorrection,
  type DerivativePromptDraft
} from "./derivativePrompt";
import {
  generationPageDraftKey,
  legacyGenerationPromptDraftKey,
  readGenerationPageDraft,
  readLegacyGenerationPromptDraft,
  saveGenerationPageDraft,
  type GenerationPageDraft
} from "./generationPageDraft";
import {
  SystemPromptSettingsDialog,
  type PromptTemplateDraft,
  type PromptTemplateFamily
} from "./components/SystemPromptSettingsDialog";
import {
  DEFAULT_DIAGRAM_MODEL_ID,
  DEFAULT_GENERATION_COUNT,
  DEFAULT_GENERATION_PROMPT_PROFILE_ID,
  isDiagramComponentArchived,
  isDiagramArchived,
  type ArtifactImportInput,
  type CodeEntityPromptTemplateRecord,
  type DiagramComponentRecord,
  type DiagramElementMapping,
  type DiagramRecord,
  type DiagramSelectionBounds,
  type DiagramModelId,
  type GenerationOutputKind,
  type GenerationPromptProfileId,
  type PromptReference,
  type SystemPromptTemplateRecord,
  type WorkspaceSnapshot
} from "./domain";

type Screen = "diagram" | "diagram-component" | "generation";

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [activeDiagramId, setActiveDiagramId] = useState<string | null>(null);
  const [activeComponentId, setActiveComponentId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("generation");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(DEFAULT_GENERATION_COUNT);
  const [outputKind, setOutputKind] = useState<GenerationOutputKind>("diagram");
  const [generationModelId, setGenerationModelId] = useState<DiagramModelId>(DEFAULT_DIAGRAM_MODEL_ID);
  const [promptProfileId, setPromptProfileId] = useState<GenerationPromptProfileId>(
    DEFAULT_GENERATION_PROMPT_PROFILE_ID
  );
  const [historicalReferences, setHistoricalReferences] = useState<PromptReference[]>([]);
  const [derivativeDraft, setDerivativeDraft] = useState<DerivativePromptDraft | null>(null);
  const [excludedReferenceKeys, setExcludedReferenceKeys] = useState<Set<string>>(new Set());
  const [restoredGenerationDraftKey, setRestoredGenerationDraftKey] = useState<string | null>(null);
  const [contextTab, setContextTab] = useState<ContextTab>("code-entities");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false);
  const [activeEditSessionId, setActiveEditSessionId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editModelId, setEditModelId] = useState<DiagramModelId>(DEFAULT_DIAGRAM_MODEL_ID);
  const [markerMode, setMarkerMode] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editProgress, setEditProgress] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mappingProgress, setMappingProgress] = useState("");
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [codeEntityReveal, setCodeEntityReveal] = useState<CodeEntityReveal | undefined>();
  const revealRequestId = useRef(0);
  const editQueue = useRef<Promise<void>>(Promise.resolve());
  const editShortcutHandlers = useRef({ undo: () => {}, redo: () => {} });

  const load = useCallback(async () => {
    try {
      const next = await fetchWorkspace();
      setWorkspace(next);
      setError(null);
      setActiveSetId((current) => current && next.diagramSets.some((set) => set.id === current)
        ? current
        : next.diagramSets.at(-1)?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "workspace load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeSet = workspace?.diagramSets.find((set) => set.id === activeSetId) ?? null;
  const entitySet = activeSet && workspace
    ? workspace.codeEntitySets[activeSet.codeEntitiesSetId]
    : null;
  const diagrams = useMemo(() => activeSet && workspace
    ? [...activeSet.diagramIds, ...workspace.globalImports.diagramIds]
      .map((id) => workspace.diagrams[id])
      .filter((diagram): diagram is DiagramRecord => Boolean(diagram) && !isDiagramArchived(diagram))
    : [], [activeSet, workspace]);
  const components = useMemo(() => activeSet && workspace
    ? [...activeSet.diagramComponentIds, ...workspace.globalImports.diagramComponentIds]
      .map((id) => workspace.diagramComponents[id])
      .filter((component): component is DiagramComponentRecord => (
        Boolean(component) && !isDiagramComponentArchived(component)
      ))
    : [], [activeSet, workspace]);
  const promptDiagramReferences = useMemo(() => diagramReferencesInPrompt({
    prompt,
    diagrams: workspace?.diagrams ?? {},
    historicalReferences
  }), [historicalReferences, prompt, workspace?.diagrams]);
  const promptProfiles = useMemo(() => {
    const builtInOrder = ["default", "structure-first", "flow-first", "compact"];
    return Object.values(workspace?.systemPromptTemplates ?? {}).sort((left, right) => {
      if (left.builtIn && right.builtIn) {
        return builtInOrder.indexOf(left.id) - builtInOrder.indexOf(right.id);
      }
      return Number(right.builtIn) - Number(left.builtIn) || left.label.localeCompare(right.label);
    });
  }, [workspace?.systemPromptTemplates]);
  const codeEntityPromptProfiles = useMemo(() => Object.values(
    workspace?.codeEntityPromptTemplates ?? {}
  ).sort((left, right) => (
    Number(right.builtIn) - Number(left.builtIn) || left.label.localeCompare(right.label)
  )), [workspace?.codeEntityPromptTemplates]);
  const fallbackPromptProfileId = promptProfiles.find(
    (profile) => profile.id === DEFAULT_GENERATION_PROMPT_PROFILE_ID
  )?.id ?? promptProfiles[0]?.id ?? DEFAULT_GENERATION_PROMPT_PROFILE_ID;

  const restoreGenerationDraft = (
    draftKey: string,
    legacyPromptKey: string,
    defaults: GenerationPageDraft
  ) => {
    const stored = readGenerationPageDraft(window.localStorage, draftKey);
    const availableEntityIds = new Set(entitySet?.entities.map((entity) => entity.id) ?? []);
    const selectedCodeEntityIds = stored
      ? stored.selectedCodeEntityIds.filter((id) => availableEntityIds.has(id))
      : defaults.selectedCodeEntityIds;
    const restoredPromptProfileId = stored
      && promptProfiles.some((profile) => profile.id === stored.promptProfileId)
      ? stored.promptProfileId
      : defaults.promptProfileId;
    setPrompt(stored?.prompt
      ?? readLegacyGenerationPromptDraft(window.localStorage, legacyPromptKey)
      ?? defaults.prompt);
    setSelectedIds(new Set(selectedCodeEntityIds));
    setExcludedReferenceKeys(new Set(stored?.excludedReferenceKeys ?? defaults.excludedReferenceKeys));
    setCount(stored?.count ?? defaults.count);
    setOutputKind(stored?.outputKind ?? defaults.outputKind);
    setGenerationModelId(stored?.modelId ?? defaults.modelId);
    setPromptProfileId(restoredPromptProfileId);
    setRestoredGenerationDraftKey(draftKey);
  };

  const currentGenerationDraftKey = workspace?.project && activeSet
    ? generationPageDraftKey(workspace.project.id, activeSet.id, derivativeDraft?.derivation)
    : null;

  useEffect(() => {
    if (!promptProfiles.length || promptProfiles.some((profile) => profile.id === promptProfileId)) return;
    const legacyIds: Record<string, string> = {
      structureFirst: "structure-first",
      flowFirst: "flow-first"
    };
    const migrated = legacyIds[promptProfileId];
    setPromptProfileId(promptProfiles.some((profile) => profile.id === migrated)
      ? migrated
      : fallbackPromptProfileId);
  }, [fallbackPromptProfileId, promptProfiles, promptProfileId]);
  const activeDiagram = diagrams.find((diagram) => diagram.id === activeDiagramId)
    ?? diagrams.at(-1)
    ?? null;
  const activeComponent = components.find((component) => component.id === activeComponentId) ?? null;
  const selectedArtifact = screen === "diagram-component" ? activeComponent : activeDiagram;
  const selectedArtifactKind: GenerationOutputKind = screen === "diagram-component"
    ? "diagram-component"
    : "diagram";
  const selectedCodeEntityMap = selectedArtifact && workspace && activeSet
    ? workspace.codeEntityMaps[`${activeSet.id}:${selectedArtifact.id}`]
      ?? workspace.codeEntityMaps[selectedArtifact.id]
    : undefined;
  const activeEditSession = activeEditSessionId && workspace
    ? workspace.editSessions[activeEditSessionId] ?? null
    : null;
  const editSession = activeEditSession?.status === "active"
    && activeEditSession.sourceArtifactId === selectedArtifact?.id
    ? activeEditSession
    : null;
  const collectionRun = activeSet && workspace
    ? [...activeSet.agentRunIds]
      .reverse()
      .map((id) => workspace.agentRuns[id])
      .find((run) => run?.kind === "collect-entities")
    : undefined;
  const initialGenerationPending = Boolean(activeSet && workspace
    && activeSet.readiness === "ready"
    && activeSet.diagramIds.length === 0
    && (activeSet.generationBatchIds.length === 0
      || activeSet.generationBatchIds.some((id) => {
        const status = workspace.generationBatches[id]?.status;
        return status !== "complete" && status !== "failed";
      })));
  const initialGenerationRun = initialGenerationPending && activeSet && workspace
    ? [...activeSet.agentRunIds]
      .reverse()
      .map((id) => workspace.agentRuns[id])
      .find((run) => run?.kind === "generate-one-diagram")
    : undefined;

  useEffect(() => {
    setMappingProgress("");
    setMappingError(null);
    setCodeEntityReveal(undefined);
  }, [selectedArtifact?.id]);

  useEffect(() => {
    if (!activeSet || !entitySet) return;
    const draftKey = workspace?.project
      ? generationPageDraftKey(workspace.project.id, activeSet.id)
      : null;
    if (draftKey && workspace?.project) {
      restoreGenerationDraft(
        draftKey,
        legacyGenerationPromptDraftKey(workspace.project.id, activeSet.id),
        {
          version: 1,
          prompt: "",
          selectedCodeEntityIds: entitySet.entities.map((entity) => entity.id),
          excludedReferenceKeys: [],
          count: DEFAULT_GENERATION_COUNT,
          outputKind: "diagram",
          modelId: DEFAULT_DIAGRAM_MODEL_ID,
          promptProfileId: fallbackPromptProfileId
        }
      );
    } else {
      setRestoredGenerationDraftKey(null);
    }
    setHistoricalReferences([]);
    setDerivativeDraft(null);
    setContextTab("code-entities");
    setProgress("");
    setError(null);
    setActiveComponentId(null);
    setActiveEditSessionId(null);
    setEditPrompt("");
    setMarkerMode(false);
    setMappingProgress("");
    setMappingError(null);
    setCodeEntityReveal(undefined);
    const activeDiagramIds = activeSet.diagramIds.filter((id) => {
      const diagram = workspace?.diagrams[id];
      return diagram && !isDiagramArchived(diagram);
    });
    if (activeSet.readiness === "ready" && activeDiagramIds.length > 0) {
      setActiveDiagramId(activeDiagramIds.at(-1) ?? null);
      setScreen("diagram");
    } else {
      setActiveDiagramId(null);
      setScreen("generation");
    }
  }, [activeSet?.id, entitySet?.id]);

  useEffect(() => {
    if (!currentGenerationDraftKey
      || restoredGenerationDraftKey !== currentGenerationDraftKey) return;
    saveGenerationPageDraft(window.localStorage, currentGenerationDraftKey, {
      version: 1,
      prompt,
      selectedCodeEntityIds: [...selectedIds],
      excludedReferenceKeys: [...excludedReferenceKeys],
      count,
      outputKind,
      modelId: generationModelId,
      promptProfileId
    });
  }, [
    count,
    currentGenerationDraftKey,
    excludedReferenceKeys,
    generationModelId,
    outputKind,
    prompt,
    promptProfileId,
    restoredGenerationDraftKey,
    selectedIds
  ]);

  useEffect(() => {
    if (!activeSet || activeSet.readiness !== "ready" || activeDiagramId !== null) return;
    const activeDiagramIds = activeSet.diagramIds.filter((id) => {
      const diagram = workspace?.diagrams[id];
      return diagram && !isDiagramArchived(diagram);
    });
    const latestDiagramId = activeDiagramIds.at(-1);
    if (!latestDiagramId) return;
    setActiveDiagramId(latestDiagramId);
    setScreen("diagram");
  }, [activeSet, activeDiagramId, workspace]);

  useEffect(() => {
    const shouldPoll = workspace !== null && (
      workspace.diagramSets.length === 0
      || activeSet?.readiness === "collecting"
      || initialGenerationPending
    );
    if (!shouldPoll) return undefined;
    const timer = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(timer);
  }, [workspace?.diagramSets.length, activeSet?.readiness, initialGenerationPending, load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return;
      if ((event.target as HTMLElement | null)?.closest("#edit-prompt")) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        editShortcutHandlers.current.undo();
      } else if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) {
        event.preventDefault();
        editShortcutHandlers.current.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!workspace) {
    return <main className="center-state"><span className="pulse" /><h1>NEW DIAGRAM</h1><p>{error || "loading workspace…"}</p></main>;
  }

  if (!workspace.project || workspace.diagramSets.length === 0) {
    return (
      <main className="empty-workspace">
        <span className="eyebrow">NO DIAGRAM SETS</span>
        <h1>Start from the agent-facing CLI.</h1>
        <p>The browser cannot create a DiagramSet or CodeEntitiesSet.</p>
        <pre>npm run diagram -- create --path /path/to/repo --name "Feature" --prompt "Map the feature"</pre>
        {error ? <p className="inline-error">{error}</p> : null}
      </main>
    );
  }

  if (!activeSet || !entitySet) return null;
  const waiting = activeSet.readiness === "collecting"
    || initialGenerationPending
    || activeSet.readiness === "failed";

  const generate = async () => {
    setBusy(true);
    setError(null);
    setProgress("queuing generation batch");
    const beforeDiagrams = new Set(activeSet.diagramIds);
    const beforeComponents = new Set(activeSet.diagramComponentIds);
    try {
      const next = await generateArtifacts(activeSet.id, {
        prompt,
        selectedCodeEntityIds: [...selectedIds],
        count,
        outputKind,
        modelId: generationModelId,
        promptProfileId,
        referenceSelections: promptDiagramReferences.flatMap((reference) => (
          reference.tokens.map((token) => ({
            kind: reference.kind,
            targetId: reference.targetId,
            token,
            handle: reference.handle,
            included: reference.available && !excludedReferenceKeys.has(reference.key)
          }))
        )),
        derivation: derivativeDraft ? {
          ...derivativeDraft.derivation,
          promptCorrection: promptCorrection(prompt, derivativeDraft)
        } : undefined
      }, setProgress);
      setWorkspace(next);
      const nextSet = next.diagramSets.find((set) => set.id === activeSet.id);
      const createdDiagrams = nextSet?.diagramIds.filter((id) => !beforeDiagrams.has(id)) ?? [];
      const createdComponents = nextSet?.diagramComponentIds
        .filter((id) => !beforeComponents.has(id)) ?? [];
      if (outputKind === "diagram") {
        setActiveDiagramId(createdDiagrams[0] ?? nextSet?.diagramIds.at(-1) ?? null);
        setActiveComponentId(null);
        setScreen("diagram");
      } else {
        setActiveComponentId(createdComponents[0] ?? null);
        setScreen("diagram-component");
      }
      setContextTab("diagrams");
      const created = outputKind === "diagram" ? createdDiagrams.length : createdComponents.length;
      setProgress(`generated ${created} ${outputKind === "diagram" ? "diagrams" : "components"} with ${count} parallel agents`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "generation failed");
    } finally {
      setBusy(false);
    }
  };

  const updateGenerationPrompt = (value: string) => {
    setPrompt(value);
    if (currentGenerationDraftKey
      && restoredGenerationDraftKey === currentGenerationDraftKey) {
      saveGenerationPageDraft(window.localStorage, currentGenerationDraftKey, {
        version: 1,
        prompt: value,
        selectedCodeEntityIds: [...selectedIds],
        excludedReferenceKeys: [...excludedReferenceKeys],
        count,
        outputKind,
        modelId: generationModelId,
        promptProfileId
      });
    }
  };

  const persistPromptTemplate = async (
    draft: Pick<SystemPromptTemplateRecord, "label" | "description" | "prompts"> & { id?: string }
  ): Promise<SystemPromptTemplateRecord> => {
    const beforeIds = new Set(Object.keys(workspace.systemPromptTemplates));
    const next = await saveSystemPromptTemplate(draft);
    setWorkspace(next);
    const saved = draft.id
      ? next.systemPromptTemplates[draft.id]
      : Object.values(next.systemPromptTemplates).find((template) => !beforeIds.has(template.id));
    if (!saved) throw new Error("saved template was not returned by the workspace");
    if (!draft.id) setPromptProfileId(saved.id);
    return saved;
  };

  const restorePromptTemplate = async (id: string): Promise<SystemPromptTemplateRecord> => {
    const next = await resetSystemPromptTemplate(id);
    setWorkspace(next);
    return next.systemPromptTemplates[id];
  };

  const removePromptTemplate = async (id: string): Promise<void> => {
    const next = await deleteSystemPromptTemplate(id);
    setWorkspace(next);
    if (promptProfileId === id) {
      const remaining = Object.values(next.systemPromptTemplates);
      setPromptProfileId(remaining.find(
        (template) => template.id === DEFAULT_GENERATION_PROMPT_PROFILE_ID
      )?.id ?? remaining[0]?.id ?? DEFAULT_GENERATION_PROMPT_PROFILE_ID);
    }
  };

  const persistCodeEntityPromptTemplate = async (
    draft: Pick<CodeEntityPromptTemplateRecord, "label" | "description" | "prompts"> & { id?: string }
  ): Promise<CodeEntityPromptTemplateRecord> => {
    const beforeIds = new Set(Object.keys(workspace.codeEntityPromptTemplates));
    const next = await saveCodeEntityPromptTemplate(draft);
    setWorkspace(next);
    const saved = draft.id
      ? next.codeEntityPromptTemplates[draft.id]
      : Object.values(next.codeEntityPromptTemplates).find((template) => !beforeIds.has(template.id));
    if (!saved) throw new Error("saved CodeEntity template was not returned by the workspace");
    return saved;
  };

  const restoreCodeEntityPromptTemplate = async (
    id: string
  ): Promise<CodeEntityPromptTemplateRecord> => {
    const next = await resetCodeEntityPromptTemplate(id);
    setWorkspace(next);
    return next.codeEntityPromptTemplates[id];
  };

  const removeCodeEntityPromptTemplate = async (id: string): Promise<void> => {
    const next = await deleteCodeEntityPromptTemplate(id);
    setWorkspace(next);
  };

  const savePromptTemplate = (
    family: PromptTemplateFamily,
    draft: PromptTemplateDraft
  ): Promise<SystemPromptTemplateRecord | CodeEntityPromptTemplateRecord> => {
    if (family === "generation") {
      return persistPromptTemplate({
        id: draft.id,
        label: draft.label,
        description: draft.description,
        prompts: {
          diagram: draft.prompts.diagram ?? "",
          "diagram-component": draft.prompts["diagram-component"] ?? ""
        }
      });
    }
    return persistCodeEntityPromptTemplate({
      id: draft.id,
      label: draft.label,
      description: draft.description,
      prompts: {
        "code-entity-identification": draft.prompts["code-entity-identification"] ?? "",
        "code-entity-compaction": draft.prompts["code-entity-compaction"] ?? ""
      }
    });
  };

  const removeDiagramSet = async (setId: string): Promise<void> => {
    const next = await deleteDiagramSet(setId);
    setWorkspace(next);
    setActiveSetId((current) => current && next.diagramSets.some((set) => set.id === current)
      ? current
      : next.diagramSets.at(-1)?.id ?? null);
  };

  const derive = (diagram: DiagramRecord) => {
    const config = diagram.generationPromptConfigId
      ? workspace.generationPromptConfigs[diagram.generationPromptConfigId]
      : undefined;
    const draft = buildDerivativePrompt({
      sourceArtifactKind: "diagram",
      sourceArtifact: diagram,
      diagrams: workspace.diagrams,
      components: workspace.diagramComponents,
      promptConfigs: workspace.generationPromptConfigs
    });
    const draftKey = generationPageDraftKey(
      workspace.project!.id,
      activeSet.id,
      draft.derivation
    );
    restoreGenerationDraft(
      draftKey,
      legacyGenerationPromptDraftKey(workspace.project!.id, activeSet.id, draft.derivation),
      {
        version: 1,
        prompt: draft.prompt,
        selectedCodeEntityIds: workspace.globalImports.diagramIds.includes(diagram.id)
          ? [...selectedIds]
          : config?.selectedCodeEntityIds ?? diagram.codeEntityIds,
        excludedReferenceKeys: [],
        count: DEFAULT_GENERATION_COUNT,
        outputKind: config?.outputKind ?? "diagram",
        modelId: config?.modelId ?? DEFAULT_DIAGRAM_MODEL_ID,
        promptProfileId: config?.systemPrompt.profileId ?? DEFAULT_GENERATION_PROMPT_PROFILE_ID
      }
    );
    setHistoricalReferences(draft.historicalReferences);
    setDerivativeDraft(draft);
    setScreen("generation");
  };

  const deriveComponent = (component: DiagramComponentRecord) => {
    const config = component.generationPromptConfigId
      ? workspace.generationPromptConfigs[component.generationPromptConfigId]
      : undefined;
    const draft = buildDerivativePrompt({
      sourceArtifactKind: "diagram-component",
      sourceArtifact: component,
      diagrams: workspace.diagrams,
      components: workspace.diagramComponents,
      promptConfigs: workspace.generationPromptConfigs
    });
    const draftKey = generationPageDraftKey(
      workspace.project!.id,
      activeSet.id,
      draft.derivation
    );
    restoreGenerationDraft(
      draftKey,
      legacyGenerationPromptDraftKey(workspace.project!.id, activeSet.id, draft.derivation),
      {
        version: 1,
        prompt: draft.prompt,
        selectedCodeEntityIds: workspace.globalImports.diagramComponentIds.includes(component.id)
          ? [...selectedIds]
          : config?.selectedCodeEntityIds ?? component.codeEntityIds,
        excludedReferenceKeys: [],
        count: DEFAULT_GENERATION_COUNT,
        outputKind: config?.outputKind ?? "diagram-component",
        modelId: config?.modelId ?? DEFAULT_DIAGRAM_MODEL_ID,
        promptProfileId: config?.systemPrompt.profileId ?? DEFAULT_GENERATION_PROMPT_PROFILE_ID
      }
    );
    setHistoricalReferences(draft.historicalReferences);
    setDerivativeDraft(draft);
    setScreen("generation");
  };

  const leaveDerivative = () => {
    if (!derivativeDraft) return;
    const { sourceArtifactKind, sourceArtifactId } = derivativeDraft.derivation;
    if (sourceArtifactKind === "diagram") {
      setActiveDiagramId(sourceArtifactId);
      setActiveComponentId(null);
      setScreen("diagram");
    } else {
      setActiveComponentId(sourceArtifactId);
      setScreen("diagram-component");
    }
  };

  const importArtifact = async (input: ArtifactImportInput) => {
    const beforeIds = input.artifactKind === "diagram"
      ? workspace.globalImports.diagramIds
      : workspace.globalImports.diagramComponentIds;
    const next = await importGlobalArtifact(input);
    const nextIds = input.artifactKind === "diagram"
      ? next.globalImports.diagramIds
      : next.globalImports.diagramComponentIds;
    const artifactId = nextIds.find((id) => !beforeIds.includes(id));
    if (!artifactId) throw new Error("Imported artifact was not returned");
    setWorkspace(next);
    setProgress(`imported ${input.artifactKind === "diagram" ? "Diagram" : "DiagramComponent"}`);
    setContextTab("diagrams");
    if (input.artifactKind === "diagram") {
      setActiveDiagramId(artifactId);
      setActiveComponentId(null);
      setScreen("diagram");
    } else {
      setActiveComponentId(artifactId);
      setScreen("diagram-component");
    }
  };

  const rename = async (diagramId: string, name: string) => {
    setWorkspace(workspace.globalImports.diagramIds.includes(diagramId)
      ? await renameImportedDiagram(diagramId, name)
      : await renameDiagram(activeSet.id, diagramId, name));
  };

  const archive = async (diagramId: string) => {
    const next = workspace.globalImports.diagramIds.includes(diagramId)
      ? await archiveImportedDiagram(diagramId)
      : await archiveDiagram(activeSet.id, diagramId);
    setWorkspace(next);
    const nextSet = next.diagramSets.find((set) => set.id === activeSet.id);
    const nextActiveIds = [...(nextSet?.diagramIds ?? []), ...next.globalImports.diagramIds]
      .filter((id) => {
      const diagram = next.diagrams[id];
      return diagram && !isDiagramArchived(diagram);
      });
    setActiveDiagramId((current) => current === diagramId
      ? nextActiveIds.at(-1) ?? null
      : current);
    if (nextActiveIds.length === 0) {
      if (components.length > 0) {
        setActiveComponentId(components.at(-1)?.id ?? null);
        setScreen("diagram-component");
      } else {
        setScreen("generation");
      }
    }
  };

  const archiveComponent = async (componentId: string) => {
    const next = workspace.globalImports.diagramComponentIds.includes(componentId)
      ? await archiveImportedDiagramComponent(componentId)
      : await archiveDiagramComponent(activeSet.id, componentId);
    setWorkspace(next);
    const nextSet = next.diagramSets.find((set) => set.id === activeSet.id);
    const nextActiveIds = [
      ...(nextSet?.diagramComponentIds ?? []),
      ...next.globalImports.diagramComponentIds
    ].filter((id) => {
      const component = next.diagramComponents[id];
      return component && !isDiagramComponentArchived(component);
    });
    if (activeComponentId === componentId) {
      const replacement = nextActiveIds.at(-1) ?? null;
      setActiveComponentId(replacement);
      if (!replacement) setScreen(activeDiagram ? "diagram" : "generation");
    }
  };

  const capture = async (bounds: DiagramSelectionBounds) => {
    if (!activeDiagram) throw new Error("No active Diagram to capture");
    const next = await captureDiagramComponent(activeSet.id, activeDiagram.id, bounds);
    setWorkspace(next);
    setContextTab("diagrams");
    setProgress("DiagramComponent captured and saved");
  };

  const captureNested = async (bounds: DiagramSelectionBounds) => {
    if (!activeComponent) throw new Error("No active DiagramComponent to capture");
    const next = await captureNestedDiagramComponent(activeSet.id, activeComponent.id, bounds);
    setWorkspace(next);
    const nextSet = next.diagramSets.find((set) => set.id === activeSet.id);
    const createdId = nextSet?.diagramComponentIds
      .filter((id) => !activeSet.diagramComponentIds.includes(id))
      .at(-1);
    if (createdId) setActiveComponentId(createdId);
    setContextTab("diagrams");
    setProgress("Child DiagramComponent captured and saved");
  };

  const selectDiagram = (diagramId: string) => {
    setActiveDiagramId(diagramId);
    setActiveComponentId(null);
    setScreen("diagram");
  };

  const selectComponent = (componentId: string) => {
    setActiveComponentId(componentId);
    setScreen("diagram-component");
  };

  const toggleEntity = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const startEdit = async () => {
    if (!selectedArtifact) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const reusable = Object.values(workspace.editSessions).find((session) => (
        session.status === "active"
        && session.diagramSetId === activeSet.id
        && session.sourceArtifactKind === selectedArtifactKind
        && session.sourceArtifactId === selectedArtifact.id
      ));
      if (reusable) {
        setActiveEditSessionId(reusable.id);
      } else {
        const next = await createEditSession(activeSet.id, selectedArtifactKind, selectedArtifact.id);
        setWorkspace(next);
        const created = Object.values(next.editSessions).find((session) => (
          session.status === "active"
          && session.sourceArtifactKind === selectedArtifactKind
          && session.sourceArtifactId === selectedArtifact.id
        ));
        if (!created) throw new Error("edit session was not returned");
        setActiveEditSessionId(created.id);
      }
      setEditPrompt("");
      setMarkerMode(false);
      setEditProgress("");
      setContextTab("operations");
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "could not start edit mode");
    } finally {
      setEditBusy(false);
    }
  };

  const queueManualEdit = (ascii: string) => {
    if (!editSession) return;
    const sessionId = editSession.id;
    editQueue.current = editQueue.current.then(async () => {
      const next = await applyManualEdit(activeSet.id, sessionId, ascii);
      setWorkspace(next);
    }).catch((caught) => {
      setEditError(caught instanceof Error ? caught.message : "manual edit failed");
    });
  };

  const runEditAction = async (
    action: (setId: string, sessionId: string) => Promise<WorkspaceSnapshot>
  ) => {
    if (!editSession) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await editQueue.current;
      setWorkspace(await action(activeSet.id, editSession.id));
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "edit operation failed");
    } finally {
      setEditBusy(false);
    }
  };

  const markLocation = async (line: number, column: number) => {
    if (!editSession) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await editQueue.current;
      const result = await placeEditMarker(activeSet.id, editSession.id, line, column);
      setWorkspace(result.workspace);
      setEditPrompt((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${result.markerToken} `);
      setMarkerMode(false);
      setContextTab("operations");
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "marker placement failed");
    } finally {
      setEditBusy(false);
    }
  };

  const runLlmEdit = async () => {
    if (!editSession || !editPrompt.trim()) return;
    setEditBusy(true);
    setEditError(null);
    setEditProgress("queuing LLM edit");
    try {
      await editQueue.current;
      const next = await applyLlmEdit(
        activeSet.id,
        editSession.id,
        editPrompt,
        editModelId,
        setEditProgress
      );
      setWorkspace(next);
      setEditPrompt("");
      setEditProgress("LLM edit applied");
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "LLM edit failed");
    } finally {
      setEditBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editSession) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await editQueue.current;
      const next = await finishEdit(activeSet.id, editSession.id);
      const completed = next.editSessions[editSession.id];
      if (!completed?.outputArtifactId) throw new Error("saved edit did not return an artifact");
      setWorkspace(next);
      if (editSession.sourceArtifactKind === "diagram") {
        setActiveDiagramId(completed.outputArtifactId);
        setActiveComponentId(null);
        setScreen("diagram");
      } else {
        setActiveComponentId(completed.outputArtifactId);
        setScreen("diagram-component");
      }
      setActiveEditSessionId(null);
      setMarkerMode(false);
      setEditPrompt("");
      setContextTab("diagrams");
      setProgress("edited copy saved");
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "could not save edited copy");
    } finally {
      setEditBusy(false);
    }
  };

  const leaveEdit = async () => {
    if (!editSession) return;
    await runEditAction(discardEdit);
    setActiveEditSessionId(null);
    setMarkerMode(false);
    setEditPrompt("");
    setContextTab("code-entities");
  };

  const generateCodeEntityMap = async () => {
    if (!selectedArtifact) return;
    setMappingBusy(true);
    setMappingError(null);
    setMappingProgress("queuing code-entity mapping");
    try {
      const next = await mapCodeEntities(
        activeSet.id,
        selectedArtifactKind,
        selectedArtifact.id,
        setMappingProgress
      );
      setWorkspace(next);
      const count = (next.codeEntityMaps[`${activeSet.id}:${selectedArtifact.id}`]
        ?? next.codeEntityMaps[selectedArtifact.id])?.mappings.length ?? 0;
      setMappingProgress(`mapped ${count} diagram elements`);
    } catch (caught) {
      setMappingError(caught instanceof Error ? caught.message : "code-entity mapping failed");
      setMappingProgress("");
    } finally {
      setMappingBusy(false);
    }
  };

  const revealCodeEntity = (mapping: DiagramElementMapping) => {
    revealRequestId.current += 1;
    setContextTab("code-entities");
    setCodeEntityReveal({
      entityId: mapping.entityId,
      sourceRangeIndex: mapping.sourceRangeIndex,
      requestId: revealRequestId.current
    });
  };

  editShortcutHandlers.current = editSession ? {
    undo: () => void runEditAction(undoEdit),
    redo: () => void runEditAction(redoEdit)
  } : { undo: () => {}, redo: () => {} };

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand">
          <span className="brand-mark">ND</span>
          <div><h1>NEW DIAGRAM</h1><p>{workspace.project.name}</p></div>
        </div>
        <DiagramSetPicker
          diagramSets={workspace.diagramSets}
          activeSetId={activeSet.id}
          onSelect={setActiveSetId}
          onDelete={removeDiagramSet}
        />
        <nav className="screen-tabs" aria-label="Workspace screens">
          <button
            type="button"
            className={screen === "diagram" || screen === "diagram-component" ? "is-active" : ""}
            disabled={diagrams.length + components.length === 0}
            onClick={() => setScreen(activeComponent ? "diagram-component" : "diagram")}
          >
            {activeComponent ? "COMPONENT" : "DIAGRAM"}
          </button>
          <button type="button" className={screen === "generation" ? "is-active" : ""} onClick={() => setScreen("generation")}>GENERATE</button>
          <button type="button" className="header-import" onClick={() => setImportOpen(true)}>IMPORT</button>
          <div className="settings-menu-shell">
            <button
              type="button"
              className={settingsMenuOpen ? "is-active" : ""}
              aria-haspopup="menu"
              aria-expanded={settingsMenuOpen}
              onClick={() => setSettingsMenuOpen((open) => !open)}
            >SETTINGS</button>
            {settingsMenuOpen ? (
              <div className="settings-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => {
                  setSettingsMenuOpen(false);
                  setPromptSettingsOpen(true);
                }}>Configure system prompts</button>
              </div>
            ) : null}
          </div>
        </nav>
      </header>

      {waiting ? (
        <section className="waiting-state" aria-live="polite">
          <span className={activeSet.readiness === "failed" ? "waiting-icon is-failed" : "waiting-icon"} />
          <span className="eyebrow">{
            activeSet.readiness === "failed"
              ? "COLLECTION FAILED"
              : initialGenerationPending
                ? "GENERATING INITIAL DIAGRAMS"
                : "COLLECTING CODE ENTITIES"
          }</span>
          <h2>{activeSet.name}</h2>
          <p>{activeSet.error
            || initialGenerationRun?.statusMessage
            || collectionRun?.statusMessage
            || "Opening the code-entity collector."}</p>
          <code>{activeSet.sourceCheckoutRoot}</code>
          <button type="button" className="button" onClick={() => void load()}>refresh status</button>
        </section>
      ) : screen === "generation" ? (
        <SplitPane
          left={<GeneratorOptions
            codeEntities={entitySet}
            diagrams={diagrams}
            components={components}
            outputKind={outputKind}
            modelId={generationModelId}
            promptProfileId={promptProfileId}
            promptProfiles={promptProfiles}
            historicalReferences={historicalReferences}
            diagramReferences={promptDiagramReferences}
            excludedReferenceKeys={excludedReferenceKeys}
            derivativeSourceReferenceKey={derivativeDraft?.derivation.sourceArtifactKind === "diagram"
              ? `diagram:${derivativeDraft.derivation.sourceArtifactId}`
              : undefined}
            prompt={prompt}
            count={count}
            generating={busy}
            progress={progress}
            error={error}
            backLabel={derivativeDraft
              ? `back to ${derivativeDraft.derivation.sourceArtifactKind === "diagram"
                ? "diagram"
                : "component"}`
              : undefined}
            onBack={derivativeDraft ? leaveDerivative : undefined}
            onPrompt={updateGenerationPrompt}
            onToggleDiagramReference={(key) => setExcludedReferenceKeys((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })}
            onCount={setCount}
            onOutputKind={setOutputKind}
            onModel={setGenerationModelId}
            onPromptProfile={setPromptProfileId}
            onGenerate={() => void generate()}
          />}
          right={<DiagramContextPanel
            setId={activeSet.id}
            codeEntities={entitySet}
            diagramSet={activeSet}
            diagrams={diagrams}
            components={components}
            generationBatches={workspace.generationBatches}
            generationPromptConfigs={workspace.generationPromptConfigs}
            selectedIds={selectedIds}
            onToggleEntity={toggleEntity}
            activeTab={contextTab}
            onTab={setContextTab}
            onSelectDiagram={selectDiagram}
            onSelectComponent={selectComponent}
            onRenameDiagram={rename}
            onArchiveDiagram={archive}
            onArchiveComponent={archiveComponent}
          />}
        />
      ) : screen === "diagram-component" && activeComponent ? (
        <SplitPane
          left={<DiagramView
            active={editSession ? { ...activeComponent, ascii: editSession.workingAscii } : activeComponent}
            artifactKind="diagram-component"
            onDerive={() => deriveComponent(activeComponent)}
            onCapture={captureNested}
            editMode={Boolean(editSession)}
            markerMode={markerMode}
            editBusy={editBusy}
            codeEntities={entitySet.entities}
            codeEntityMap={selectedCodeEntityMap}
            mappingBusy={mappingBusy}
            mappingProgress={mappingProgress}
            mappingError={mappingError}
            onToggleEdit={() => void (editSession ? leaveEdit() : startEdit())}
            onMapCodeEntities={() => void generateCodeEntityMap()}
            onRevealCodeEntity={revealCodeEntity}
            onManualEdit={queueManualEdit}
            onMarker={(line, column) => void markLocation(line, column)}
            onUndoEdit={() => void runEditAction(undoEdit)}
            onRedoEdit={() => void runEditAction(redoEdit)}
          />}
          right={<DiagramContextPanel
            setId={activeSet.id}
            codeEntities={entitySet}
            diagramSet={activeSet}
            diagrams={diagrams}
            components={components}
            generationBatches={workspace.generationBatches}
            generationPromptConfigs={workspace.generationPromptConfigs}
            activeComponent={activeComponent}
            editSession={editSession ?? undefined}
            editPrompt={editPrompt}
            editModelId={editModelId}
            markerMode={markerMode}
            editBusy={editBusy}
            editProgress={editProgress}
            editError={editError}
            codeEntityReveal={codeEntityReveal}
            activeTab={contextTab}
            onTab={setContextTab}
            onSelectDiagram={selectDiagram}
            onSelectComponent={selectComponent}
            onRenameDiagram={rename}
            onArchiveDiagram={archive}
            onArchiveComponent={archiveComponent}
            onEditPrompt={setEditPrompt}
            onEditModel={setEditModelId}
            onMarkerMode={setMarkerMode}
            onUndoEdit={() => void runEditAction(undoEdit)}
            onRedoEdit={() => void runEditAction(redoEdit)}
            onLlmEdit={() => void runLlmEdit()}
            onFinishEdit={() => void saveEdit()}
            onDiscardEdit={() => void leaveEdit()}
          />}
        />
      ) : activeDiagram ? (
        <SplitPane
          left={<DiagramView
            active={editSession ? { ...activeDiagram, ascii: editSession.workingAscii } : activeDiagram}
            artifactKind="diagram"
            onDerive={() => derive(activeDiagram)}
            onCapture={capture}
            editMode={Boolean(editSession)}
            markerMode={markerMode}
            editBusy={editBusy}
            codeEntities={entitySet.entities}
            codeEntityMap={selectedCodeEntityMap}
            mappingBusy={mappingBusy}
            mappingProgress={mappingProgress}
            mappingError={mappingError}
            onToggleEdit={() => void (editSession ? leaveEdit() : startEdit())}
            onMapCodeEntities={() => void generateCodeEntityMap()}
            onRevealCodeEntity={revealCodeEntity}
            onManualEdit={queueManualEdit}
            onMarker={(line, column) => void markLocation(line, column)}
            onUndoEdit={() => void runEditAction(undoEdit)}
            onRedoEdit={() => void runEditAction(redoEdit)}
          />}
          right={<DiagramContextPanel
            setId={activeSet.id}
            codeEntities={entitySet}
            diagramSet={activeSet}
            diagrams={diagrams}
            components={components}
            generationBatches={workspace.generationBatches}
            generationPromptConfigs={workspace.generationPromptConfigs}
            activeDiagram={activeDiagram}
            editSession={editSession ?? undefined}
            editPrompt={editPrompt}
            editModelId={editModelId}
            markerMode={markerMode}
            editBusy={editBusy}
            editProgress={editProgress}
            editError={editError}
            codeEntityReveal={codeEntityReveal}
            activeTab={contextTab}
            onTab={setContextTab}
            onSelectDiagram={selectDiagram}
            onSelectComponent={selectComponent}
            onRenameDiagram={rename}
            onArchiveDiagram={archive}
            onArchiveComponent={archiveComponent}
            onEditPrompt={setEditPrompt}
            onEditModel={setEditModelId}
            onMarkerMode={setMarkerMode}
            onUndoEdit={() => void runEditAction(undoEdit)}
            onRedoEdit={() => void runEditAction(redoEdit)}
            onLlmEdit={() => void runLlmEdit()}
            onFinishEdit={() => void saveEdit()}
            onDiscardEdit={() => void leaveEdit()}
          />}
        />
      ) : null}
      {importOpen ? (
        <ImportArtifactDialog
          onClose={() => setImportOpen(false)}
          onImport={importArtifact}
        />
      ) : null}
      {promptSettingsOpen ? (
        <SystemPromptSettingsDialog
          generationTemplates={promptProfiles}
          codeEntityTemplates={codeEntityPromptProfiles}
          initialGenerationTemplateId={promptProfileId}
          onClose={() => setPromptSettingsOpen(false)}
          onSave={savePromptTemplate}
          onReset={(family, id) => family === "generation"
            ? restorePromptTemplate(id)
            : restoreCodeEntityPromptTemplate(id)}
          onDelete={(family, id) => family === "generation"
            ? removePromptTemplate(id)
            : removeCodeEntityPromptTemplate(id)}
        />
      ) : null}
    </main>
  );
}
