import { useCallback, useEffect, useMemo, useState } from "react";
import { archiveDiagram, fetchWorkspace, finalizeCodeEntities, generateDiagrams, renameDiagram } from "./api";
import { CodeEntitiesPanel } from "./components/CodeEntitiesPanel";
import { DiagramContextPanel } from "./components/DiagramContextPanel";
import { DiagramView } from "./components/DiagramView";
import { GeneratorOptions } from "./components/GeneratorOptions";
import { SplitPane } from "./components/SplitPane";
import { isDiagramArchived, type DiagramRecord, type WorkspaceSnapshot } from "./domain";

type Screen = "diagram" | "generation";

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [activeDiagramId, setActiveDiagramId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("generation");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(3);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  const activeDiagram = diagrams.find((diagram) => diagram.id === activeDiagramId)
    ?? diagrams.at(-1)
    ?? null;
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
    setProgress("");
    setError(null);
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
    const before = new Set(activeSet.diagramIds);
    try {
      const next = await generateDiagrams(activeSet.id, {
        prompt,
        selectedCodeEntityIds: [...selectedIds],
        count
      }, setProgress);
      setWorkspace(next);
      const nextSet = next.diagramSets.find((set) => set.id === activeSet.id);
      const created = nextSet?.diagramIds.filter((id) => !before.has(id)) ?? [];
      setActiveDiagramId(created[0] ?? nextSet?.diagramIds.at(-1) ?? null);
      setScreen("diagram");
      setProgress(`generated ${created.length} diagrams with ${count} parallel agents`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "generation failed");
    } finally {
      setBusy(false);
    }
  };

  const derive = (diagram: DiagramRecord) => {
    setPrompt(`@diagram/${diagram.handle} `);
    setSelectedIds(new Set(diagram.codeEntityIds));
    setScreen("generation");
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
    if (nextActiveIds.length === 0) setScreen("generation");
  };

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
          <button type="button" className={screen === "diagram" ? "is-active" : ""} disabled={diagrams.length === 0} onClick={() => setScreen("diagram")}>DIAGRAM</button>
          <button type="button" className={screen === "generation" ? "is-active" : ""} onClick={() => setScreen("generation")}>GENERATE</button>
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
            prompt={prompt}
            count={count}
            generating={busy}
            progress={progress}
            error={error}
            onPrompt={setPrompt}
            onCount={setCount}
            onFinalize={() => void finalize()}
            onGenerate={() => void generate()}
          />}
          right={<CodeEntitiesPanel
            setId={activeSet.id}
            codeEntities={entitySet}
            selectedIds={selectedIds}
            onToggle={(id) => setSelectedIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
          />}
        />
      ) : activeDiagram ? (
        <SplitPane
          left={<DiagramView
            active={activeDiagram}
            onDerive={derive}
          />}
          right={<DiagramContextPanel
            setId={activeSet.id}
            codeEntities={entitySet}
            diagramSet={activeSet}
            diagrams={diagrams}
            generationBatches={workspace.generationBatches}
            activeDiagram={activeDiagram}
            onSelectDiagram={setActiveDiagramId}
            onRenameDiagram={rename}
            onArchiveDiagram={archive}
          />}
        />
      ) : null}
    </main>
  );
}
