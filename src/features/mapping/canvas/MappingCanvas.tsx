import { useMappingServices } from '../services/MappingServices';
import { useStore } from 'zustand';
import type { CanvasSession } from '../workspace/canvasSession';
import { SelectionPreviewOverlay } from './SelectionPreviewOverlay';
import { DiagramSelectionLayer } from './DiagramSelectionLayer';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { useEndpointGeometry } from './useEndpointGeometry';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import { diagramSceneText } from '../../../../domain/mapping/workspace/diagramSceneText';
import { SearchHighlight, type DiagramFocus } from '../search/SearchHighlight';
import { type DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import { DiagramConnections } from './DiagramConnections';
import { exportedEvidenceId } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { diagramSource } from '../../../../domain/core/diagrams/diagram';
import { diagramSelectionNodes } from '../../../../domain/mapping/workspace/mappingDocument';
import { diagramProjection } from '../../../../domain/mapping/workspace/diagramViewState';
import { DiagramSubtreeControls } from './DiagramSubtreeControls';
import { CanvasPasteMenu } from "./CanvasPasteMenu";
import { normalizePastedDiagram } from "./pasteDiagram";
import { LocalChatVerbosityToggle } from "../chat/LocalChatVerbosityToggle";
import { selectionClipboardText } from "../../../../domain/mapping/workspace/selectionClipboard";
import { layoutConversationPane } from "../../../../domain/mapping/chat/conversationPaneLayout";
import { addDisplayNode, displayGeometry, measureDisplayNode, removeDisplayNode, setExpansion, type DisplayState, type SelectionRegion, type ConversationPane, type ProjectedPane } from "../../../../domain/mapping/workspace/displayModel";
import { initialSelectionSurface, selectionSurfaceKeys, type MappingCanvasState, type MappingControlValues, type SelectionSurfaceState } from "../../../../domain/mapping/workspace/mappingWorkspace";
import { SelectionEffectsLayer } from "./SelectionEffectsLayer";
import { flattenGrid, hitTest, layoutScene, resolveScene, updateGridBox, type GridPoint as ScenePoint } from "../../../../domain/core/diagrams/lineGrid";
import { type MappingGridDocument } from "../../../../domain/mapping/workspace/mappingGrid";
import { projectSelection, validateProjection } from "../../../../domain/core/diagrams/diagramProjection";
import type { ProjectRepresentationCatalogRecord } from "../../../../domain/core/representations/projectCatalog";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
  type PointerEvent
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

interface GridPoint {
  line: number;
  column: number;
}

interface CellMetrics {
  width: number;
  height: number;
}

interface ActiveSelection {
  pointerId: number;
  anchor: GridPoint;
  start: { x: number; y: number };
}

function useControl<K extends keyof MappingControlValues>(key: K, state: MappingCanvasState,
  setState: Dispatch<SetStateAction<MappingCanvasState>>): [MappingControlValues[K], Dispatch<SetStateAction<MappingControlValues[K]>>] {
  const isSurface = (selectionSurfaceKeys as readonly string[]).includes(key);
  const read = (current: MappingCanvasState) => (isSurface
    ? current.controls.surfaces[current.controls.retainedSelectionId ?? 'draft']
    : current.controls) as MappingControlValues;
  const set = useCallback((value: SetStateAction<MappingControlValues[K]>) => setState(current => {
    const nextValue = typeof value === 'function' ? (value as (old: MappingControlValues[K]) => MappingControlValues[K])(read(current)[key]) : value;
    if (isSurface) {
      const owner = current.controls.retainedSelectionId ?? 'draft';
      return { ...current, controls: { ...current.controls, surfaces: { ...current.controls.surfaces,
        [owner]: { ...current.controls.surfaces[owner], [key]: nextValue } } } };
    }
    const surfaces = { ...current.controls.surfaces };
    if (key === 'retainedSelectionId' && nextValue !== current.controls.retainedSelectionId) {
      const target = nextValue as string | null;
      if (!target) surfaces.draft = { ...initialSelectionSurface(), presentation: surfaces[current.controls.retainedSelectionId ?? 'draft'].presentation };
      else surfaces[target] ??= { ...surfaces[current.controls.retainedSelectionId ?? 'draft'] };
    }
    return { ...current, controls: { ...current.controls, [key]: nextValue, surfaces } };
  }), [key, isSurface, setState]);
  return [read(state)[key], set];
}

function normalizeRect(anchor: GridPoint, focus: GridPoint): MappingPocGridRect {
  return {
    startLine: Math.min(anchor.line, focus.line),
    endLine: Math.max(anchor.line, focus.line),
    startColumn: Math.min(anchor.column, focus.column),
    endColumn: Math.max(anchor.column, focus.column)
  };
}

function typingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches("input, textarea, select") || target.isContentEditable);
}


