import { MappingServicesContext, type MappingServices } from './services/MappingServices';
import type { CanvasHistoryRecord } from '../../../domain/mapping/workspace/canvasHistory';
import { historyFromRevision, documentFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { UiTestFramework } from "@new-diagram/ui-test-framework";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiagramSearchService, type SearchDocument } from './search/diagramSearchService';
import type { DiagramLineSearchResult } from '../../../domain/mapping/search/diagramSearch';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';
import { DiagramSearchPanel } from './search/DiagramSearchPanel';
import type { DiagramFocus } from './search/SearchHighlight';
import type { CanvasTransform } from "../../../domain/core/diagrams/diagramCanvas";
import type { DiagramJumpTarget } from '../../../domain/core/diagrams/diagramJump';
import { singleDiagramScene } from "../../../domain/core/diagrams/projectDiagramCanvas";
import type { CanvasCommand } from '../../../domain/mapping/agent/contracts';
import type { LocalChatVariant } from "../../../domain/mapping/chat/localChat";
import { mappingDocumentFromScene } from "../../../domain/mapping/workspace/mappingDocument";
import type { DiagramOperation, MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';
import type { MappingGridDocument } from "../../../domain/mapping/workspace/mappingGrid";
import { initialCanvasState, type MappingCanvasState, type MappingWorkspaceSnapshot } from "../../../domain/mapping/workspace/mappingWorkspace";
import { deserializeWorkspace, serializeWorkspace } from "../../../domain/mapping/workspace/mappingWorkspaceCodec";
import { DraggableDiagramCanvas } from "../../shared/diagrams/DraggableDiagramCanvas";
import { loadProjectRepresentations, type ProjectRepresentationsSnapshot } from "../../shared/http/api";
import { useAgentCanvasBridge } from './agent/useAgentCanvasBridge';
import { MappingPocSelectionCanvas } from "./canvas/MappingCanvas";
import type { DisplayModeChange } from './changes/changeSessionApi';
import { ChangeSessionPreview } from './changes/ChangeSessionPreview';
import { SourcePaneViewState } from "./source-pane/sourcePaneViewState";
import { SourcePaneDocumentActiveContext, SourcePaneDocumentContext, SourcePaneViewStateContext } from "./source-pane/SourcePaneViewStateContext";
import { FloatingPane } from "./workspace/FloatingPane";
import { MappingDiagramExplorer } from "./workspace/MappingDiagramExplorer";
import { deleteMappingProjectDiagram, saveMappingProjectDiagram } from "./workspace/mappingProjectApi";
import { MappingSubmenu } from "./workspace/MappingSubmenu";
import { mappingWorkspaceRepository } from "./workspace/mappingWorkspaceRepository";

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
  }
} as const;

interface Draft {
  history?: CanvasHistoryRecord;
  representationId?: string;
  name: string;
  document: MappingGridDocument;
  savedScene: string;
  savedEdges?: string;
  savedName: string;
  revisionId: string;
  busy: boolean;
  canvas: MappingCanvasState;
  viewport?: CanvasTransform;
  focusBox?: DiagramFocus;
}
const dirty = (draft: Draft) => draft.name !== draft.savedName || JSON.stringify(draft.document.scene) !== draft.savedScene || JSON.stringify(draft.document.edges) !== (draft.savedEdges ?? '[]');

export function MappingPocPage({ services }: { services: MappingServices }) {
  return <MappingServicesContext.Provider value={services}><MappingWorkspacePage /></MappingServicesContext.Provider>;
}

