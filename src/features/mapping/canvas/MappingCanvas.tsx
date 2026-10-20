import { completeMarquee } from '../../../../domain/mapping/selection/completeMarquee';
import type { SelectionHit, SelectionPolicy } from '../../../../domain/mapping/selection/selectionGesture';
import { shareEqual, CanvasRuntimeContext } from '../tldraw/CanvasRuntimeContext';
import { diagramSelectionItem, regionSelectionItem, selectedDiagramIds, selectionContentNodes, type SelectionState } from '../../../../domain/mapping/selection/selectionState';
import { toggleSubtreeSelection } from '../../../../domain/mapping/selection/subtreeSelection';
import type { PromptReference } from '../../../../domain/mapping/agent/diagramEdit';
import { nodesReference } from '../prompt-composer/promptReferences';
import { useMappingServices } from '../services/MappingServices';
import { useStore } from 'zustand';
import type { CanvasSession } from '../workspace/canvasSession';
import { deselectCanvas, selectCanvasMarquee, updateSelection, type CanvasMarqueeSelection, type SelectionBounds } from '../../../../domain/mapping/selection/canvasSelection';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { handleNodeSelect, DEFAULT_MAPPED_RESOURCE_TYPE } from '../../../../domain/mapping/code-panel/codePanel';
import { upsertCodePanel } from '../code-panel/codePanelState';
import { CanvasSelectionLayer } from './CanvasSelectionLayer';
import { CursorCopyOverlay } from './CursorCopyOverlay';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { useEndpointGeometry } from './useEndpointGeometry';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import { diagramSceneText } from '../../../../domain/mapping/workspace/diagramSceneText';
import { SearchHighlight, type DiagramFocus } from '../search/SearchHighlight';
import { revealSearchMatches } from '../search/revealSearchMatches';
import { type DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import { DiagramConnections } from './DiagramConnections';
import { exportedEvidenceId } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { diagramSource } from '../../../../domain/core/diagrams/diagram';
import { diagramSelectionNodes } from '../../../../domain/mapping/workspace/mappingDocument';
import { diagramProjection } from '../../../../domain/mapping/workspace/diagramViewState';
import { DiagramSubtreeControls } from './DiagramSubtreeControls';
import { CanvasTransferMenu } from "./CanvasTransferMenu";
import { LocalChatVerbosityToggle } from "../chat/LocalChatVerbosityToggle";
import { selectionClipboardText } from "../../../../domain/mapping/workspace/selectionClipboard";
import { layoutConversationPane } from "../../../../domain/mapping/chat/conversationPaneLayout";
import { addDisplayNode, displayGeometry, measureDisplayNode, removeDisplayNode, setExpansion, type DisplayState, type SelectionRegion, type ConversationPane, type ProjectedPane } from "../../../../domain/mapping/workspace/displayModel";
import { initialSelectionSurface, selectionSurfaceKeys, type MappingCanvasState, type MappingControlValues, type SelectionSurfaceState } from "../../../../domain/mapping/workspace/mappingWorkspace";
import { SelectionEffectsLayer } from "./SelectionEffectsLayer";
import { flattenGrid, layoutScene, resolveScene, updateGridBox, type GridPoint as ScenePoint } from "../../../../domain/core/diagrams/lineGrid";
import { type MappingGridDocument } from "../../../../domain/mapping/workspace/mappingGrid";
import { projectSelection, validateProjection } from "../../../../domain/core/diagrams/diagramProjection";
import type { ProjectRepresentationCatalogRecord } from "../../../../domain/core/representations/projectCatalog";
import {
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent
} from "react";
import { createPortal } from "react-dom";
import {
  projectASelectionToB,
  type MappingPocANode,
  type MappingPocGridRect
} from "../../../../domain/mapping/selection/mappingPoc";
import {
  MAPPING_POC_DETAIL_OVERLAYS,
  MAPPING_POC_OVERLAY_PLACEMENTS
} from "../../../../domain/mapping/selection/mappingPocOverlays";
import { localChatResponder, promptMappingPocSelection } from "../api";
import {
  isLocalChatSubmitHotkey,
  type LocalChatVerbosity,
  type LocalChatThread,
  type LocalChatVariant
} from "../../../../domain/mapping/chat/localChat";
import { LocalChatConvo } from "../chat/LocalChatConvo";

interface CellMetrics { width: number; height: number }

function useControl<K extends keyof MappingControlValues>(key: K, state: MappingCanvasState,
  setState: Dispatch<SetStateAction<MappingCanvasState>>): [MappingControlValues[K], Dispatch<SetStateAction<MappingControlValues[K]>>] {
  const isSurface = (selectionSurfaceKeys as readonly string[]).includes(key);
  const read = (current: MappingCanvasState) => (isSurface
    ? (current.controls.surfaces[current.controls.selectionFocusId ?? 'draft'] ?? current.controls.surfaces.draft)
    : current.controls) as MappingControlValues;
  const set = useCallback((value: SetStateAction<MappingControlValues[K]>) => setState(current => {
    const nextValue = typeof value === 'function' ? (value as (old: MappingControlValues[K]) => MappingControlValues[K])(read(current)[key]) : value;
    if (isSurface) {
      const owner = current.controls.selectionFocusId && current.controls.surfaces[current.controls.selectionFocusId] ? current.controls.selectionFocusId : 'draft';
      return { ...current, controls: { ...current.controls, surfaces: { ...current.controls.surfaces,
        [owner]: { ...current.controls.surfaces[owner], [key]: nextValue } } } };
    }
    const surfaces = { ...current.controls.surfaces };
    if (key === 'selectionFocusId' && nextValue !== current.controls.selectionFocusId) {
      const target = nextValue as string | null;
      if (!target) surfaces.draft = { ...initialSelectionSurface(), presentation: (surfaces[current.controls.selectionFocusId ?? 'draft'] ?? surfaces.draft).presentation };
      else if (current.display.nodes[target]) surfaces[target] ??= { ...surfaces[current.controls.selectionFocusId ?? 'draft'] ?? initialSelectionSurface() };
    }
    return { ...current, controls: { ...current.controls, [key]: nextValue, surfaces } };
  }), [key, isSurface, setState]);
  return [read(state)[key], set];
}

function typingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches("input, textarea, select") || target.isContentEditable);
}


const emptySelectionScene = singleDiagramScene('[Empty canvas]');
const emptySelectionBox = flattenGrid(resolveScene(emptySelectionScene)).find(box => box.contentId)!;