const emptySelectionScene = singleDiagramScene('[Empty canvas]');
const emptySelectionBox = flattenGrid(resolveScene(emptySelectionScene)).find(box => box.contentId)!;

export function MappingPocSelectionCanvas(props: {
  onTransfer?: (mode: 'copy' | 'move', selectedIds: string[]) => void;
  onUndo?: (redo: boolean) => void;
  canWorkspaceUndo?: boolean;
  canWorkspaceRedo?: boolean;
  session: CanvasSession;
  onJump?: (target: DiagramJumpTarget) => void;
  onBusyChange?: (busy: boolean) => void;
  active?: boolean;
  focusBox?: DiagramFocus;
  projectContext?: { projectId: string; representationId: string; baseRevisionId: string };
  projectionCatalog?: ProjectRepresentationCatalogRecord;
  dirtyRepresentationIds?: string[];
  onLineCountChange?: (lineCount: number) => void;
  localChatVariant?: LocalChatVariant;
}) {
  const session = props.session, controller = session.controller;
  const documentState = useStore(session.document, state => state.document);
  const presentation = useStore(session.presentation, state => state);
  const controls = useStore(session.controls, state => state);
  const geometry = useStore(session.geometry, state => state);
  const status = useStore(session.status, state => state);
  const controllerState = useMemo(() => controller.getSnapshot(), [controller, documentState, presentation, controls, geometry, status]);
  const canvasState = useMemo(() => ({ ...presentation, controls }), [presentation, controls]);
  const setCanvasState = useCallback((value: SetStateAction<MappingCanvasState>) => controller.updateCanvas(value), [controller]);
  const localChatVariant = canvasState.controls.surfaces[canvasState.controls.retainedSelectionId ?? 'draft'].presentation;
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
  const operationOwnerRef = useRef<string>('draft'); operationOwnerRef.current = canvasState.controls.retainedSelectionId ?? 'draft';
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
  const [retainedSelectionId, setRetainedSelectionId] = useControl('retainedSelectionId', canvasState, setCanvasState);
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
  const activeSelectionRef = useRef<ActiveSelection | null>(null);
  const replyControllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    for (const controller of replyControllers.current.values()) controller.abort();
    replyControllers.current.clear();
  }, []);
  const [clientSessionId] = useState(() => `mapping-${crypto.randomUUID()}`);
  const [cell, setCell] = useState<CellMetrics>({ width: 0, height: 0 });
  const [connectionsOpen, setConnectionsOpen] = useState(false);
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
  const endpointGeometry = useEndpointGeometry(controller, props.active !== false);
  const composedText = useMemo(() => diagramSceneText(scene, canvasState.diagramViews, gridDocument.jumps), [scene, canvasState.diagramViews, gridDocument.jumps]);
  const composedAscii = composedText.ascii;
  const commit = (next: MappingGridDocument) => controller.commitDocument(next);
  const [promptOperation, setPromptOperation] = useControl("promptOperation", canvasState, setCanvasState);
  const [diagramPlacement, setDiagramPlacement] = useState<string | null>(null);
  const placementDragRef = useRef<ScenePoint | null>(null);
  const placementPointerRef = useRef<number | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{ start: ScenePoint; end: ScenePoint } | null>(null);
  const [movingBoxId, setMovingBoxId] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useControl("selectionRect", canvasState, setCanvasState);
  const [diagramSelection, setDiagramSelection] = useControl('selectedDiagramIds', canvasState, setCanvasState);
  const selectedDiagrams = (diagramSelection ?? []).filter(id => boxes.some(box => `grid:${box.box.id}` === id && box.box.kind === 'diagram'));
  const [selectedNodeIds, setSelectedNodeIds] = useControl("selectedNodeIds", canvasState, setCanvasState);
  const [projectionChoice, setProjectionChoice] = useControl("projectionChoice", canvasState, setCanvasState);
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
    const text = selectionClipboardText(content, selectionRect, selectedNodeIds)!;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable in this browser");
      await navigator.clipboard.writeText(text);
      setStatusMessage(selectedSourceRangeCount ? "Copied ASCII + code refs" : "Copied ASCII (no code refs mapped)");
    } catch (error) {
      setStatusMessage(`Copy failed: ${error instanceof Error ? error.message : "Clipboard access was denied"}`);
    }
  }, [content, selectionRect, selectedNodeIds, selectedSourceRangeCount]);
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
      if (width > 0 && height > 0) setCell({ width, height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(pre);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    props.onLineCountChange?.(composedAscii.split("\n").length);
  }, [composedAscii, props.onLineCountChange]);

  const busyHandler = useRef(props.onBusyChange);
  busyHandler.current = props.onBusyChange;
  useEffect(() => { busyHandler.current?.(isGenerating); }, [isGenerating]);

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
    clearSelection();
  }, [props.focusBox]);

  useEffect(() => {
    if (promptOpen) promptInputRef.current?.focus();
  }, [promptOpen]);

  useEffect(() => {
    if (askOpen) askInputRef.current?.focus();
  }, [askOpen]);

  const scenePointAtClient = useCallback((clientX: number, clientY: number): ScenePoint | null => {
    const pre = preRef.current;
    if (!pre || !(cell.width > 0) || !(cell.height > 0)) return null;
    const bounds = pre.getBoundingClientRect();
    const scale = pre.offsetWidth > 0 ? bounds.width / pre.offsetWidth : 1;
    return {
      row: Math.max(0, Math.floor((clientY - bounds.top) / (cell.height * scale))),
      column: Math.max(0, Math.floor((clientX - bounds.left) / (cell.width * scale)))
    };
  }, [cell]);
  const pointAtClient = useCallback((clientX: number, clientY: number): GridPoint | null => {
    const point = scenePointAtClient(clientX, clientY);
    const line = point && activeProjection.lineForRow(Math.max(0, Math.min(activeProjection.sourceLines.length - 1, point.row - activeBox.bounds.row)));
    return point && line ? {
      line,
      column: Math.max(1, Math.min(maxColumn, point.column - activeBox.bounds.column + 1))
    } : null;
  }, [scenePointAtClient, maxColumn, activeBox, activeProjection]);

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

  const finishSelection = (event: PointerEvent<HTMLDivElement>) => {
    const active = activeSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const focus = pointAtClient(event.clientX, event.clientY) ?? active.anchor;
    const rect = normalizeRect(active.anchor, focus);
    const selected = nodes.filter((node) => (
      node.head.line >= rect.startLine
      && node.head.line <= rect.endLine
      && node.head.startColumn <= rect.endColumn
      && node.head.endColumn >= rect.startColumn
    ));
    activeSelectionRef.current = null;
    session.previewSelection(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!activeProjection.rect(rect)) {
      setSelectionRect(null); setSelectedNodeIds([]);
      setStatusMessage('Expand the subtree before selecting across hidden lines'); return;
    }
    setPromptOpen(false);
    setPromptText("");
    setAskOpen(false);
    setAskText("");
    setPromptPhase("ready");
    const sourceRangeCount = selected.reduce((count, node) => count + node.sourceRanges.length, 0);
    setStatusMessage(selected.length ? `${sourceRangeCount} mapped corpus range${sourceRangeCount === 1 ? "" : "s"} ready` : "Diagram region selected");
    setSelectedNodeIds(selected.map((node) => node.id));
    setSelectionRect(rect);
  };

  const retainSelection = useCallback(() => {
    if (retainedSelectionId && display.nodes[retainedSelectionId]) return retainedSelectionId;
    if (!selectionRect) return undefined;
    const id = crypto.randomUUID();
    const root: SelectionRegion = { ...displayGeometry({
      x: (activeBox.bounds.column + selectionRect.startColumn - 1) * cell.width,
      y: (activeBox.bounds.row + (activeProjection.rowForLine(selectionRect.startLine) ?? selectionRect.startLine - 1)) * cell.height }, {
      width: (selectionRect.endColumn - selectionRect.startColumn + 1) * cell.width,
      height: (selectionRect.endLine - selectionRect.startLine + 1) * cell.height }), id, kind: 'selection', childIds: [], expansion: 'expanded', displayMode: 'stacked',
      sourceBoxId: activeBox.box.id, sourceContentId: content.id, sourceAscii: content.content.ascii,
      sourceRevisionId: props.projectContext?.baseRevisionId, rect: { ...selectionRect }, selectedIds: [...selectedNodeIds] };
    setDisplay(current => addDisplayNode(current, root)); setRetainedSelectionId(id); setActionsOpen(false);
    return id;
  }, [activeProjection, retainedSelectionId, display, selectionRect, activeBox, cell, content, props.projectContext?.baseRevisionId, selectedNodeIds, setDisplay, setRetainedSelectionId, setActionsOpen]);
  const openMapped = useCallback(() => {
    if (!candidateProjection.bRange) return;
    const ownerId = retainSelection(); if (!ownerId) return;
    const result = callTreeProjection.result ?? { ascii: candidateProjection.bAscii, matchedSourceEvidenceIds: [],
      unmatchedSourceEvidenceIds: [], targetNodeIds: candidateProjection.directlyMappedBNodeIds,
      visibleNodeIds: candidateProjection.selectedBNodeIds, projectedNodeIds: candidateProjection.selectedBNodeIds,
      rows: candidateProjection.bAscii.split('\n').map((_, index) => ({ nodeId: String(index), sourceLine: index + 1 })) };
    const pane: ProjectedPane = { ...displayGeometry(), id: crypto.randomUUID(), kind: 'projection', childIds: [], expansion: 'expanded',
      title: callTreeProjection.title ?? 'Related branches', projectionId: chosenProjection?.id,
      sourceRevisionId: chosenProjection?.sourceRevisionId, targetRevisionId: chosenProjection?.targetRevisionId,
      content: { kind: 'call-tree', result, coverage: `${result.matchedSourceEvidenceIds.length}/${selectedEvidenceIds.length} entities linked · ${result.targetNodeIds.length} branches` } };
    setDisplay(current => addDisplayNode(current, pane, ownerId));
    setActionsOpen(false);
    setStatusMessage("Projection opened");
  }, [candidateProjection, retainSelection, callTreeProjection, chosenProjection, selectedEvidenceIds.length, setDisplay]);
  const removeEffect = (id: string) => controller.updateCanvas(current => {
    if (current.controls.surfaces[id]?.promptPhase === 'generating') return current;
    const display = removeDisplayNode(current.display, id);
    const ownerRemoved = current.controls.retainedSelectionId && !display.nodes[current.controls.retainedSelectionId];
    return { ...current, display, controls: { ...current.controls,
      ...(ownerRemoved ? { retainedSelectionId: null, selectionRect: null, selectedNodeIds: [] } : {}),
      surfaces: Object.fromEntries(Object.entries(current.controls.surfaces).filter(([key]) => key === 'draft' || display.nodes[key])),
      activeThreadId: current.controls.activeThreadId && display.nodes[current.controls.activeThreadId] ? current.controls.activeThreadId : null } };
  }, true);

  const clearSelection = useCallback(() => {
    const active = activeSelectionRef.current;
    const stage = stageRef.current;
    if (active && stage?.hasPointerCapture(active.pointerId)) {
      stage.releasePointerCapture(active.pointerId);
    }
    activeSelectionRef.current = null;
    session.previewSelection(null);
    if (placementPointerRef.current !== null && stage?.hasPointerCapture(placementPointerRef.current)) {
      stage.releasePointerCapture(placementPointerRef.current);
    }
    placementDragRef.current = null;
    placementPointerRef.current = null;
    setSelectedNodeIds([]);
    setSelectionRect(null);
    setRetainedSelectionId(null);
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
    setSelectedNodeIds([]);
    setSelectionRect(null);
    setRetainedSelectionId(null);
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
      clearSelection();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Layout failed");
    }
  };

  const undo = (redo = false) => {
    if (isGenerating) return;
    clearSelection();
    setDiagramSelection([]);
    if (props.onUndo) props.onUndo(redo); else controller.undo(redo);
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
      controller.applyUpdate(expectedVersion, [{ method: 'patchDiagram', nodeId: `grid:${activeBox.box.id}`,
        start: result.startLine, end: result.oldEndLine,
        patch: result.diagramAscii.split('\n').slice(result.startLine - 1, result.newEndLine).join('\n'), mappings: result.mappings }]);
      if (operationOwnerRef.current === owner) {
        setSelectedNodeIds([]);
        setSelectionRect({ startLine: result.startLine, endLine: result.newEndLine,
          startColumn: selectionRect.startColumn, endColumn: selectionRect.endColumn });
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
      if (operationOwnerRef.current === owner) { clearSelection(); setActiveBoxId(id); }
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
      clearSelection();
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : 'Grouping failed'); }
  };

  const hotkeyHandler = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const handle = (event: globalThis.KeyboardEvent) => hotkeyHandler.current(event);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useLayoutEffect(() => {
    hotkeyHandler.current = (event: globalThis.KeyboardEvent) => {
      if (props.active === false || event.defaultPrevented) return;
      if (event.key === "Escape" && activeSelectionRef.current) {
        event.preventDefault(); clearSelection(); return;
      }
      if (event.target instanceof Element && event.target.closest(".mapping-floating-pane, .mapping-submenu, [data-display-node]")) return;
      if (event.key === "Escape" && (diagramPlacement || movingBoxId)) {
        event.preventDefault();
        clearSelection();
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
      if (event.key === 'Escape' && diagramSelection?.length) {
        event.preventDefault(); clearSelection(); setDiagramSelection([]); return;
      }
      if (!selectionRect) return;
      if (event.key.toLowerCase() === "c" && !event.altKey && !promptOpen && !askOpen
        && !window.getSelection()?.toString()) {
        event.preventDefault(); void copySelection(); return;
      }
      if (event.key.toLowerCase() === "n" && candidateProjection.bRange && !promptOpen && !askOpen) {
        event.preventDefault();
        openMapped();
        return;
      }
      if (event.key.toLowerCase() === "p" && promptPhase !== "generating" && !askOpen) {
        event.preventDefault();
        openPrompt();
        return;
      }
      if (event.key.toLowerCase() === "a" && promptPhase !== "generating" && !promptOpen) {
        event.preventDefault();
        openAsk();
        return;
      }
      if (event.key === "Escape" && !retainedSelectionId && promptPhase !== "generating") {
        clearSelection();
      }
    };
  }, [
    props.active,
    controller,
    removeEffect,
    diagramSelection,
    askOpen,
    diagramPlacement,
    movingBoxId,
    candidateProjection.bRange,
    copySelection,
    clearSelection,
    openMapped,
    retainedSelectionId,
    openAsk,
    openPrompt,
    promptOpen,
    promptPhase,
    selectedNodeIds.length,
    selectionRect
  ]);

  useEffect(() => {
    if (!selectionRect
      || retainedSelectionId
      || promptOpen
      || askOpen
      || diagramPlacement
      || promptPhase === "generating") return undefined;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (props.active === false) return;
      const stage = stageRef.current;
      if (stage && event.composedPath().includes(stage)) return;
      clearSelection();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [props.active, askOpen, clearSelection, retainedSelectionId, diagramPlacement, promptOpen, promptPhase, selectionRect]);

  const visibleSelectionRect = selectionRect && activeProjection.rect(selectionRect);
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
  const diagramText = useMemo(() => <DiagramText registerEndpoint={endpointGeometry.registerEndpoint}
    rows={composedText.rows} onJump={props.onJump ? onDiagramJump : undefined} ref={preRef}
    className="mapping-poc-ascii"
    style={cell.width ? { width: resolved.bounds.columns * cell.width } : undefined}
    data-graph="A" data-line-count={resolved.bounds.rows} data-revision={diagramRevision}
  />, [endpointGeometry.registerEndpoint, composedText.rows, Boolean(props.onJump), onDiagramJump,
    cell.width, resolved.bounds.columns, resolved.bounds.rows, diagramRevision]);

  return (
    <div
      ref={stageRef}
      tabIndex={-1}
      className={`mapping-poc-graph-stage${ctrlSelecting ? " is-selecting" : ""}`}
      aria-label="Graph A selectable nodes"
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
        if (isGenerating
          || event.button !== 0
          || event.shiftKey
          || !event.ctrlKey
          || event.metaKey
          || ((event.target as Element).closest("[data-mapping-static-ui]") && !(event.ctrlKey && (event.target as Element).closest("[data-diagram-jump-id]")))) return;
        const scenePoint = scenePointAtClient(event.clientX, event.clientY);
        const hit = scenePoint && hitTest(scene, scenePoint);
        const targetBox = hit && boxes.find((node) => node.box.id === hit.boxId);
        if (!hit || !targetBox?.contentId || targetBox.box.collapsed) return;
        const line = contentProjections.get(hit.boxId)?.lineForRow(hit.local.row);
        if (line === undefined) return;
        const anchor = { line, column: hit.local.column + 1 };
        event.currentTarget.focus({ preventScroll: true });
        setActiveBoxId(hit.boxId);

        event.preventDefault();
        event.stopPropagation();
        window.getSelection()?.removeAllRanges();
        event.currentTarget.setPointerCapture(event.pointerId);
        activeSelectionRef.current = { pointerId: event.pointerId, anchor, start: { x: event.clientX, y: event.clientY } };
        setRetainedSelectionId(null);
        setPromptPhase("ready");
        setStatusMessage("selection ready");
        setSelectionRect(null);
        session.previewSelection({ boxId: hit.boxId, rect: normalizeRect(anchor, anchor) });
        setSelectedNodeIds([]);
          }}
      onPointerMove={(event) => {
        if (placementDragRef.current) {
          const point = scenePointAtClient(event.clientX, event.clientY);
          if (point) setPlacementPreview({ start: placementDragRef.current, end: point });
          event.preventDefault(); event.stopPropagation();
          return;
        }
        const active = activeSelectionRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const focus = pointAtClient(event.clientX, event.clientY);
        if (!focus) return;
        event.preventDefault();
        event.stopPropagation();
        session.previewSelection({ boxId: activeBox.box.id, rect: normalizeRect(active.anchor, focus) });
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
        finishSelection(event);
      }}
      onPointerCancel={(event) => {
        placementDragRef.current = null;
        placementPointerRef.current = null;
        setPlacementPreview(null);
        if (activeSelectionRef.current?.pointerId !== event.pointerId) return;
        event.stopPropagation();
        activeSelectionRef.current = null;
        session.previewSelection(null);
        setSelectionRect(null);
      }}
    >
      <DiagramSelectionLayer stageRef={stageRef} active={props.active !== false && !isGenerating && !diagramPlacement && !movingBoxId}
        diagramIds={boxes.filter(box => box.box.kind === 'diagram').map(box => `grid:${box.box.id}`)} selected={selectedDiagrams}
        onSelect={ids => { clearSelection(); setDiagramSelection(ids); }} />
      {props.active !== false && props.onTransfer && selectedDiagrams.length > 0 && !selectionRect && createPortal(
        <div className="mapping-diagram-selection-actions" role="toolbar" aria-label="Selected diagrams" data-diagram-canvas-static-ui data-mapping-static-ui>
          <strong role="status">{selectedDiagrams.length} {selectedDiagrams.length === 1 ? 'diagram' : 'diagrams'} selected</strong>
          <button type="button" disabled={isGenerating || !!diagramPlacement || !!movingBoxId} onClick={() => props.onTransfer?.('copy', selectedDiagrams)}>Copy to canvas…</button>
          <button type="button" disabled={isGenerating || !!diagramPlacement || !!movingBoxId} onClick={() => props.onTransfer?.('move', selectedDiagrams)}>Move to canvas…</button>
          <button type="button" onClick={() => { clearSelection(); setDiagramSelection([]); }}>Deselect (Esc)</button>
        </div>, document.body)}
      {!boxes.some(box => box.contentId) && <p className="mapping-empty-canvas">Empty canvas — right-click to paste a diagram, or Undo to restore.</p>}
      <CanvasPasteMenu selectionCount={!selectionRect ? selectedDiagrams.length : 0}
        onCancelSelection={() => { clearSelection(); setDiagramSelection([]); }}
        onTransfer={props.onTransfer ? mode => props.onTransfer!(mode, selectedDiagrams) : undefined} stageRef={stageRef} active={props.active !== false} busy={isGenerating || !!diagramPlacement || !!movingBoxId}
        toGrid={scenePointAtClient} onPaste={(point, text) => {
          const id = `diagram-${crypto.randomUUID()}`;
          controller.applyUpdate(controller.getSnapshot().version, [{ method: 'diagram-create', id, position: point, ascii: normalizePastedDiagram(text) }]);
          clearSelection();
          setActiveBoxId(id);
          setStatusMessage("Sub-diagram pasted; layout updated");
        }} />
      <span ref={probeRef} className="mapping-poc-cell-probe" aria-hidden="true">0000000000</span>
      {diagramText}
      {props.focusBox?.search && (() => {
        const box = boxes.find(box => box.box.id === props.focusBox!.id);
        return <SearchHighlight focus={props.focusBox} content={box?.contentId ? scene.contents[box.contentId].content : undefined}
          origin={box?.bounds} cell={cell} row={contentProjections.get(props.focusBox.id)?.rowForLine(props.focusBox.search.line)} />;
      })()}

      <DiagramSubtreeControls nodes={displayNodes} visibleBoxIds={new Set(boxes.map(box => box.box.id))} cell={cell}
        disabled={isGenerating || !!diagramPlacement || !!movingBoxId || !!promptOpen || !!askOpen}
        onCollapse={(nodeId, contentNodeId, collapsed) => {
          try {
            controller.transact(controller.getSnapshot().version, [{ method: 'collapse', nodeId, contentNodeId, collapsed }]);
          } catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); }
        }} />
      <div className="mapping-grid-tools" data-mapping-static-ui data-diagram-canvas-static-ui>
        <button type="button" disabled={!(controllerState.canUndo || props.canWorkspaceUndo) || isGenerating} onClick={() => undo()}>Undo</button>
        <button type="button" disabled={!(controllerState.canRedo || props.canWorkspaceRedo) || isGenerating} onClick={() => undo(true)}>Redo</button>
        <button type="button" aria-expanded={connectionsOpen} onClick={() => setConnectionsOpen(value => !value)}>Connections ({gridDocument.edges.length})</button>
        <span role="status">{diagramPlacement ? "Drag a region to place the sub-diagram · Esc cancels" : movingBoxId ? "Click to move the box · Esc cancels" : statusMessage}</span>
      </div>
      <div ref={endpointGeometry.refForEndpoint({ displayNodeId: `grid:${scene.root.id}` })}
        data-grid-box={scene.root.id} data-diagram-selected={selectedDiagrams.includes(`grid:${scene.root.id}`)} aria-hidden="true"
        style={{ position: 'absolute', pointerEvents: 'none', left: resolved.bounds.column * cell.width,
          top: resolved.bounds.row * cell.height, width: resolved.bounds.columns * cell.width, height: resolved.bounds.rows * cell.height }} />
      {boxes.filter((node) => node.box.id !== scene.root.id).map((node) => (
        <div key={node.box.id} ref={endpointGeometry.refForEndpoint({ displayNodeId: `grid:${node.box.id}` })} className={`mapping-grid-box${node.box.kind === "container" ? " is-container" : ""}`}
          data-grid-box={node.box.id} data-diagram-selected={selectedDiagrams.includes(`grid:${node.box.id}`)} data-grid-column={node.bounds.column} data-grid-row={node.bounds.row}
          data-grid-columns={node.bounds.columns} data-grid-rows={node.bounds.rows} data-collapsed={node.box.collapsed}
          style={{ left: node.bounds.column * cell.width, top: node.bounds.row * cell.height,
            width: node.bounds.columns * cell.width, height: node.bounds.rows * cell.height }}>
          <div className="mapping-grid-box-tools" data-mapping-static-ui data-diagram-canvas-static-ui>
            <button type="button" disabled={isGenerating || !!diagramPlacement}
              aria-label={`${node.box.collapsed ? "Expand" : "Collapse"} ${node.box.id}`}
              onClick={() => {
                try { controller.transact(controller.getSnapshot().version, [{ method: 'collapse', nodeId: `grid:${node.box.id}`, collapsed: !node.box.collapsed }]); clearSelection(); }
                catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); }
              }}>
              {node.box.collapsed ? "Expand" : "Collapse"}
            </button>
            <button type="button" disabled={isGenerating || !!diagramPlacement} onClick={() => { clearSelection(); setMovingBoxId(node.box.id); }}>Move</button>
            <button type="button" disabled={isGenerating || !!diagramPlacement} onClick={() => wrapInGroup(node.box.id)}>Group</button>
          </div>
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
            className={`mapping-poc-node-hit is-${node.selectableBecause}${selectedNodeIdSet.has(node.id) ? " is-selected" : ""}${selectedNodeIdSet.has(node.id) && (promptOpen || askOpen || promptPhase === "generating") ? " is-prompt-target" : ""}`}
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

      <SelectionPreviewOverlay session={session} boxId={activeBox.box.id} projection={activeProjection} cell={cell} />
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
          aria-keyshortcuts="N P A"
          style={{ left: rectStyle.left + rectStyle.width + 12, top: rectStyle.top + rectStyle.height + 8 }}
        >
          <header>
            <span>{selectedNodes.length ? `${selectedNodes.length} selected · ${candidateProjection.mappedANodeIds.length} mapped` : "Region selected · no code entities"}</span>
            <em className={hasCompleteSourceCoverage ? "is-covered" : "is-missing"}>
              {selectedNodes.length ? `source ${sourceCoveredNodeCount}/${selectedNodes.length} · ${selectedSourceRangeCount} ranges` : "No source mappings"}
            </em>
            <small className={`is-${askOpen ? "asking" : promptPhase}`} aria-live="polite">{statusMessage}</small>
          </header>
          {!promptOpen && !askOpen ? (
            <div className="mapping-poc-selection-actions">
              <button type="button" aria-label="Copy ASCII + code refs" aria-keyshortcuts="C Control+C Meta+C" onClick={() => void copySelection()}>
                Copy ASCII + code refs
              </button>
              {props.projectContext && projections.length > 1 && <label className="mapping-projection-choice">
                Call tree<select aria-label="Call-tree projection" value={chosenProjection?.id ?? ""}
                  onChange={(event) => setProjectionChoice(event.target.value)}>
                  {projections.map((projection) => <option key={projection.id} value={projection.id}>{projection.name}</option>)}
                </select>
              </label>}
              {props.projectContext && callTreeProjection.error && <small className="mapping-projection-status" role="status">{callTreeProjection.error}</small>}
              <button type="button" disabled={!hasCompleteSourceCoverage} onClick={() => {
                openPrompt(); setPromptOperation("generate"); setStatusMessage("Describe the sub-diagram, then choose its region");
              }}>Generate sub-diagram</button>
              <button
                ref={openMappedRef}
                type="button"
                disabled={!candidateProjection.bRange}
                aria-keyshortcuts="N"
                title={props.projectContext ? callTreeProjection.error ?? "Show related call-tree branches" : "Show related branches"}
                onClick={openMapped}
              >
                <kbd>N</kbd>
                open call tree
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
                aria-keyshortcuts="A"
                title="Ask about the selected region"
                onClick={openAsk}
              >
                <kbd>A</kbd>
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


      {chatThreads.filter(thread => {
        const owner = Object.values(display.nodes).find(node => node.childIds.includes(thread.id));
        if (owner?.kind === 'selection' && scene.contents[owner.sourceContentId]?.content.ascii === owner.sourceAscii && contentProjections.has(owner.sourceBoxId) && !contentProjections.get(owner.sourceBoxId)!.rect(owner.rect)) return false;
        return !owner || owner.expansion === 'expanded' && (owner.kind !== 'selection' || boxes.some(box => box.box.id === owner.sourceBoxId && !box.box.collapsed));
      }).map((thread) => {
        const isActive = display.nodes[thread.id]?.expansion === 'expanded';
        const pane = display.nodes[thread.id] as ConversationPane;
        const presentation = pane.presentation;
        return (
          <div
            key={thread.id}
            className={`local-chat-anchor${isActive ? " is-active" : ""}`}
            data-mapping-static-ui
            data-diagram-canvas-static-ui
            style={{ left: pane.canvasAnchor.x - activeBox.bounds.column * cell.width, top: pane.canvasAnchor.y - activeBox.bounds.row * cell.height }}
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
                style={{ left: pane.position.x - pane.canvasAnchor.x, top: pane.position.y - pane.canvasAnchor.y,
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
      <SelectionEffectsLayer diagramViews={canvasState.diagramViews} state={display} setState={setDisplay} setLayoutState={setDisplayLayout} boxes={boxes} scene={scene} cell={cell}
        catalog={props.projectionCatalog} dirtyRepresentationIds={props.dirtyRepresentationIds} onRemove={removeEffect}
        busySelectionIds={Object.entries(canvasState.controls.surfaces).filter(([, surface]) => surface.promptPhase === 'generating').map(([id]) => id)}
        onActivate={root => {
          setActiveBoxId(root.sourceBoxId); setRetainedSelectionId(root.id); setSelectionRect(root.rect); setSelectedNodeIds(root.selectedIds);
          setActionsOpen(true);
          stageRef.current?.focus({ preventScroll: true });
        }} />
      <DiagramConnections controller={controller} state={controllerState} cell={cell} displayNodes={displayNodes} svgRef={endpointGeometry.svgRef}
        open={connectionsOpen && props.active !== false} onOpen={() => setConnectionsOpen(true)} onClose={() => setConnectionsOpen(false)}
        disabled={isGenerating || !!diagramPlacement || !!movingBoxId} />
    </div>
  );
}