function MappingWorkspacePage() {
  const [explorerTab, setExplorerTab] = useState<'diagrams'|'changes'>('diagrams');
  const [changeMode, setChangeMode] = useState<DisplayModeChange>();
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [viewState, setViewState] = useState(() => new SourcePaneViewState());
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<ProjectRepresentationsSnapshot>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [activeId, setActiveId] = useState<string>();
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("New diagram");
  const [newAscii, setNewAscii] = useState("[New diagram]");
  const [copyCurrent, setCopyCurrent] = useState(false);
  const active = activeId ? drafts[activeId] : undefined;
  const controllers = useRef(new Map<string, MappingDocumentController>());
  const draftRef = useRef(drafts); draftRef.current = drafts;
  const [search] = useState(() => new DiagramSearchService(() => new Worker(new URL('./search/diagramSearch.worker.ts', import.meta.url), { type: 'module' })));
  const savedSearchDocuments = useRef(new WeakMap<object, MappingGridDocument>());
  const [proposalSearchDocument, setProposalSearchDocument] = useState<SearchDocument>();
  const [proposalSearchFocus, setProposalSearchFocus] = useState<{ documentId: string; focus: DiagramFocus }>();
  useEffect(() => { setProposalSearchFocus(undefined); }, [changeMode?.sessionId, changeMode?.documentId, changeMode?.serial]);
  const onProposalSearchDocument = useCallback((document: SearchDocument) => setProposalSearchDocument(document), []);
  const proposalSearchId = changeMode ? `proposal:${changeMode.sessionId}:${changeMode.documentId}` : undefined;
  const searchDocuments = useMemo(() => {
    const documents: SearchDocument[] = [];
    const overridden = new Set(Object.entries(drafts).map(([id, draft]) => draft.representationId ?? id));
    for (const representation of Object.values(snapshot?.catalog?.representations ?? {})) {
      if (representation.status !== 'settled' || overridden.has(representation.id)) continue;
      const revision = snapshot?.catalog?.revisions[representation.currentRevisionId];
      if (!revision) continue;
      let document = savedSearchDocuments.current.get(revision);
      if (!document) { document = documentFromRevision(revision); savedSearchDocuments.current.set(revision, document); }
      documents.push({ id: representation.id, name: representation.name, document, scope: 'project' });
    }
    for (const [id, draft] of Object.entries(drafts)) documents.push({ id, name: draft.name, document: draft.document, scope: 'project' });
    if (proposalSearchDocument && proposalSearchDocument.id === proposalSearchId) documents.push(proposalSearchDocument);
    return documents;
  }, [drafts, snapshot?.catalog, proposalSearchDocument, proposalSearchId]);
  useEffect(() => { search.sync(searchDocuments); }, [search, searchDocuments]);
  useEffect(() => () => search.dispose(), [search]);
  const appliedRequests = useRef(new Map<string, unknown>());
  const waitController = async (id: string) => {
    const deadline = Date.now() + 5000;
    while (!controllers.current.has(id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const controller = controllers.current.get(id);
    if (!controller) throw new Error('DOCUMENT_UNAVAILABLE');
    return controller;
  };
  const handleAgentCommand = async (command: CanvasCommand): Promise<unknown> => {
    if (command.method === 'create-document') {
      const { name, snapshot: initialized, requestId } = command.payload as { name: string; requestId: string; snapshot: ProjectRepresentationsSnapshot };
      if (appliedRequests.current.has(`create:${requestId}`)) return appliedRequests.current.get(`create:${requestId}`);
      const id = `draft-${crypto.randomUUID()}`;
      const document = mappingDocumentFromScene(singleDiagramScene('[New diagram]'));
      setSnapshot(initialized);
      setDrafts(current => ({ ...current, [id]: { name, document, savedEdges: JSON.stringify(document.edges), savedScene: JSON.stringify(document.scene), savedName: '', revisionId: '', busy: false, canvas: initialCanvasState() } }));
      setActiveId(id);
      await waitController(id);
      const result = { documentId: id };
      appliedRequests.current.set(`create:${requestId}`, result);
      return result;
    }
    const id = command.documentId!;
    const controller = await waitController(id);
    const draft = draftRef.current[id];
    if (!draft) throw new Error('DOCUMENT_UNAVAILABLE');
    if (command.method === 'snapshot') return { ...structuredClone(controller.getSnapshot()), history: controller.exportHistory(), name: draft.name,
      representationId: draft.representationId ?? (id.startsWith('draft-') ? undefined : id), revisionId: draft.revisionId || undefined };
    if (command.method === 'apply') {
      const { requestId, expectedVersion, operations } = command.payload as { requestId: string; expectedVersion: number; operations: DiagramOperation[] };
      const key = `${id}:${requestId}`;
      if (appliedRequests.current.has(key)) return appliedRequests.current.get(key);
      if (draft.busy) throw new Error('DOCUMENT_BUSY');
      const result = controller.applyUpdate(expectedVersion, operations);
      appliedRequests.current.set(key, result);
      return result;
    }
    const { result, wholeDocument, savedScene, savedEdges, name } = command.payload as {
      result: Awaited<ReturnType<typeof saveMappingProjectDiagram>>; wholeDocument: boolean; savedScene: string; savedEdges: string; name: string;
    };
    setSnapshot(result);
    if (wholeDocument) setDrafts(current => ({ ...current, [id]: { ...current[id], representationId: result.representation.id,
      revisionId: result.representation.currentRevisionId, savedScene, savedEdges, savedName: name, name: current[id].name === draft.name ? name : current[id].name } }));
    return { updated: true };
  };
  useAgentCanvasBridge({ projectId: snapshot?.project?.id, documents: Object.entries(drafts).map(([documentId, draft]) => ({ documentId, name: draft.name,
    representationId: draft.representationId ?? (documentId.startsWith('draft-') ? undefined : documentId) })) }, handleAgentCommand);
  const diagrams = Object.values(snapshot?.catalog?.representations ?? {}).filter((diagram) => diagram.status === "settled");

  const open = (id: string, data = snapshot, navigate = true) => {
    const representation = data?.catalog?.representations[id];
    const revision = representation && data?.catalog?.revisions[representation.currentRevisionId];
    if (!representation || representation.status !== "settled" || !revision) { setError("Project diagram was not found"); return; }
    const existingId = Object.entries(drafts).find(([key, draft]) => (draft.representationId ?? key) === id)?.[0];
    if (existingId) {
      setActiveId(existingId); setError('');
      if (navigate) { const url = new URL(location.href); url.searchParams.set('diagram', id); history.pushState({}, '', url); }
      return existingId;
    }
    const document = documentFromRevision(revision);
    setDrafts((current) => current[id] ? current : { ...current, [id]: { name: representation.name,
      history: historyFromRevision(revision), document, savedEdges: JSON.stringify(document.edges), savedScene: JSON.stringify(document.scene), savedName: representation.name, revisionId: revision.id, busy: false, canvas: initialCanvasState() } });
    setActiveId(id);
    if (navigate) {
      const url = new URL(location.href); url.searchParams.set("diagram", id);
      history.pushState({}, "", url);
    }
    setError("");
    return id;
  };

  const jumpTo = async (target: DiagramJumpTarget) => {
    try {
      const id = open(target.representationId);
      if (!id || !target.displayNodeId) return;
      const controller = await waitController(id);
      const node = controller.nodes().find(node => node.id === target.displayNodeId && node.layout === 'grid');
      if (!node || node.layout !== 'grid') { setError('Linked diagram was removed; opened its canvas'); return; }
      const contentNode = target.contentNodeId && node.contentNodes?.find(item => item.id === target.contentNodeId);
      if (target.contentNodeId && !contentNode) setError('Linked label changed; opened its diagram');
      setDrafts(current => ({ ...current, [id]: { ...current[id], focusBox: { id: node.boxId,
        contentNodeId: contentNode ? contentNode.id : undefined, serial: (current[id].focusBox?.serial ?? 0) + 1 } } }));
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open linked diagram'); }
  };

  const revealSearchResult = async (result: DiagramLineSearchResult) => {
    const source = searchDocuments.find(document => document.id === result.canvasDocumentId);
    const check = (document: MappingGridDocument | undefined) => {
      const box = document && findBox(document.scene.root, result.displayNodeId.slice(5));
      const content = box?.kind === 'diagram' && document?.scene.contents[box.contentId]?.content;
      if (!content || content.revisionId !== result.revisionId || content.asciiSha256 !== result.asciiSha256)
        throw new Error('This result changed. Search again for the current line.');
    };
    check(source?.document);
    const focus: DiagramFocus = { id: result.displayNodeId.slice(5), serial: Date.now(), search: result };
    if (source?.scope === 'proposal') {
      setProposalSearchFocus({ documentId: source.id, focus }); return;
    }
    setChangeMode(undefined);
    const id = drafts[result.canvasDocumentId] ? result.canvasDocumentId : open(result.canvasDocumentId);
    if (!id) throw new Error('Canvas is no longer available.');
    setActiveId(id);
    const controller = await waitController(id);
    check(controller.getSnapshot().document);
    setDrafts(current => current[id] ? { ...current, [id]: { ...current[id], focusBox: focus } } : current);
  };

  const restore = (workspace: MappingWorkspaceSnapshot, data = snapshot) => {
    if (workspace.projectId !== data?.project?.id) throw new Error("Workspace belongs to another project");
    const documents = workspace.documents.filter(doc => doc.representationId.startsWith("draft-") || data?.catalog?.representations[doc.savedRepresentationId ?? doc.representationId]?.status === "settled");
    setViewState(new SourcePaneViewState());
    setDrafts(Object.fromEntries(documents.map(doc => [doc.representationId, { ...doc, representationId: doc.savedRepresentationId, busy: false }])));
    const id = documents.some(doc => doc.representationId === workspace.activeDocumentId)
      ? workspace.activeDocumentId : documents[0]?.representationId
        ?? Object.values(data?.catalog?.representations ?? {}).find(diagram => diagram.status === "settled")?.id;
    setActiveId(id); setWorkspaceEpoch(value => value + 1); setCreating(false);
    if (id && !documents.some(doc => doc.representationId === id)) open(id, data, false);
    const url = new URL(location.href);
    if (id) url.searchParams.set('diagram', id); else url.searchParams.delete('diagram');
    history.replaceState({}, '', url);
    setWorkspaceStatus('Workspace restored');
  };
  const capture = (): MappingWorkspaceSnapshot => {
    if (!snapshot?.project) throw new Error('Project is not initialized');
    return { schemaVersion: 3, projectId: snapshot.project.id, activeDocumentId: activeId,
      documents: Object.entries(drafts).map(([representationId, draft]) => ({ representationId, savedRepresentationId: draft.representationId, name: draft.name,
        history: controllers.current.get(representationId)?.exportHistory() ?? draft.history, savedName: draft.savedName, savedScene: draft.savedScene, savedEdges: draft.savedEdges, revisionId: draft.revisionId,
        document: controllers.current.get(representationId)?.getSnapshot().document ?? draft.document, canvas: { ...(controllers.current.get(representationId)?.getSnapshot().canvas ?? draft.canvas), display: viewState.captureDisplay(representationId, draft.canvas.display) },
        viewport: viewState.captureCamera(representationId, draft.viewport) })) };
  };
  const workspaceAction = async (action: 'save' | 'restore' | 'export', imported?: string) => {
    setWorkspaceBusy(true); setError('');
    try {
      if (imported !== undefined) { restore(deserializeWorkspace(imported)); setWorkspaceStatus('Workspace imported; save to retain on reload'); }
      else if (action === 'save') { await mappingWorkspaceRepository.save(capture()); setWorkspaceStatus('Workspace saved'); }
      else if (action === 'restore') {
        const saved = await mappingWorkspaceRepository.load();
        if (saved) restore(saved); else setWorkspaceStatus('No saved workspace yet');
      } else {
        const href = URL.createObjectURL(new Blob([serializeWorkspace(capture())], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = href; a.download = 'mapping-workspace.json'; a.click(); URL.revokeObjectURL(href);
        setWorkspaceStatus('Workspace exported');
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Workspace operation failed'); }
    finally { setWorkspaceBusy(false); }
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadProjectRepresentations(); if (cancelled) return; setSnapshot(data);
        let workspace: MappingWorkspaceSnapshot | null = null;
        let restoreError = '';
        try { workspace = await mappingWorkspaceRepository.load(); }
        catch (error) { restoreError = error instanceof Error ? error.message : 'Could not restore workspace'; }
        if (cancelled) return;
        if (workspace && workspace.documents.length) restore(workspace, data);
        else {
          const requestedId = new URL(location.href).searchParams.get('diagram');
          const id = requestedId && data.catalog?.representations[requestedId]?.status === 'settled' ? requestedId
            : Object.values(data.catalog?.representations ?? {}).find(diagram => diagram.status === 'settled')?.id;
          if (id) open(id, data, false);
          const url = new URL(location.href);
          if (id) url.searchParams.set('diagram', id); else url.searchParams.delete('diagram');
          history.replaceState({}, '', url);
        }
        if (restoreError) setError(restoreError);
      } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : 'Could not load project'); }
      finally { if (!cancelled) setWorkspaceLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Every checkpoint contains the complete immutable history, including edits made
  // during this debounce. View measurements do not trigger document persistence.
  const persistenceKey = JSON.stringify(Object.entries(drafts).map(([id, draft]) =>
    [id, draft.history?.headId, draft.name, draft.revisionId, draft.representationId]));
  useEffect(() => {
    if (!workspaceLoaded || !snapshot?.project || workspaceBusy) return;
    const timer = window.setTimeout(() => {
      void mappingWorkspaceRepository.save(capture()).then(() => setWorkspaceStatus('Editing history saved'))
        .catch(error => setError(error instanceof Error ? error.message : 'Could not save editing history'));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [persistenceKey, workspaceLoaded, workspaceBusy, snapshot?.project?.id]);

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


  const save = async () => {
    if (!activeId || !active || active.busy || savingId || deletingId) return;
    const id = activeId;
    const controller = controllers.current.get(id);
    const captured = { ...active, ...(controller ? { document: controller.getSnapshot().document, history: controller.exportHistory() } : {}) };
    setSavingId(id); setError("");
    try {
      const result = await saveMappingProjectDiagram({ projectId: snapshot?.project?.id, representationId: captured.representationId ?? (id.startsWith('draft-') ? undefined : id),
        history: captured.history, expectedRevisionId: captured.revisionId, name: captured.name, scene: captured.document.scene, edges: captured.document.edges });
      setSnapshot(result);
      setDrafts((current) => ({ ...current, [id]: { ...current[id], savedName: captured.name.trim(),
        name: current[id].name === captured.name ? captured.name.trim() : current[id].name,
        representationId: result.representation.id, savedScene: JSON.stringify(captured.document.scene), savedEdges: JSON.stringify(captured.document.edges), revisionId: result.representation.currentRevisionId } }));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save diagram"); }
    finally { setSavingId(undefined); }
  };
  const create = async () => {
    if (savingId || deletingId || (copyCurrent && active?.busy)) return;
    setSavingId("new"); setError("");
    try {
      const result = await saveMappingProjectDiagram({ projectId: snapshot?.project?.id, name: newName,
        ...(copyCurrent && active ? { sourceRevisionId: active.revisionId, scene: active.document.scene, edges: active.document.edges } : { scene: singleDiagramScene(newAscii) }) });
      setSnapshot(result); setCreating(false); open(result.representation.id, result);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create diagram"); }
    finally { setSavingId(undefined); }
  };

  const remove = async (id: string) => {
    const draftId = Object.entries(drafts).find(([key, draft]) => (draft.representationId ?? key) === id)?.[0] ?? id;
    const diagram = snapshot?.catalog?.representations[id];
    if (!diagram || deletingId || savingId || workspaceBusy || drafts[draftId]?.busy) return;
    if (!window.confirm(`Delete diagram “${diagram.name}”?${drafts[draftId] && dirty(drafts[draftId]) ? "\n\nIts unsaved changes will be discarded." : ""}`)) return;
    setDeletingId(id); setError("");
    try {
      const result = await deleteMappingProjectDiagram(id);
      setSnapshot(result);
      setDrafts(current => {
        const next = { ...current };
        delete next[draftId];
        return next;
      });
      if (activeIdRef.current === draftId) {
        const remaining = Object.values(result.catalog?.representations ?? {}).filter(diagram => diagram.status === "settled");
        const index = diagrams.findIndex(diagram => diagram.id === id);
        const nextId = remaining[Math.min(index, remaining.length - 1)]?.id;
        if (nextId) open(nextId, result, false); else setActiveId(undefined);
        const url = new URL(location.href);
        if (nextId) url.searchParams.set("diagram", nextId); else url.searchParams.delete("diagram");
        history.replaceState({}, "", url);
      }
      setWorkspaceStatus(`Deleted “${diagram.name}”`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not delete diagram"); }
    finally { setDeletingId(undefined); }
  };

  useEffect(() => {
    for (const [id, draft] of Object.entries(drafts)) viewState.prune(id, draft.canvas.display);
  }, [drafts, viewState]);

  return <SourcePaneViewStateContext.Provider value={viewState}><UiTestFramework id="mapping-local-chat" title="Local chat variants" controls={LOCAL_CHAT_UI_CONTROLS}>
    {(ui) => <main className="mapping-poc-shell" data-local-chat-variant={ui.variant}>
      <header className="workspace-header mapping-poc-header">
        {!changeMode && <MappingSubmenu projectName={snapshot?.project?.name ?? "Project"} name={active?.name ?? ""}
          status={savingId ? "Saving…" : active?.busy ? "Editing…" : active ? dirty(active) ? "Unsaved changes" : "Saved" : ""}
          canSave={Boolean(active?.name.trim() && active && dirty(active) && !active.busy && !savingId && !deletingId)}
          onNameChange={(name) => { if (activeId) setDrafts((current) => ({ ...current, [activeId]: { ...current[activeId], name } })); }}
          onNew={() => { setCopyCurrent(false); setCreating(true); }} onSave={() => void save()} />}
        {!changeMode && <div className="mapping-workspace-actions">
          <button disabled={workspaceBusy || Boolean(deletingId) || !active || Object.values(drafts).some(draft => draft.busy)} onClick={() => void workspaceAction('save')}>Save workspace</button>
          <button disabled={workspaceBusy || Boolean(deletingId) || Object.values(drafts).some(draft => draft.busy)} onClick={() => void workspaceAction('restore')}>Restore workspace</button>
          <button disabled={workspaceBusy || !active} onClick={() => void workspaceAction('export')}>Export</button>
          <button disabled={workspaceBusy || Boolean(deletingId) || Object.values(drafts).some(draft => draft.busy)} onClick={() => importRef.current?.click()}>Import</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Import workspace" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) void file.text().then(text => workspaceAction('restore', text)).catch(error => setError(String(error)));
          }} />
        </div>}
        <nav className="screen-tabs" aria-label="Application pages">
          <button type="button" className="is-active" aria-current="page">MAPPING</button>
        </nav>
      </header>
      <section className="mapping-poc-workspace">
        <div className="mapping-viewport">
          {Object.entries(drafts).map(([id, draft]) => <SourcePaneDocumentContext.Provider key={`${workspaceEpoch}:${id}`} value={id}><SourcePaneDocumentActiveContext.Provider value={id === activeId && !changeMode}><div className="mapping-document-view" hidden={id !== activeId || !!changeMode}>
            <DraggableDiagramCanvas className="mapping-poc-canvas" enabled={id === activeId} resetKey={id} leftInset={340} focusBox={draft.focusBox}
              initialTransform={draft.viewport} onTransformChange={viewport => viewState.setCamera(id, viewport)}>
              <MappingPocSelectionCanvas onJump={target => void jumpTo(target)} onController={controller => { if (controller) controllers.current.set(id, controller); else controllers.current.delete(id); }} initialCanvasState={draft.canvas}
                onCanvasStateChange={canvas => setDrafts(current => !current[id] || current[id].canvas === canvas ? current : { ...current, [id]: { ...current[id], canvas } })}
                initialHistory={draft.history}
                onHistoryChange={history => setDrafts(current => !current[id] || current[id].history?.headId === history.headId ? current : { ...current, [id]: { ...current[id], history } })}
                initialDocument={draft.document} active={id === activeId && !creating && !changeMode} focusBox={draft.focusBox}
                projectContext={draft.revisionId ? { projectId: snapshot!.project!.id, representationId: draft.representationId ?? id, baseRevisionId: draft.revisionId } : undefined}
                projectionCatalog={snapshot?.catalog ?? undefined} savedScene={draft.savedScene}
                dirtyRepresentationIds={Object.keys(drafts).filter((key) => JSON.stringify(drafts[key].document.scene) !== drafts[key].savedScene)}
                onDocumentChange={(document) => setDrafts((current) => !current[id] || current[id].document === document ? current : { ...current, [id]: { ...current[id], document } })}
                onBusyChange={(busy) => setDrafts((current) => !current[id] || current[id].busy === busy ? current : { ...current, [id]: { ...current[id], busy } })}
                localChatVariant={ui.variant as LocalChatVariant} />
            </DraggableDiagramCanvas>
          </div></SourcePaneDocumentActiveContext.Provider></SourcePaneDocumentContext.Provider>)}
          {!active && !changeMode && <div className="mapping-empty"><h1>{snapshot ? "Create a project diagram" : error ? "Could not load project diagrams" : "Loading project diagrams…"}</h1>
            {snapshot && <button type="button" onClick={() => setCreating(true)}>New diagram</button>}</div>}
          {changeMode && <ChangeSessionPreview mode={changeMode} onSelect={setChangeMode}
            onSearchDocument={onProposalSearchDocument} searchFocus={proposalSearchFocus && proposalSearchFocus.documentId === proposalSearchId ? proposalSearchFocus.focus : undefined} />}
          <DiagramSearchPanel service={search} activeDocumentId={proposalSearchId ?? activeId}
            activeName={changeMode ? proposalSearchDocument && proposalSearchDocument.id === proposalSearchId ? proposalSearchDocument.name : 'Loading proposal…' : active?.name}
            onReveal={revealSearchResult} />
          <FloatingPane><MappingDiagramExplorer explorerTab={explorerTab}
            onTabChange={tab => { setExplorerTab(tab); if (tab === 'diagrams') setChangeMode(undefined); }}
            changeMode={changeMode} onChangeSelect={setChangeMode} projectName={snapshot?.project?.name ?? "Project"} diagrams={diagrams}
            activeId={active?.representationId ?? activeId} scene={active?.document.scene} dirtyIds={Object.keys(drafts).filter((id) => dirty(drafts[id])).map(id => drafts[id].representationId ?? id)}
            onDelete={id => void remove(id)} deletingId={deletingId} deleteDisabled={Boolean(deletingId || savingId || workspaceBusy)}
            busyIds={Object.keys(drafts).filter(id => drafts[id].busy).map(id => drafts[id].representationId ?? id)}
            onOpen={(id) => { setChangeMode(undefined); open(id); }} onFocus={(id) => { if (activeId && !drafts[activeId]?.busy) setDrafts((current) => ({ ...current,
              [activeId]: { ...current[activeId], focusBox: { id, serial: (current[activeId].focusBox?.serial ?? 0) + 1 } } })); }} /></FloatingPane>
          {error && <div className="mapping-project-error" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></div>}
        </div>
        <footer className="mapping-poc-status"><span>{active?.name ?? "PROJECT DIAGRAMS"}</span>
          <span>{workspaceStatus || 'Ctrl + drag to select · N opens call tree · P patches · A asks locally'}</span></footer>
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
  </UiTestFramework></SourcePaneViewStateContext.Provider>;
}
