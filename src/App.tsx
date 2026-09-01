import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import {
  applyLlmEdit,
  applyManualEdit,
  addDiagramHighlight,
  addRepresentationFeedback,
  archiveDiagram,
  archiveDiagramComponent,
  archiveImportedDiagram,
  archiveImportedDiagramComponent,
  captureDiagramComponent,
  captureNestedDiagramComponent,
  createEditSession,
  deleteCodeEntityPromptTemplate,
  deleteDiagramSet,
  deleteDiagramHighlight,
  discardEdit,
  fetchCallGraphFocus,
  fetchMappedArtifactBundle,
  fetchWorkspace,
  generateArtifacts,
  finishEdit,
  importGlobalArtifact,
  mapCodeEntitiesBatch,
  placeEditMarker,
  redoEdit,
  renameDiagram,
  renameImportedDiagram,
  resetSystemPromptTemplate,
  resetCodeEntityPromptTemplate,
  saveCodeEntityPromptTemplate,
  saveDiagramCandidateRankings,
  saveSystemPromptTemplate,
  setStarredDiagram,
  deleteSystemPromptTemplate,
  undoEdit
} from "./api";
import { CallGraphFocusTree } from "./call-graph-tree/CallGraphFocusTree";
import type { CallGraphFocusRequest, CallGraphFocusResult } from "./callGraphFocus";
import { DiagramContextPanel, type ContextTab } from "./components/DiagramContextPanel";
import { DiagramSetTreePanel } from "./components/DiagramSetTreePanel";
import type { CodeEntityReveal } from "./components/CodeEntitiesPanel";
import { DIAGRAM_VIEW_OPTIONS, DiagramView, EmptyDiagramView } from "./components/DiagramView";
import { FileExplorerPanel } from "./components/FileExplorerPanel";
import { ExperimentViewerPage } from "./components/ExperimentViewerPage";
import { GeneratorOptions } from "./components/GeneratorOptions";
import { HighlightsTreePanel } from "./components/HighlightsTreePanel";
import { MarkdownSectionsPanel } from "./components/MarkdownSectionsPanel";
import { ImportArtifactDialog } from "./components/ImportArtifactDialog";
import { PaneApi } from "./panes/api";
import {
  PaneNavigationApi
} from "./panes/navigation";
import { PaneWorkspace, type PaneTabView } from "./panes/PaneWorkspace";
import {
  addPane,
  closePaneTab,
  createPaneLayout,
  findPaneSplit,
  parsePaneLayout,
  removePane,
  setPaneTabs,
  type PaneLayoutState,
  type PaneTab
} from "./panes/model";
import { useRefBuffer } from "./ref-buffer/RefBufferContext";
import type { ReferenceResolutionContext } from "./referenceResolver";
import {
  buildDerivativePrompt,
  diagramReferencesInPrompt,
  promptCorrection,
  rebaseDerivativePrompt,
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
  outputKindForTarget,
  type ArtifactImportInput,
  type AgentRunStatus,
  type CodeEntityMappingTarget,
  type CodeEntityPromptTemplateRecord,
  type DiagramComponentRecord,
  type DiagramElementMapping,
  type DiagramRecord,
  type DiagramViewKind,
  type DiagramSelectionBounds,
  type DiagramModelId,
  type GenerationOutputKind,
  type GenerationTargetKind,
  type GenerationPromptProfileId,
  type PromptReference,
  type SystemPromptTemplateRecord,
  type WorkspaceSnapshot
} from "./domain";
import { isHighlightRecordV2, type PersistedHighlightRecord } from "./highlights";
import type { RepresentationFeedbackTarget } from "./representationGraph";
import { defaultGenerationInstruction, type PromptOption } from "./prompt";
import type { DomainProfile } from "./domainProfile";
import {
  profileSupportsCommand,
  representationKindForArtifact,
  resolveDomainProfile
} from "./domainProfiles";
import type {
  TerminalMarkdownOutline,
  TerminalMarkdownSection
} from "./terminalMarkdown/toc";

type Screen = "diagram" | "diagram-component" | "generation";

type SourceLocationJumpPayload = {
  type: "code-entity";
  entityId: string;
  sourceRangeIndex: number;
  path?: string;
  line?: number;
} | {
  type: "markdown-section";
  path: string;
  line: number;
  startLine: number;
  endLine: number;
};

interface MappingJobState {
  status: AgentRunStatus;
  progress: string;
  error?: string;
}

function mappingJobKey(setId: string, target: CodeEntityMappingTarget): string {
  return `${setId}:${target.artifactKind}:${target.artifactId}`;
}

function mergeMappingWorkspace(
  current: WorkspaceSnapshot | null,
  incoming: WorkspaceSnapshot,
  setId: string
): WorkspaceSnapshot {
  if (!current) return incoming;
  const incomingSet = incoming.diagramSets.find((set) => set.id === setId);
  return {
    ...current,
    diagramSets: current.diagramSets.map((set) => set.id === setId && incomingSet
      ? {
          ...set,
          agentRunIds: [...new Set([...set.agentRunIds, ...incomingSet.agentRunIds])],
          updatedAt: set.updatedAt > incomingSet.updatedAt ? set.updatedAt : incomingSet.updatedAt
        }
      : set),
    agentRuns: { ...current.agentRuns, ...incoming.agentRuns },
    spatialProgress: { ...current.spatialProgress, ...incoming.spatialProgress },
    codeEntityMaps: { ...current.codeEntityMaps, ...incoming.codeEntityMaps }
  };
}

const PRIMARY_PANE_ID = "primary";
const CONTEXT_PANE_ID = "context";
const FILES_PANE_ID = "files";
const ROOT_SPLIT_ID = "studio-root";
const FILES_SPLIT_ID = "studio-files";
const LEGACY_CALL_GRAPH_FOCUS_PANE_PREFIX = "call-graph-focus-pane-";
const CALL_GRAPH_FOCUS_VIEW_PREFIX = "call-graph-focus-view-";
const PANE_LAYOUT_STORAGE_KEY = "new-diagram:pane-layout";
const LEGACY_SPLIT_STORAGE_KEY = "new-diagram:split-percent";
const PANE_PROFILE_STORAGE_KEY = "new-diagram:pane-domain-profile";
const STUDIO_PANE_MINIMUM_SIZES = {
  [FILES_PANE_ID]: { width: 220 },
  [PRIMARY_PANE_ID]: { width: 480 },
  [CONTEXT_PANE_ID]: { width: 320 }
};

function withoutTransientCallGraphFocus(state: PaneLayoutState): PaneLayoutState {
  let next = Object.keys(state.panes)
    .filter((paneId) => paneId.startsWith(LEGACY_CALL_GRAPH_FOCUS_PANE_PREFIX))
    .reduce((current, paneId) => removePane(current, paneId), state);
  const transientTabs = Object.values(next.panes).flatMap((pane) => pane.tabs
    .filter((tab) => tab.id.startsWith(CALL_GRAPH_FOCUS_VIEW_PREFIX))
    .map((tab) => ({ paneId: pane.id, tabId: tab.id })));
  for (const { paneId, tabId } of transientTabs) {
    next = closePaneTab(next, paneId, tabId);
  }
  return next;
}

function explorerPaneTabs(profile: DomainProfile): PaneTab[] {
  return profile.workspace.explorerTabs.map((tab) => ({ ...tab }));
}

