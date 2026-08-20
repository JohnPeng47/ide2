import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyLlmEdit,
  applyManualEdit,
  archiveDiagram,
  archiveDiagramComponent,
  captureDiagramComponent,
  captureNestedDiagramComponent,
  createEditSession,
  discardEdit,
  fetchWorkspace,
  finalizeCodeEntities,
  generateArtifacts,
  finishEdit,
  importProjectArtifact,
  placeEditMarker,
  redoEdit,
  renameDiagram,
  undoEdit
} from "./api";
import { DiagramContextPanel, type ContextTab } from "./components/DiagramContextPanel";
import { DiagramView } from "./components/DiagramView";
import { GeneratorOptions } from "./components/GeneratorOptions";
import { ImportArtifactDialog } from "./components/ImportArtifactDialog";
import { SplitPane } from "./components/SplitPane";
import {
  DEFAULT_EDIT_MODEL_ID,
  isDiagramComponentArchived,
  isDiagramArchived,
  type ArtifactImportInput,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSelectionBounds,
  type EditModelId,
  type GenerationOutputKind,
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
  const [count, setCount] = useState(3);
  const [outputKind, setOutputKind] = useState<GenerationOutputKind>("diagram");
  const [contextTab, setContextTab] = useState<ContextTab>("code-entities");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingImported, setPendingImported] = useState<{
    setId: string;
    artifactKind: GenerationOutputKind;
    artifactId: string;
  } | null>(null);
  const [activeEditSessionId, setActiveEditSessionId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editModelId, setEditModelId] = useState<EditModelId>(DEFAULT_EDIT_MODEL_ID);
  const [markerMode, setMarkerMode] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editProgress, setEditProgress] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
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
    ? activeSet.diagramIds
      .map((id) => workspace.diagrams[id])
      .filter((diagram): diagram is DiagramRecord => Boolean(diagram) && !isDiagramArchived(diagram))
    : [], [activeSet, workspace]);
  const components = useMemo(() => activeSet && workspace
    ? activeSet.diagramComponentIds
      .map((id) => workspace.diagramComponents[id])
      .filter((component): component is DiagramComponentRecord => (
        Boolean(component) && !isDiagramComponentArchived(component)
      ))
    : [], [activeSet, workspace]);
  const activeDiagram = diagrams.find((diagram) => diagram.id === activeDiagramId)
    ?? diagrams.at(-1)
    ?? null;
  const activeComponent = components.find((component) => component.id === activeComponentId) ?? null;
  const selectedArtifact = screen === "diagram-component" ? activeComponent : activeDiagram;
  const selectedArtifactKind: GenerationOutputKind = screen === "diagram-component"
    ? "diagram-component"
    : "diagram";
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

  useEffect(() => {
    if (!activeSet || !entitySet) return;
    setSelectedIds(new Set(entitySet.entities.map((entity) => entity.id)));
    setPrompt("");
    setCount(3);
    setOutputKind("diagram");
    setContextTab("code-entities");
    setProgress("");
    setError(null);
    setActiveComponentId(null);
    setActiveEditSessionId(null);
    setEditPrompt("");
    setMarkerMode(false);
    if (pendingImported?.setId === activeSet.id) {
      if (pendingImported.artifactKind === "diagram") {
        setActiveDiagramId(pendingImported.artifactId);
        setScreen("diagram");
      } else {
        setActiveDiagramId(null);
        setActiveComponentId(pendingImported.artifactId);
        setScreen("diagram-component");
      }
      setContextTab("diagrams");
      setPendingImported(null);
      return;
    }
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
    const shouldPoll = workspace !== null && (
      workspace.diagramSets.length === 0 || activeSet?.readiness === "collecting"
    );
    if (!shouldPoll) return undefined;
    const timer = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(timer);
  }, [workspace?.diagramSets.length, activeSet?.readiness, load]);

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
  const waiting = activeSet.readiness === "collecting" || activeSet.readiness === "failed";

  const finalize = async () => {
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await finalizeCodeEntities(activeSet.id));
      setProgress("CodeEntitiesSet finalized and immutable");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "finalization failed");
    } finally {
      setBusy(false);
    }
  };

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
        outputKind
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

  const derive = (diagram: DiagramRecord) => {
    setPrompt(`@diagram/${diagram.handle} `);
    setSelectedIds(new Set(diagram.codeEntityIds));
    setOutputKind("diagram");
    setScreen("generation");
  };

  const deriveComponent = (component: DiagramComponentRecord) => {
    setPrompt(`@component/${component.handle} `);
    setSelectedIds(new Set(component.codeEntityIds));
    setOutputKind("diagram-component");
    setScreen("generation");
  };

  const importArtifact = async (input: ArtifactImportInput) => {
    if (!workspace.project) throw new Error("Project is not available");
    const before = workspace.diagramSets.find((set) => set.id === input.diagramSetId);
    if (!before) throw new Error("Import target DiagramSet is not available");
    const next = await importProjectArtifact(workspace.project.id, input);
    const target = next.diagramSets.find((set) => set.id === input.diagramSetId);
    if (!target) throw new Error("Imported artifact target was not returned");
    const artifactId = input.artifactKind === "diagram"
      ? target.diagramIds.find((id) => !before.diagramIds.includes(id))
      : target.diagramComponentIds.find((id) => !before.diagramComponentIds.includes(id));
    if (!artifactId) throw new Error("Imported artifact was not returned");
    setWorkspace(next);
    setProgress(`imported ${input.artifactKind === "diagram" ? "Diagram" : "DiagramComponent"}`);
    setContextTab("diagrams");
    if (input.diagramSetId !== activeSet.id) {
      setPendingImported({ setId: input.diagramSetId, artifactKind: input.artifactKind, artifactId });
      setActiveSetId(input.diagramSetId);
    } else if (input.artifactKind === "diagram") {
      setActiveDiagramId(artifactId);
      setActiveComponentId(null);
      setScreen("diagram");
    } else {
      setActiveComponentId(artifactId);
      setScreen("diagram-component");
    }
  };

  const rename = async (diagramId: string, name: string) => {
    setWorkspace(await renameDiagram(activeSet.id, diagramId, name));
  };

  const archive = async (diagramId: string) => {
    const next = await archiveDiagram(activeSet.id, diagramId);
    setWorkspace(next);
    const nextSet = next.diagramSets.find((set) => set.id === activeSet.id);
    const nextActiveIds = nextSet?.diagramIds.filter((id) => {
      const diagram = next.diagrams[id];
      return diagram && !isDiagramArchived(diagram);
    }) ?? [];
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
    const next = await archiveDiagramComponent(activeSet.id, componentId);
    setWorkspace(next);
    const nextSet = next.diagramSets.find((set) => set.id === activeSet.id);
    const nextActiveIds = nextSet?.diagramComponentIds.filter((id) => {
      const component = next.diagramComponents[id];
      return component && !isDiagramComponentArchived(component);
    }) ?? [];
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
        <label className="set-picker">
          <span>DIAGRAM SET</span>
          <select value={activeSet.id} onChange={(event) => setActiveSetId(event.target.value)}>
            {workspace.diagramSets.map((set) => <option value={set.id} key={set.id}>{set.name}</option>)}
          </select>
        </label>
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
        </nav>
      </header>

      {waiting ? (
        <section className="waiting-state" aria-live="polite">
          <span className={activeSet.readiness === "failed" ? "waiting-icon is-failed" : "waiting-icon"} />
          <span className="eyebrow">{activeSet.readiness === "failed" ? "COLLECTION FAILED" : "COLLECTING CODE ENTITIES"}</span>
          <h2>{activeSet.name}</h2>
          <p>{activeSet.error || collectionRun?.statusMessage || "Opening the code-entity collector."}</p>
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
            prompt={prompt}
            count={count}
            generating={busy}
            progress={progress}
            error={error}
            onPrompt={setPrompt}
            onCount={setCount}
            onOutputKind={setOutputKind}
            onFinalize={() => void finalize()}
            onGenerate={() => void generate()}
          />}
          right={<DiagramContextPanel
            setId={activeSet.id}
            codeEntities={entitySet}
            diagramSet={activeSet}
            diagrams={diagrams}
            components={components}
            generationBatches={workspace.generationBatches}
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
            onToggleEdit={() => void (editSession ? leaveEdit() : startEdit())}
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
            activeComponent={activeComponent}
            editSession={editSession ?? undefined}
            editPrompt={editPrompt}
            editModelId={editModelId}
            markerMode={markerMode}
            editBusy={editBusy}
            editProgress={editProgress}
            editError={editError}
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
            onToggleEdit={() => void (editSession ? leaveEdit() : startEdit())}
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
            activeDiagram={activeDiagram}
            editSession={editSession ?? undefined}
            editPrompt={editPrompt}
            editModelId={editModelId}
            markerMode={markerMode}
            editBusy={editBusy}
            editProgress={editProgress}
            editError={editError}
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
          diagramSets={workspace.diagramSets}
          defaultDiagramSetId={activeSet.id}
          onClose={() => setImportOpen(false)}
          onImport={importArtifact}
        />
      ) : null}
    </main>
  );
}
