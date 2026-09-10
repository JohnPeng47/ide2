import extraction from "../../data/extraction.json";
import { UiTestFramework } from "@new-diagram/ui-test-framework";
import { useEffect, useState } from "react";
import { loadProjectRepresentations, type ProjectRepresentationsSnapshot } from "../api";
import { DraggableDiagramCanvas } from "./DraggableDiagramCanvas";
import { FloatingPane } from "./FloatingPane";
import { sceneFromRevision, singleDiagramScene } from "../projectDiagramCanvas";
import type { LocalChatVariant } from "../localChat";
import { mappingDocumentFromScene } from "../mappingDocument";
import type { MappingGridDocument } from "../mappingGrid";
import { saveMappingProjectDiagram } from "../mappingProjectApi";
import { MappingDiagramExplorer } from "./MappingDiagramExplorer";
import { MappingPocSelectionCanvas } from "./MappingPocSelectionCanvas";
import { MappingSubmenu } from "./MappingSubmenu";

const LOCAL_CHAT_UI_CONTROLS = {
  variant: {
    type: "select",
    label: "Local chat UI",
    description: "Compare the compact popover, floating window, and docked panel.",
    defaultValue: "compact",
    options: [
      { value: "compact", label: "Compact popover" },
      { value: "floating", label: "Floating window" },
      { value: "docked", label: "Docked panel" }
    ]
  },

} as const;

interface Draft {
  name: string;
  document: MappingGridDocument;
  savedScene: string;
  savedName: string;
  revisionId: string;
  busy: boolean;
  focusBox?: { id: string; serial: number };
}
const dirty = (draft: Draft) => draft.name !== draft.savedName || JSON.stringify(draft.document.scene) !== draft.savedScene;