export function createStudioPaneState(
  profile: DomainProfile,
  restored: PaneLayoutState | null,
  storedPercent = Number.NaN
): PaneLayoutState {
  if (restored?.panes[PRIMARY_PANE_ID] && restored.panes[CONTEXT_PANE_ID]) {
    let withoutTransient = withoutTransientCallGraphFocus(restored);
    if (withoutTransient.panes[FILES_PANE_ID]) {
      const activeExplorerTab = withoutTransient.panes[FILES_PANE_ID].activeTabId;
      return setPaneTabs(
        withoutTransient,
        FILES_PANE_ID,
        explorerPaneTabs(profile),
        activeExplorerTab
      );
    }
    const contextTabs = withoutTransient.panes[CONTEXT_PANE_ID].tabs.filter((tab) => tab.id !== "files");
    const withoutLegacyFilesTab = setPaneTabs(
      withoutTransient,
      CONTEXT_PANE_ID,
      contextTabs,
      withoutTransient.panes[CONTEXT_PANE_ID].activeTabId === "files"
        ? "code-entities"
        : withoutTransient.panes[CONTEXT_PANE_ID].activeTabId
    );
    return addPane(withoutLegacyFilesTab, {
      id: FILES_PANE_ID,
      ariaLabel: "Diagram navigation",
      tabListClassName: "file-pane-tabs",
      tabs: explorerPaneTabs(profile)
    }, PRIMARY_PANE_ID, { placement: "left", ratio: 0.32, splitId: FILES_SPLIT_ID });
  }
  const ratio = Number.isFinite(storedPercent) && storedPercent > 0
    ? storedPercent / 100
    : 0.62;
  const primary = createPaneLayout({
    id: PRIMARY_PANE_ID,
    ariaLabel: "Primary workspace",
    tabListClassName: "diagram-view-tabs",
    tabs: [{ id: "generate", label: "Generate" }]
  });
  const withContext = addPane(primary, {
    id: CONTEXT_PANE_ID,
    ariaLabel: "Diagram context",
    tabListClassName: "context-tabs",
    tabs: [
      { id: "code-entities", label: "Code Entities", domId: "code-entities-tab" },
      { id: "diagrams", label: "Diagrams", domId: "diagrams-tab" }
    ]
  }, PRIMARY_PANE_ID, { placement: "right", ratio, splitId: ROOT_SPLIT_ID });
  return addPane(withContext, {
    id: FILES_PANE_ID,
    ariaLabel: "Diagram navigation",
    tabListClassName: "file-pane-tabs",
    tabs: explorerPaneTabs(profile)
  }, PRIMARY_PANE_ID, { placement: "left", ratio: 0.32, splitId: FILES_SPLIT_ID });
}

function createStudioPaneApi(profile: DomainProfile): PaneApi {
  const restored = parsePaneLayout(window.localStorage.getItem(PANE_LAYOUT_STORAGE_KEY));
  const storedPercent = Number(window.localStorage.getItem(LEGACY_SPLIT_STORAGE_KEY));
  return new PaneApi(createStudioPaneState(profile, restored, storedPercent));
}

function pageFromPath(): "studio" | "experiments" {
  return window.location.pathname.startsWith("/experiments") ? "experiments" : "studio";
}

