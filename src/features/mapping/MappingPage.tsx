import { selectionContentNodes } from '../../../domain/mapping/selection/selectionState';
import { generatedDiagramOperations } from '../../../domain/mapping/workspace/generatedDiagramOperations';
import { WindowPanel } from './window-panel/WindowPanel';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import type { ContentNodeAnchor } from '../../../domain/core/diagrams/diagramConnection';
import { DiffTreePanel } from './changes/DiffTreePanel';
import { inferRepositoryId } from '../../../domain/core/repositories/repository';
import { PromptComposer, type PromptRevision, type PromptRevisionSource } from './prompt-composer/PromptComposer';
import { PromptComposerCoordinator, composerUnsettled } from './prompt-composer/promptComposerCoordinator';
import { createDiagramEditClient } from './prompt-composer/diagramEditClient';
import { copyPromptReferences, diagramTitle, diagramReference, nodesReference } from './prompt-composer/promptReferences';
import type { DiagramRevision } from '../../../domain/core/diagrams/diagramService';
import type { CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import type { PromptOperation } from '../../../domain/mapping/agent/promptTemplates';
import { deselectCanvas } from '../../../domain/mapping/selection/canvasSelection';
import { DiagramRevisionReceiver } from './agent/diagramRevisionReceiver';
import type { DiagramCreation, DiagramRevisionApplication, PromptReference } from '../../../domain/mapping/agent/diagramEdit';
import { DefaultCanvasHistoryService } from '../../../domain/core/diagrams/canvasHistoryService';
import { useStore } from 'zustand';
import { CanvasWorkspace, type CanvasDraft as Draft, type CanvasDraftSeed } from './workspace/canvasWorkspace';
import { WorkspacePersistence } from './workspace/workspacePersistence';
import { runWorkspaceTask } from './workspace/runWorkspaceTask';
import { pruneWorkspaceDocuments } from '../../../domain/mapping/workspace/pruneWorkspaceDocuments';
import { emptyCanvasDocument, type CanvasTransfer, type TransferState } from '../../../domain/core/diagrams/canvasTransfer';
import { removeDisplayNode } from '../../../domain/mapping/workspace/displayModel';
import { MappingServicesContext, useMappingServices, type MappingServices } from './services/MappingServices';
import { reconcileWorkspaceDocument } from '../../../domain/mapping/workspace/reconcileWorkspace';
import { historyFromRevision, documentFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { UiTestFramework } from "@new-diagram/ui-test-framework";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiagramSearchService, type SearchDocument } from './search/diagramSearchService';
import type { DiagramLineSearchResult } from '../../../domain/mapping/search/diagramSearch';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';
import { DiagramSearchPanel } from './search/DiagramSearchPanel';
import type { DiagramFocus } from './search/SearchHighlight';
import type { DiagramJumpTarget } from '../../../domain/core/diagrams/diagramJump';
import { singleDiagramScene } from "../../../domain/core/diagrams/projectDiagramCanvas";
import type { CanvasCommand } from '../../../domain/mapping/agent/contracts';
import type { LocalChatVariant } from "../../../domain/mapping/chat/localChat";
import { mappingDocumentFromScene } from "../../../domain/mapping/workspace/mappingDocument";
import { type DiagramOperation, MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';
import type { MappingGridDocument } from "../../../domain/mapping/workspace/mappingGrid";
import { initialCanvasState, type MappingCanvasState, type MappingWorkspaceSnapshot } from "../../../domain/mapping/workspace/mappingWorkspace";
import { deserializeWorkspace, serializeWorkspace } from "../../../domain/mapping/workspace/mappingWorkspaceCodec";
import { MappingEditorCanvas } from "./tldraw/MappingEditorCanvas";
import { loadProjectRepresentations, type ProjectRepresentationsSnapshot } from "../../shared/http/api";
import { useAgentCanvasBridge } from './agent/useAgentCanvasBridge';
import { MappingPocSelectionCanvas } from "./canvas/MappingCanvas";
import type { DisplayModeChange } from './changes/changeSessionApi';
import { ChangeSessionPreview } from './changes/ChangeSessionPreview';
import type { DiagramChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';
import { stateKey } from '../../../domain/core/diagrams/canvasHistory';
import { SourcePaneViewState } from "./source-pane/sourcePaneViewState";
import { SourcePaneDocumentActiveContext, SourcePaneDocumentContext, SourcePaneViewStateContext } from "./source-pane/SourcePaneViewStateContext";
import { SourceWindowPanel } from './source-pane/SourceWindowPanel';
import { FloatingPane } from "./workspace/FloatingPane";
import { MappingDiagramExplorer } from "./workspace/MappingDiagramExplorer";
import { deleteMappingProjectDiagram, saveMappingProjectDiagram } from "./workspace/mappingProjectApi";
import { MappingSubmenu } from "./workspace/MappingSubmenu";
import { WorkspaceStorage } from './workspace/workspaceStorage';

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

const documentOf = (draft: Draft) => draft.session.document.getState().document;
const canvasOf = (draft: Draft) => draft.session.controller.getSnapshot().canvas;
const dirty = (draft: Draft) => draft.session.status.getState().isDirty;
const paintProgress = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

export function MappingPocPage({ services }: { services: MappingServices }) {
  return <MappingServicesContext.Provider value={services}><MappingWorkspacePage /></MappingServicesContext.Provider>;
}

function MappingWorkspacePage() {
  const { diagrams: diagramService, canvasHistory, workspaceStorage: injectedStorage } = useMappingServices();
  const [storage] = useState(() => injectedStorage ?? new WorkspaceStorage());
  const persistence = useRef<WorkspacePersistence | undefined>(undefined);
  const [pendingTransfer, setPendingTransfer] = useState<{ sourceId: string; mode: 'copy' | 'move'; selectedIds: string[]; revisionId: string }>();
  const [explorerTab, setExplorerTab] = useState<'diagrams'|'changes'|'llms'>('diagrams');
  const [changeMode, setChangeMode] = useState<DisplayModeChange>();
  const [diffTreeMode, setDiffTreeMode] = useState<DisplayModeChange>();
  const [diffTreeReveal, setDiffTreeReveal] = useState<{ sessionId: string; nodeId: string; serial: number }>();
  const revealDiffTreeNode = (nodeId: string) => {
    if (!changeMode) return;
    setDiffTreeMode(changeMode);
    setDiffTreeReveal(previous => ({ sessionId: changeMode.sessionId, nodeId, serial: (previous?.serial ?? 0) + 1 }));
  };
  const selectChangeMode = (mode: DisplayModeChange) => {
    if (mode.view === 'diff-tree' || mode.view === 'treemaps') { setDiffTreeReveal(undefined); setDiffTreeMode(mode); }
    setChangeMode({ ...mode, view: undefined });
  };
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [viewState, setViewState] = useState(() => new SourcePaneViewState());
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [transferProgress, setTransferProgress] = useState('');
  const transferBusy = useRef(false);
  const [transfers, setTransfers] = useState<CanvasTransfer[]>([]);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<ProjectRepresentationsSnapshot>();
  const [workspace] = useState(() => new CanvasWorkspace(diagramService, canvasHistory));
  const [prompts] = useState(() => new PromptComposerCoordinator(createDiagramEditClient()));
  const carried = useStore(prompts.store, state => state.carried);
  const { entries: llmEntries, activeKey: activeLlm } = useStore(prompts.store);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolTab, setToolTab] = useState<'search' | 'llm'>('search');
  const closeTools = () => {
    setToolsOpen(false);
    document.querySelector<HTMLElement>('.mapping-document-view:not([hidden]) .mapping-poc-graph-stage')?.focus({ preventScroll: true });
  };
  const drafts = useStore(workspace.store, state => state.drafts);
  const dirtySceneIds = useStore(workspace.dirtyScenes, state => state.ids);
  const setDrafts = workspace.setDrafts;
  const disposal = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(disposal.current);
    return () => { disposal.current = setTimeout(() => {
      prompts.dispose();
      workspace.dispose();
      if (!injectedStorage) {
        if (storage.records) void storage.flush().catch(() => {}).finally(() => storage.dispose());
        else storage.dispose();
      }
    }, 0); };
  }, [workspace, storage, injectedStorage]);
  useEffect(() => () => { viewState.flush(); viewState.dispose(); }, [viewState]);
  const [activeId, setActiveId] = useState<string>();
  const mountedDocuments = useRef(new Set<string>());
  if (activeId) mountedDocuments.current.add(activeId);
  const startup = useRef<Promise<[ProjectRepresentationsSnapshot, { workspace: MappingWorkspaceSnapshot | null; restoreError: string }]> | undefined>(undefined);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("New diagram");
  const [newRepositoryId, setNewRepositoryId] = useState('');
  const [newAscii, setNewAscii] = useState("[New diagram]");
  const [copyCurrent, setCopyCurrent] = useState(false);
  const active = activeId ? drafts[activeId] : undefined;
  const revealedLlmRuns = useRef(new Set<string>());
  useEffect(() => {
    const entry = activeLlm ? llmEntries[activeLlm] : undefined, run = entry?.run;
    const nodeId = run?.created?.nodeIds[0];
    if (!entry || !run || run.status !== 'completed' || !nodeId || entry.target.documentId !== activeId || revealedLlmRuns.current.has(run.runId)) return;
    revealedLlmRuns.current.add(run.runId);
    setDrafts(current => current[entry.target.documentId] ? { ...current, [entry.target.documentId]: {
      ...current[entry.target.documentId], focusBox: { id: nodeId.slice(5), serial: Date.now() }
    } } : current);
  }, [llmEntries, activeLlm, activeId]);
  const controllers = { current: workspace.controllers };
  const cancelTransfer = useCallback(() => {
    if (transferBusy.current) return;
    const source = pendingTransfer && controllers.current.get(pendingTransfer.sourceId);
    source?.updateCanvas(deselectCanvas, true);
    setPendingTransfer(undefined); setError(''); setWorkspaceStatus('Transfer cancelled');
  }, [pendingTransfer]);
  useEffect(() => {
    if (!pendingTransfer) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !transferBusy.current) { event.preventDefault(); event.stopImmediatePropagation(); cancelTransfer(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [pendingTransfer, cancelTransfer]);
  const beginTransfer = (sourceId: string, mode: 'copy' | 'move', selectedIds: string[]) => {
    const source = controllers.current.get(sourceId);
    if (!source || !selectedIds.length || workspaceBusy || savingId || deletingId) return;
    setPendingTransfer({ sourceId, mode, selectedIds: [...selectedIds], revisionId: source.getSnapshot().canvasRevisionId });
    setExplorerTab('diagrams'); setChangeMode(undefined); setError('');
  };
  const draftRef = { get current() { return workspace.store.getState().drafts; } };
  const [search] = useState(() => new DiagramSearchService(() => new Worker(new URL('./search/diagramSearch.worker.ts', import.meta.url), { type: 'module' })));
  const savedSearchDocuments = useRef(new WeakMap<object, MappingGridDocument>());
  const [proposalSearchDocument, setProposalSearchDocument] = useState<SearchDocument>();
  const [proposalSearchFocus, setProposalSearchFocus] = useState<{ documentId: string; focus: DiagramFocus }>();
  const [searchOpenRequest, setSearchOpenRequest] = useState(0);
  const [searchMatches, setSearchMatches] = useState<readonly DiagramLineSearchResult[]>([]);
  const searchMatchesByDocument = useMemo(() => {
    const grouped = new Map<string, DiagramLineSearchResult[]>();
    for (const match of searchMatches) {
      const matches = grouped.get(match.canvasDocumentId) ?? [];
      matches.push(match); grouped.set(match.canvasDocumentId, matches);
    }
    return grouped;
  }, [searchMatches]);
  const searchNavigation = useRef(0);
  const clearSearchFocus = useCallback(() => {
    searchNavigation.current++;
    setProposalSearchFocus(undefined);
    setSearchMatches([]);
    setDrafts(current => Object.values(current).some(draft => draft.focusBox?.search)
      ? Object.fromEntries(Object.entries(current).map(([id, draft]) => [id, draft.focusBox?.search ? { ...draft, focusBox: undefined } : draft])) : current);
  }, []);
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
    for (const [id, draft] of Object.entries(drafts)) if (!draft.hidden) documents.push({ id, name: draft.name, document: documentOf(draft), scope: 'project' });
    if (proposalSearchDocument && proposalSearchDocument.id === proposalSearchId) documents.push(proposalSearchDocument);
    return documents;
  }, [drafts, snapshot?.catalog, proposalSearchDocument, proposalSearchId]);
  useEffect(() => { search.sync(searchDocuments); }, [search, searchDocuments]);
  useEffect(() => () => search.dispose(), [search]);
  const appliedRequests = useRef(new Map<string, unknown>());
  const [revisionReceiver] = useState(() => new DiagramRevisionReceiver());
  const waitController = async (id: string) => {
    const deadline = Date.now() + 5000;
    while (!controllers.current.has(id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const controller = controllers.current.get(id);
    if (!controller) throw new Error('DOCUMENT_UNAVAILABLE');
    return controller;
  };
  const handleAgentCommand = async (command: CanvasCommand): Promise<unknown> => {
    if (transferBusy.current) throw new Error('WORKSPACE_BUSY');
    if (command.method === 'copy-document') {
      const { name, repositoryId, expectedVersion, requestId } = command.payload as { name: string; repositoryId?: string; expectedVersion?: number; requestId: string };
      const key = `copy:${command.documentId}:${requestId}`;
      if (appliedRequests.current.has(key)) return appliedRequests.current.get(key);
      const sourceId = command.documentId!, source = draftRef.current[sourceId];
      if (!source || source.hidden) throw new Error('DOCUMENT_UNAVAILABLE');
      const result = workspace.copyDocument({ documentId: sourceId, name, repositoryId, expectedVersion,
        display: viewState.captureDisplay(sourceId, source.session.controller.getSnapshot().canvas.display),
        viewport: viewState.captureCamera(sourceId, source.viewport) });
      // Record the receipt immediately: a lost acknowledgement must not create another copy.
      appliedRequests.current.set(key, result);
      setActiveId(result.documentId);
      return result;
    }
    if (command.method === 'create-document') {
      const { name, repositoryId, snapshot: initialized, requestId } = command.payload as { name: string; repositoryId?: string; requestId: string; snapshot: ProjectRepresentationsSnapshot };
      if (appliedRequests.current.has(`create:${requestId}`)) return appliedRequests.current.get(`create:${requestId}`);
      const id = `draft-${crypto.randomUUID()}`;
      const document = mappingDocumentFromScene(singleDiagramScene('[New diagram]'));
      setSnapshot(initialized);
      setDrafts(current => ({ ...current, [id]: { name, repositoryId, document, savedEdges: JSON.stringify(document.edges), savedScene: JSON.stringify(document.scene), savedName: '', revisionId: '', busy: false, canvas: initialCanvasState() } }));
      setActiveId(id);
      await waitController(id);
      const result = { documentId: id };
      appliedRequests.current.set(`create:${requestId}`, result);
      return result;
    }
    const id = command.documentId!;
    const controller = await waitController(id);
    const draft = draftRef.current[id];
    if (!draft || draft.hidden) throw new Error('DOCUMENT_UNAVAILABLE');
    // Acceptance only compares the current state; exporting all history can make replies enormous.
    if (command.method === 'context') {
      const snapshot = controller.getSnapshot();
      return { version: snapshot.version, name: draft.name, nodes: controller.nodes(), edges: structuredClone(snapshot.document.edges) };
    }
    if (command.method === 'document-state') return { document: controller.getSnapshot().document, name: draft.name };
    if (command.method === 'snapshot') return { ...structuredClone(controller.getSnapshot()), history: controller.exportHistory(), name: draft.name, repositoryId: draft.repositoryId,
      representationId: draft.representationId ?? (id.startsWith('draft-') ? undefined : id), revisionId: draft.revisionId || undefined };
    if (command.method === 'apply-diagram-revision') {
      if (workspaceBusy || draft.busy) throw new Error('WORKSPACE_BUSY');
      if (!persistence.current || !storage.records) throw Error('WORKSPACE_UNAVAILABLE: persistence is not ready');
      return revisionReceiver.apply(id, command.payload as DiagramRevisionApplication, controller, async () => {
        persistence.current?.sync([id]);
        await storage.flush();
      });
    }
    if (command.method === 'create-diagrams') {
      if (workspaceBusy || draft.busy) throw new Error('WORKSPACE_BUSY');
      if (!persistence.current || !storage.records) throw Error('WORKSPACE_UNAVAILABLE: persistence is not ready');
      const { requestId, expectedVersion, diagrams } = command.payload as { requestId: string; expectedVersion: number; diagrams: DiagramCreation[] };
      const key = `${id}:create-diagrams:${requestId}`;
      // Keep the receipt before flushing: retrying a failed write must not create the diagrams twice.
      let result = appliedRequests.current.get(key) as { version: number } | undefined;
      if (!result) {
        result = { version: controller.applyUpdate(expectedVersion, generatedDiagramOperations(diagrams)).version };
        appliedRequests.current.set(key, result);
      }
      try { persistence.current.sync([id]); await storage.flush(); }
      catch (error) { throw Error(`PERSISTENCE_PENDING: diagrams created; retry the same request to flush: ${String(error)}`); }
      return result;
    }
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
    if (wholeDocument) setDrafts(current => ({ ...current, [id]: { ...current[id], representationId: result.representation.id, repositoryId: result.representation.repositoryId,
      revisionId: result.representation.currentRevisionId, savedScene, savedEdges, savedName: name, name: current[id].name === draft.name ? name : current[id].name } }));
    return { updated: true };
  };
  const { canvasId, agentStatus } = useAgentCanvasBridge({ projectId: snapshot?.project?.id, documents: Object.entries(drafts).filter(([, draft]) => !draft.hidden).map(([documentId, draft]) => ({ documentId, name: draft.name, repositoryId: draft.repositoryId,
    representationId: draft.representationId ?? (documentId.startsWith('draft-') ? undefined : documentId) })) }, handleAgentCommand, workspace);
  const draftAliases = new Set(Object.entries(drafts).map(([id, draft]) => draft.representationId ?? id));
  const diagrams = [...Object.values(snapshot?.catalog?.representations ?? {}).filter(diagram => diagram.status === 'settled' && !draftAliases.has(diagram.id)),
    ...Object.entries(drafts).filter(([, draft]) => !draft.hidden).map(([id, draft]) => ({ id: draft.representationId ?? id, name: draft.name, repositoryId: draft.repositoryId }))];

  const open = (id: string, data = snapshot, navigate = true) => {
    const existingId = Object.entries(draftRef.current).find(([key, draft]) => key === id || draft.representationId === id)?.[0];
    if (existingId) {
      if (draftRef.current[existingId].hidden) { setError('This canvas is currently undone. Redo its transfer to reopen it.'); return; }
      setActiveId(existingId); setError('');
      if (navigate) { const url = new URL(location.href); url.searchParams.set('diagram', existingId); history.pushState({}, '', url); }
      return existingId;
    }
    const representation = data?.catalog?.representations[id];
    const revision = representation && data?.catalog?.revisions[representation.currentRevisionId];
    if (!representation || representation.status !== 'settled' || !revision) { setError('Project diagram was not found'); return; }
    const document = documentFromRevision(revision);
    setDrafts((current) => current[id] ? current : { ...current, [id]: { name: representation.name, repositoryId: representation.repositoryId,
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
    const navigation = ++searchNavigation.current;
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
    if (navigation !== searchNavigation.current) return;
    check(controller.getSnapshot().document);
    setDrafts(current => current[id] ? { ...current, [id]: { ...current[id], focusBox: focus } } : current);
  };

  const openAccepted = async (session: Omit<DiagramChangeSession, 'receipts'>, documentId: string) => {
    const acceptance = session.acceptance;
    const selected = acceptance?.documents.find(d => d.documentId === documentId);
    const reviewedSelection = session.documents.find(d => d.id === documentId);
    if (!acceptance || !reviewedSelection) throw new Error('Accepted canvas was not found');
    const selectedRepresentationId = selected?.representationId ?? reviewedSelection.representationId;
    const data = await loadProjectRepresentations();
    const next: Record<string, Draft | CanvasDraftSeed> = { ...draftRef.current };
    let selectedId = selectedRepresentationId ?? documentId, keptLocalEdits = false;
    for (const published of acceptance.documents) {
      const representation = data.catalog?.representations[published.representationId];
      const revision = representation && data.catalog?.revisions[representation.currentRevisionId];
      if (!representation || representation.status !== 'settled' || !revision) throw new Error('Published canvas was not found or is archived');
      const existingId = Object.keys(next).find(id => id === published.documentId || (next[id].representationId ?? id) === published.representationId);
      if (!existingId && published.documentId !== documentId) continue;
      const key = existingId ?? published.representationId, previous = draftRef.current[key];
      if (published.documentId === documentId) selectedId = key;
      const live = controllers.current.get(key)?.getSnapshot();
      const previousDocument = live?.document ?? (previous && documentOf(previous));
      const reviewed = session.documents.find(d => d.id === published.documentId);
      const capturedOriginal = previous && reviewed?.baseline && previous.revisionId === (published.before?.revisionId ?? '') &&
        stateKey(previousDocument) === stateKey(reviewed.baseline.document) && previous.name === reviewed.name;
      if (previous && dirty(previous) && !capturedOriginal) {
        keptLocalEdits = true; continue;
      }
      const document = documentFromRevision(revision), history = historyFromRevision(revision);
      const view = history?.snapshots[history.headId].view as MappingCanvasState | undefined;
      next[key] = { ...previous, representationId: representation.id, repositoryId: representation.repositoryId, name: representation.name, document, history,
        canvas: view?.display ? view : initialCanvasState(), revisionId: revision.id, savedName: representation.name,
        savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges), busy: false, reloadKey: revision.id };
    }
    // Migration destinations can be unchanged canvases and thus absent from the
    // publication receipt. Open the existing canvas without replacing local edits.
    if (!selected) {
      const existingId = Object.keys(next).find(id => id === documentId || !!selectedRepresentationId && (next[id].representationId ?? id) === selectedRepresentationId);
      if (existingId) selectedId = existingId;
      else {
        const representation = selectedRepresentationId && data.catalog?.representations[selectedRepresentationId];
        const revision = representation && data.catalog?.revisions[representation.currentRevisionId];
        if (!representation || representation.status !== 'settled' || !revision) {
          setSnapshot(data); setDrafts(next);
          setWorkspaceStatus('Changes accepted. This unchanged canvas remains available in the review.');
          return;
        }
        const document = documentFromRevision(revision);
        next[selectedId] = { representationId: representation.id, repositoryId: representation.repositoryId, name: representation.name, document, history: historyFromRevision(revision),
          canvas: initialCanvasState(), revisionId: revision.id, savedName: representation.name,
          savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges), busy: false };
      }
    }
    setSnapshot(data); setDrafts(next); setActiveId(selectedId); setChangeMode(undefined); setExplorerTab('diagrams');
    setWorkspaceStatus(keptLocalEdits ? 'Changes accepted; newer local edits were preserved.' : 'Changes accepted. The review diff remains in Changes.');
    const url = new URL(location.href); url.searchParams.set('diagram', selectedRepresentationId ?? selectedId); history.replaceState({}, '', url);
  };

  const restore = (workspace: MappingWorkspaceSnapshot, data = snapshot) => {
    if (workspace.projectId !== data?.project?.id) throw new Error("Workspace belongs to another project");
    const retained = new Set(workspace.documents.filter(doc => {
      const savedId = doc.savedRepresentationId ?? (doc.representationId.startsWith('draft-') ? undefined : doc.representationId);
      return !savedId || data?.catalog?.representations[savedId]?.status === 'settled';
    }).map(doc => doc.representationId));
    workspace = pruneWorkspaceDocuments(workspace, id => retained.has(id));
    const documents = workspace.documents;
    setTransfers(workspace.transfers ?? []);
    setViewState(new SourcePaneViewState());
    setDrafts(Object.fromEntries(documents.map(doc => {
      const refreshed = data?.catalog && !(workspace.transfers ?? []).some(tx => tx.sourceId === doc.representationId || tx.destinationId === doc.representationId) ? reconcileWorkspaceDocument(doc, data.catalog) : { document: doc, newerRevision: false };
      return [doc.representationId, { ...refreshed.document, newerRevision: refreshed.newerRevision, representationId: doc.savedRepresentationId,
        repositoryId: doc.repositoryId ?? data?.catalog?.representations[doc.savedRepresentationId ?? doc.representationId]?.repositoryId
          ?? inferRepositoryId(doc.document.scene, data?.project?.repositories ?? []), busy: false }];
    })));
    const id = documents.some(doc => !doc.hidden && doc.representationId === workspace.activeDocumentId)
      ? workspace.activeDocumentId : documents.find(doc => !doc.hidden)?.representationId
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
    return { schemaVersion: 3, projectId: snapshot.project.id, activeDocumentId: activeId, transfers,
      documents: Object.entries(workspace.store.getState().drafts).map(([representationId, draft]) => ({ representationId, hidden: draft.hidden, savedRepresentationId: draft.representationId, repositoryId: draft.repositoryId, name: draft.name,
        history: draft.session.controller.exportHistory(), savedName: draft.savedName, savedScene: draft.savedScene, savedEdges: draft.savedEdges, revisionId: draft.revisionId,
        document: documentOf(draft), canvas: { ...(canvasOf(draft)), display: viewState.captureDisplay(representationId, canvasOf(draft).display) },
        viewport: viewState.captureCamera(representationId, draft.viewport) })) };
  };
  const boundary = (id: string, redo = false) => (redo ? transfers : [...transfers].reverse())
    .find(tx => !tx.discarded && controllers.current.get(id)?.transferBoundary(tx, id, redo));
  // The only publication point: persist both histories and the workspace transaction together.
  const installWorkspace = (workspace: MappingWorkspaceSnapshot) => {
    const next = Object.fromEntries(workspace.documents.map(doc => [doc.representationId, {
      ...doc, representationId: doc.savedRepresentationId, busy: false
    } satisfies CanvasDraftSeed]));
    setDrafts(next); setTransfers(workspace.transfers ?? []); setActiveId(workspace.activeDocumentId);
    setViewState(new SourcePaneViewState()); setWorkspaceEpoch(epoch => epoch + 1);
    const url = new URL(location.href);
    if (workspace.activeDocumentId) url.searchParams.set('diagram', workspace.activeDocumentId); else url.searchParams.delete('diagram');
    history.pushState({}, '', url);
  };
  const publishTransfer = async (workspace: MappingWorkspaceSnapshot) => {
    await storage.save(workspace);
    if (pendingTransfer) { setTransferProgress('Opening destination canvas…'); await paintProgress(); }
    installWorkspace(workspace);
  };
  const transfer = async (destinationChoice: { id: string } | { name: string }) => {
    if (!pendingTransfer || transferBusy.current || workspaceBusy) return;
    if (savingId || deletingId || Object.values(drafts).some(draft => draft.busy)) {
      setError('A canvas is still being edited or saved. Wait for it to finish, then retry.'); return;
    }
    const { sourceId, mode, selectedIds, revisionId } = pendingTransfer;
    transferBusy.current = true; persistence.current?.setPaused(true); setWorkspaceBusy(true); setError('');
    setTransferProgress(`Preparing ${mode === 'copy' ? 'copy' : 'move'} of ${selectedIds.length} ${selectedIds.length === 1 ? 'diagram' : 'diagrams'}…`);
    try {
      await paintProgress();
      const source = controllers.current.get(sourceId); if (!source) throw Error('Source canvas is unavailable');
      if (source.getSnapshot().canvasRevisionId !== revisionId) throw Error('Source canvas changed; cancel and select the diagrams again');
      const workspace = capture();
      let destinationDoc = 'id' in destinationChoice ? workspace.documents.find(doc => doc.representationId === destinationChoice.id || doc.savedRepresentationId === destinationChoice.id) : undefined;
      if ('id' in destinationChoice && !destinationDoc) {
        const representation = snapshot?.catalog?.representations[destinationChoice.id];
        const revision = representation && snapshot?.catalog?.revisions[representation.currentRevisionId];
        if (!representation || representation.status !== 'settled' || !revision) throw Error('Destination canvas is unavailable');
        const document = documentFromRevision(revision);
        destinationDoc = { representationId: representation.id, repositoryId: representation.repositoryId, name: representation.name, savedName: representation.name, revisionId: revision.id,
          savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges), document, canvas: initialCanvasState(), history: historyFromRevision(revision) };
        workspace.documents.push(destinationDoc);
      }
      if (destinationDoc?.hidden) throw Error('Destination canvas is currently undone');
      const destinationId = destinationDoc?.representationId ?? `draft-${crypto.randomUUID()}`;
      const name = destinationDoc?.name ?? ('name' in destinationChoice ? destinationChoice.name.trim() : '');
      if (!name || name.length > 120) throw Error('Enter a canvas name (up to 120 characters)');
      const destination = destinationDoc ? controllers.current.get(destinationId) ?? new MappingDocumentController(destinationDoc.document,
        destinationDoc.canvas, 0, undefined, undefined, destinationDoc.history, diagramService, canvasHistory) : undefined;
      const sourceView = structuredClone(source.getSnapshot().canvas);
      for (const node of Object.values(sourceView.display.nodes)) if (node.kind === 'selection' && selectedIds.includes(`grid:${node.sourceBoxId}`))
        sourceView.display = removeDisplayNode(sourceView.display, node.id);
      sourceView.diagramViews = Object.fromEntries(Object.entries(sourceView.diagramViews ?? {}).filter(([id]) => !selectedIds.includes(id)));
      sourceView.selection = { items: [] };
      sourceView.controls = { ...initialCanvasState().controls, activeBoxId: sourceView.controls.activeBoxId };
      const prepared = await runWorkspaceTask({ type: 'transfer', source: source.exportHistory(), destination: destination?.exportHistory(),
        input: { mode, sourceId, sourceAliases: [sourceId, drafts[sourceId].representationId ?? sourceId],
          destinationId, selectedIds, sourceView, destinationView: destination?.getSnapshot().canvas ?? initialCanvasState() } });
      workspace.documents = workspace.documents.map(doc => {
        if (doc.representationId === sourceId) return mode === 'move'
          ? { ...doc, document: prepared.source.document, history: prepared.source.history, canvas: prepared.source.view as MappingCanvasState }
          : { ...doc, canvas: deselectCanvas(doc.canvas) };
        if (doc.representationId === destinationId) return { ...doc, document: prepared.destination.document, history: prepared.destination.history, canvas: prepared.destination.view as MappingCanvasState };
        return doc;
      });
      if (!destinationDoc) workspace.documents.push({ representationId: destinationId, repositoryId: drafts[sourceId].repositoryId, name, revisionId: '', savedName: '',
        savedScene: JSON.stringify(emptyCanvasDocument().scene), savedEdges: '[]', document: prepared.destination.document,
        canvas: prepared.destination.view as MappingCanvasState, history: prepared.destination.history });
      workspace.activeDocumentId = destinationId;
      workspace.transfers = [...transfers.map(tx => tx.applied ? tx : { ...tx, discarded: true }), prepared.transaction];
      setTransferProgress(`Saving ${'name' in destinationChoice ? 'new canvas' : 'changes'} to “${name}”…`);
      await paintProgress();
      await publishTransfer(workspace); setPendingTransfer(undefined);
      setWorkspaceStatus(`${mode === 'copy' ? 'Copied' : 'Moved'} ${selectedIds.length} diagrams to “${name}”. Undo reverses the entire transfer.`);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { transferBusy.current = false; setWorkspaceBusy(false); setTransferProgress(''); }
  };
  const undo = async (id: string, redo = false) => {
    if (transferBusy.current || workspaceBusy || savingId || deletingId || Object.values(drafts).some(draft => draft.busy)) return;
    try {
      const tx = boundary(id, redo);
      if (!tx) { controllers.current.get(id)?.undo(redo); return; }
      const participants = new Set([tx.sourceId, tx.destinationId]);
      if (!redo && transfers.slice(transfers.indexOf(tx) + 1).some(later => later.applied &&
        (participants.has(later.sourceId) || participants.has(later.destinationId))))
        throw Error('Undo newer transfers involving either canvas first');
      const source = controllers.current.get(tx.sourceId), destination = controllers.current.get(tx.destinationId);
      if (!source || !destination) throw Error('Both canvases must be available to undo or redo this transfer');
      const prepared = source.prepareTransferNavigation(destination, tx, redo);
      const workspace = capture();
      workspace.documents = workspace.documents.map(doc => {
        const state: TransferState | undefined = doc.representationId === tx.sourceId ? prepared.source
          : doc.representationId === tx.destinationId ? prepared.destination : undefined;
        return state ? { ...doc, history: state.history, document: state.document, canvas: state.view as MappingCanvasState,
          hidden: doc.representationId === tx.destinationId && tx.destinationCreated !== false ? !redo : doc.hidden } : doc;
      });
      workspace.transfers = transfers.map(item => item.id === tx.id ? prepared.transaction : item);
      workspace.activeDocumentId = redo ? tx.destinationId : tx.sourceId;
      transferBusy.current = true; persistence.current?.setPaused(true); setWorkspaceBusy(true); setError('');
      await publishTransfer(workspace); setWorkspaceStatus(`${redo ? 'Redid' : 'Undid'} ${tx.mode} to canvas`);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { transferBusy.current = false; setWorkspaceBusy(false); }
  };
  const workspaceAction = async (action: 'save' | 'restore' | 'export', imported?: string) => {
    viewState.flush();
    persistence.current?.setPaused(true); setWorkspaceBusy(true); setError('');
    try {
      if (imported !== undefined) { restore(deserializeWorkspace(imported)); setWorkspaceStatus('Workspace imported'); }
      else if (action === 'save') { persistence.current?.setPaused(false); viewState.flush(); persistence.current?.update(activeId, transfers); persistence.current?.sync(); await storage.flush(); setWorkspaceStatus('Workspace saved'); }
      else if (action === 'restore') {
        const saved = await storage.restore();
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
        // These reads are independent. Share them across StrictMode effect replays.
        startup.current ??= Promise.all([loadProjectRepresentations('current'), storage.load().then(
          workspace => ({ workspace, restoreError: '' }),
          error => ({ workspace: null, restoreError: error instanceof Error ? error.message : 'Could not restore workspace' })
        )]);
        const [data, { workspace, restoreError }] = await startup.current;
        if (cancelled) return;
        setSnapshot(data);
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

  useEffect(() => {
    if (!workspaceLoaded || !snapshot?.project || !storage.records) return;
    const adapter = persistence.current = new WorkspacePersistence(workspace, storage.records, snapshot.project.id, viewState);
    adapter.update(activeId, transfers);
    const notify = () => {
      const status = storage.records!.status;
      if (status.error) setError(status.error);
      else if (!status.pending) setWorkspaceStatus('Editing history saved');
    };
    const off = storage.records.subscribe(notify); notify();
    const hidden = () => { if (document.visibilityState === 'hidden') { viewState.flush(); void storage.flush().catch(error => setError(String(error))); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { adapter.dispose(); if (persistence.current === adapter) persistence.current = undefined; off(); document.removeEventListener('visibilitychange', hidden); };
  }, [workspace, storage, viewState, workspaceLoaded, snapshot?.project?.id, workspaceEpoch]);
  useEffect(() => {
    persistence.current?.setPaused(workspaceBusy);
    if (!workspaceBusy) { persistence.current?.update(activeId, transfers); persistence.current?.sync(); }
  }, [workspaceBusy, activeId, transfers]);

  useEffect(() => {
    const back = () => { const id = new URL(location.href).searchParams.get("diagram"); if (id) open(id, snapshot, false); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [snapshot]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (viewState.pending || storage.records?.status.pending || Object.values(drafts).some((draft) => dirty(draft) || draft.busy)) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts, storage, viewState]);


  const save = async () => {
    if (!activeId || !active || active.busy || savingId || deletingId || workspaceBusy) return;
    const id = activeId;
    const captured = { ...active, document: documentOf(active), history: active.session.controller.exportHistory() };
    setSavingId(id); setError("");
    try {
      const result = await saveMappingProjectDiagram({ projectId: snapshot?.project?.id, repositoryId: captured.repositoryId, representationId: captured.representationId ?? (id.startsWith('draft-') ? undefined : id),
        history: captured.history, expectedRevisionId: captured.revisionId, name: captured.name, scene: captured.document.scene, edges: captured.document.edges });
      setSnapshot(result);
      setDrafts((current) => ({ ...current, [id]: { ...current[id], savedName: captured.name.trim(),
        name: current[id].name === captured.name ? captured.name.trim() : current[id].name,
        representationId: result.representation.id, repositoryId: result.representation.repositoryId, savedScene: JSON.stringify(captured.document.scene), savedEdges: JSON.stringify(captured.document.edges), revisionId: result.representation.currentRevisionId } }));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save diagram"); }
    finally { setSavingId(undefined); }
  };
  const create = async () => {
    if (savingId || deletingId || (copyCurrent && active?.busy)) return;
    setSavingId("new"); setError("");
    try {
      const document = copyCurrent && active ? documentOf(active) : mappingDocumentFromScene(singleDiagramScene(newAscii));
      const histories = new DefaultCanvasHistoryService();
      const context = histories.openContext(document, initialCanvasState(), copyCurrent && active ? active.session.controller.exportHistory() : undefined);
      const history = copyCurrent && active ? histories.forkContext(context, initialCanvasState()) : histories.exportContext(context);
      const result = await saveMappingProjectDiagram({ projectId: snapshot?.project?.id, repositoryId: newRepositoryId || active?.repositoryId || (snapshot?.project?.repositories?.length === 1 ? snapshot.project.repositories[0].id : undefined), name: newName,
        history, scene: document.scene, edges: document.edges,
        ...(copyCurrent && active ? { sourceRevisionId: active.revisionId } : {}) });
      setSnapshot(result); setCreating(false); open(result.representation.id, result);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create diagram"); }
    finally { setSavingId(undefined); }
  };

  const remove = async (id: string) => {
    const draftId = Object.entries(drafts).find(([key, draft]) => key === id || draft.representationId === id)?.[0] ?? id;
    const draft = drafts[draftId];
    const savedId = draft?.representationId ?? (draftId.startsWith('draft-') ? undefined : id);
    const diagram = savedId ? snapshot?.catalog?.representations[savedId] : undefined;
    const name = draft?.name ?? diagram?.name;
    if (!name || deletingId || savingId || workspaceBusy || Object.values(drafts).some(draft => draft.busy)) return;
    if (!window.confirm(`Delete diagram “${name}”?${draft && dirty(draft) ? "\n\nIts unsaved changes will be discarded." : ""}`)) return;
    setDeletingId(id); persistence.current?.setPaused(true); setWorkspaceBusy(true); transferBusy.current = true; setError('');
    try {
      const retired = new Set(transfers.filter(tx => tx.sourceId === draftId || tx.destinationId === draftId).map(tx => tx.id));
      const result = savedId ? await deleteMappingProjectDiagram(savedId) : snapshot!;
      if (savedId) setSnapshot(result);
      for (const [key, controller] of controllers.current) if (key !== draftId && retired.size) controller.retireTransactions(retired);
      const remaining = Object.fromEntries(Object.entries(workspace.store.getState().drafts).filter(([key]) => key !== draftId));
      const nextTransfers = transfers.filter(tx => !retired.has(tx.id));
      const nextId = activeId === draftId ? Object.entries(remaining).find(([, draft]) => !draft.hidden)?.[0] : activeId;
      setDrafts(remaining); setTransfers(nextTransfers); setActiveId(nextId);
      persistence.current?.setPaused(false);
      persistence.current?.update(nextId, nextTransfers);
      persistence.current?.sync([draftId, ...(retired.size ? Object.keys(remaining) : [])]);
      await storage.flush();
      if (!nextId) {
        const hiddenAliases = new Set(Object.entries(remaining).filter(([, doc]) => doc.hidden).map(([key, doc]) => doc.representationId ?? key));
        const available = Object.values(result.catalog?.representations ?? {}).find(diagram => diagram.status === 'settled' && !hiddenAliases.has(diagram.id));
        if (available) open(available.id, result, false);
      }
      setWorkspaceStatus(`Deleted “${name}”`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not delete diagram'); }
    finally { setDeletingId(undefined); setWorkspaceBusy(false); transferBusy.current = false; }
  };

  useEffect(() => {
    for (const [id, draft] of Object.entries(drafts)) viewState.prune(id, canvasOf(draft).display);
  }, [drafts, viewState]);

  // Revisions are immutable: cache each canvas's exported history until its checkpoint changes.
  const histories = useRef(new WeakMap<object, { key: string; record: CanvasHistoryRecord }>());
  const knownRevisions = () => {
    const revisions = new Map<string, DiagramRevision>();
    for (const draft of Object.values(drafts)) {
      const controller = draft.session?.controller; if (!controller) continue;
      const state = controller.getSnapshot(), key = `${state.canvasRevisionId}:${state.version}`;
      let cached = histories.current.get(controller);
      if (cached?.key !== key) histories.current.set(controller, cached = { key, record: controller.exportHistory() });
      for (const revision of Object.values(cached.record.diagramRevisions)) revisions.set(revision.id, revision);
    }
    return revisions;
  };
  const revisionDepth = (revisions: ReadonlyMap<string, DiagramRevision>, id: string) => {
    let depth = 0;
    for (let revision = revisions.get(id); revision && depth < 100000; revision = revision.parentId ? revisions.get(revision.parentId) : undefined) depth++;
    return depth || undefined;
  };
  const findRevision = (id: string) => {
    const known = knownRevisions().get(id);
    if (known) return known;
    try { return diagramService.getRevision(id); } catch { return undefined; }
  };
  const revisionSource: PromptRevisionSource = {
    list: target => {
      const node = drafts[target.documentId]?.session?.controller.nodes().find(node => node.id === target.nodeId);
      const diagram = node?.layout === 'grid' ? node.diagram : undefined;
      if (!diagram) return [];
      const revisions = knownRevisions();
      for (const summary of diagramService.listRevisions(diagram.diagramId))
        if (!revisions.has(summary.id)) try { revisions.set(summary.id, diagramService.getRevision(summary.id)); } catch { /* Not hydrated in this tab. */ }
      return [...revisions.values()].filter(revision => revision.diagramId === diagram.diagramId).map((revision): PromptRevision => ({
        id: revision.id, diagramId: revision.diagramId, sequence: revisionDepth(revisions, revision.id) ?? 1, current: revision.id === diagram.revisionId,
        title: diagramTitle(revision.diagram), ascii: revision.diagram.content.ascii
      })).sort((a, b) => b.sequence - a.sequence || a.id.localeCompare(b.id));
    },
    sequence: id => revisionDepth(knownRevisions(), id)
  };
  const capturedSelection = (documentId: string) => {
    const controller = drafts[documentId]?.session.controller;
    const snapshot = controller?.getSnapshot();
    const references: PromptReference[] = [], selections: { id: string; reference?: PromptReference }[] = [], sources: ContentNodeAnchor[] = [];
    let subtree: import('../../../domain/mapping/agent/diagramEdit').EditDiagramInput['subtree'];
    let selectedNodeId: string | undefined, subtreeLabel: string | undefined;
    for (const item of snapshot?.canvas.selection.items ?? []) {
      const box = findBox(snapshot!.document.scene.root, item.displayNodeId.slice(5));
      const diagram = box?.kind === 'diagram' ? snapshot!.document.scene.contents[box.contentId] : undefined;
      if (!diagram || item.region && item.region.sourceAscii !== diagram.content.ascii) {
        selections.push({ id: item.id }); continue;
      }
      const reference = item.region ? nodesReference(diagram, box!.id, item.region.rect, item.region.contentNodeIds) : diagramReference(diagram);
      references.push(reference); selections.push({ id: item.id, reference });
      const nodes = diagramContentNodes(diagram.content);
      const selected = item.region ? selectionContentNodes(diagram, item.region) : nodes.filter(node => !node.parentId);
      for (const node of selected) sources.push({ kind: 'content-node', displayNodeId: item.displayNodeId,
        contentNodeId: node.id, revisionId: diagram.content.revisionId, side: 'auto' });
      if (item.region && selected.length && (!subtree || item.id === snapshot!.canvas.controls.selectionFocusId)) {
        subtree = { contentNodeId: selected[0].id, revisionId: diagram.content.revisionId }; selectedNodeId = item.displayNodeId; subtreeLabel = selected[0].label;
      }
    }
    return { references, selections, sources: [...new Map(sources.map(source => [JSON.stringify(source), source])).values()], subtree, selectedNodeId, subtreeLabel };
  };
  const selectionChanged = (documentId: string) => {
    const captured = capturedSelection(documentId);
    const key = prompts.store.getState().activeKey, entry = key && prompts.store.getState().entries[key];
    if (key && entry && entry.target.documentId === documentId) prompts.setTarget(key, {
      sources: captured.sources, ...((!entry.target.subtree || entry.run?.status === 'completed' || entry.run?.status === 'conflict') && captured.subtree ? { subtree: captured.subtree, subtreeLabel: captured.subtreeLabel, nodeId: captured.selectedNodeId } : {}) });
    prompts.syncSelections(documentId, captured.selections);
  };
  const openComposer = (documentId: string, nodeId: string, operation: PromptOperation, fresh = false) => {
    const draft = drafts[documentId], captured = capturedSelection(documentId);
    nodeId = captured.selectedNodeId ?? nodeId;
    const node = draft?.session.controller.nodes().find(node => node.id === nodeId);
    if (!draft || nodeId !== 'canvas' && (node?.layout !== 'grid' || node.kind !== 'diagram')) { setError('Open a canvas containing a diagram to start an LLM.'); return; }
    const title = node?.layout === 'grid' && node.diagram ? diagramTitle(node.diagram) : 'New diagram';
    const key = prompts.open({ operation, canvasId, documentId, nodeId, label: `${draft.name} / ${captured.subtreeLabel ?? title}`,
      subtree: captured.subtree, subtreeLabel: captured.subtreeLabel, sources: captured.sources }, fresh);
    prompts.syncSelections(documentId, captured.selections);
    setToolsOpen(true); setToolTab('llm'); setExplorerTab('llms');
    if (nodeId.startsWith('grid:')) setDrafts(current => ({ ...current, [documentId]: { ...current[documentId],
      focusBox: { id: nodeId.slice(5), contentNodeId: captured.subtree?.contentNodeId, serial: Date.now() } } }));
    return key;
  };
  const newLlm = () => {
    if (!activeId || !active) return;
    const node = active.session.controller.nodes().find(node => node.layout === 'grid' && node.kind === 'diagram');
    openComposer(activeId, node?.id ?? 'canvas', 'create-diagram', true);
  };
  /** Copy goes to the clipboard; insert goes into the open composer, or opens an edit prompt for this diagram. */
  const shareReferences = (documentId: string, references: PromptReference[], mode: 'copy' | 'insert', nodeId: string) => {
    const count = `${references.length} reference${references.length === 1 ? '' : 's'}`;
    if (mode === 'copy') {
      void copyPromptReferences(references).then(() => setWorkspaceStatus(`Copied ${count} · paste into any prompt box`))
        .catch(error => setError(`Copy failed: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const key = prompts.store.getState().activeKey ?? openComposer(documentId, nodeId, 'edit-diagram');
    if (!key) return;
    for (const reference of references) if (!prompts.insertReference(reference, key)) {
      setError('That prompt is busy or full. Wait for its request to finish, or remove a reference.'); return;
    }
    prompts.show(key); setWorkspaceStatus(`Added ${count} to the prompt`);
  };
  const placement = useMemo(() => carried && activeId ? { onPlace: (point: { column: number; row: number }) => {
    const controller = draftRef.current[activeId]?.session?.controller, revision = findRevision(carried.reference.revisionId);
    prompts.carry();
    if (!controller || !revision) { setError('That revision is no longer available.'); return; }
    const { content, sourceContext } = revision.diagram;
    try {
      controller.applyUpdate(controller.getSnapshot().version, [structuredClone({ method: 'diagram-create', id: `diagram-${crypto.randomUUID()}`, position: point,
        ascii: content.ascii, structureKind: content.structure.kind, mappings: sourceContext.mappings, evidence: sourceContext.evidence,
        source: sourceContext.binding }) as Extract<DiagramOperation, { method: 'diagram-create' }>]);
      setWorkspaceStatus(`Placed ${carried.reference.label} on the canvas · Undo to remove`);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  } } : undefined, [carried, activeId]);

  return <SourcePaneViewStateContext.Provider value={viewState}><UiTestFramework id="mapping-local-chat" title="Local chat variants" controls={LOCAL_CHAT_UI_CONTROLS}>
    {(ui) => <main className="mapping-poc-shell" data-local-chat-variant={ui.variant}>
      <header className="workspace-header mapping-poc-header" inert={!!pendingTransfer}>
        {!changeMode && <MappingSubmenu projectName={snapshot?.project?.name ?? "Project"} name={active?.name ?? ""}
          status={savingId ? "Saving…" : active?.busy ? "Editing…" : active ? dirty(active) ? "Unsaved changes" : "Saved" : ""}
          canSave={Boolean(active?.name.trim() && active && dirty(active) && !active.busy && !savingId && !deletingId && !workspaceBusy)}
          onNameChange={(name) => { if (activeId) setDrafts((current) => ({ ...current, [activeId]: { ...current[activeId], name } })); }}
          onNew={() => { setCopyCurrent(false); setCreating(true); }} onSave={() => void save()} />}
        {!changeMode && <div className="mapping-workspace-actions">
          <span className="mapping-agent-status" role="status" aria-live="polite" aria-atomic="true"
            data-state={!agentStatus.connected ? 'unavailable' : agentStatus.count ? 'connected' : 'idle'}
            title={agentStatus.connected ? 'Live agent connections across this workspace' : 'Reconnecting to check agent connections'}>
            <span className="mapping-agent-status-dot" aria-hidden="true" />
            {!agentStatus.connected ? 'Agents unavailable' : agentStatus.count
              ? `${agentStatus.count} agent${agentStatus.count === 1 ? '' : 's'} connected` : 'No agents connected'}
          </span>
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
          {Object.entries(drafts).filter(([id]) => mountedDocuments.current.has(id)).map(([id, draft]) => <SourcePaneDocumentContext.Provider key={`${workspaceEpoch}:${id}:${draft.reloadKey ?? ''}`} value={id}><SourcePaneDocumentActiveContext.Provider value={id === activeId && !changeMode}><div className="mapping-document-view" inert={!!pendingTransfer || workspaceBusy} hidden={draft.hidden || id !== activeId || !!changeMode}>
            <MappingEditorCanvas session={draft.session} className="mapping-poc-canvas" enabled={id === activeId && !draft.hidden && !changeMode} focusBox={draft.focusBox}
              initialTransform={draft.viewport} onTransformChange={viewport => viewState.setCamera(id, viewport)}>
              <MappingPocSelectionCanvas onUpdateDiagram={nodeId => { openComposer(id, nodeId, capturedSelection(id).subtree ? 'edit-diagram' : 'create-diagram', true); }}
                onOpenLlm={() => {
                  const key = prompts.store.getState().activeKey;
                  const entry = key && prompts.store.getState().entries[key];
                  if (entry && entry.target.documentId === id) {
                    prompts.syncSelections(id, capturedSelection(id).selections);
                    setToolsOpen(true); setToolTab('llm'); setExplorerTab('llms');
                  } else newLlm();
                }}
                onSelectionChange={() => selectionChanged(id)}
                extension={toolsOpen && toolTab === 'llm' && activeLlm && llmEntries[activeLlm]?.target.documentId === id && llmEntries[activeLlm].target.operation === 'extend-diagram'
                  ? { key: activeLlm, disabled: composerUnsettled(llmEntries[activeLlm]), origin: llmEntries[activeLlm].target.origin, onPlace: point => prompts.setTarget(activeLlm, { origin: point }) } : undefined}
                onReference={(references, mode, nodeId) => shareReferences(id, references, mode, nodeId)}
                placement={id === activeId ? placement : undefined} onTransfer={(mode, selected) => beginTransfer(id, mode, selected)}
                onUndo={redo => void undo(id, redo)} canWorkspaceUndo={!!boundary(id)} canWorkspaceRedo={!!boundary(id, true)} onJump={target => void jumpTo(target)} session={draft.session} active={id === activeId && !draft.hidden && !workspaceBusy && !pendingTransfer && !creating && !changeMode} focusBox={draft.focusBox} searchMatches={searchMatchesByDocument.get(id)}
                projectContext={draft.revisionId ? { projectId: snapshot!.project!.id, representationId: draft.representationId ?? id, baseRevisionId: draft.revisionId } : undefined}
                projectionCatalog={snapshot?.catalog ?? undefined}
                dirtyRepresentationIds={dirtySceneIds}
                onBusyChange={(busy) => setDrafts((current) => !current[id] || current[id].busy === busy ? current : { ...current, [id]: { ...current[id], busy } })}
                localChatVariant={ui.variant as LocalChatVariant} />
            </MappingEditorCanvas>
            <SourceWindowPanel session={draft.session} projectId={snapshot?.project?.id}
              active={id === activeId && !draft.hidden && !changeMode} />
          </div></SourcePaneDocumentActiveContext.Provider></SourcePaneDocumentContext.Provider>)}
          {!active && !changeMode && <div className="mapping-empty"><h1>{snapshot ? "Create a project diagram" : error ? "Could not load project diagrams" : "Loading project diagrams…"}</h1>
            {snapshot && <button type="button" onClick={() => setCreating(true)}>New diagram</button>}</div>}
          {changeMode && <ChangeSessionPreview mode={changeMode} onSelect={selectChangeMode} onOpenAccepted={openAccepted}
              onDiffTreeJump={revealDiffTreeNode}
              onSearchDocument={onProposalSearchDocument} searchFocus={proposalSearchFocus && proposalSearchFocus.documentId === proposalSearchId ? proposalSearchFocus.focus : undefined}
              searchMatches={proposalSearchId ? searchMatchesByDocument.get(proposalSearchId) : undefined} />}
          {diffTreeMode && <DiffTreePanel key={diffTreeMode.sessionId} mode={diffTreeMode}
              revealNode={diffTreeReveal?.sessionId === diffTreeMode.sessionId ? diffTreeReveal : undefined}
              onSearch={() => setSearchOpenRequest(value => value + 1)}
              revealCanvasSerial={proposalSearchFocus?.documentId === proposalSearchId ? proposalSearchFocus?.focus.serial : undefined}
              onClose={() => { setDiffTreeMode(undefined); setDiffTreeReveal(undefined); }} onNavigate={setChangeMode}
              canvas={changeMode?.documentId ? <ChangeSessionPreview compact mode={changeMode} onSelect={selectChangeMode} onOpenAccepted={openAccepted}
                onDiffTreeJump={revealDiffTreeNode}
                searchFocus={proposalSearchFocus?.documentId === proposalSearchId ? proposalSearchFocus?.focus : undefined}
                searchMatches={proposalSearchId ? searchMatchesByDocument.get(proposalSearchId) : undefined} />
                : <p className="window-panel-message">Select a canvas in the explorer.</p>} />}
          {!pendingTransfer && <>
            {!toolsOpen && !diffTreeMode && <button className="workspace-tools-open" aria-label="Search diagrams" onClick={() => { setToolTab('search'); setToolsOpen(true); }}>Search</button>}
            <div hidden={!toolsOpen}>
              <WindowPanel title="Workspace tools" activeTab={toolTab} onTabChange={setToolTab} onClose={closeTools} tabs={[
                { id: 'search', title: 'Search', content: <DiagramSearchPanel embedded openRequest={searchOpenRequest} visible={toolsOpen && toolTab === 'search'}
                  onOpen={() => { setToolTab('search'); setToolsOpen(true); }} onClose={closeTools}
                  service={search} activeDocumentId={proposalSearchId ?? activeId}
                  activeName={changeMode ? proposalSearchDocument?.name : active?.name}
                  onReveal={revealSearchResult} onClear={clearSearchFocus} onMatches={setSearchMatches} /> },
                { id: 'llm', title: 'LLM', content: <PromptComposer coordinator={prompts} revisions={revisionSource} /> }
              ]} />
            </div>
          </>}
          <FloatingPane highlighted={!!pendingTransfer}><MappingDiagramExplorer explorerTab={explorerTab}
            llms={<><button className="llm-explorer-new" disabled={!active} onClick={newLlm}>New LLM</button>
              <nav aria-label="LLM sessions">{Object.entries(llmEntries).map(([key, entry]) => <div key={key} className="mapping-explorer-row">
                <button aria-current={activeLlm === key ? 'page' : undefined} className={activeLlm === key ? 'is-active' : undefined}
                  onClick={() => { prompts.show(key); prompts.syncSelections(entry.target.documentId, capturedSelection(entry.target.documentId).selections, key); setToolTab('llm'); setToolsOpen(true); setChangeMode(undefined); setActiveId(entry.target.documentId); }}>
                  {entry.target.label} · {entry.run?.status ?? entry.target.operation}
                </button>
                <button className="mapping-explorer-delete" aria-label={`Dismiss LLM ${entry.target.label}`} disabled={composerUnsettled(entry)} onClick={() => prompts.dismiss(key)}>×</button>
              </div>)}</nav></>}
            transfer={pendingTransfer ? { mode: pendingTransfer.mode, count: pendingTransfer.selectedIds.length,
              sourceId: drafts[pendingTransfer.sourceId]?.representationId ?? pendingTransfer.sourceId, busy: workspaceBusy, error, progress: transferProgress,
              onCancel: cancelTransfer, onNew: name => void transfer({ name }) } : undefined}
            onTabChange={tab => { setExplorerTab(tab); if (tab === 'diagrams') setChangeMode(undefined); }}
            changeMode={changeMode} onChangeSelect={selectChangeMode} projectName={snapshot?.project?.name ?? "Project"} repositories={snapshot?.project?.repositories ?? []} diagrams={diagrams}
            activeId={active?.representationId ?? activeId} scene={active ? documentOf(active).scene : undefined} dirtyIds={Object.keys(drafts).filter((id) => dirty(drafts[id])).map(id => drafts[id].representationId ?? id)}
            onDelete={id => void remove(id)} deletingId={deletingId} deleteDisabled={Boolean(deletingId || savingId || workspaceBusy)}
            busyIds={Object.keys(drafts).filter(id => drafts[id].busy).map(id => drafts[id].representationId ?? id)}
            onOpen={(id) => { if (pendingTransfer) void transfer({ id }); else { setChangeMode(undefined); open(id); } }} onFocus={(id) => { if (activeId && !drafts[activeId]?.busy) setDrafts((current) => ({ ...current,
              [activeId]: { ...current[activeId], focusBox: { id, serial: (current[activeId].focusBox?.serial ?? 0) + 1 } } })); }} /></FloatingPane>
          {workspaceBusy && <div className="mapping-transfer-busy" role="status" aria-live="polite"><div><strong>{transferProgress || 'Saving workspace…'}</strong><p>Keep this page open while the operation finishes.</p></div></div>}
        </div>
        <footer className="mapping-poc-status"><span>{active?.name ?? "PROJECT DIAGRAMS"}</span>
          <span>{active?.newerRevision ? 'A newer saved revision is available. Your local edits were preserved.' : workspaceStatus || 'Drag boxes to move · Ctrl-drag selects regions · Space or middle-drag pans · Actions (A) opens selection actions'}</span></footer>
      </section>
      {creating && <div className="mapping-dialog-backdrop"><form className="mapping-create-dialog" role="dialog" aria-modal="true" aria-label="New project diagram"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !savingId) { event.preventDefault(); setCreating(false); setError(""); }
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)"));
          const next = event.shiftKey ? controls.at(-1) : controls[0];
          if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); next?.focus(); }
        }}
        onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <h2>New project diagram</h2>
        <label>Name<input autoFocus aria-label="New diagram name" value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} /></label>
        {!!snapshot?.project?.repositories?.length && <label>Repository<select aria-label="Canvas repository" value={newRepositoryId || active?.repositoryId || (snapshot.project.repositories.length === 1 ? snapshot.project.repositories[0].id : '')} onChange={event => setNewRepositoryId(event.target.value)}>
          <option value="" disabled>Select a repository</option>{snapshot.project.repositories.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}
        </select></label>}
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