export function MappingPocSelectionCanvas(props: {
  onSelectionChange?: () => void;
  extension?: { key: string; disabled?: boolean; origin?: { column: number; row: number }; onPlace: (point: { column: number; row: number }) => void };
  onUpdateDiagram?: (nodeId: string) => void;
  /** References are captured here, at the moment of the action, from the exact displayed revision. */
  onReference?: (references: PromptReference[], mode: 'copy' | 'insert', nodeId: string) => void;
  /** While set, a click on the canvas places something at that grid point instead of selecting. */
  placement?: { onPlace: (point: ScenePoint) => void };
  onTransfer?: (mode: 'copy' | 'move', selectedIds: string[]) => void;
  onUndo?: (redo: boolean) => void;
  canWorkspaceUndo?: boolean;
  canWorkspaceRedo?: boolean;
  session: CanvasSession;
  onJump?: (target: DiagramJumpTarget) => void;
  onBusyChange?: (busy: boolean) => void;
  active?: boolean;
  focusBox?: DiagramFocus;
  searchMatches?: readonly import('../../../../domain/mapping/search/diagramSearch').DiagramLineSearchResult[];
  projectContext?: { projectId: string; representationId: string; baseRevisionId: string };
  projectionCatalog?: ProjectRepresentationCatalogRecord;
  dirtyRepresentationIds?: string[];
  onLineCountChange?: (lineCount: number) => void;
  localChatVariant?: LocalChatVariant;
}) {
  const nativeRuntime = useContext(CanvasRuntimeContext);
  const session = props.session, controller = session.controller;
  const documentState = useStore(session.document, state => state.document);
  const presentation = useStore(session.presentation, state => state);
  const controls = useStore(session.controls, state => state);
  const geometry = useStore(session.geometry, state => nativeRuntime ? state.cell : state);
  const status = useStore(session.status, state => state);
  const selection = useStore(session.selection, state => state);
  const controllerState = useMemo(() => controller.getSnapshot(), [controller, documentState, presentation, controls, geometry, status, selection]);
  const canvasState = useMemo(() => ({ ...presentation, controls, selection }), [presentation, controls, selection]);
  const setCanvasState = useCallback((value: SetStateAction<MappingCanvasState>) => controller.updateCanvas(value), [controller]);
  const localChatVariant = (canvasState.controls.surfaces[canvasState.controls.selectionFocusId ?? 'draft'] ?? canvasState.controls.surfaces.draft).presentation;
  const previousVariant = useRef(props.localChatVariant);
  useEffect(() => {
    if (previousVariant.current === props.localChatVariant) return;
    previousVariant.current = props.localChatVariant;
    const presentation = props.localChatVariant ?? 'compact';
    setCanvasState(current => ({ ...current,
      controls: { ...current.controls, surfaces: Object.fromEntries(Object.entries(current.controls.surfaces).map(([id, surface]) => [id, { ...surface, presentation }])) },
      display: { ...current.display, nodes: Object.fromEntries(Object.entries(current.display.nodes).map(([id, node]) => [id, node.kind === 'conversation' ? { ...node, presentation, geometryPolicy: { placement: 'automatic' as const, sizing: 'content' as const }, expandedGeometry: undefined } : node])) }
    }));
  }, [props.localChatVariant]);
  const display = canvasState.display;
  const operationOwnerRef = useRef<string>('draft'); operationOwnerRef.current = canvasState.controls.selectionFocusId && canvasState.controls.surfaces[canvasState.controls.selectionFocusId] ? canvasState.controls.selectionFocusId : 'draft';
  const isGenerating = Object.values(canvasState.controls.surfaces).some(surface => surface.promptPhase === 'generating');
  const updateSurface = (owner: string, patch: Partial<SelectionSurfaceState>) => setCanvasState(current =>
    current.controls.surfaces[owner] ? { ...current, controls: { ...current.controls, surfaces: { ...current.controls.surfaces,
      [owner]: { ...current.controls.surfaces[owner], ...patch } } } } : current);

  const setDisplayLayout = useCallback((value: SetStateAction<DisplayState>) => setCanvasState(current => {
    const display = typeof value === 'function' ? value(current.display) : value;
    return display === current.display ? current : { ...current, display };
  }), [setCanvasState]);
  const measurePane = useCallback((id: string, width: number, height: number) =>
    setDisplayLayout(current => measureDisplayNode(current, id, width, height)), [setDisplayLayout]);
  useLayoutEffect(() => {
    const layout = () => setDisplayLayout(current => {
      let next = current;
      for (const node of Object.values(current.nodes)) if (node.kind === 'conversation') {
        next = layoutConversationPane(next, node, { width: window.innerWidth, height: window.innerHeight });
      }
      return next;
    });
    layout(); window.addEventListener('resize', layout);
    return () => window.removeEventListener('resize', layout);
  }, [display, setDisplayLayout]);
  const setDisplay = useCallback((value: SetStateAction<DisplayState>) => controller.updateCanvas(current => {
    const display = typeof value === 'function' ? value(current.display) : value;
    return display === current.display ? current : { ...current, display };
  }, true), [controller]);
  const [actionsOpen, setActionsOpen] = useControl('actionsOpen', canvasState, setCanvasState);
  const [selectionFocusId, setSelectionFocusId] = useControl('selectionFocusId', canvasState, setCanvasState);
  const focusedItem = selection.items.find(item => item.id === selectionFocusId && item.region);
  const retainedSelectionId = focusedItem && display.nodes[focusedItem.id]?.kind === 'selection' ? focusedItem.id : null;
  const [ctrlSelecting, setCtrlSelecting] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => setCtrlSelecting(event.ctrlKey);
    const clear = () => setCtrlSelecting(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', down); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', down); window.removeEventListener('blur', clear); };
  }, []);

  const stageRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openMappedRef = useRef<HTMLButtonElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const askInputRef = useRef<HTMLTextAreaElement>(null);
  const codePanelFocus = useRef<{ panelId: string; selectionId: string } | null>(null);
  const replyControllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    for (const controller of replyControllers.current.values()) controller.abort();
    replyControllers.current.clear();
  }, []);
  const [clientSessionId] = useState(() => `mapping-${crypto.randomUUID()}`);
  const [cell, setCell] = useState<CellMetrics>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const configure = () => controller.configureLayout(cell, { width: window.innerWidth, height: window.innerHeight });
    configure(); window.addEventListener('resize', configure);
    return () => window.removeEventListener('resize', configure);
  }, [controller, cell]);
  const gridDocument = controllerState.document;
  const scene = gridDocument.scene;
  const resolved = useMemo(() => resolveScene(scene), [scene]);
  const boxes = useMemo(() => flattenGrid(resolved), [resolved]);
  const [activeBoxId, setActiveBoxId] = useControl("activeBoxId", canvasState, setCanvasState);
  const activeBox = boxes.find((node) => node.box.id === activeBoxId && node.contentId)
    ?? boxes.find((node) => node.contentId) ?? emptySelectionBox;
  const content = scene.contents[activeBox.contentId!] ?? emptySelectionScene.contents[emptySelectionBox.contentId!];
  const ascii = content.content.ascii;
  const diagramRevision = content.revision;
  const nodes = useMemo(() => scene.contents[activeBox.contentId!] ? diagramSelectionNodes(content) : [], [content, scene, activeBox]);
  const sections = gridDocument.sections[content.id] ?? [];
  const contentProjections = useMemo(() => new Map(boxes.filter(box => box.contentId).map(box => [box.box.id,
    diagramProjection(scene, box.box.id, box.contentId!, box.box.collapsed ? undefined : canvasState.diagramViews)])), [boxes, scene, canvasState.diagramViews]);
  const activeProjection = contentProjections.get(activeBox.box.id) ?? diagramProjection(emptySelectionScene, emptySelectionBox.box.id, emptySelectionBox.contentId!);
  // Selection controls do not change the display-node registry.
  const displayNodes = useMemo(() => controller.nodes(), [controller, gridDocument, display,
    canvasState.diagramViews, controllerState.version, controllerState.cell, controllerState.endpointBounds]);
  const endpointGeometry = useEndpointGeometry(controller, props.active !== false && !nativeRuntime);
  const composedText = useMemo(() => nativeRuntime ? { ascii: '', rows: [] } : diagramSceneText(scene, canvasState.diagramViews, gridDocument.jumps), [scene, canvasState.diagramViews, gridDocument.jumps]);
  const composedAscii = composedText.ascii;
  const commit = (next: MappingGridDocument) => controller.commitDocument(next);
  const [promptOperation, setPromptOperation] = useControl("promptOperation", canvasState, setCanvasState);
  const [diagramPlacement, setDiagramPlacement] = useState<string | null>(null);
  const placementDragRef = useRef<ScenePoint | null>(null);
  const placementPointerRef = useRef<number | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{ start: ScenePoint; end: ScenePoint } | null>(null);
  const [movingBoxId, setMovingBoxId] = useState<string | null>(null);
  const selectionRect = focusedItem?.region?.rect ?? null;
  const diagramSelection = selectedDiagramIds(selection);
  const selectedDiagrams = (diagramSelection ?? []).filter(id => boxes.some(box => `grid:${box.box.id}` === id && box.box.kind === 'diagram'));
  const selectedNodeIds = focusedItem?.region?.selectedIds ?? [];
  const contentOfBox = (boxId: string) => { const box = boxes.find(node => node.box.id === boxId); return box?.contentId ? scene.contents[box.contentId] : undefined; };
  const focusedReference = () => {
    const boxId = focusedItem?.displayNodeId.slice(5), diagram = boxId && contentOfBox(boxId);
    return diagram && focusedItem?.region ? nodesReference(diagram, boxId, focusedItem.region.rect, focusedItem.region.contentNodeIds) : undefined;
  };
  const [projectionChoice] = useControl("projectionChoice", canvasState, setCanvasState);
  const openDetailIds = new Set(Object.values(display.nodes).filter(node => node.kind === 'detail').map(node => node.kind === 'detail' ? node.sectionId : undefined));
  const openDetail = (sectionId: string) => {
    const existing = Object.values(display.nodes).find(node => node.kind === 'detail' && node.sectionId === sectionId);
    if (existing) { setDisplay(state => setExpansion(state, existing.id, 'expanded')); return; }
    const overlay = MAPPING_POC_DETAIL_OVERLAYS.find(item => item.id === sectionId);
    const placement = MAPPING_POC_OVERLAY_PLACEMENTS.find(item => item.overlayId === sectionId);
    if (!overlay || !placement) return;
    setDisplay(state => addDisplayNode(state, { id: crypto.randomUUID(), kind: 'detail', childIds: [], expansion: 'expanded',
      ...displayGeometry({ x: (activeBox.bounds.column + placement.originColumn - 1) * cell.width,
        y: (activeBox.bounds.row + placement.originLine - 1) * cell.height }),
      sectionId, title: overlay.label, ascii: overlay.ascii }));
  };
  const [promptOpen, setPromptOpen] = useControl("promptOpen", canvasState, setCanvasState);
  const [promptText, setPromptText] = useControl("promptText", canvasState, setCanvasState);
  const [promptPhase, setPromptPhase] = useControl("promptPhase", canvasState, setCanvasState);
  const [statusMessage, setStatusMessage] = useControl("statusMessage", canvasState, setCanvasState);
  const [askOpen, setAskOpen] = useControl("askOpen", canvasState, setCanvasState);
  const [askText, setAskText] = useControl("askText", canvasState, setCanvasState);
  const [askVerbosity, setAskVerbosity] = useControl("askVerbosity", canvasState, setCanvasState);
  const chatThreads = Object.values(display.nodes).filter((node): node is ConversationPane => node.kind === 'conversation').map(node => node.thread);
  const setChatThreads = useCallback((update: SetStateAction<LocalChatThread[]>) => setDisplay(current => {
    const old = Object.values(current.nodes).filter((node): node is ConversationPane => node.kind === 'conversation').map(node => node.thread);
    const next = typeof update === 'function' ? update(old) : update;
    let state = current;
    for (const thread of next) {
      const existing = state.nodes[thread.id];
      if (existing?.kind === 'conversation') state = { ...state, nodes: { ...state.nodes, [thread.id]: { ...existing, thread } } };

    }
    return state;
  }), [setDisplay]);
  useEffect(() => {
    for (const [id, controller] of replyControllers.current) {
      if (!display.nodes[id]) { controller.abort(); replyControllers.current.delete(id); }
    }
  }, [display]);
  const [activeThreadId, setActiveThreadControl] = useControl("activeThreadId", canvasState, setCanvasState);
  const setActiveThreadId = (id: string | null) => {
    setActiveThreadControl(id);
    const target = id ?? activeThreadId;
    if (target) setDisplay(state => {
      const node = state.nodes[target];
      return node?.kind === 'conversation' ? setExpansion(state, target, id ? 'expanded' : 'collapsed') : state;
    });
  };

  const asciiLines = useMemo(() => ascii.split("\n"), [ascii]);
  const lineCount = asciiLines.length;
  const maxColumn = useMemo(() => Math.max(...asciiLines.map((line) => line.length), 1), [asciiLines]);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedNodes = useMemo(
    () => nodes.filter((node) => selectedNodeIdSet.has(node.id)),
    [nodes, selectedNodeIdSet]
  );
  const activeThread = chatThreads.find(thread => thread.id === activeThreadId && display.nodes[thread.id]?.expansion === 'expanded' && !Object.values(display.nodes)
    .some(node => node.childIds.includes(thread.id) && (node.expansion === 'collapsed' || node.kind === 'selection' && !boxes.some(box => box.box.id === node.sourceBoxId && !box.box.collapsed))));
  const sourceCoveredNodeCount = selectedNodes.filter((node) => node.sourceRanges.length > 0).length;
  const selectedSourceRangeCount = selectedNodes.reduce(
    (count, node) => count + node.sourceRanges.length,
    0
  );
  const hasCompleteSourceCoverage = selectedNodes.length > 0
    && sourceCoveredNodeCount === selectedNodes.length;
  const copySelection = useCallback(async () => {
    if (!selectionRect) return;
    const text = selectionClipboardText(content, selectionRect, selectedNodeIds, focusedItem?.region?.contentNodeIds)!;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable in this browser");
      await navigator.clipboard.writeText(text);
      setStatusMessage(selectedSourceRangeCount ? "Copied ASCII + code refs" : "Copied ASCII (no code refs mapped)");
    } catch (error) {
      setStatusMessage(`Copy failed: ${error instanceof Error ? error.message : "Clipboard access was denied"}`);
    }
  }, [content, selectionRect, selectedNodeIds, selectedSourceRangeCount, focusedItem]);
  const selectedEvidenceIds = useMemo(() => [...new Set(diagramSource(content).mappings()
    .filter((mapping) => selectedNodeIdSet.has(`${content.id}:${mapping.id}`))
    .map((mapping) => exportedEvidenceId(scene, content.id, mapping.entityId)))], [scene, content, selectedNodeIdSet]);
  const projections = Object.values(props.projectionCatalog?.projections ?? {})
    .reverse()
    .filter((projection) => projection.sourceRepresentationId === props.projectContext?.representationId)
    .sort((a, b) => Number(Boolean(b.compactionProjection)) - Number(Boolean(a.compactionProjection)));
  const chosenProjection = projections.find((projection) => projection.id === projectionChoice)
    ?? projections.find((projection) => projection.sourceRevisionId === props.projectContext?.baseRevisionId
      && props.projectionCatalog?.representations[projection.targetRepresentationId]?.currentRevisionId === projection.targetRevisionId)
    ?? projections[0];
  const projectionContentDirty = status.sceneDirty;
  const callTreeProjection = useMemo(() => {
    const catalog = props.projectionCatalog;
    if (!catalog || !chosenProjection) return { error: "No call-tree projection has been created for this diagram." };
    if (projectionContentDirty || props.dirtyRepresentationIds?.includes(chosenProjection.targetRepresentationId)) {
      return { error: "Unsaved diagram changes: save or undo them before opening the call tree." };
    }
    const source = catalog.representations[chosenProjection.sourceRepresentationId];
    const target = catalog.representations[chosenProjection.targetRepresentationId];
    if (source?.status !== "settled" || target?.status !== "settled"
      || source.currentRevisionId !== chosenProjection.sourceRevisionId
      || props.projectContext?.baseRevisionId !== chosenProjection.sourceRevisionId
      || target.currentRevisionId !== chosenProjection.targetRevisionId) {
      return { error: "Projection needs updating: its source or call-tree revision has changed." };
    }
    try {
      validateProjection(chosenProjection, catalog);
      const result = projectSelection(chosenProjection, catalog.revisions[chosenProjection.targetRevisionId], selectedEvidenceIds);
      return { result, title: target.name, error: result.targetNodeIds.length ? undefined : "No linked call-tree branches for this selection." };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not resolve projection" };
    }
  }, [props.projectionCatalog, chosenProjection, projectionContentDirty, props.dirtyRepresentationIds, props.projectContext?.baseRevisionId, selectedEvidenceIds]);
  const candidateProjection = useMemo(
    () => {
      const projection = projectASelectionToB(selectedNodeIds.filter((id) => nodes.some((node) => node.id === id)), nodes);
      if (!props.projectContext) return projection;
      const result = callTreeProjection.result;
      const bRange = result?.ascii ? { startLine: 1, endLine: result.ascii.split("\n").length } : null;
      const matched = new Set(result?.matchedSourceEvidenceIds ?? []);
      return { ...projection, mappedANodeIds: diagramSource(content).mappings().filter((mapping) => matched.has(exportedEvidenceId(scene, content.id, mapping.entityId))
        && selectedNodeIds.includes(`${content.id}:${mapping.id}`)).map((mapping) => `${content.id}:${mapping.id}`),
        directlyMappedBNodeIds: result?.targetNodeIds ?? [], selectedBNodeIds: result?.visibleNodeIds ?? [],
        alignedSectionIds: [], mappedBRange: bRange, alignedBRange: bRange, bRange, bAscii: result?.ascii ?? "" };
    },
    [selectedNodeIds, nodes, content, props.projectContext, callTreeProjection]
  );
  useLayoutEffect(() => {
    const pre = preRef.current;
    const probe = probeRef.current;
    if (!pre || !probe) return undefined;
    const measure = () => {
      const matrix = endpointGeometry.svgRef.current?.getScreenCTM();
      const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 0;
      const width = scale ? probe.getBoundingClientRect().width / scale / 10 : 0;
      const height = Number.parseFloat(getComputedStyle(pre).lineHeight);
      if (width > 0 && height > 0) setCell(current => Math.abs(current.width - width) < .001 && current.height === height ? current : { width, height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(pre); observer?.observe(probe);
    document.fonts.addEventListener('loadingdone', measure);
    return () => { observer?.disconnect(); document.fonts.removeEventListener('loadingdone', measure); };
  }, []);

  useEffect(() => {
    props.onLineCountChange?.(composedAscii.split("\n").length);
  }, [composedAscii, props.onLineCountChange]);

  const busyHandler = useRef(props.onBusyChange);
  busyHandler.current = props.onBusyChange;
  useEffect(() => { busyHandler.current?.(isGenerating); }, [isGenerating]);

  useEffect(() => {
    if (!props.searchMatches?.length || props.active === false) return;
    const current = controller.getSnapshot();
    const revealed = revealSearchMatches(current.document.scene, current.canvas.diagramViews, props.searchMatches);
    if (revealed.root !== current.document.scene.root)
      controller.commitDocument({ ...current.document, scene: layoutScene({ ...current.document.scene, root: revealed.root }, revealed.root.id) });
    if (revealed.views !== current.canvas.diagramViews)
      controller.updateCanvas(canvas => ({ ...canvas, diagramViews: revealed.views }));
  }, [controller, props.searchMatches, props.active]);

  useEffect(() => {
    if (!props.focusBox) return;
    const target = props.focusBox.id;
    const expand = (box: typeof scene.root): typeof scene.root => {
      if (box.kind === "diagram") return box.id === target ? { ...box, collapsed: false } : box;
      const contains = (node: typeof scene.root): boolean => node.id === target || (node.kind === "container" && node.children.some(contains));
      return contains(box) ? { ...box, collapsed: false, children: box.children.map(expand) } : box;
    };
    const root = expand(scene.root);
    if (JSON.stringify(root) !== JSON.stringify(scene.root)) commit({ ...gridDocument, scene: layoutScene({ ...scene, root }, target) });
    const focusNode = props.focusBox.contentNodeId;
    const displayed = controller.nodes().find(node => node.id === `grid:${target}`);
    if ((focusNode || props.focusBox.search) && displayed?.layout === 'grid' && displayed.content?.structure.kind === 'tree') {
      const content = displayed.content;
      const ancestors = new Set<string>();
      let node = content.structure.kind === 'tree' && focusNode ? content.structure.nodes[focusNode] : undefined;
      while (node?.parentId && content.structure.kind === 'tree') { ancestors.add(node.parentId); node = content.structure.nodes[node.parentId]; }
      const line = props.focusBox.search?.line;
      if (line && content.structure.kind === 'tree') for (const node of Object.values(content.structure.nodes))
        if (node.foldRanges.some(range => range.startLine <= line && range.endLine >= line)) ancestors.add(node.id);
      controller.updateCanvas(current => {
        const view = current.diagramViews?.[displayed.id];
        if (!view) return current;
        return { ...current, diagramViews: { ...current.diagramViews, [displayed.id]: { ...view,
          collapsedContentNodeIds: view.collapsedContentNodeIds.filter(id => !ancestors.has(id)) } } };
      });
    }
    setActiveBoxId(target);
    clearSelectionFocus();
  }, [props.focusBox]);

  useEffect(() => {
    if (promptOpen) promptInputRef.current?.focus();
  }, [promptOpen]);

  useEffect(() => {
    if (askOpen) askInputRef.current?.focus();
  }, [askOpen]);

  const scenePointAtClient = useCallback((clientX: number, clientY: number): ScenePoint | null => {
    if (nativeRuntime?.editor && cell.width > 0 && cell.height > 0) {
      const point = nativeRuntime.editor.screenToPage({ x: clientX, y: clientY });
      return { column: Math.max(0, Math.floor(point.x / cell.width)), row: Math.max(0, Math.floor(point.y / cell.height)) };
    }
    const pre = preRef.current;
    if (!pre || !(cell.width > 0) || !(cell.height > 0)) return null;
    const bounds = pre.getBoundingClientRect();
    const scale = pre.offsetWidth > 0 ? bounds.width / pre.offsetWidth : 1;
    return {
      row: Math.max(0, Math.floor((clientY - bounds.top) / (cell.height * scale))),
      column: Math.max(0, Math.floor((clientX - bounds.left) / (cell.width * scale)))
    };
  }, [cell]);
  const resolveMarquee = (bounds: SelectionBounds, promoted: string[]) => {
    if (nativeRuntime?.editor && cell.width && cell.height) {
      const a = nativeRuntime.editor.screenToPage({ x: bounds.left, y: bounds.top });
      const b = nativeRuntime.editor.screenToPage({ x: bounds.right, y: bounds.bottom });
      return selectCanvasMarquee(scene, canvasState.diagramViews, { left: a.x / cell.width, right: b.x / cell.width,
        top: a.y / cell.height, bottom: b.y / cell.height }, promoted, boxes);
    }
    const pre = preRef.current;
    if (!pre || !cell.width || !cell.height) return { diagramIds: promoted, regions: [] };
    const screen = pre.getBoundingClientRect(), scale = screen.width / pre.offsetWidth;
    return selectCanvasMarquee(scene, canvasState.diagramViews, {
      left: (bounds.left - screen.left) / (cell.width * scale), right: (bounds.right - screen.left) / (cell.width * scale),
      top: (bounds.top - screen.top) / (cell.height * scale), bottom: (bounds.bottom - screen.top) / (cell.height * scale)
    }, promoted, boxes);
  };

  const requestLocalReply = useCallback((thread: LocalChatThread) => {
    if (replyControllers.current.has(thread.id)) return;
    if (!thread.context) {
      setChatThreads(threads => threads.map(current => current.id === thread.id
        ? { ...current, pending: false, error: "This saved conversation has no source context. Start a new conversation." } : current));
      return;
    }
    const controller = new AbortController();
    replyControllers.current.set(thread.id, controller);
    const updateThread = (update: (current: LocalChatThread) => LocalChatThread) => {
      if (!controller.signal.aborted) setChatThreads((threads) => threads.map((current) => current.id === thread.id ? update(current) : current));
    };
    void localChatResponder.reply({
      threadId: thread.id, context: thread.context, verbosity: thread.verbosity,
      selection: thread.selection, history: thread.messages
    }, {
      signal: controller.signal,
      onContext: (sourceRanges) => updateThread((current) => current.context ? { ...current, context: { ...current.context, sourceRanges } } : current),
      onProgress: (progress) => updateThread((current) => ({ ...current, progress }))
    }).then((reply) => {
      updateThread((current) => ({ ...current, pending: false, progress: undefined, error: undefined,
        messages: [...current.messages, { id: `local-message-${crypto.randomUUID()}`, role: "assistant", text: reply }]
      }));
    }).catch((error) => {
      updateThread((current) => ({ ...current, pending: false, progress: undefined,
        error: error instanceof Error ? error.message : "Chat failed"
      }));
    }).finally(() => replyControllers.current.delete(thread.id));
  }, [setChatThreads]);

  const commitSelection = (select: (current: MappingCanvasState) => SelectionState) => {
    controller.updateCanvas(current => updateSelection(current, { type: 'replace', items: select(current).items }), true);
  };

  const finishMarquee = (marquee: CanvasMarqueeSelection, policy: SelectionPolicy, baseline?: SelectionState) => {
    controller.updateCanvas(current => completeMarquee(baseline ? { ...current, selection: baseline } : current, marquee, scene, boxes, policy), true);
  };
  const selectHit = (hit: SelectionHit, policy: SelectionPolicy, whole: boolean, baseline?: SelectionState) => {
    const box = boxes.find(box => `grid:${box.box.id}` === hit.diagramId);
    const diagram = box?.contentId ? scene.contents[box.contentId] : undefined;
    if (!diagram) return;
    if (whole || !hit.nodeId) {
      clearSelectionFocus();
      controller.updateCanvas(current => updateSelection(baseline ? { ...current, selection: baseline } : current,
        { type: policy, items: [diagramSelectionItem(hit.diagramId)] }), true);
      return;
    }
    if (diagram.content.revisionId !== hit.revision) return;
    const node = diagramContentNodes(diagram.content).find(node => node.id === hit.nodeId);
    if (node) finishMarquee({ diagramIds: [], regions: [{ boxId: box!.box.id,
      rect: { startLine: node.line, endLine: node.line, startColumn: node.startColumn, endColumn: node.endColumn } }] }, policy, baseline);
  };

  // A carried reference drops where the user clicks; the pointer never reaches selection or panning.
  const placement = props.placement;
  useEffect(() => {
    const stage = nativeRuntime ? stageRef.current?.closest<HTMLElement>('[data-diagram-canvas]') : stageRef.current;
    if (!stage || !placement || props.active === false) return;
    const down = (event: globalThis.PointerEvent) => {
      if (event.button || (event.target as Element).closest('[data-mapping-static-ui]')) return;
      const point = scenePointAtClient(event.clientX, event.clientY); if (!point) return;
      event.preventDefault(); event.stopImmediatePropagation(); placement.onPlace(point);
    };
    stage.addEventListener('pointerdown', down, true);
    return () => stage.removeEventListener('pointerdown', down, true);
  }, [nativeRuntime, placement, props.active, scenePointAtClient]);

  // Source panels live in native shapes, outside the application overlay. Keep
  // keyboard source navigation tied to the last panel the user actually touched.
  useEffect(() => {
    const viewport = stageRef.current?.closest<HTMLElement>('[data-diagram-canvas]') ?? stageRef.current;
    if (!viewport || props.active === false) return;
    const focusPanel = (event: globalThis.PointerEvent) => {
      const id = (event.target as Element).closest<HTMLElement>('[data-pane-content="code-panel"]')?.dataset.displayNode;
      const pane = id && controller.getSnapshot().canvas.display.nodes[id];
      if (pane && pane.kind === 'projection' && pane.content.kind === 'code-panel')
        codePanelFocus.current = { panelId: pane.id, selectionId: pane.content.selectionId };
    };
    viewport.addEventListener('pointerdown', focusPanel, true);
    return () => viewport.removeEventListener('pointerdown', focusPanel, true);
  }, [controller, props.active]);

  const retainSelection = useCallback(() => {
    if (retainedSelectionId && display.nodes[retainedSelectionId]) return retainedSelectionId;
    if (!focusedItem?.region) return undefined;
    const { id, region } = focusedItem;
    const root: SelectionRegion = { ...displayGeometry({
      x: (activeBox.bounds.column + region.rect.startColumn - 1) * cell.width,
      y: (activeBox.bounds.row + (activeProjection.rowForLine(region.rect.startLine) ?? region.rect.startLine - 1)) * cell.height }, {
      width: (region.rect.endColumn - region.rect.startColumn + 1) * cell.width,
      height: (region.rect.endLine - region.rect.startLine + 1) * cell.height }), id, kind: 'selection', childIds: [], expansion: 'expanded', displayMode: 'stacked',
      sourceBoxId: focusedItem.displayNodeId.slice(5), sourceContentId: region.sourceContentId, sourceAscii: region.sourceAscii,
      sourceRevisionId: region.sourceRevisionId, rect: { ...region.rect }, contentNodeIds: region.contentNodeIds, selectedIds: [...region.selectedIds] };
    controller.updateCanvas(current => ({ ...current, display: addDisplayNode(current.display, root), controls: { ...current.controls,
      surfaces: { ...current.controls.surfaces, [id]: { ...current.controls.surfaces.draft, actionsOpen: false } } } }), true);
    return id;
  }, [activeProjection, retainedSelectionId, display, focusedItem, activeBox, cell, controller]);

  const selectedContentNodes = useMemo(() => focusedItem?.region ? selectionContentNodes(content, focusedItem.region) : [], [content, focusedItem]);
  const openMapped = useCallback(() => {
    if (!props.projectContext || !selectedContentNodes.length) return;
    const ownerId = retainSelection(); if (!ownerId) return;
    const panel = handleNodeSelect({ diagram: content, projectId: props.projectContext.projectId }, selectedContentNodes, DEFAULT_MAPPED_RESOURCE_TYPE);
    controller.updateCanvas(current => {
      const owner = current.display.nodes[ownerId];
      if (owner?.kind !== 'selection') return current;
      const display = upsertCodePanel(current.display, owner, panel);
      const pane = Object.values(display.nodes).find(node => node.kind === 'projection' && node.content.kind === 'code-panel'
        && node.content.selectionId === ownerId);
      if (pane) codePanelFocus.current = { panelId: pane.id, selectionId: ownerId };
      return { ...current, display, controls: { ...current.controls, surfaces: { ...current.controls.surfaces,
        [ownerId]: { ...current.controls.surfaces[ownerId], actionsOpen: false } } } };
    }, true);
  }, [props.projectContext, selectedContentNodes, content, retainSelection, controller]);
  const removeEffect = (id: string) => controller.updateCanvas(current => {
    if (current.controls.surfaces[id]?.promptPhase === 'generating') return current;
    const display = removeDisplayNode(current.display, id);
    const next = updateSelection(current, { type: 'remove', id });
    return { ...next, display, controls: { ...next.controls,
      surfaces: Object.fromEntries(Object.entries(current.controls.surfaces).filter(([key]) => key === 'draft' || display.nodes[key])),
      activeThreadId: current.controls.activeThreadId && display.nodes[current.controls.activeThreadId] ? current.controls.activeThreadId : null } };
  }, true);

  const clearSelectionFocus = useCallback(() => {
    const stage = stageRef.current;
    if (placementPointerRef.current !== null && stage?.hasPointerCapture(placementPointerRef.current)) {
      stage.releasePointerCapture(placementPointerRef.current);
    }
    placementDragRef.current = null;
    placementPointerRef.current = null;
    setSelectionFocusId(null);
    setPromptOpen(false);
    setPromptText("");
    setAskOpen(false);
    setAskText("");
    setDiagramPlacement(null);
    setPlacementPreview(null);
    setMovingBoxId(null);
    setPromptPhase("ready");
    setStatusMessage("selection ready");
  }, [session, setCanvasState]);

  const openPrompt = useCallback(() => {
    if (!selectionRect
      || !selectedNodeIds.length
      || !hasCompleteSourceCoverage
      || promptPhase === "generating") return;
    retainSelection();
    setAskOpen(false);
    setPromptOperation("edit");
    setPromptOpen(true);
    setPromptPhase("composing");
    setStatusMessage("describe the in-line change");
  }, [hasCompleteSourceCoverage, promptPhase, selectedNodeIds.length, selectionRect, retainSelection]);

  const openAsk = useCallback(() => {
    if (!selectionRect || promptPhase === "generating") return;
    retainSelection();
    setPromptOpen(false);
    setAskOpen(true);
    setStatusMessage("ask about the selected region");
  }, [promptPhase, selectionRect, retainSelection]);

  const submitAsk = (event: FormEvent) => {
    event.preventDefault();
    const query = askText.trim();
    if (!selectionRect || !query) return;
    const summary = selectedNodeIds.length ? `${selectedNodeIds.length} selected diagram node${selectedNodeIds.length === 1 ? "" : "s"}` : `Selected diagram region (lines ${selectionRect.startLine}–${selectionRect.endLine})`;
    const thread: LocalChatThread = {
      id: `local-thread-${crypto.randomUUID()}`,
      title: summary,
      selection: { boxId: activeBox.box.id, nodeIds: [...selectedNodeIds], rect: { ...selectionRect }, summary },
      context: structuredClone({ ...props.projectContext, contentId: content.id, sourceContext: content.sourceContext, diagramAscii: ascii,
        diagramRevision, mappings: [...diagramSource(content).mappings()] }),
      verbosity: askVerbosity,
      messages: [{ id: `local-message-${crypto.randomUUID()}`, role: "user", text: query }],
      pending: true
    };
    const ownerId = retainSelection();
    if (!ownerId) return;
    const anchor = {
      x: (activeBox.bounds.column + selectionRect.endColumn) * cell.width,
      y: (activeBox.bounds.row + (activeProjection.rowForLine(selectionRect.startLine) ?? selectionRect.startLine - 1)) * cell.height
    };
    setDisplay(current => addDisplayNode(current, {
      ...displayGeometry({ x: anchor.x - 17, y: anchor.y - 17 }, { width: 34, height: 34 }),
      id: thread.id, kind: 'conversation', childIds: [], expansion: 'expanded',
      canvasAnchor: anchor, thread, draft: '', presentation: localChatVariant
    }, ownerId));
    setActiveThreadId(thread.id);
    setAskOpen(false);
    setAskText("");
    setSelectionFocusId(null);
    setPromptPhase("ready");
    setStatusMessage("selection ready");
    requestLocalReply(thread);
  };

  const submitLocalFollowUp = useCallback((threadId: string, text: string) => {
    const thread = chatThreads.find((candidate) => candidate.id === threadId);
    if (!thread || thread.pending || replyControllers.current.has(threadId)) return;
    const next: LocalChatThread = { ...thread, pending: true, error: undefined,
      messages: [...thread.messages, { id: `local-message-${crypto.randomUUID()}`, role: "user", text }]
    };
    setChatThreads((current) => current.map((candidate) => candidate.id === threadId ? next : candidate));
    requestLocalReply(next);
  }, [chatThreads, requestLocalReply]);

  const retryLocalReply = (threadId: string) => {
    const thread = chatThreads.find((candidate) => candidate.id === threadId);
    if (!thread || thread.pending || replyControllers.current.has(threadId)) return;
    const next = { ...thread, pending: true, error: undefined };
    setChatThreads((current) => current.map((candidate) => candidate.id === threadId ? next : candidate));
    requestLocalReply(next);
  };

  const changeThreadVerbosity = (threadId: string, verbosity: LocalChatVerbosity) => {
    setChatThreads((current) => current.map((thread) => thread.id === threadId ? { ...thread, verbosity } : thread));
  };

  const commitScene = (nextScene: typeof scene, changedId: string) => {
    try {
      commit({ ...gridDocument, scene: layoutScene(nextScene, changedId) });
      clearSelectionFocus();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Layout failed");
    }
  };

  const undo = (redo = false) => {
    if (isGenerating) return;
    clearSelectionFocus();
    if (props.onUndo) props.onUndo(redo); else controller.undo(redo);
  };
  const escapeSelection = () => {
    if (isGenerating || nativeRuntime?.gestures.escape?.()) return;
    clearSelectionFocus();
    controller.updateCanvas(deselectCanvas, true);
    stageRef.current?.focus({ preventScroll: true });
  };

  const submitPrompt = async (event: FormEvent) => {
    event.preventDefault();
    const owner = operationOwnerRef.current;
    if (!selectionRect || !promptText.trim() || isGenerating) return;
    if (promptOperation === "generate") {
      setDiagramPlacement(promptText.trim());
      setStatusMessage("Drag a region on the canvas for the new diagram; Escape cancels");
      return;
    }
    updateSurface(owner, { promptPhase: "generating" });
    updateSurface(owner, { statusMessage: "starting diagram agent…" });
    const expectedVersion = controller.getSnapshot().version;
    try {
      const result = await promptMappingPocSelection({
        ...props.projectContext, contentId: content.id, sourceContext: content.sourceContext,
        clientSessionId: `${clientSessionId}-${crypto.randomUUID()}`,
        diagramAscii: ascii, diagramRevision, mappings: [...diagramSource(content).mappings()],
        selection: selectionRect, instruction: promptText.trim()
      }, (message) => updateSurface(owner, { statusMessage: message }));
      // Checkpoints must not capture an in-flight agent state that redo would revive.
      updateSurface(owner, { promptPhase: 'applied', promptOpen: false, promptText: '' });
      controller.applyUpdate(expectedVersion, [{ method: 'patchDiagram', nodeId: `grid:${activeBox.box.id}`,
        start: result.startLine, end: result.oldEndLine,
        patch: result.diagramAscii.split('\n').slice(result.startLine - 1, result.newEndLine).join('\n'), mappings: result.mappings }]);
      if (operationOwnerRef.current === owner) {
        const diagram = controller.getSnapshot().document.scene.contents[content.id];
        const item = regionSelectionItem(diagram, activeBox.box.id, { startLine: result.startLine, endLine: result.newEndLine,
          startColumn: selectionRect.startColumn, endColumn: selectionRect.endColumn });
        controller.updateCanvas(current => {
          const next = updateSelection(current, { type: 'add', items: [item] });
          return { ...next, controls: { ...next.controls, selectionFocusId: item.id } };
        }, true);
      }
      updateSurface(owner, { promptOpen: false });
      updateSurface(owner, { promptText: "" });
      updateSurface(owner, { promptPhase: "applied" });
      updateSurface(owner, { statusMessage: `patch applied · ${result.verticalDelta >= 0 ? "+" : ""}${result.verticalDelta} rows` });
    } catch (error) {
      updateSurface(owner, { promptPhase: "error" });
      updateSurface(owner, { statusMessage: error instanceof Error ? error.message : "diagram prompt failed" });
    }
  };

  const { diagrams: diagramService } = useMappingServices();
  const generateAt = async (start: ScenePoint, end: ScenePoint) => {
    const owner = operationOwnerRef.current;
    if (!diagramPlacement || !selectionRect) return;
    const column = Math.min(start.column, end.column);
    const row = Math.min(start.row, end.row);
    const minimumSize = { columns: Math.abs(end.column - start.column) + 1, rows: Math.abs(end.row - start.row) + 1 };
    const parent = boxes.find((node) => node.children.some((child) => child.box.id === activeBox.box.id)) ?? resolved;
    // An area outside the source container belongs to the root canvas.
    const targetParent = column >= parent.bounds.column && row >= parent.bounds.row ? parent : resolved;
    setDiagramPlacement(null);
    setPlacementPreview(null);
    updateSurface(owner, { promptPhase: "generating" });
    updateSurface(owner, { statusMessage: "generating sub-diagram…" });
    const expectedVersion = controller.getSnapshot().version;
    try {
      const id = `diagram-${crypto.randomUUID()}`;
      const result = await diagramService.generate({ input: { id },
        context: { ...props.projectContext, diagram: content, selection: selectionRect },
        instruction: `${diagramPlacement}\nAim for ${minimumSize.columns} columns by ${minimumSize.rows} rows; the canvas can grow if needed.`
      }, { onProgress: message => updateSurface(owner, { statusMessage: message }) });
      // Generation has finished before the canvas checkpoint is captured.
      updateSurface(owner, { promptPhase: "applied", promptOpen: false, statusMessage: "Sub-diagram generated; layout updated" });
      controller.applyUpdate(expectedVersion, [{ method: 'diagram-insert', id, revisionId: result.revision.id,
        parentId: `grid:${targetParent.box.id}`, minimumSize,
        position: { column: column - targetParent.bounds.column, row: row - targetParent.bounds.row } }]);
      if (operationOwnerRef.current === owner) { clearSelectionFocus(); setActiveBoxId(id); }
      if (operationOwnerRef.current === 'draft') setStatusMessage("Sub-diagram generated; layout updated");
    } catch (error) {
      updateSurface(owner, { promptPhase: "error" });
      updateSurface(owner, { statusMessage: error instanceof Error ? error.message : "Sub-diagram generation failed" });
    }
  };

  const wrapInGroup = (boxId: string) => {
    const id = `group-${crypto.randomUUID()}`;
    try {
      controller.applyUpdate(controller.getSnapshot().version, [{ method: 'group', nodeId: `grid:${boxId}`, id }]);
      clearSelectionFocus();
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : 'Grouping failed'); }
  };

  // Application placement is a tool layered over the Editor's coordinate system.
  useEffect(() => {
    const viewport = stageRef.current?.closest<HTMLElement>('[data-diagram-canvas]');
    if (!nativeRuntime || !viewport || (!diagramPlacement && !movingBoxId)) return;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element).closest('button,input,textarea,select,[data-mapping-static-ui]')) return;
      const point = scenePointAtClient(event.clientX, event.clientY); if (!point) return;
      event.preventDefault(); event.stopPropagation();
      if (movingBoxId) {
        controller.applyUpdate(controller.getSnapshot().version, [{ method: 'move', nodeId: `grid:${movingBoxId}`, position: point }]);
        setMovingBoxId(null); return;
      }
      placementDragRef.current = point; placementPointerRef.current = event.pointerId;
      setPlacementPreview({ start: point, end: point }); viewport.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!placementDragRef.current) return;
      event.preventDefault(); event.stopPropagation();
      const point = scenePointAtClient(event.clientX, event.clientY);
      if (point) setPlacementPreview({ start: placementDragRef.current, end: point });
    };
    const cancel = () => { placementDragRef.current = null; placementPointerRef.current = null; setPlacementPreview(null); };
    const up = (event: PointerEvent) => {
      const start = placementDragRef.current; if (!start) return;
      event.preventDefault(); event.stopPropagation();
      const end = scenePointAtClient(event.clientX, event.clientY) ?? start;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      cancel(); void generateAt(start, end);
    };
    viewport.addEventListener('pointerdown', down, true); viewport.addEventListener('pointermove', move, true);
    viewport.addEventListener('pointerup', up, true); viewport.addEventListener('pointercancel', cancel, true);
    return () => { viewport.removeEventListener('pointerdown', down, true); viewport.removeEventListener('pointermove', move, true);
      viewport.removeEventListener('pointerup', up, true); viewport.removeEventListener('pointercancel', cancel, true); };
  }, [nativeRuntime, diagramPlacement, movingBoxId, scenePointAtClient]);

  const hotkeyHandler = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const handle = (event: globalThis.KeyboardEvent) => hotkeyHandler.current(event);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useLayoutEffect(() => {
    hotkeyHandler.current = (event: globalThis.KeyboardEvent) => {
      if (props.active === false || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing
        && (key === 'z' || key === 'y') && !typingTarget(event.target)) {
        event.preventDefault();
        const redo = key === 'y', snapshot = controller.getSnapshot();
        if (!isGenerating && (redo ? snapshot.canRedo || props.canWorkspaceRedo : snapshot.canUndo || props.canWorkspaceUndo)) undo(redo);
        return;
      }
      const targetPane = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-display-node]') : null;
      if (event.key === 'Escape' && !event.repeat && !typingTarget(event.target)
        && !(event.target instanceof Element && event.target.closest('.mapping-floating-pane, .mapping-submenu'))
        && (!targetPane || targetPane.dataset.paneContent === 'code-panel')) {
        const current = controller.getSnapshot().canvas;
        const focusedId = targetPane?.dataset.displayNode ?? codePanelFocus.current?.panelId;
        const panel = focusedId ? current.display.nodes[focusedId]
          : Object.values(current.display.nodes).find(node => node.kind === 'projection' && node.content.kind === 'code-panel'
            && node.content.selectionId === current.controls.selectionFocusId);
        if (panel?.kind === 'projection' && panel.content.kind === 'code-panel') {
          event.preventDefault();
          codePanelFocus.current = { panelId: panel.id, selectionId: panel.content.selectionId };
          removeEffect(panel.id);
          stageRef.current?.focus({ preventScroll: true });
          return;
        }
        const ownerId = codePanelFocus.current?.selectionId;
        const owner = ownerId ? current.display.nodes[ownerId] : undefined;
        if (owner?.kind === 'selection' && owner.childIds.length === 0) {
          event.preventDefault(); removeEffect(owner.id); codePanelFocus.current = null; return;
        }
      }
      if (event.target instanceof Element && event.target.closest(".mapping-floating-pane, .mapping-submenu, [data-display-node]")) return;
      if (event.key === "Escape" && (diagramPlacement || movingBoxId)) {
        event.preventDefault();
        clearSelectionFocus();
        return;
      }
      if (typingTarget(event.target)) {
        if (event.key === "Escape" && (promptOpen || askOpen) && promptPhase !== "generating") {
          event.preventDefault();
          if (retainedSelectionId) { (event.target as HTMLElement).blur(); return; }
          setPromptOpen(false);
          setAskOpen(false);
          setPromptPhase("ready");
          setStatusMessage("selection ready");
        }
        return;
      }
      // Regions remain selected when their action surface loses focus.
      if (event.key === "Escape" && selection.items.length && promptPhase !== "generating") {
        event.preventDefault();
        if (event.repeat) return;
        const current = controller.getSnapshot().canvas;
        const item = current.selection.items.find(item => item.id === current.controls.selectionFocusId)
          ?? current.selection.items.at(-1);
        if (item) {
          clearSelectionFocus();
          controller.select({ type: 'remove', id: item.id });
        }
        return;
      }
      if (!selectionRect && event.key.toLowerCase() === 'a' && !event.ctrlKey && !event.metaKey && selectedDiagrams.length) {
        event.preventDefault(); setActionsOpen(value => !value); return;
      }
      if (!selectionRect) return;
      if (event.key.toLowerCase() === "c" && !event.altKey && !event.isComposing && !promptOpen && !askOpen
        && !window.getSelection()?.toString()) {
        event.preventDefault(); void copySelection(); return;
      }
      if (event.key.toLowerCase() === "n" && actionsOpen && selectedContentNodes.length && props.projectContext && !promptOpen && !askOpen) {
        event.preventDefault();
        openMapped();
        return;
      }
      if (event.key.toLowerCase() === "p" && promptPhase !== "generating" && !askOpen) {
        event.preventDefault();
        openPrompt();
        return;
      }
      if (event.key.toLowerCase() === "a" && !event.ctrlKey && !event.metaKey && !event.altKey && !askOpen && promptPhase !== "generating" && !promptOpen) {
        event.preventDefault();
        setActionsOpen(value => !value);
        return;
      }
    };
  }, [
    props.active,
    props.onUpdateDiagram,
    props.onUndo,
    props.canWorkspaceUndo,
    props.canWorkspaceRedo,
    isGenerating,
    controller,
    removeEffect,
    diagramSelection,
    askOpen,
    diagramPlacement,
    movingBoxId,
    actionsOpen,
    selectedContentNodes,
    props.projectContext,
    setActionsOpen,
    copySelection,
    clearSelectionFocus,
    openMapped,
    retainedSelectionId,
    openAsk,
    openPrompt,
    promptOpen,
    promptPhase,
    selectedNodeIds.length,
    selection.items.length,
    selectionRect
  ]);

  const visibleSelectionRect = selectionRect && activeProjection.selectionRect(selectionRect);
  const rectStyle = visibleSelectionRect && cell.width > 0 && cell.height > 0 ? {
    left: (visibleSelectionRect.startColumn - 1) * cell.width,
    top: (visibleSelectionRect.startLine - 1) * cell.height,
    width: (visibleSelectionRect.endColumn - visibleSelectionRect.startColumn + 1) * cell.width,
    height: (visibleSelectionRect.endLine - visibleSelectionRect.startLine + 1) * cell.height
  } : undefined;
  const threadSource = boxes.find((node) => node.box.id === (activeThread?.selection.boxId ?? "overview"));
  const visibleThreadRect = activeThread && threadSource && contentProjections.get(threadSource.box.id)?.rect(activeThread.selection.rect);
  const activeThreadRectStyle = visibleThreadRect && activeThread && threadSource && !threadSource.box.collapsed && cell.width > 0 && cell.height > 0 ? {
    left: (threadSource.bounds.column - activeBox.bounds.column + visibleThreadRect.startColumn - 1) * cell.width,
    top: (threadSource.bounds.row - activeBox.bounds.row + visibleThreadRect.startLine - 1) * cell.height,
    width: (visibleThreadRect.endColumn - visibleThreadRect.startColumn + 1) * cell.width,
    height: (visibleThreadRect.endLine - visibleThreadRect.startLine + 1) * cell.height
  } : undefined;
  const selectionPhase = askOpen ? "asking" : promptPhase;
  const showSelectionMenu = Boolean(selectionRect && rectStyle && !diagramPlacement
    && (!retainedSelectionId || promptOpen || askOpen || actionsOpen));

  const jumpCallback = useRef(props.onJump); jumpCallback.current = props.onJump;
  const onDiagramJump = useCallback((target: Parameters<NonNullable<typeof props.onJump>>[0]) => jumpCallback.current?.(target), []);
  const selectionCallback = useRef(props.onSelectionChange); selectionCallback.current = props.onSelectionChange;
  useEffect(() => { if (props.active !== false) selectionCallback.current?.(); }, [selection, props.active]);
  const [extensionSource, setExtensionSource] = useState<{ x: number; y: number }>();
  const [placingExtension, setPlacingExtension] = useState(false);
  const [extensionPreview, setExtensionPreview] = useState<ScenePoint>();
  const extensionBox = boxes.find(box => focusedItem ? focusedItem.displayNodeId === `grid:${box.box.id}`
    : selection.items.some(item => item.displayNodeId === `grid:${box.box.id}`));
  const fallbackExtensionSource = { x: ((extensionBox?.bounds.column ?? 0) + (extensionBox?.bounds.columns ?? 2)) * cell.width,
    y: (extensionBox?.bounds.row ?? 0) * cell.height };
  const extensionPoint = extensionPreview ?? props.extension?.origin;
  const pickExtension = (point: { x: number; y: number }) => {
    setExtensionSource(point); setExtensionPreview(undefined); setPlacingExtension(true);
    stageRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    setPlacingExtension(false); setExtensionPreview(undefined); setExtensionSource(undefined);
  }, [props.extension?.key, props.active]);
  useEffect(() => {
    if (props.extension?.disabled) { setPlacingExtension(false); setExtensionPreview(undefined); }
  }, [props.extension?.disabled]);
  useEffect(() => {
    if (!placingExtension || !props.extension || props.extension.disabled || props.active === false) return;
    const viewport = stageRef.current?.closest<HTMLElement>('[data-diagram-canvas]');
    if (!viewport) return;
    let placingPointer: number | undefined;
    const canvasTarget = (event: PointerEvent) => event.target instanceof Element && viewport.contains(event.target)
      && !event.target.closest('input, textarea, select, [contenteditable=true], .retained-selection-controls');
    const move = (event: PointerEvent) => {
      if (!canvasTarget(event)) return;
      const point = scenePointAtClient(event.clientX, event.clientY);
      if (point) setExtensionPreview(point);
      event.stopImmediatePropagation();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !canvasTarget(event)) return;
      placingPointer = event.pointerId;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== placingPointer) return;
      placingPointer = undefined;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!canvasTarget(event)) return;
      const point = scenePointAtClient(event.clientX, event.clientY);
      if (!point || boxes.some(box => box.box.kind === 'diagram' && point.column >= box.bounds.column
        && point.column < box.bounds.column + box.bounds.columns && point.row >= box.bounds.row && point.row < box.bounds.row + box.bounds.rows)) {
        setStatusMessage('Place the origin in an empty part of the canvas.'); return;
      }
      props.extension?.onPlace(point); setExtensionPreview(undefined); setPlacingExtension(false);
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      setPlacingExtension(false); setExtensionPreview(undefined);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', cancel, true);
    return () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true); window.removeEventListener('keydown', cancel, true);
    };
  }, [placingExtension, props.extension, props.active, boxes, scenePointAtClient]);
  const selectedContentKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of selection.items) {
      const region = item.region;
      if (!region) continue;
      const diagram = scene.contents[region.sourceContentId];
      if (!diagram || diagram.content.ascii !== region.sourceAscii) continue;
      for (const contentNode of selectionContentNodes(diagram, region))
        keys.add(JSON.stringify([item.displayNodeId, contentNode.id]));
    }
    return keys;
  }, [selection, scene.contents]);
  const diagramText = useMemo(() => <DiagramText registerEndpoint={endpointGeometry.registerEndpoint}
    nodeProps={owner => selectedContentKeys.has(JSON.stringify([owner.displayNodeId, owner.contentNodeId]))
      ? { className: 'is-selected' } : undefined}
    rows={composedText.rows} onJump={props.onJump ? onDiagramJump : undefined} ref={preRef}
    className="mapping-poc-ascii"
    style={cell.width ? { width: resolved.bounds.columns * cell.width } : undefined}
    data-graph="A" data-line-count={resolved.bounds.rows} data-revision={diagramRevision}
  />, [selectedContentKeys, endpointGeometry.registerEndpoint, composedText.rows, Boolean(props.onJump), onDiagramJump,
    cell.width, resolved.bounds.columns, resolved.bounds.rows, diagramRevision]);

  useLayoutEffect(() => {
    if (!nativeRuntime) return;
    nativeRuntime.actions = {
      undo: () => undo(),
      escape: escapeSelection,
      jump: onDiagramJump,
      collapse: (nodeId, collapsed, contentNodeId) => {
        try { controller.transact(controller.getSnapshot().version, [{ method: 'collapse', nodeId, collapsed, ...(contentNodeId ? { contentNodeId } : {}) }]); if (!contentNodeId) clearSelectionFocus(); }
        catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); }
      },
      move: id => { clearSelectionFocus(); setMovingBoxId(id); }, group: wrapInGroup, remove: removeEffect,
      toggleConversation: (id, expanded) => {
        if (expanded) setActiveThreadId(id);
        else { setDisplay(state => setExpansion(state, id, 'collapsed')); if (activeThreadId === id) setActiveThreadControl(null); }
      },
      submit: (id, message) => { void submitLocalFollowUp(id, message); }, verbosity: changeThreadVerbosity, retry: id => { void retryLocalReply(id); }
    };
    nativeRuntime.canUndo.set(!!(controllerState.canUndo || props.canWorkspaceUndo) && !isGenerating);
    nativeRuntime.canEscape.set(!isGenerating);
    nativeRuntime.interaction.set(shareEqual(nativeRuntime.interaction.get(), {
      disabled: isGenerating || !!diagramPlacement, subtreeDisabled: isGenerating || !!diagramPlacement || !!movingBoxId || !!promptOpen || !!askOpen, jumps: !!props.onJump
    }));
    nativeRuntime.catalog.set(shareEqual(nativeRuntime.catalog.get(), { catalog: props.projectionCatalog, dirtyIds: props.dirtyRepresentationIds }));
  });

  return (
    <div
      ref={stageRef}
      tabIndex={-1}
      className={`mapping-poc-graph-stage${ctrlSelecting ? " is-selecting" : ""}`}
      aria-label="Graph A selectable nodes"
      onPointerDownCapture={event => {
        const id = (event.target as Element).closest<HTMLElement>('[data-pane-content="code-panel"]')?.dataset.displayNode;
        const pane = id ? controller.getSnapshot().canvas.display.nodes[id] : undefined;
        if (pane?.kind === 'projection' && pane.content.kind === 'code-panel')
          codePanelFocus.current = { panelId: pane.id, selectionId: pane.content.selectionId };
      }}
      style={cell.width ? { width: (resolved.bounds.columns + 65) * cell.width, minHeight: (resolved.bounds.rows + 16) * cell.height } : undefined}
      onPointerDown={(event) => {
        if (props.active === false) return;
        if (event.button !== 0 || ((event.target as Element).closest("[data-mapping-static-ui]") && !(event.ctrlKey && (event.target as Element).closest("[data-diagram-jump-id]")))) return;
        if (diagramPlacement || movingBoxId) {
          const point = scenePointAtClient(event.clientX, event.clientY);
          if (!point) return;
          event.preventDefault(); event.stopPropagation();
          if (movingBoxId) {
            const parent = boxes.find((node) => node.children.some((child) => child.box.id === movingBoxId))!;
            commitScene(updateGridBox(scene, movingBoxId, (box) => ({ ...box,
              position: { column: Math.max(0, point.column - parent.bounds.column), row: Math.max(0, point.row - parent.bounds.row) } })), movingBoxId);
          } else {
            placementDragRef.current = point;
            placementPointerRef.current = event.pointerId;
            setPlacementPreview({ start: point, end: point });
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          return;
        }
      }}
      onPointerMove={(event) => {
        if (placementDragRef.current) {
          const point = scenePointAtClient(event.clientX, event.clientY);
          if (point) setPlacementPreview({ start: placementDragRef.current, end: point });
          event.preventDefault(); event.stopPropagation();
          return;
        }
      }}
      onPointerUp={(event) => {
        const start = placementDragRef.current;
        if (start) {
          placementDragRef.current = null;
          placementPointerRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          const end = scenePointAtClient(event.clientX, event.clientY) ?? start;
          event.preventDefault(); event.stopPropagation();
          void generateAt(start, end);
          return;
        }
      }}
      onPointerCancel={(event) => {
        placementDragRef.current = null;
        placementPointerRef.current = null;
        setPlacementPreview(null);
      }}
    >
      <CursorCopyOverlay session={session} stage={stageRef} active={props.active !== false}
        disabled={isGenerating || !!diagramPlacement || !!movingBoxId || !!props.placement || placingExtension} pointAtClient={scenePointAtClient} />
      <CanvasSelectionLayer stageRef={stageRef} active={props.active !== false && !isGenerating && !diagramPlacement && !movingBoxId}
        diagramIds={boxes.filter(box => box.box.kind === 'diagram').map(box => `grid:${box.box.id}`)} selected={selectedDiagrams}
        onClear={escapeSelection}
        onSelectNode={hit => {
          const box = boxes.find(box => `grid:${box.box.id}` === hit.diagramId), diagram = box?.contentId && scene.contents[box.contentId];
          if (diagram && diagram.content.revisionId === hit.revision && hit.nodeId)
            commitSelection(current => toggleSubtreeSelection(current.selection, diagram, box!.box.id, hit.nodeId!));
        }}
        runtime={nativeRuntime ?? undefined} resolve={resolveMarquee} onComplete={finishMarquee} onTap={selectHit}
        onSelectDiagram={(id, toggle) => { clearSelectionFocus(); controller.select(toggle
          ? { type: 'toggleDiagram', displayNodeId: id } : { type: 'replace', items: [diagramSelectionItem(id)] }); }} />
      {props.extension && selection.items.length > 0 && <>
        {!selection.items.some(item => item.region) && <button className="projection-join llm-origin" aria-label="Place new diagram origin"
          disabled={props.extension.disabled} data-mapping-static-ui data-diagram-canvas-static-ui
          style={{ left: fallbackExtensionSource.x - 8, top: fallbackExtensionSource.y - 8 }}
          onClick={() => pickExtension(fallbackExtensionSource)}>+</button>}
        {extensionPoint && <>
          <svg className="llm-extension-edge" data-placing={placingExtension} width="1" height="1" aria-hidden="true">
            <path d={`M${(extensionSource ?? fallbackExtensionSource).x} ${(extensionSource ?? fallbackExtensionSource).y} L${extensionPoint.column * cell.width} ${extensionPoint.row * cell.height}`}
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 3" />
          </svg>
          <button className={`projection-join llm-origin${placingExtension ? ' llm-origin-preview' : ''}`} aria-label="Move new diagram origin"
            disabled={props.extension.disabled} data-mapping-static-ui data-diagram-canvas-static-ui
            style={{ left: extensionPoint.column * cell.width - 8, top: extensionPoint.row * cell.height - 8 }}
            onClick={() => pickExtension(extensionSource ?? fallbackExtensionSource)}>+</button>
        </>}
      </>}
      {!selectionRect && selectedDiagrams.length > 0 && <div className="mapping-whole-actions" data-mapping-static-ui data-diagram-canvas-static-ui>
        <button onClick={() => setActionsOpen(value => !value)}>Actions (A)</button>
        {actionsOpen && <div role="menu" aria-label="Selection actions"><button role="menuitem" onClick={() => {
          props.onUpdateDiagram?.(selectedDiagrams[0]); setActionsOpen(false);
        }}>LLM [Ctrl+B, L]</button>
          <button role="menuitem" disabled={isGenerating || !!diagramPlacement || !!movingBoxId} onClick={() => {
            try {
              controller.applyUpdate(controller.getSnapshot().version, [{ method: 'delete-diagrams', nodeIds: selectedDiagrams }]);
              setStatusMessage(`${selectedDiagrams.length === 1 ? 'Diagram' : 'Diagrams'} deleted · Undo to restore`);
              setActionsOpen(false);
            } catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); }
          }}>Delete {selectedDiagrams.length === 1 ? 'diagram' : 'diagrams'}</button>
        </div>}
      </div>}
      {!boxes.some(box => box.contentId) && <p className="mapping-empty-canvas">Empty canvas — create a diagram, or Undo to restore.</p>}
      <CanvasTransferMenu selectionCount={!selectionRect ? selectedDiagrams.length : 0}
        onCancelSelection={() => { clearSelectionFocus(); controller.updateCanvas(deselectCanvas, true); }}
        onTransfer={props.onTransfer ? mode => props.onTransfer!(mode, selectedDiagrams) : undefined} stageRef={stageRef} active={props.active !== false} busy={isGenerating || !!diagramPlacement || !!movingBoxId}
        />
      <span ref={probeRef} className="mapping-poc-cell-probe" aria-hidden="true">0000000000</span>
      {nativeRuntime ? <>
        <pre ref={preRef} className="mapping-poc-ascii" aria-hidden="true" style={{ width: resolved.bounds.columns * (cell.width || 8.4), height: 18, visibility: 'hidden' }}> </pre>
      </> : diagramText}
      {(props.searchMatches?.length ? props.searchMatches : props.focusBox?.search ? [props.focusBox.search] : []).map(result => {
        const id = result.displayNodeId.slice(5), box = boxes.find(box => box.box.id === id);
        const focused = props.focusBox?.search?.displayNodeId === result.displayNodeId && props.focusBox.search.line === result.line;
        return <SearchHighlight key={`${id}:${result.line}`} result={result} focus={focused ? props.focusBox : undefined}
          content={box?.contentId ? scene.contents[box.contentId].content : undefined}
          origin={box?.bounds} cell={cell} row={contentProjections.get(id)?.rowForLine(result.line)} />;
      })}

      {!nativeRuntime && <DiagramSubtreeControls nodes={displayNodes} visibleBoxIds={new Set(boxes.map(box => box.box.id))} cell={cell}
        disabled={isGenerating || !!diagramPlacement || !!movingBoxId || !!promptOpen || !!askOpen}
        onCollapse={(nodeId, contentNodeId, collapsed) => {
          try {
            controller.transact(controller.getSnapshot().version, [{ method: 'collapse', nodeId, contentNodeId, collapsed }]);
          } catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); }
        }} />}
      <div className="mapping-grid-tools" data-mapping-static-ui data-diagram-canvas-static-ui>
        <button type="button" disabled={!(controllerState.canUndo || props.canWorkspaceUndo) || isGenerating} onClick={() => undo()} title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z">Undo</button>
        <button type="button" disabled={!(controllerState.canRedo || props.canWorkspaceRedo) || isGenerating} onClick={() => undo(true)} title="Redo (Ctrl+Y)" aria-keyshortcuts="Control+Y">Redo</button>
        <button type="button" disabled={isGenerating} onClick={escapeSelection} title="Cancel or deselect (Esc)" aria-keyshortcuts="Escape">Esc</button>
        <span role="status">{diagramPlacement ? "Drag a region to place the sub-diagram · Esc cancels" : movingBoxId ? "Click to move the box · Esc cancels" : statusMessage}</span>
      </div>
      {!nativeRuntime && <div ref={endpointGeometry.refForEndpoint({ displayNodeId: `grid:${scene.root.id}` })}
        data-grid-box={scene.root.id} data-diagram-selected={selectedDiagrams.includes(`grid:${scene.root.id}`)} aria-hidden="true"
        style={{ position: 'absolute', pointerEvents: 'none', left: resolved.bounds.column * cell.width,
          top: resolved.bounds.row * cell.height, width: resolved.bounds.columns * cell.width, height: resolved.bounds.rows * cell.height }} />}
      {!nativeRuntime && boxes.filter((node) => node.box.id !== scene.root.id).map((node) => (
        <div key={node.box.id} ref={endpointGeometry.refForEndpoint({ displayNodeId: `grid:${node.box.id}` })} className={`mapping-grid-box${node.box.kind === "container" ? " is-container" : ""}`}
          data-grid-box={node.box.id} data-diagram-selected={selectedDiagrams.includes(`grid:${node.box.id}`)} data-grid-column={node.bounds.column} data-grid-row={node.bounds.row}
          data-grid-columns={node.bounds.columns} data-grid-rows={node.bounds.rows} data-collapsed={node.box.collapsed}
          style={{ left: nativeRuntime ? 0 : node.bounds.column * cell.width, top: nativeRuntime ? 0 : node.bounds.row * cell.height,
            width: node.bounds.columns * cell.width, height: node.bounds.rows * cell.height }}>
          {node.box.id !== scene.root.id && <div className="mapping-grid-box-tools" data-mapping-static-ui data-diagram-canvas-static-ui>
            <button type="button" disabled={isGenerating || !!diagramPlacement}
              aria-label={`${node.box.collapsed ? "Expand" : "Collapse"} ${node.box.id}`}
              onClick={() => {
                try { controller.transact(controller.getSnapshot().version, [{ method: 'collapse', nodeId: `grid:${node.box.id}`, collapsed: !node.box.collapsed }]); clearSelectionFocus(); }
                catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); }
              }}>
              {node.box.collapsed ? "Expand" : "Collapse"}
            </button>
            <button type="button" disabled={isGenerating || !!diagramPlacement} onClick={() => { clearSelectionFocus(); setMovingBoxId(node.box.id); }}>Move</button>
            <button type="button" disabled={isGenerating || !!diagramPlacement} onClick={() => wrapInGroup(node.box.id)}>Group</button>
          </div>}
        </div>
      ))}
      {placementPreview ? <div className="mapping-grid-placement" style={{
        left: Math.min(placementPreview.start.column, placementPreview.end.column) * cell.width,
        top: Math.min(placementPreview.start.row, placementPreview.end.row) * cell.height,
        width: (Math.abs(placementPreview.end.column - placementPreview.start.column) + 1) * cell.width,
        height: (Math.abs(placementPreview.end.row - placementPreview.start.row) + 1) * cell.height
      }} /> : null}
      <div className="mapping-grid-local" style={{ position: "absolute",
        left: activeBox.bounds.column * cell.width, top: activeBox.bounds.row * cell.height,
        width: maxColumn * cell.width, height: lineCount * cell.height }}>
      <div className="mapping-poc-node-layer" aria-hidden="true">
        {!activeBox.box.collapsed && cell.width > 0 && cell.height > 0 ? nodes.filter(node => activeProjection.rowForLine(node.head.line) !== undefined).map((node) => (
          <span
            key={node.id}
            className={`mapping-poc-node-hit is-${node.selectableBecause}${selectedNodeIdSet.has(node.id) && (promptOpen || askOpen || promptPhase === "generating") ? " is-selected is-prompt-target" : ""}`}
            data-selectable-node={node.id}
            style={{
              left: (node.head.startColumn - 1) * cell.width,
              top: activeProjection.rowForLine(node.head.line)! * cell.height,
              width: (node.head.endColumn - node.head.startColumn + 1) * cell.width,
              height: cell.height
            }}
          />
        )) : null}
      </div>

      {cell.width > 0 && cell.height > 0 ? (
        <div className="mapping-poc-a-section-layer" aria-label="Graph A detail sections">
          {sections.map(section => ({ ...section, visibleRect: activeProjection.rect({ startLine: section.startLine, endLine: section.endLine, startColumn: 1, endColumn: 1 }) })).filter(section => section.visibleRect).map((section, index) => (
            <section
              key={section.id}
              className={`mapping-poc-a-section${openDetailIds.has(section.id) ? " is-open" : ""}`}
              data-a-section={section.id}
              style={{
                top: (section.visibleRect!.startLine - 1) * cell.height,
                height: (section.visibleRect!.endLine - section.visibleRect!.startLine + 1) * cell.height
              }}
            >
              <button
                type="button"
                data-mapping-static-ui
                data-diagram-canvas-static-ui
                aria-label={`Open ${section.label} overlay`}
                aria-pressed={openDetailIds.has(section.id)}
                onClick={() => openDetail(section.id)}
              >
                <span>{index + 1}</span>
                {section.label}
              </button>
            </section>
          ))}
        </div>
      ) : null}

      {rectStyle && !retainedSelectionId ? (
        <span
          className={`mapping-poc-selection-rect is-${selectionPhase}`}
          style={rectStyle}
          aria-hidden="true"
        />
      ) : null}

      {activeThread && activeThreadRectStyle ? (
        <div
          className="local-chat-source-highlight"
          data-local-chat-source-highlight={activeThread.id}
          style={activeThreadRectStyle}
          aria-hidden="true"
        >
          <span>CHAT SOURCE</span>
        </div>
      ) : null}

      {showSelectionMenu && rectStyle ? (
        <div
          ref={menuRef}
          className={`mapping-poc-selection-menu${askOpen && localChatVariant === "floating" ? " has-floating-ask" : ""}`}
          data-mapping-static-ui
          data-diagram-canvas-static-ui
          role="dialog"
          tabIndex={-1}
          aria-label="Selected node operations"
          aria-keyshortcuts="C N P A"
          onKeyDownCapture={event => {
            if (event.key.toLowerCase() !== 'c') return;
            // Handle Copy while focus is inside the panel, before canvas shortcuts.
            hotkeyHandler.current(event.nativeEvent);
            if (event.nativeEvent.defaultPrevented) event.stopPropagation();
          }}
          style={{ left: rectStyle.left + rectStyle.width + 12, top: rectStyle.top + rectStyle.height + 8 }}
        >
          <header>
            <button type="button" disabled={isGenerating} onClick={escapeSelection} title="Cancel or deselect (Esc)" aria-keyshortcuts="Escape">Esc</button>
            <span>{selectedNodes.length ? `${selectedNodes.length} selected · ${candidateProjection.mappedANodeIds.length} mapped` : "Region selected · no code entities"}</span>
            <em className={hasCompleteSourceCoverage ? "is-covered" : "is-missing"}>
              {selectedNodes.length ? `source ${sourceCoveredNodeCount}/${selectedNodes.length} · ${selectedSourceRangeCount} ranges` : "No source mappings"}
            </em>
            <small className={`is-${askOpen ? "asking" : promptPhase}`} aria-live="polite">{statusMessage}</small>
          </header>
          {!promptOpen && !askOpen ? (
            <div className="mapping-poc-selection-actions">
              {props.onUpdateDiagram && <button type="button" title="Open LLM (Ctrl+B, L)" disabled={isGenerating || !!diagramPlacement || !!movingBoxId}
                onClick={() => { if (focusedItem) { props.onUpdateDiagram?.(focusedItem.displayNodeId); setActionsOpen(false); } }}>LLM [Ctrl+B, L]</button>}
              {props.onReference && focusedItem && <button type="button" onClick={() => { const reference = focusedReference(); if (reference) props.onReference?.([reference], 'insert', focusedItem.displayNodeId); }}>Add to prompt</button>}
              {props.onReference && focusedItem && <button type="button" onClick={() => { const reference = focusedReference(); if (reference) props.onReference?.([reference], 'copy', focusedItem.displayNodeId); }}>Copy as reference</button>}
              <button type="button" aria-label="Copy ASCII + code refs" title="Copy full selected rows and selected code references (C)" aria-keyshortcuts="C Control+C Meta+C" onClick={() => void copySelection()}>
                <kbd>C</kbd> Copy ASCII + code refs
              </button>
              <button
                ref={openMappedRef}
                type="button"
                disabled={!props.projectContext || !selectedContentNodes.length}
                aria-keyshortcuts="N"
                title="Open mapped source ranges for the selected nodes"
                onClick={openMapped}
              >
                <kbd>N</kbd>
                open mapped source
              </button>
              <button
                type="button"
                aria-keyshortcuts="P"
                disabled={!hasCompleteSourceCoverage}
                title={hasCompleteSourceCoverage ? "Prompt with mapped corpus context" : "Selected elements need source mappings"}
                onClick={openPrompt}
              >
                <kbd>P</kbd>
                prompt selection
              </button>
              <button
                type="button"
                className="is-ask"
                title="Ask about the selected region"
                onClick={openAsk}
              >
                ask about selection
              </button>
            </div>
          ) : promptOpen ? (
            <form className="mapping-poc-prompt-form" onSubmit={submitPrompt}>
              <label htmlFor="mapping-poc-prompt">{promptOperation === "generate" ? "Describe the sub-diagram" : "Change selected rows"}</label>
              <textarea
                ref={promptInputRef}
                id={props.active === false ? undefined : "mapping-poc-prompt"}
                value={promptText}
                maxLength={promptOperation === "generate" ? 3800 : 4000}
                rows={4}
                disabled={promptPhase === "generating"}
                placeholder="e.g. split aggregation into validation and scoring"
                onChange={(event) => {
                  setPromptText(event.target.value);
                  if (promptPhase === "error") {
                    setPromptPhase("composing");
                    setStatusMessage("ready to retry");
                  }
                }}
              />
              <footer>
                <button
                  type="button"
                  disabled={promptPhase === "generating"}
                  onClick={() => {
                    setPromptOpen(false);
                    setPromptPhase("ready");
                    setStatusMessage("selection ready");
                  }}
                >cancel</button>
                <button
                  type="submit"
                  className="is-primary"
                  disabled={!promptText.trim() || promptPhase === "generating"}
                >{promptPhase === "generating" ? "applying…" : promptOperation === "generate" ? "choose region" : "apply patch"}</button>
              </footer>
            </form>
          ) : (
            <form
              className={`local-chat-ask-form is-${localChatVariant}`}
              data-local-chat-ask={localChatVariant}
              onSubmit={submitAsk}
            >
              <label htmlFor="mapping-poc-local-question">Ask about this region</label>
              <textarea
                ref={askInputRef}
                id={props.active === false ? undefined : "mapping-poc-local-question"}
                value={askText}
                maxLength={4000}
                rows={3}
                placeholder="e.g. What contract does this block define?"
                onChange={(event) => setAskText(event.target.value)}
                onKeyDown={(event) => {
                  if (!isLocalChatSubmitHotkey({
                    key: event.key,
                    ctrlKey: event.ctrlKey,
                    isComposing: event.nativeEvent.isComposing
                  })) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
              <LocalChatVerbosityToggle value={askVerbosity} onChange={setAskVerbosity} />
              <footer>
                <button
                  type="button"
                  onClick={() => {
                    setAskOpen(false);
                    setAskText("");
                    setStatusMessage("selection ready");
                  }}
                >cancel</button>
                <button type="submit" className="is-primary" disabled={!askText.trim()} title="Send (Ctrl+Enter)">
                  ask
                </button>
              </footer>
            </form>
          )}
        </div>
      ) : null}


      {!nativeRuntime && chatThreads.filter(thread => {
        const owner = Object.values(display.nodes).find(node => node.childIds.includes(thread.id));
        if (owner?.kind === 'selection' && scene.contents[owner.sourceContentId]?.content.ascii === owner.sourceAscii && contentProjections.has(owner.sourceBoxId) && !contentProjections.get(owner.sourceBoxId)!.selectionRect(owner.rect)) return false;
        return !owner || owner.expansion === 'expanded' && (owner.kind !== 'selection' || boxes.some(box => box.box.id === owner.sourceBoxId && !box.box.collapsed));
      }).map((thread) => {
        const isActive = display.nodes[thread.id]?.expansion === 'expanded';
        const pane = display.nodes[thread.id] as ConversationPane;
        const presentation = pane.presentation;
        return (
          <div key={thread.id}
            className={`local-chat-anchor${isActive ? " is-active" : ""}`}
            data-mapping-static-ui
            data-diagram-canvas-static-ui
            style={{ left: nativeRuntime ? 0 : pane.canvasAnchor.x - activeBox.bounds.column * cell.width, top: nativeRuntime ? 0 : pane.canvasAnchor.y - activeBox.bounds.row * cell.height }}
          >
            <button
              type="button"
              className={`local-chat-bubble${thread.pending ? " is-pending" : ""}`}
              data-local-chat-bubble={thread.id}
              aria-label={`${isActive ? "Collapse" : "Open"} local conversation`}
              aria-expanded={isActive}
              onClick={() => {
                if (isActive) { setDisplay(state => setExpansion(state, thread.id, 'collapsed')); if (activeThreadId === thread.id) setActiveThreadControl(null); }
                else setActiveThreadId(thread.id);
              }}
            >
              <span aria-hidden="true">?</span>
              <small>{thread.messages.filter((message) => message.role === "assistant").length}</small>
            </button>
            {isActive && presentation !== "docked" ? (
              <LocalChatConvo
                thread={thread}
                displayNodeId={pane.id}
                onMeasure={measurePane}
                style={{ left: nativeRuntime ? 0 : pane.position.x - pane.canvasAnchor.x, top: nativeRuntime ? 0 : pane.position.y - pane.canvasAnchor.y,
                  ...(pane.geometryPolicy.sizing === 'fixed' ? { width: pane.bounds.width, height: pane.bounds.height, maxHeight: 'none' } : {}) }}
                draft={(display.nodes[thread.id] as ConversationPane).draft}
                onDraftChange={draft => setDisplay(state => ({ ...state, nodes: { ...state.nodes, [thread.id]: { ...(state.nodes[thread.id] as ConversationPane), draft } } }))}
                variant={presentation}
                onClose={() => { setDisplay(state => setExpansion(state, thread.id, 'collapsed')); if (activeThreadId === thread.id) setActiveThreadControl(null); }}
                onSubmit={(message) => submitLocalFollowUp(thread.id, message)}
                onVerbosityChange={(value) => changeThreadVerbosity(thread.id, value)}
                onRetry={() => retryLocalReply(thread.id)}
              />
            ) : null}
          </div>
        );
      })}

      {props.active !== false && activeThread && (display.nodes[activeThread.id] as ConversationPane).presentation === "docked" && typeof document !== "undefined" ? createPortal(
        <div
          className="local-chat-docked-shell"
          style={{ left: display.nodes[activeThread.id].position.x, top: display.nodes[activeThread.id].position.y,
            width: display.nodes[activeThread.id].bounds.width, height: display.nodes[activeThread.id].bounds.height,
            right: 'auto', bottom: 'auto' }}
          data-mapping-static-ui
          data-diagram-canvas-static-ui
        >
          <LocalChatConvo
            thread={activeThread}
            displayNodeId={activeThread.id}
            draft={(display.nodes[activeThread.id] as ConversationPane).draft}
            onDraftChange={draft => setDisplay(state => ({ ...state, nodes: { ...state.nodes, [activeThread.id]: { ...(state.nodes[activeThread.id] as ConversationPane), draft } } }))}
            variant="docked"
            onClose={() => setActiveThreadId(null)}
            onSubmit={(message) => submitLocalFollowUp(activeThread.id, message)}
            onVerbosityChange={(value) => changeThreadVerbosity(activeThread.id, value)}
            onRetry={() => retryLocalReply(activeThread.id)}
          />
        </div>,
        document.body
      ) : null}

      {!showSelectionMenu && selectionRect && !selectedNodes.length && rectStyle && (promptPhase === "applied" || promptPhase === "error") ? (
        <div
          className={`mapping-poc-local-status is-${promptPhase}`}
          data-mapping-static-ui
          data-diagram-canvas-static-ui
          role="status"
          style={{ left: rectStyle.left + rectStyle.width + 12, top: rectStyle.top }}
        >
          <span>{promptPhase === "applied" ? "PATCHED" : "ERROR"}</span>
          <strong>{statusMessage}</strong>
        </div>
      ) : null}

      </div>
      <SelectionEffectsLayer extension={props.extension ? { disabled: props.extension.disabled, onPick: pickExtension } : undefined} session={session} selection={selection} diagramViews={canvasState.diagramViews} state={display} setState={setDisplay} setLayoutState={setDisplayLayout} boxes={boxes} scene={scene} cell={cell}
        onEscape={escapeSelection}
        catalog={props.projectionCatalog} dirtyRepresentationIds={props.dirtyRepresentationIds} onRemove={removeEffect}
        busySelectionIds={Object.entries(canvasState.controls.surfaces).filter(([, surface]) => surface.promptPhase === 'generating').map(([id]) => id)}
        onActivate={root => {
          controller.updateCanvas(current => {
            const next = updateSelection(current, { type: 'add', items: [{ id: root.id, displayNodeId: `grid:${root.sourceBoxId}`, region: {
              sourceContentId: root.sourceContentId, sourceRevisionId: root.sourceRevisionId, sourceAscii: root.sourceAscii,
              rect: root.rect, contentNodeIds: root.contentNodeIds, selectedIds: root.selectedIds
            } }] });
            return { ...next, controls: { ...next.controls, activeBoxId: root.sourceBoxId, selectionFocusId: root.id } };
          }, true);
          setActionsOpen(true);
          stageRef.current?.focus({ preventScroll: true });
        }} />
      <DiagramConnections edges={nativeRuntime ? [] : gridDocument.edges} displayNodes={displayNodes} svgRef={endpointGeometry.svgRef} />
    </div>
  );
}