export function App() {
  const [page, setPage] = useState(pageFromPath);
  useEffect(() => {
    const onPopState = () => setPage(pageFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (next: "studio" | "experiments") => {
    window.history.pushState({}, "", next === "experiments" ? "/experiments" : "/");
    setPage(next);
  };
  return page === "experiments"
    ? <ExperimentViewerPage onStudio={() => navigate("studio")} />
    : <StudioPage onExperiments={() => navigate("experiments")} />;
}

function StudioPage(props: { onExperiments: () => void }) {
  const refBuffer = useRefBuffer();
  const [paneApi] = useState(() => createStudioPaneApi(resolveDomainProfile(
    window.localStorage.getItem(PANE_PROFILE_STORAGE_KEY)
  )));
  const [paneNavigation] = useState(() => new PaneNavigationApi(paneApi));
  const jumpHistory = useSyncExternalStore(paneNavigation.subscribe, paneNavigation.getHistory);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [activeDiagramId, setActiveDiagramId] = useState<string | null>(null);
  const [activeComponentId, setActiveComponentId] = useState<string | null>(null);
  const [activeViewKind, setActiveViewKind] = useState<DiagramViewKind>("diagram");
  const [screen, setScreen] = useState<Screen>("generation");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [referencePrompt, setReferencePrompt] = useState("");
  const [count, setCount] = useState(DEFAULT_GENERATION_COUNT);
  const [targetKind, setTargetKind] = useState<GenerationTargetKind>("diagram");
  const [generationModelId, setGenerationModelId] = useState<DiagramModelId>(DEFAULT_DIAGRAM_MODEL_ID);
  const [promptProfileId, setPromptProfileId] = useState<GenerationPromptProfileId>(
    DEFAULT_GENERATION_PROMPT_PROFILE_ID
  );
  const [historicalReferences, setHistoricalReferences] = useState<PromptReference[]>([]);
  const [derivativeDraft, setDerivativeDraft] = useState<DerivativePromptDraft | null>(null);
  const [excludedReferenceKeys, setExcludedReferenceKeys] = useState<Set<string>>(new Set());
  const [excludedReferencePromptKeys, setExcludedReferencePromptKeys] = useState<Set<string>>(new Set());
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
  const [mappingJobs, setMappingJobs] = useState<Record<string, MappingJobState>>({});
  const [starBusy, setStarBusy] = useState(false);
  const [highlightBusyMappingIds, setHighlightBusyMappingIds] = useState<Set<string>>(new Set());
  const [representationFeedbackBusy, setRepresentationFeedbackBusy] = useState(false);
  const [callGraphFocusViews, setCallGraphFocusViews] = useState<Record<string, CallGraphFocusResult>>({});
  const [codeEntityReveal, setCodeEntityReveal] = useState<CodeEntityReveal | undefined>();
  const [markdownOutline, setMarkdownOutline] = useState<(TerminalMarkdownOutline & { path: string }) | null>(null);
  const [activeMarkdownSection, setActiveMarkdownSection] = useState<{ path: string; id: string } | null>(null);
  const requestedDiagramIdRef = useRef<string | null>(null);
  const revealRequestId = useRef(0);
  const editQueue = useRef<Promise<void>>(Promise.resolve());
  const editShortcutHandlers = useRef({ undo: () => {}, redo: () => {} });
  const domainProfile = resolveDomainProfile(workspace?.project?.domainProfileId);

  useEffect(() => paneNavigation.registerHandler("source-location", (destination) => {
    const payload = destination.payload as SourceLocationJumpPayload;
    revealRequestId.current += 1;
    setContextTab("code-entities");
    setCodeEntityReveal(payload.type === "code-entity" ? {
      entityId: payload.entityId,
      sourceRangeIndex: payload.sourceRangeIndex,
      requestId: revealRequestId.current
    } : {
      path: payload.path,
      targetLine: payload.line,
      highlightRange: { startLine: payload.startLine, endLine: payload.endLine },
      requestId: revealRequestId.current
    });
  }), [paneNavigation]);

  const handleMarkdownOutlineChange = useCallback((outline: (TerminalMarkdownOutline & { path: string }) | null) => {
    setMarkdownOutline(outline);
    if (!outline) setActiveMarkdownSection(null);
  }, []);

  const handleMarkdownActiveSectionChange = useCallback((section: {
    path: string;
    id: string;
    line: number;
    scrollTop: number;
  }) => {
    setActiveMarkdownSection((current) => current?.path === section.path && current.id === section.id
      ? current
      : { path: section.path, id: section.id });
  }, []);

  useEffect(() => paneApi.subscribe(() => {
    const paneState = paneApi.getState();
    window.localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify(withoutTransientCallGraphFocus(paneState))
    );
    const rootSplit = findPaneSplit(paneState.root, ROOT_SPLIT_ID);
    if (rootSplit) {
      window.localStorage.setItem(LEGACY_SPLIT_STORAGE_KEY, (rootSplit.ratio * 100).toFixed(2));
    }
  }), [paneApi]);

  useEffect(() => paneApi.subscribe(() => {
    const liveTabIds = new Set(
      Object.values(paneApi.getState().panes).flatMap((pane) => pane.tabs.map((tab) => tab.id))
    );
    setCallGraphFocusViews((current) => {
      const remaining = Object.entries(current).filter(([viewId]) => liveTabIds.has(viewId));
      return remaining.length === Object.keys(current).length
        ? current
        : Object.fromEntries(remaining);
    });
  }), [paneApi]);

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
  const activeRepresentationGraph = activeSet
    ? workspace?.representationGraphs?.[activeSet.id]
    : undefined;
  const entitySet = activeSet && workspace
    ? workspace.codeEntitySets[activeSet.codeEntitiesSetId]
    : null;
  useEffect(() => {
    setMarkdownOutline(null);
    setActiveMarkdownSection(null);
  }, [activeSet?.id]);
  const resolutionEntities = useMemo(() => [
    ...(entitySet?.entities ?? []),
    ...Object.values(workspace?.importedCodeEntities ?? {})
  ], [entitySet?.entities, workspace?.importedCodeEntities]);
  const referenceResolutionContext = useMemo<ReferenceResolutionContext>(() => ({
    codeEntities: resolutionEntities,
    diagrams: workspace?.diagrams ?? {},
    components: workspace?.diagramComponents ?? {}
  }), [resolutionEntities, workspace?.diagramComponents, workspace?.diagrams]);
  useEffect(() => {
    refBuffer.setScope(workspace?.project && activeSet
      ? `${workspace.project.id}:${activeSet.id}`
      : null);
  }, [activeSet, refBuffer.setScope, workspace?.project]);
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
  const promptTemplateReferenceOptions = useMemo<PromptOption[]>(() => workspace ? [
    ...workspace.globalImports.diagramIds.flatMap((id) => {
      const diagram = workspace.diagrams[id];
      return diagram && !isDiagramArchived(diagram) ? [{
        kind: "diagram" as const,
        id: diagram.id,
        handle: diagram.handle,
        label: diagram.name,
        token: `@diagram/${diagram.handle}`,
        ...(diagram.recordOrigin ? { origin: diagram.recordOrigin } : {})
      }] : [];
    }),
    ...workspace.globalImports.diagramComponentIds.flatMap((id) => {
      const component = workspace.diagramComponents[id];
      return component && !isDiagramComponentArchived(component) ? [{
        kind: "diagram-component" as const,
        id: component.id,
        handle: component.handle,
        label: component.name,
        token: `@component/${component.handle}`,
        ...(component.recordOrigin ? { origin: component.recordOrigin } : {})
      }] : [];
    })
  ] : [], [workspace]);
  const foundationDiagram = activeSet?.featuredViewIds.diagram
    ? diagrams.find((diagram) => diagram.id === activeSet.featuredViewIds.diagram)
    : undefined;
  const companionCallGraph = activeSet?.featuredViewIds["call-graph"]
    ? diagrams.find((diagram) => diagram.id === activeSet.featuredViewIds["call-graph"])
    : undefined;
  const immutableCodeEntities = useMemo(() => {
    if (!foundationDiagram || !entitySet) return [];
    const byId = new Map(resolutionEntities.map((entity) => [entity.id, entity]));
    const ids = targetKind === "dir-view"
      ? [...new Set([...foundationDiagram.codeEntityIds, ...(companionCallGraph?.codeEntityIds ?? [])])]
      : foundationDiagram.codeEntityIds;
    return ids
      .map((id) => byId.get(id))
      .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity));
  }, [companionCallGraph, entitySet, foundationDiagram, resolutionEntities, targetKind]);
  const foundationRepositoryPaths = useMemo(() => [...new Set(
    immutableCodeEntities.flatMap((entity) => entity.sourceRanges.map((range) => range.path))
  )].sort(), [immutableCodeEntities]);
  const promptDiagramReferences = useMemo(() => diagramReferencesInPrompt({
    prompt,
    diagrams: workspace?.diagrams ?? {},
    historicalReferences
  }), [historicalReferences, prompt, workspace?.diagrams]);
  const referencePromptDiagramReferences = useMemo(() => diagramReferencesInPrompt({
    prompt: referencePrompt,
    diagrams: workspace?.diagrams ?? {},
    historicalReferences
  }), [historicalReferences, referencePrompt, workspace?.diagrams]);
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
    defaults: GenerationPageDraft,
    transformPrompt: (value: string) => string = (value) => value
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
    setPrompt(transformPrompt(stored?.prompt
      ?? readLegacyGenerationPromptDraft(window.localStorage, legacyPromptKey)
      ?? defaults.prompt));
    setReferencePrompt(stored?.referencePrompt ?? defaults.referencePrompt);
    setSelectedIds(new Set(selectedCodeEntityIds));
    setExcludedReferenceKeys(new Set(stored?.excludedReferenceKeys ?? defaults.excludedReferenceKeys));
    setExcludedReferencePromptKeys(new Set(
      stored?.excludedReferencePromptKeys ?? defaults.excludedReferencePromptKeys
    ));
    setCount(stored?.count ?? defaults.count);
    setTargetKind(stored?.targetKind ?? defaults.targetKind);
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
  const activeDiagram = diagrams.find((diagram) => diagram.id === activeDiagramId) ?? null;
  const viewCounts = useMemo(() => ({
    diagram: diagrams.filter((diagram) => diagram.viewKind === "diagram").length,
    "call-graph": diagrams.filter((diagram) => diagram.viewKind === "call-graph").length,
    "dir-view": diagrams.filter((diagram) => diagram.viewKind === "dir-view").length
  }), [diagrams]);
  const availableDiagramViewOptions = useMemo(
    () => DIAGRAM_VIEW_OPTIONS.filter(({ kind }) => domainProfile.workspace.diagramViews.includes(kind)),
    [domainProfile]
  );
  const availableGenerationTargets = useMemo<readonly GenerationTargetKind[]>(
    () => [...domainProfile.workspace.diagramViews, "diagram-component"],
    [domainProfile]
  );
  useEffect(() => {
    if (!availableGenerationTargets.includes(targetKind)) setTargetKind("diagram");
  }, [availableGenerationTargets, targetKind]);
  const featuredViewKinds = new Set<DiagramViewKind>(
    (Object.keys(activeSet?.featuredViewIds ?? {}) as DiagramViewKind[]).filter(
      (kind) => Boolean(activeSet?.featuredViewIds[kind])
    )
  );
  const activeComponent = components.find((component) => component.id === activeComponentId) ?? null;
  const selectedArtifact = screen === "diagram-component" ? activeComponent : activeDiagram;
  const selectedRepresentationKind = selectedArtifact
    ? representationKindForArtifact(selectedArtifact)
    : "diagram";
  const selectedArtifactKind: GenerationOutputKind = screen === "diagram-component"
    ? "diagram-component"
    : "diagram";
  const selectedCodeEntityMap = selectedArtifact && workspace && activeSet
    ? workspace.codeEntityMaps[`${activeSet.id}:${selectedArtifact.id}`]
      ?? workspace.codeEntityMaps[selectedArtifact.id]
    : undefined;
  const selectedSpatialProgress = useMemo(() => selectedArtifact
    ? Object.values(workspace?.spatialProgress ?? {}).filter(
        (state) => state.scope.revision.artifactId === selectedArtifact.id
      )
    : [], [selectedArtifact, workspace?.spatialProgress]);
  const selectedMappingTarget: CodeEntityMappingTarget | undefined = selectedArtifact
    ? { artifactKind: selectedArtifactKind, artifactId: selectedArtifact.id }
    : undefined;
  const selectedHighlightedMappingIds = useMemo(() => new Set(
    (workspace?.highlights ?? [])
      .filter((highlight) => highlight.diagramSetId === activeSet?.id
        && highlight.artifactId === selectedArtifact?.id)
      .map((highlight) => highlight.mappingId)
      .filter((mappingId): mappingId is string => Boolean(mappingId))
  ), [activeSet?.id, selectedArtifact?.id, workspace?.highlights]);
  const selectedMappingJob = selectedMappingTarget && activeSet
    ? mappingJobs[mappingJobKey(activeSet.id, selectedMappingTarget)]
    : undefined;
  const selectedMappingBusy = selectedMappingJob
    ? !["complete", "failed", "interrupted"].includes(selectedMappingJob.status)
    : false;
  const selectedCandidateBatch = activeDiagram && workspace
    ? Object.values(workspace.diagramCandidateBatches).find(
        (batch) => batch.diagramIds.includes(activeDiagram.id)
      )
    : undefined;
  const unmappedCandidateTargets = activeSet && workspace && selectedCandidateBatch
    ? selectedCandidateBatch.diagramIds.flatMap((diagramId): CodeEntityMappingTarget[] => {
        const diagram = workspace.diagrams[diagramId];
        if (!diagram || isDiagramArchived(diagram)) return [];
        const target = { artifactKind: "diagram" as const, artifactId: diagramId };
        const job = mappingJobs[mappingJobKey(activeSet.id, target)];
        const running = job && !["complete", "failed", "interrupted"].includes(job.status);
        const mapped = workspace.codeEntityMaps[`${activeSet.id}:${diagramId}`]
          ?? workspace.codeEntityMaps[diagramId];
        return running || mapped ? [] : [target];
      })
    : [];
  const activeEditSession = activeEditSessionId && workspace
    ? workspace.editSessions[activeEditSessionId] ?? null
    : null;
  const editSession = activeEditSession?.status === "active"
    && activeEditSession.sourceArtifactId === selectedArtifact?.id
    ? activeEditSession
    : null;

  useLayoutEffect(() => {
    const primaryTabs: PaneTab[] = screen === "generation"
      ? [{ id: "generate", label: "Generate" }]
      : screen === "diagram-component"
        ? [{ id: "component", label: "Component" }]
        : availableDiagramViewOptions.map(({ kind, label }) => ({
          id: kind,
          label,
          badge: featuredViewKinds.has(kind) ? "★" : viewCounts[kind]
        }));
    const baseContextTabs: PaneTab[] = [
      { id: "code-entities", label: "Code Entities", domId: "code-entities-tab" },
      { id: "diagrams", label: "Diagrams", domId: "diagrams-tab" },
      ...(activeRepresentationGraph ? [{
        id: "layers",
        label: "Layers",
        domId: "layers-tab"
      }] : []),
      ...(editSession ? [{
        id: "operations",
        label: "Operations · ",
        badge: editSession.operationCursor,
        domId: "operations-tab"
      }] : [])
    ];
    const focusTabs: PaneTab[] = Object.entries(callGraphFocusViews).map(([viewId, result]) => ({
      id: viewId,
      label: `Focus · ${result.callGraphName}`,
      closable: true
    }));
    const availableContextTabs = new Map(
      [...baseContextTabs, ...focusTabs].map((tab) => [tab.id, tab])
    );
    const currentContextPane = paneApi.getState().panes[CONTEXT_PANE_ID];
    const contextTabs = (currentContextPane?.tabs ?? [])
      .map((tab) => availableContextTabs.get(tab.id))
      .filter((tab): tab is PaneTab => Boolean(tab));
    for (const tab of availableContextTabs.values()) {
      if (!contextTabs.some((candidate) => candidate.id === tab.id)) contextTabs.push(tab);
    }
    const currentContextTabId = currentContextPane?.activeTabId;
    const desiredContextTabId = currentContextTabId?.startsWith(CALL_GRAPH_FOCUS_VIEW_PREFIX)
      && contextTabs.some((tab) => tab.id === currentContextTabId)
      ? currentContextTabId
      : contextTab;
    paneApi.setTabs(PRIMARY_PANE_ID, primaryTabs, screen === "generation"
      ? "generate"
      : screen === "diagram-component" ? "component" : activeViewKind);
    if (workspace?.project) {
      window.localStorage.setItem(PANE_PROFILE_STORAGE_KEY, domainProfile.id);
      const currentFilesTabId = paneApi.getState().panes[FILES_PANE_ID]?.activeTabId;
      paneApi.setTabs(
        FILES_PANE_ID,
        explorerPaneTabs(domainProfile),
        currentFilesTabId
      );
    }
    paneApi.setTabs(CONTEXT_PANE_ID, contextTabs, desiredContextTabId);
  }, [
    activeViewKind,
    activeRepresentationGraph,
    callGraphFocusViews,
    contextTab,
    editSession,
    featuredViewKinds,
    domainProfile,
    availableDiagramViewOptions,
    paneApi,
    screen,
    viewCounts,
    workspace?.project
  ]);
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
          version: 4,
          prompt: "",
          referencePrompt: "",
          selectedCodeEntityIds: entitySet.entities.map((entity) => entity.id),
          excludedReferenceKeys: [],
          excludedReferencePromptKeys: [],
          count: DEFAULT_GENERATION_COUNT,
          targetKind: "diagram",
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
    setMappingJobs({});
    setCodeEntityReveal(undefined);
    const availableDiagramIds = activeSet.diagramIds.filter((id) => {
      const diagram = workspace?.diagrams[id];
      return diagram
        && domainProfile.workspace.diagramViews.includes(diagram.viewKind)
        && !isDiagramArchived(diagram);
    });
    const requestedDiagramId = requestedDiagramIdRef.current;
    const requestedDiagram = requestedDiagramId && availableDiagramIds.includes(requestedDiagramId)
      ? workspace?.diagrams[requestedDiagramId]
      : undefined;
    requestedDiagramIdRef.current = null;
    if (activeSet.readiness === "ready" && requestedDiagram && !isDiagramArchived(requestedDiagram)) {
      setActiveViewKind(requestedDiagram.viewKind);
      setActiveDiagramId(requestedDiagram.id);
      setScreen("diagram");
    } else if (activeSet.readiness === "ready" && availableDiagramIds.length > 0) {
      const preferredDiagramId = activeSet.featuredViewIds.diagram
        ?? domainProfile.workspace.diagramViews
          .map((viewKind) => activeSet.featuredViewIds[viewKind])
          .find((id) => id && availableDiagramIds.includes(id))
        ?? availableDiagramIds.at(-1)
        ?? null;
      const preferredDiagram = preferredDiagramId
        ? workspace?.diagrams[preferredDiagramId]
        : undefined;
      setActiveViewKind(preferredDiagram?.viewKind ?? "diagram");
      setActiveDiagramId(preferredDiagramId);
      setScreen("diagram");
    } else {
      setActiveDiagramId(null);
      setScreen("generation");
    }
  }, [activeSet?.id, domainProfile.id, entitySet?.id]);

  useEffect(() => {
    if (!currentGenerationDraftKey
      || restoredGenerationDraftKey !== currentGenerationDraftKey) return;
    saveGenerationPageDraft(window.localStorage, currentGenerationDraftKey, {
      version: 4,
      prompt,
      referencePrompt,
      selectedCodeEntityIds: [...selectedIds],
      excludedReferenceKeys: [...excludedReferenceKeys],
      excludedReferencePromptKeys: [...excludedReferencePromptKeys],
      count,
      targetKind,
      modelId: generationModelId,
      promptProfileId
    });
  }, [
    count,
    currentGenerationDraftKey,
    excludedReferenceKeys,
    excludedReferencePromptKeys,
    generationModelId,
    targetKind,
    prompt,
    promptProfileId,
    referencePrompt,
    restoredGenerationDraftKey,
    selectedIds
  ]);

  useEffect(() => {
    if (!activeSet
      || activeSet.readiness !== "ready"
      || activeDiagramId !== null
      || activeViewKind !== "diagram") return;
    const activeDiagramIds = activeSet.diagramIds.filter((id) => {
      const diagram = workspace?.diagrams[id];
      return diagram && diagram.viewKind === "diagram" && !isDiagramArchived(diagram);
    });
    const latestDiagramId = activeDiagramIds.at(-1);
    if (!latestDiagramId) return;
    setActiveDiagramId(activeSet.featuredViewIds.diagram ?? latestDiagramId);
    setScreen("diagram");
  }, [activeSet, activeDiagramId, activeViewKind, workspace]);

  useEffect(() => {
    const shouldPoll = workspace !== null && (
      workspace.diagramSets.length === 0
      || activeSet?.readiness === "collecting"
      || activeSet?.readiness === "failed"
      || initialGenerationPending
    );
    if (!shouldPoll) return undefined;
    const timer = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(timer);
  }, [workspace?.diagramSets.length, activeSet?.readiness, initialGenerationPending, load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return;
      if ((event.target as HTMLElement | null)?.closest(
        "textarea, input, [contenteditable='true'], [contenteditable='plaintext-only']"
      )) return;
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

  const generate = async (
    instruction = prompt,
    referenceInstruction = referencePrompt
  ) => {
    setBusy(true);
    setError(null);
    setProgress("queuing generation batch");
    const beforeDiagrams = new Set(activeSet.diagramIds);
    const beforeComponents = new Set(activeSet.diagramComponentIds);
    const outputKind = outputKindForTarget(targetKind);
    const generationDiagramReferences = diagramReferencesInPrompt({
      prompt: instruction,
      diagrams: workspace.diagrams,
      historicalReferences
    });
    const generationReferencePromptDiagramReferences = diagramReferencesInPrompt({
      prompt: referenceInstruction,
      diagrams: workspace.diagrams,
      historicalReferences
    });
    try {
      const next = await generateArtifacts(activeSet.id, {
        prompt: instruction,
        selectedCodeEntityIds: targetKind === "call-graph" || targetKind === "dir-view"
          ? immutableCodeEntities.map((entity) => entity.id)
          : [...selectedIds],
        count,
        outputKind,
        ...(outputKind === "diagram" ? { viewKind: targetKind as DiagramViewKind } : {}),
        modelId: generationModelId,
        promptProfileId,
        referenceSelections: generationDiagramReferences.flatMap((reference) => (
          reference.tokens.map((token) => ({
            kind: reference.kind,
            targetId: reference.targetId,
            ...(reference.origin ? { origin: reference.origin } : {}),
            token,
            handle: reference.handle,
            included: reference.available && !excludedReferenceKeys.has(reference.key)
          }))
        )),
        ...(referenceInstruction.trim() ? {
          referencePrompt: referenceInstruction,
          referencePromptSelections: generationReferencePromptDiagramReferences.flatMap((reference) => (
            reference.tokens.map((token) => ({
              kind: reference.kind,
              targetId: reference.targetId,
              ...(reference.origin ? { origin: reference.origin } : {}),
              token,
              handle: reference.handle,
              included: reference.available && !excludedReferencePromptKeys.has(reference.key)
            }))
          ))
        } : {}),
        derivation: derivativeDraft ? {
          ...derivativeDraft.derivation,
          promptCorrection: promptCorrection(instruction, derivativeDraft)
        } : undefined
      }, setProgress);
      setWorkspace(next);
      const nextSet = next.diagramSets.find((set) => set.id === activeSet.id);
      const createdDiagrams = nextSet?.diagramIds.filter((id) => !beforeDiagrams.has(id)) ?? [];
      const createdComponents = nextSet?.diagramComponentIds
        .filter((id) => !beforeComponents.has(id)) ?? [];
      if (outputKind === "diagram") {
        setActiveDiagramId(createdDiagrams[0] ?? nextSet?.diagramIds.at(-1) ?? null);
        setActiveViewKind(targetKind as DiagramViewKind);
        setActiveComponentId(null);
        setScreen("diagram");
      } else {
        setActiveComponentId(createdComponents[0] ?? null);
        setScreen("diagram-component");
      }
      setContextTab("diagrams");
      const created = outputKind === "diagram" ? createdDiagrams.length : createdComponents.length;
      const label = targetKind === "call-graph"
        ? "call graphs"
        : targetKind === "dir-view"
          ? "directory views"
          : targetKind === "diagram-component"
            ? "components"
            : "diagrams";
      setProgress(`generated ${created} ${label} with ${count} parallel agents`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "generation failed");
    } finally {
      setBusy(false);
    }
  };

  const updateGenerationPrompt = (value: string) => {
    setPrompt(value);
  };

  const updateReferencePrompt = (value: string) => {
    setReferencePrompt(value);
  };

  const insertReferenceTokens = (tokens: string) => {
    const normalized = tokens.trim();
    if (!normalized) return;
    updateGenerationPrompt(prompt.trim()
      ? `${prompt.trimEnd()}\n\n${normalized}`
      : normalized);
    setProgress("inserted buffered references into the generation prompt");
  };

  const persistPromptTemplate = async (
    draft: Pick<
      SystemPromptTemplateRecord,
      "label" | "description" | "prompts"
    > & { id?: string }
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
        prompts: Object.fromEntries(Object.entries(draft.prompts).map(([name, template]) => [
          name,
          { template: template ?? "" }
        ]))
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
    if (diagram.viewKind === "call-graph" || diagram.viewKind === "dir-view") {
      openGenerate(diagram.viewKind);
      return;
    }
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
        version: 4,
        prompt: draft.prompt,
        referencePrompt: "",
        selectedCodeEntityIds: workspace.globalImports.diagramIds.includes(diagram.id)
          ? [...selectedIds]
          : config?.selectedCodeEntityIds ?? diagram.codeEntityIds,
        excludedReferenceKeys: [],
        excludedReferencePromptKeys: [],
        count: DEFAULT_GENERATION_COUNT,
        targetKind: config?.outputKind === "diagram-component"
          ? "diagram-component"
          : config?.viewKind ?? diagram.viewKind,
        modelId: config?.modelId ?? DEFAULT_DIAGRAM_MODEL_ID,
        promptProfileId: config?.systemPrompt.profileId ?? DEFAULT_GENERATION_PROMPT_PROFILE_ID
      },
      (value) => rebaseDerivativePrompt(value, draft)
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
        version: 4,
        prompt: draft.prompt,
        referencePrompt: "",
        selectedCodeEntityIds: workspace.globalImports.diagramComponentIds.includes(component.id)
          ? [...selectedIds]
          : config?.selectedCodeEntityIds ?? component.codeEntityIds,
        excludedReferenceKeys: [],
        excludedReferencePromptKeys: [],
        count: DEFAULT_GENERATION_COUNT,
        targetKind: config?.outputKind === "diagram" ? config.viewKind ?? "diagram" : "diagram-component",
        modelId: config?.modelId ?? DEFAULT_DIAGRAM_MODEL_ID,
        promptProfileId: config?.systemPrompt.profileId ?? DEFAULT_GENERATION_PROMPT_PROFILE_ID
      },
      (value) => rebaseDerivativePrompt(value, draft)
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

  const exportMappedArtifact = async (
    artifactKind: GenerationOutputKind,
    artifact: DiagramRecord | DiagramComponentRecord
  ) => {
    const bundle = await fetchMappedArtifactBundle(activeSet.id, artifactKind, artifact.id);
    const url = URL.createObjectURL(new Blob(
      [`${JSON.stringify(bundle, null, 2)}\n`],
      { type: "application/json" }
    ));
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${artifact.handle}.mapped-artifact.json`;
      link.click();
    } finally {
      URL.revokeObjectURL(url);
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
    const archivedViewKind = workspace.diagrams[diagramId]?.viewKind ?? activeViewKind;
    const nextActiveIds = [...(nextSet?.diagramIds ?? []), ...next.globalImports.diagramIds]
      .filter((id) => {
      const diagram = next.diagrams[id];
      return diagram && diagram.viewKind === archivedViewKind && !isDiagramArchived(diagram);
      });
    setActiveDiagramId((current) => current === diagramId
      ? nextSet?.featuredViewIds[archivedViewKind] ?? nextActiveIds.at(-1) ?? null
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

  const toggleStarred = async (diagramId: string) => {
    setStarBusy(true);
    setError(null);
    try {
      setWorkspace(await setStarredDiagram(
        activeSet.id,
        diagramId,
        activeSet.featuredViewIds[workspace.diagrams[diagramId]?.viewKind ?? "diagram"] !== diagramId
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "chosen diagram update failed");
    } finally {
      setStarBusy(false);
    }
  };

  const saveCandidateRankings = async (
    candidateBatchId: string,
    rankings: Array<{ diagramId: string; rank: number }>
  ) => {
    setWorkspace(await saveDiagramCandidateRankings(
      activeSet.id,
      candidateBatchId,
      rankings
    ));
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
    const diagram = workspace.diagrams[diagramId];
    if (diagram) setActiveViewKind(diagram.viewKind);
    setActiveDiagramId(diagramId);
    setActiveComponentId(null);
    setScreen("diagram");
  };

  const selectDiagramSet = (setId: string) => {
    requestedDiagramIdRef.current = null;
    setActiveSetId(setId);
  };

  const selectDiagramFromSet = (setId: string, diagramId: string) => {
    if (setId === activeSet.id) {
      selectDiagram(diagramId);
      return;
    }
    requestedDiagramIdRef.current = diagramId;
    setActiveSetId(setId);
  };

  const selectViewKind = (viewKind: DiagramViewKind) => {
    setActiveViewKind(viewKind);
    setActiveDiagramId(activeSet.featuredViewIds[viewKind] ?? null);
    setActiveComponentId(null);
    setScreen("diagram");
  };

  const openGenerate = (nextTargetKind: GenerationTargetKind) => {
    setTargetKind(nextTargetKind);
    if (nextTargetKind === "call-graph" || nextTargetKind === "dir-view") {
      setPrompt(defaultGenerationInstruction(nextTargetKind));
    } else if (targetKind === "call-graph" || targetKind === "dir-view") {
      setPrompt("");
    }
    setDerivativeDraft(null);
    setHistoricalReferences([]);
    setExcludedReferenceKeys(new Set());
    setScreen("generation");
  };

  const changeGenerationTarget = (nextTargetKind: GenerationTargetKind) => {
    if (nextTargetKind === targetKind) return;
    const nextAuxiliary = nextTargetKind === "call-graph" || nextTargetKind === "dir-view";
    const currentAuxiliary = targetKind === "call-graph" || targetKind === "dir-view";
    setTargetKind(nextTargetKind);
    if (nextAuxiliary) {
      setPrompt(defaultGenerationInstruction(nextTargetKind));
      setDerivativeDraft(null);
      setHistoricalReferences([]);
      setExcludedReferenceKeys(new Set());
    } else if (currentAuxiliary) {
      setPrompt("");
    }
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

  const runCodeEntityMappings = async (targets: CodeEntityMappingTarget[]) => {
    if (targets.length === 0) return;
    const setId = activeSet.id;
    setMappingJobs((current) => {
      const next = { ...current };
      for (const target of targets) {
        next[mappingJobKey(setId, target)] = {
          status: "queued",
          progress: "queuing code-entity mapping"
        };
      }
      return next;
    });
    try {
      const result = await mapCodeEntitiesBatch(
        setId,
        targets,
        (event) => setMappingJobs((current) => ({
          ...current,
          [mappingJobKey(setId, event)]: {
            status: event.status,
            progress: event.message,
            ...(event.status === "failed" ? { error: event.message } : {})
          }
        }))
      );
      setWorkspace((current) => mergeMappingWorkspace(current, result.workspace, setId));
      setMappingJobs((current) => {
        const next = { ...current };
        for (const item of result.results) {
          next[mappingJobKey(setId, item)] = item.status === "complete"
            ? {
                status: "complete",
                progress: `mapped ${item.mappingCount ?? 0} diagram elements`
              }
            : {
                status: "failed",
                progress: "",
                error: item.error ?? "code-entity mapping failed"
              };
        }
        return next;
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "code-entity mapping failed";
      setMappingJobs((current) => {
        const next = { ...current };
        for (const target of targets) {
          const key = mappingJobKey(setId, target);
          if (next[key]?.status === "complete") continue;
          next[key] = { status: "failed", progress: "", error: message };
        }
        return next;
      });
    }
  };

  const generateCodeEntityMap = async () => {
    if (!selectedMappingTarget) return;
    await runCodeEntityMappings([selectedMappingTarget]);
  };

  const openCallGraphFocus = async (request: CallGraphFocusRequest) => {
    const result = await fetchCallGraphFocus(request);
    const instanceId = crypto.randomUUID();
    const viewId = `${CALL_GRAPH_FOCUS_VIEW_PREFIX}${instanceId}`;
    const contextPane = paneApi.getState().panes[CONTEXT_PANE_ID];
    if (!contextPane) throw new Error("the Diagram context pane is unavailable");
    const activeIndex = contextPane.tabs.findIndex((tab) => tab.id === contextPane.activeTabId);
    const insertAt = activeIndex < 0 ? contextPane.tabs.length : activeIndex;
    const focusTab: PaneTab = {
      id: viewId,
      label: `Focus · ${result.callGraphName}`,
      closable: true
    };
    setCallGraphFocusViews((current) => ({ ...current, [viewId]: result }));
    try {
      paneApi.setTabs(CONTEXT_PANE_ID, [
        ...contextPane.tabs.slice(0, insertAt),
        focusTab,
        ...contextPane.tabs.slice(insertAt)
      ], viewId);
      paneApi.focusPane(CONTEXT_PANE_ID);
    } catch (caught) {
      setCallGraphFocusViews((current) => {
        const next = { ...current };
        delete next[viewId];
        return next;
      });
      throw caught;
    }
  };

  const revealCodeEntity = (
    target: Pick<DiagramElementMapping, "entityId" | "sourceRangeIndex">
  ) => {
    const entity = resolutionEntities.find((candidate) => candidate.id === target.entityId);
    const range = entity?.sourceRanges[target.sourceRangeIndex];
    paneNavigation.jump({
      key: `code-entity:${activeSet.id}:${target.entityId}:${target.sourceRangeIndex}`,
      kind: "source-location",
      paneId: CONTEXT_PANE_ID,
      tabId: "code-entities",
      label: entity?.label ?? target.entityId,
      detail: range ? `${range.path}:L${range.startLine}` : undefined,
      payload: {
        type: "code-entity",
        entityId: target.entityId,
        sourceRangeIndex: target.sourceRangeIndex,
        path: range?.path,
        line: range?.startLine
      } satisfies SourceLocationJumpPayload
    });
  };

  const jumpToMarkdownSection = (section: TerminalMarkdownSection) => {
    if (!markdownOutline) return;
    paneNavigation.jump({
      key: `markdown-section:${activeSet.id}:${markdownOutline.path}:${section.id}`,
      kind: "source-location",
      paneId: CONTEXT_PANE_ID,
      tabId: "code-entities",
      label: section.label,
      detail: `${markdownOutline.path}:L${section.startLine}`,
      payload: {
        type: "markdown-section",
        path: markdownOutline.path,
        line: section.startLine,
        startLine: section.startLine,
        endLine: section.startLine
      } satisfies SourceLocationJumpPayload
    });
  };

  const toggleHighlight = async (mapping: DiagramElementMapping) => {
    if (!selectedArtifact || !activeSet || highlightBusyMappingIds.has(mapping.id)) return;
    const existing = (workspace.highlights ?? []).find((highlight) => (
      highlight.diagramSetId === activeSet.id
      && highlight.artifactId === selectedArtifact.id
      && highlight.mappingId === mapping.id
    ));
    setHighlightBusyMappingIds((current) => new Set(current).add(mapping.id));
    setError(null);
    try {
      const next = existing
        ? await deleteDiagramHighlight(existing.id)
        : await addDiagramHighlight({
          diagramSetId: activeSet.id,
          artifactKind: selectedArtifactKind,
          artifactId: selectedArtifact.id,
          mappingId: mapping.id
        });
      setWorkspace(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "highlight update failed");
    } finally {
      setHighlightBusyMappingIds((current) => {
        const next = new Set(current);
        next.delete(mapping.id);
        return next;
      });
    }
  };

  const revealHighlight = (highlight: PersistedHighlightRecord) => {
    if (highlight.artifactKind === "diagram") selectDiagram(highlight.artifactId);
    else selectComponent(highlight.artifactId);
    const evidence = isHighlightRecordV2(highlight)
      ? highlight.evidence
      : { evidenceId: highlight.entityId, sourceRangeIndex: highlight.sourceRangeIndex };
    revealCodeEntity({
      entityId: evidence.evidenceId,
      sourceRangeIndex: evidence.sourceRangeIndex
    });
  };

  const removeHighlight = async (highlight: PersistedHighlightRecord) => {
    setError(null);
    try {
      setWorkspace(await deleteDiagramHighlight(highlight.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "highlight removal failed");
    }
  };

  const saveRepresentationFeedback = async (
    target: RepresentationFeedbackTarget,
    comment: string
  ) => {
    if (!activeSet) return;
    setRepresentationFeedbackBusy(true);
    try {
      setWorkspace(await addRepresentationFeedback(activeSet.id, { target, comment }));
    } finally {
      setRepresentationFeedbackBusy(false);
    }
  };

  editShortcutHandlers.current = editSession ? {
    undo: () => void runEditAction(undoEdit),
    redo: () => void runEditAction(redoEdit)
  } : { undo: () => {}, redo: () => {} };

  let primaryPaneContent: ReactNode;
  if (screen === "generation") {
    primaryPaneContent = <GeneratorOptions
      codeEntities={entitySet}
      diagrams={diagrams}
      components={components}
      targetKind={targetKind}
      availableTargetKinds={availableGenerationTargets}
      foundationDiagram={foundationDiagram}
      companionCallGraph={companionCallGraph}
      immutableCodeEntities={immutableCodeEntities}
      foundationRepositoryPaths={foundationRepositoryPaths}
      modelId={generationModelId}
      promptProfileId={promptProfileId}
      promptProfiles={promptProfiles}
      historicalReferences={historicalReferences}
      diagramReferences={promptDiagramReferences}
      excludedReferenceKeys={excludedReferenceKeys}
      referencePromptDiagramReferences={referencePromptDiagramReferences}
      excludedReferencePromptKeys={excludedReferencePromptKeys}
      derivativeSourceReferenceKey={derivativeDraft?.derivation.sourceArtifactKind === "diagram"
        ? `diagram:${derivativeDraft.derivation.sourceArtifactId}`
        : undefined}
      prompt={prompt}
      referencePrompt={referencePrompt}
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
      onReferencePrompt={updateReferencePrompt}
      onToggleDiagramReference={(key) => setExcludedReferenceKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      })}
      onToggleReferencePromptDiagramReference={(key) => setExcludedReferencePromptKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      })}
      onCount={setCount}
      onTargetKind={changeGenerationTarget}
      onModel={setGenerationModelId}
      onPromptProfile={setPromptProfileId}
      onGenerate={(instruction, referenceInstruction) => void generate(instruction, referenceInstruction)}
    />;
  } else if (screen === "diagram-component" && activeComponent) {
    primaryPaneContent = <DiagramView
      active={editSession ? { ...activeComponent, ascii: editSession.workingAscii } : activeComponent}
      artifactKind="diagram-component"
      representationKind={selectedRepresentationKind}
      onGenerate={() => deriveComponent(activeComponent)}
      onExport={() => exportMappedArtifact("diagram-component", activeComponent)}
      onCapture={captureNested}
      editMode={Boolean(editSession)}
      markerMode={markerMode}
      editBusy={editBusy}
      codeEntities={resolutionEntities}
      codeEntityMap={selectedCodeEntityMap}
      spatialProgress={selectedSpatialProgress}
      referenceResolutionContext={referenceResolutionContext}
      projectId={workspace.project.id}
      diagramSetId={activeSet.id}
      onInsertReferenceTokens={insertReferenceTokens}
      mappingBusy={selectedMappingBusy}
      mappingProgress={selectedMappingJob?.progress ?? ""}
      mappingError={selectedMappingJob?.error ?? null}
      onToggleEdit={() => void (editSession ? leaveEdit() : startEdit())}
      onMapCodeEntities={() => void generateCodeEntityMap()}
      onRevealCodeEntity={revealCodeEntity}
      highlightedMappingIds={selectedHighlightedMappingIds}
      highlightBusyMappingIds={highlightBusyMappingIds}
      onToggleHighlight={profileSupportsCommand(domainProfile, "toggle-highlight", selectedRepresentationKind)
        ? (mapping) => void toggleHighlight(mapping)
        : undefined}
      collapseSubtrees={profileSupportsCommand(
        domainProfile,
        "collapse-subtree",
        selectedRepresentationKind
      )}
      onManualEdit={queueManualEdit}
      onMarker={(line, column) => void markLocation(line, column)}
      onUndoEdit={() => void runEditAction(undoEdit)}
      onRedoEdit={() => void runEditAction(redoEdit)}
    />;
  } else if (activeDiagram) {
    primaryPaneContent = <DiagramView
      active={editSession ? { ...activeDiagram, ascii: editSession.workingAscii } : activeDiagram}
      artifactKind="diagram"
      representationKind={selectedRepresentationKind}
      onGenerate={() => derive(activeDiagram)}
      onExport={() => exportMappedArtifact("diagram", activeDiagram)}
      onCapture={capture}
      editMode={Boolean(editSession)}
      markerMode={markerMode}
      editBusy={editBusy}
      codeEntities={resolutionEntities}
      codeEntityMap={selectedCodeEntityMap}
      spatialProgress={selectedSpatialProgress}
      referenceResolutionContext={referenceResolutionContext}
      projectId={workspace.project.id}
      diagramSetId={activeSet.id}
      onInsertReferenceTokens={insertReferenceTokens}
      mappingBusy={selectedMappingBusy}
      mappingProgress={selectedMappingJob?.progress ?? ""}
      mappingError={selectedMappingJob?.error ?? null}
      starred={activeSet.featuredViewIds[activeDiagram.viewKind] === activeDiagram.id}
      starBusy={starBusy}
      onToggleStarred={() => void toggleStarred(activeDiagram.id)}
      onToggleEdit={() => void (editSession ? leaveEdit() : startEdit())}
      onMapCodeEntities={() => void generateCodeEntityMap()}
      onMapAllCodeEntities={() => void runCodeEntityMappings(unmappedCandidateTargets)}
      mapAllCodeEntitiesCount={unmappedCandidateTargets.length}
      onRevealCodeEntity={revealCodeEntity}
      highlightedMappingIds={selectedHighlightedMappingIds}
      highlightBusyMappingIds={highlightBusyMappingIds}
      onToggleHighlight={profileSupportsCommand(
        domainProfile,
        "toggle-highlight",
        selectedRepresentationKind
      ) ? (mapping) => void toggleHighlight(mapping) : undefined}
      collapseSubtrees={profileSupportsCommand(
        domainProfile,
        "collapse-subtree",
        selectedRepresentationKind
      )}
      onManualEdit={queueManualEdit}
      onMarker={(line, column) => void markLocation(line, column)}
      onUndoEdit={() => void runEditAction(undoEdit)}
      onRedoEdit={() => void runEditAction(redoEdit)}
      onOpenCallGraphFocus={openCallGraphFocus}
    />;
  } else {
    primaryPaneContent = <EmptyDiagramView
      viewKind={activeViewKind}
      viewCounts={viewCounts}
      onGenerate={() => openGenerate(activeViewKind)}
    />;
  }

  const contextCodeEntities = screen === "generation"
    ? entitySet
    : { ...entitySet, entities: resolutionEntities };
  const renderContextPane = (tab: ContextTab) => <DiagramContextPanel
    setId={activeSet.id}
    codeEntities={contextCodeEntities}
    contentPresentation={domainProfile.content}
    diagramSet={activeSet}
    diagrams={diagrams}
    components={components}
    allDiagrams={workspace.diagrams}
    generationBatches={workspace.generationBatches}
    diagramCandidateBatches={workspace.diagramCandidateBatches}
    generationPromptConfigs={workspace.generationPromptConfigs}
    activeDiagram={screen === "diagram" ? activeDiagram ?? undefined : undefined}
    activeComponent={screen === "diagram-component" ? activeComponent ?? undefined : undefined}
    editSession={editSession ?? undefined}
    representationGraph={activeRepresentationGraph}
    representationFeedbackBusy={representationFeedbackBusy}
    onRepresentationFeedback={saveRepresentationFeedback}
    editPrompt={editPrompt}
    editModelId={editModelId}
    markerMode={markerMode}
    editBusy={editBusy}
    editProgress={editProgress}
    editError={editError}
    codeEntityReveal={codeEntityReveal}
    onMarkdownOutlineChange={handleMarkdownOutlineChange}
    onMarkdownActiveSectionChange={handleMarkdownActiveSectionChange}
    selectedIds={screen === "generation" && targetKind !== "call-graph" && targetKind !== "dir-view"
      ? selectedIds
      : undefined}
    onToggleEntity={screen === "generation" && targetKind !== "call-graph" && targetKind !== "dir-view"
      ? toggleEntity
      : undefined}
    activeTab={tab}
    onSelectDiagram={selectDiagram}
    onSelectComponent={selectComponent}
    onRenameDiagram={rename}
    onArchiveDiagram={archive}
    onArchiveComponent={archiveComponent}
    onSaveCandidateRankings={saveCandidateRankings}
    onEditPrompt={setEditPrompt}
    onEditModel={setEditModelId}
    onMarkerMode={setMarkerMode}
    onUndoEdit={() => void runEditAction(undoEdit)}
    onRedoEdit={() => void runEditAction(redoEdit)}
    onLlmEdit={() => void runLlmEdit()}
    onFinishEdit={() => void saveEdit()}
    onDiscardEdit={() => void leaveEdit()}
  />;
  const callGraphPaneViews: Record<string, PaneTabView> = Object.fromEntries(
    Object.entries(callGraphFocusViews).map(([viewId, result]) => [
      viewId,
      { content: <CallGraphFocusTree result={result} /> }
    ])
  );
  const paneViews: Record<string, PaneTabView> = {
    generate: { content: primaryPaneContent },
    component: { content: primaryPaneContent },
    diagram: { content: primaryPaneContent, onActivate: () => selectViewKind("diagram") },
    "call-graph": { content: primaryPaneContent, onActivate: () => selectViewKind("call-graph") },
    "dir-view": { content: primaryPaneContent, onActivate: () => selectViewKind("dir-view") },
    "code-entities": { content: renderContextPane("code-entities"), onActivate: () => setContextTab("code-entities") },
    files: { content: <FileExplorerPanel
      activeSetId={activeSet.id}
      activeProjectId={activeSet.projectId}
      diagramSets={workspace.diagramSets}
      diagrams={workspace.diagrams}
      codeEntitySets={workspace.codeEntitySets}
      codeEntityMaps={workspace.codeEntityMaps}
      onRevealCodeEntity={revealCodeEntity}
    /> },
    "diagram-sets": { content: <DiagramSetTreePanel
      diagramSets={workspace.diagramSets}
      diagrams={workspace.diagrams}
      activeSetId={activeSet.id}
      activeDiagramId={activeDiagramId ?? undefined}
      onSelectSet={selectDiagramSet}
      onSelectDiagram={selectDiagramFromSet}
      onDeleteSet={removeDiagramSet}
    /> },
    "markdown-sections": { content: <MarkdownSectionsPanel
      path={markdownOutline?.path}
      title={markdownOutline?.title}
      sections={markdownOutline?.sections ?? []}
      activeSectionId={activeMarkdownSection && activeMarkdownSection.path === markdownOutline?.path
        ? activeMarkdownSection.id
        : undefined}
      jumpHistory={jumpHistory}
      onJumpSection={jumpToMarkdownSection}
      onReplayJump={(entry) => paneNavigation.jump(entry)}
      onClearHistory={() => paneNavigation.clearHistory()}
    /> },
    highlights: { content: <HighlightsTreePanel
      highlights={workspace.highlights ?? []}
      activeSetId={activeSet.id}
      onReveal={revealHighlight}
      onRemove={(highlight) => void removeHighlight(highlight)}
    /> },
    diagrams: { content: renderContextPane("diagrams"), onActivate: () => setContextTab("diagrams") },
    operations: { content: renderContextPane("operations"), onActivate: () => setContextTab("operations") },
    ...callGraphPaneViews
  };

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand">
          <span className="brand-mark">ND</span>
          <div><h1>NEW DIAGRAM</h1><p>{workspace.project.name}</p></div>
        </div>
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
          <button type="button" onClick={props.onExperiments}>EXPERIMENTS</button>
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
      ) : (
        <PaneWorkspace
          api={paneApi}
          views={paneViews}
          paneMinimumSizes={STUDIO_PANE_MINIMUM_SIZES}
        />
      )}
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
          referenceOptions={promptTemplateReferenceOptions}
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