export function MappingPocPage(props: { onStudio: () => void; onExperiments: () => void;
  registerNavigationGuard?: (guard: (() => boolean) | undefined) => void }) {
  const [snapshot, setSnapshot] = useState<ProjectRepresentationsSnapshot>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [activeId, setActiveId] = useState<string>();
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("New diagram");
  const [newAscii, setNewAscii] = useState("[New diagram]");
  const [copyCurrent, setCopyCurrent] = useState(false);
  const active = activeId ? drafts[activeId] : undefined;
  const diagrams = Object.values(snapshot?.catalog?.representations ?? {}).filter((diagram) => diagram.status === "settled");

  const open = (id: string, data = snapshot, navigate = true) => {
    const representation = data?.catalog?.representations[id];
    const revision = representation && data?.catalog?.revisions[representation.currentRevisionId];
    if (!representation || representation.status !== "settled" || !revision) { setError("Project diagram was not found"); return; }
    const document = mappingDocumentFromScene(sceneFromRevision(revision), revision.evidence);
    setDrafts((current) => current[id] ? current : { ...current, [id]: { name: representation.name,
      document, savedScene: JSON.stringify(document.scene), savedName: representation.name, revisionId: revision.id, busy: false } });
    setActiveId(id);
    if (navigate) {
      const url = new URL(location.href); url.searchParams.set("diagram", id);
      history.pushState({}, "", url);
    }
    setError("");
  };

  useEffect(() => {
    let cancelled = false;
    loadProjectRepresentations().then((data) => {
      if (cancelled) return;
      setSnapshot(data);
      const id = new URL(location.href).searchParams.get("diagram")
        ?? extraction.primaryDiagramId;
      if (id) open(id, data, false);
    }).catch((error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const back = () => { const id = new URL(location.href).searchParams.get("diagram"); if (id) open(id, snapshot, false); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [snapshot]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (Object.values(drafts).some((draft) => dirty(draft) || draft.busy)) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts]);
  useEffect(() => {
    props.registerNavigationGuard?.(() => !Object.values(drafts).some((draft) => dirty(draft) || draft.busy)
      || window.confirm("Leave Mapping and discard unsaved changes and pending edits?"));
    return () => props.registerNavigationGuard?.(undefined);
  }, [drafts, activeId, props.registerNavigationGuard]);

  const save = async () => {
    if (!activeId || !active || active.busy || savingId) return;
    const id = activeId;
    const captured = active;
    setSavingId(id); setError("");
    try {
      const result = await saveMappingProjectDiagram({ projectId: snapshot?.project?.id, representationId: id,
        expectedRevisionId: captured.revisionId, name: captured.name, scene: captured.document.scene });
      setSnapshot(result);
      setDrafts((current) => ({ ...current, [id]: { ...current[id], savedName: captured.name.trim(),
        name: current[id].name === captured.name ? captured.name.trim() : current[id].name,
        savedScene: JSON.stringify(captured.document.scene), revisionId: result.representation.currentRevisionId } }));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save diagram"); }
    finally { setSavingId(undefined); }
  };
  const create = async () => {
    if (savingId || (copyCurrent && active?.busy)) return;
    setSavingId("new"); setError("");
    try {
      const result = await saveMappingProjectDiagram({ projectId: snapshot?.project?.id, name: newName,
        ...(copyCurrent && active ? { sourceRevisionId: active.revisionId, scene: active.document.scene } : { scene: singleDiagramScene(newAscii) }) });
      setSnapshot(result); setCreating(false); open(result.representation.id, result);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create diagram"); }
    finally { setSavingId(undefined); }
  };

  return <UiTestFramework id="mapping-local-chat" title="Local chat variants" controls={LOCAL_CHAT_UI_CONTROLS}>
    {(ui) => <main className="mapping-poc-shell" data-local-chat-variant={ui.variant}>
      <header className="studio-header mapping-poc-header">
        <MappingSubmenu projectName={snapshot?.project?.name ?? "Project"} name={active?.name ?? ""}
          status={savingId ? "Saving…" : active?.busy ? "Editing…" : active ? dirty(active) ? "Unsaved changes" : "Saved" : ""}
          canSave={Boolean(active?.name.trim() && active && dirty(active) && !active.busy && !savingId)}
          onNameChange={(name) => { if (activeId) setDrafts((current) => ({ ...current, [activeId]: { ...current[activeId], name } })); }}
          onNew={() => { setCopyCurrent(false); setCreating(true); }} onSave={() => void save()} />
        <nav className="screen-tabs" aria-label="Application pages">
          <button type="button" disabled title="Studio is available in the full app">STUDIO</button>
          <button type="button" disabled title="Experiments are available in the full app">EXPERIMENTS</button>
          <button type="button" className="is-active" aria-current="page">MAPPING</button>
        </nav>
      </header>
      <section className="mapping-poc-workspace">
        <div className="mapping-viewport">
          {Object.entries(drafts).map(([id, draft]) => <div key={id} className="mapping-document-view" hidden={id !== activeId}>
            <DraggableDiagramCanvas className="mapping-poc-canvas" enabled resetKey={id} leftInset={340} focusBox={draft.focusBox}>
              <MappingPocSelectionCanvas initialDocument={draft.document} active={id === activeId && !creating} focusBox={draft.focusBox}
                projectContext={{ projectId: snapshot!.project!.id, representationId: id, baseRevisionId: draft.revisionId }}
                projectionCatalog={snapshot?.catalog ?? undefined} savedScene={draft.savedScene}
                dirtyRepresentationIds={Object.keys(drafts).filter((key) => JSON.stringify(drafts[key].document.scene) !== drafts[key].savedScene)}
                onDocumentChange={(document) => setDrafts((current) => current[id].document === document ? current : { ...current, [id]: { ...current[id], document } })}
                onBusyChange={(busy) => setDrafts((current) => current[id].busy === busy ? current : { ...current, [id]: { ...current[id], busy } })}
                localChatVariant={ui.variant as LocalChatVariant} />
            </DraggableDiagramCanvas>
          </div>)}
          {!active && <div className="mapping-empty"><h1>{snapshot ? "Create a project diagram" : error ? "Could not load project diagrams" : "Loading project diagrams…"}</h1>
            {snapshot && <button type="button" onClick={() => setCreating(true)}>New diagram</button>}</div>}
          <FloatingPane><MappingDiagramExplorer projectName={snapshot?.project?.name ?? "Project"} diagrams={diagrams}
            activeId={activeId} scene={active?.document.scene} dirtyIds={Object.keys(drafts).filter((id) => dirty(drafts[id]))}
            onOpen={(id) => open(id)} onFocus={(id) => { if (activeId) setDrafts((current) => ({ ...current,
              [activeId]: { ...current[activeId], focusBox: { id, serial: (current[activeId].focusBox?.serial ?? 0) + 1 } } })); }} /></FloatingPane>
          {error && <div className="mapping-project-error" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></div>}
        </div>
        <footer className="mapping-poc-status"><span>{active?.name ?? "PROJECT DIAGRAMS"}</span>
          <span>select text to generate a sub-diagram · N opens call tree · P patches · A asks locally</span></footer>
      </section>
      {creating && <div className="mapping-dialog-backdrop"><form className="mapping-create-dialog" role="dialog" aria-modal="true" aria-label="New project diagram"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !savingId) { event.preventDefault(); setCreating(false); setError(""); }
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), textarea:not(:disabled), button:not(:disabled)"));
          const next = event.shiftKey ? controls.at(-1) : controls[0];
          if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); next?.focus(); }
        }}
        onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <h2>New project diagram</h2>
        <label>Name<input autoFocus aria-label="New diagram name" value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} /></label>
        {active && <label><input type="checkbox" checked={copyCurrent} onChange={(event) => setCopyCurrent(event.target.checked)} />Start from current diagram</label>}
        {!copyCurrent && <label>ASCII content<textarea aria-label="Initial diagram content" value={newAscii} onChange={(event) => setNewAscii(event.target.value)} rows={8} maxLength={20000} /></label>}
        <p>Start from a mapped diagram to keep its source evidence for select → prompt.</p>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" disabled={Boolean(savingId)} onClick={() => { setCreating(false); setError(""); }}>Cancel</button>
          <button type="submit" disabled={Boolean(savingId) || !newName.trim() || (!copyCurrent && !newAscii.trim()) || (copyCurrent && active?.busy)}>Create diagram</button></footer>
      </form></div>}
    </main>}
  </UiTestFramework>;
}
