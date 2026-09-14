import { CanvasPasteMenu } from "./CanvasPasteMenu";
import { pasteGridDiagram } from "./pasteDiagram";
import { LocalChatVerbosityToggle } from "../chat/LocalChatVerbosityToggle";
import { formatAsciiWithCodeReferences } from "../../../../domain/core/diagrams/diagramClipboard";
import { asciiForSelection } from "../../../../domain/core/diagrams/diagramSelection";
import { layoutConversationPane } from "../../../../domain/mapping/chat/conversationPaneLayout";
import { addDisplayNode, displayGeometry, measureDisplayNode, removeDisplayNode, setExpansion, type DisplayState, type SelectionRegion, type ConversationPane, type ProjectedPane } from "../../../../domain/mapping/workspace/displayModel";
import { initialCanvasState, initialSelectionSurface, selectionSurfaceKeys, type MappingCanvasState, type MappingControlValues, type SelectionSurfaceState } from "../../../../domain/mapping/workspace/mappingWorkspace";
import { SelectionEffectsLayer } from "./SelectionEffectsLayer";
import { composeScene, flattenGrid, hitTest, layoutScene, resolveScene, updateGridBox, type GridPoint as ScenePoint } from "../../../../domain/core/diagrams/lineGrid";
import { initialMappingGrid, insertGridDiagram, type MappingGridDocument } from "../../../../domain/mapping/workspace/mappingGrid";
import { mappingDocumentFromScene } from "../../../../domain/mapping/workspace/mappingDocument";
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
  MAPPING_POC_OVERLAY_PLACEMENTS,
  type MappingPocASection
} from "../../../../domain/mapping/selection/mappingPocOverlays";
import { localChatResponder, promptMappingPocSelection } from "../api";
import type { MappingPocPromptResult } from "../../../../domain/mapping/selection/mappingPocPrompt";
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

function nodesAfterPatch(
  nodes: readonly MappingPocANode[],
  result: MappingPocPromptResult
): MappingPocANode[] {
  return nodes.flatMap((node) => {
    if (node.extent.endLine < result.startLine) return [node];
    if (node.extent.startLine <= result.oldEndLine) return [];
    return [{
      ...node,
      head: { ...node.head, line: node.head.line + result.verticalDelta },
      extent: {
        startLine: node.extent.startLine + result.verticalDelta,
        endLine: node.extent.endLine + result.verticalDelta
      }
    }];
  });
}

function sectionsAfterPatch(
  sections: readonly MappingPocASection[],
  result: MappingPocPromptResult
): MappingPocASection[] {
  return sections.flatMap((section) => {
    if (section.endLine < result.startLine) return [section];
    if (section.startLine <= result.oldEndLine) return [];
    return [{
      ...section,
      startLine: section.startLine + result.verticalDelta,
      endLine: section.endLine + result.verticalDelta
    }];
  });
}

export function MappingPocSelectionCanvas(props: {
  initialDocument?: MappingGridDocument;
  initialCanvasState?: MappingCanvasState;
  onCanvasStateChange?: (state: MappingCanvasState) => void;
  onDocumentChange?: (document: MappingGridDocument) => void;
  onBusyChange?: (busy: boolean) => void;
  active?: boolean;
  focusBox?: { id: string; serial: number };
  projectContext?: { projectId: string; representationId: string; baseRevisionId: string };
  projectionCatalog?: ProjectRepresentationCatalogRecord;
  savedScene?: string;
  dirtyRepresentationIds?: string[];
  onLineCountChange?: (lineCount: number) => void;
  localChatVariant?: LocalChatVariant;
}) {
  const [canvasState, setCanvasState] = useState(() => {
    if (props.initialCanvasState) return props.initialCanvasState;
    const state = initialCanvasState(); state.controls.surfaces.draft.presentation = props.localChatVariant ?? 'compact'; return state;
  });
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

  const setDisplay = useCallback((value: SetStateAction<DisplayState>) => setCanvasState(current => {
    const display = typeof value === 'function' ? value(current.display) : value;
    return display === current.display ? current : { ...current, display };
  }), []);
  const measurePane = useCallback((id: string, width: number, height: number) =>
    setDisplay(current => measureDisplayNode(current, id, width, height)), [setDisplay]);
  useLayoutEffect(() => {
    const layout = () => setDisplay(current => {
      let next = current;
      for (const node of Object.values(current.nodes)) if (node.kind === 'conversation') {
        next = layoutConversationPane(next, node, { width: window.innerWidth, height: window.innerHeight });
      }
      return next;
    });
    layout(); window.addEventListener('resize', layout);
    return () => window.removeEventListener('resize', layout);
  }, [display, setDisplay]);
  const canvasChange = useRef(props.onCanvasStateChange); canvasChange.current = props.onCanvasStateChange;
  useEffect(() => { canvasChange.current?.(canvasState); }, [canvasState]);
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
  const [history, setHistory] = useState<{ past: MappingGridDocument[]; present: MappingGridDocument; future: MappingGridDocument[] }>(
    () => ({ past: [], present: props.initialDocument ?? initialMappingGrid(), future: [] })
  );
  const gridDocument = history.present;
  const scene = gridDocument.scene;
  const resolved = useMemo(() => resolveScene(scene), [scene]);
  const boxes = useMemo(() => flattenGrid(resolved), [resolved]);
  const [activeBoxId, setActiveBoxId] = useControl("activeBoxId", canvasState, setCanvasState);
  const activeBox = boxes.find((node) => node.box.id === activeBoxId && node.contentId)
    ?? boxes.find((node) => node.contentId)!;
  const content = scene.contents[activeBox.contentId!];
  const ascii = content.ascii;
  const diagramRevision = content.revision;
  const nodes = gridDocument.nodes[content.id] ?? [];
  const sections = gridDocument.sections[content.id] ?? [];
  const composedAscii = useMemo(() => composeScene(scene), [scene]);
  const commit = (next: MappingGridDocument) => setHistory((current) => ({
    past: [...current.past.slice(-49), current.present], present: next, future: []
  }));
  const [promptOperation, setPromptOperation] = useControl("promptOperation", canvasState, setCanvasState);
  const [diagramPlacement, setDiagramPlacement] = useState<string | null>(null);
  const placementDragRef = useRef<ScenePoint | null>(null);
  const placementPointerRef = useRef<number | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{ start: ScenePoint; end: ScenePoint } | null>(null);
  const [movingBoxId, setMovingBoxId] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useControl("selectionRect", canvasState, setCanvasState);
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
    const refs = selectedNodes.flatMap((node) => node.sourceRanges.map((range) =>
      `${node.label}: ${range.path}:${range.startLine}-${range.endLine}`
    ));
    const text = formatAsciiWithCodeReferences([asciiForSelection(ascii, selectionRect)], refs);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable in this browser");
      await navigator.clipboard.writeText(text);
      setStatusMessage(refs.length ? "Copied ASCII + code refs" : "Copied ASCII (no code refs mapped)");
    } catch (error) {
      setStatusMessage(`Copy failed: ${error instanceof Error ? error.message : "Clipboard access was denied"}`);
    }
  }, [ascii, selectionRect, selectedNodes]);
  const selectedEvidenceIds = useMemo(() => [...new Set(content.mappings
    .filter((mapping) => selectedNodeIdSet.has(`${content.id}:${mapping.id}`))
    .map((mapping) => mapping.entityId))], [content, selectedNodeIdSet]);
  const projections = Object.values(props.projectionCatalog?.projections ?? {})
    .reverse()
    .filter((projection) => projection.sourceRepresentationId === props.projectContext?.representationId)
    .sort((a, b) => Number(Boolean(b.compactionProjection)) - Number(Boolean(a.compactionProjection)));
  const chosenProjection = projections.find((projection) => projection.id === projectionChoice)
    ?? projections.find((projection) => projection.sourceRevisionId === props.projectContext?.baseRevisionId
      && props.projectionCatalog?.representations[projection.targetRepresentationId]?.currentRevisionId === projection.targetRevisionId)
    ?? projections[0];
  const projectionContentDirty = props.savedScene !== undefined && JSON.stringify(scene) !== props.savedScene;
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
      return { ...projection, mappedANodeIds: content.mappings.filter((mapping) => matched.has(mapping.entityId)
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
      const width = probe.offsetWidth / 10;
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

  const changeHandler = useRef(props.onDocumentChange);
  changeHandler.current = props.onDocumentChange;
  useEffect(() => { changeHandler.current?.(gridDocument); }, [gridDocument]);
  const busyHandler = useRef(props.onBusyChange);
  busyHandler.current = props.onBusyChange;
  useEffect(() => { busyHandler.current?.(isGenerating); }, [isGenerating]);

  useEffect(() => {
    if (!props.focusBox) return;
    const target = props.focusBox.id;
    const expand = (box: typeof scene.root): typeof scene.root => {
      if (box.kind === "diagram") return box;
      const contains = (node: typeof scene.root): boolean => node.id === target || (node.kind === "container" && node.children.some(contains));
      return contains(box) ? { ...box, collapsed: false, children: box.children.map(expand) } : box;
    };
    const root = expand(scene.root);
    if (JSON.stringify(root) !== JSON.stringify(scene.root)) commit({ ...gridDocument, scene: layoutScene({ ...scene, root }, target) });
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
    return point ? {
      line: Math.max(1, Math.min(lineCount, point.row - activeBox.bounds.row + 1)),
      column: Math.max(1, Math.min(maxColumn, point.column - activeBox.bounds.column + 1))
    } : null;
  }, [scenePointAtClient, lineCount, maxColumn, activeBox]);

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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
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
      y: (activeBox.bounds.row + selectionRect.startLine - 1) * cell.height }, {
      width: (selectionRect.endColumn - selectionRect.startColumn + 1) * cell.width,
      height: (selectionRect.endLine - selectionRect.startLine + 1) * cell.height }), id, kind: 'selection', childIds: [], expansion: 'expanded', displayMode: 'stacked',
      sourceBoxId: activeBox.box.id, sourceContentId: content.id, sourceAscii: content.ascii,
      sourceRevisionId: props.projectContext?.baseRevisionId, rect: { ...selectionRect }, selectedIds: [...selectedNodeIds] };
    setDisplay(current => addDisplayNode(current, root)); setRetainedSelectionId(id); setActionsOpen(false);
    return id;
  }, [retainedSelectionId, display, selectionRect, activeBox, cell, content, props.projectContext?.baseRevisionId, selectedNodeIds, setDisplay, setRetainedSelectionId, setActionsOpen]);
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
  const removeEffect = (id: string) => setCanvasState(current => {
    if (current.controls.surfaces[id]?.promptPhase === 'generating') return current;
    const display = removeDisplayNode(current.display, id);
    const ownerRemoved = current.controls.retainedSelectionId && !display.nodes[current.controls.retainedSelectionId];
    return { ...current, display, controls: { ...current.controls,
      ...(ownerRemoved ? { retainedSelectionId: null, selectionRect: null, selectedNodeIds: [] } : {}),
      surfaces: Object.fromEntries(Object.entries(current.controls.surfaces).filter(([key]) => key === 'draft' || display.nodes[key])),
      activeThreadId: current.controls.activeThreadId && display.nodes[current.controls.activeThreadId] ? current.controls.activeThreadId : null } };
  });

  const clearSelection = useCallback(() => {
    const active = activeSelectionRef.current;
    const stage = stageRef.current;
    if (active && stage?.hasPointerCapture(active.pointerId)) {
      stage.releasePointerCapture(active.pointerId);
    }
    activeSelectionRef.current = null;
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
  }, []);

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
      context: structuredClone({ ...props.projectContext, contentId: content.id, diagramAscii: ascii,
        diagramRevision, mappings: [...content.mappings] }),
      verbosity: askVerbosity,
      messages: [{ id: `local-message-${crypto.randomUUID()}`, role: "user", text: query }],
      pending: true
    };
    const ownerId = retainSelection();
    if (!ownerId) return;
    const anchor = {
      x: (activeBox.bounds.column + selectionRect.endColumn) * cell.width,
      y: (activeBox.bounds.row + selectionRect.startLine - 1) * cell.height
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
    setHistory((current) => {
      if (redo) {
        const next = current.future[0];
        return next ? { past: [...current.past, current.present], present: next, future: current.future.slice(1) } : current;
      }
      const previous = current.past.at(-1);
      return previous ? { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] } : current;
    });
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
    try {
      const result = await promptMappingPocSelection({
        ...props.projectContext,
        clientSessionId: `${clientSessionId}-${crypto.randomUUID()}`,
        diagramAscii: ascii, diagramRevision, mappings: [...content.mappings],
        selection: selectionRect, instruction: promptText.trim()
      }, (message) => updateSurface(owner, { statusMessage: message }));
      const nextContent = { ...content, ascii: result.diagramAscii, revision: result.diagramRevision,
        mappings: result.mappings ?? [] };
      const nextScene = layoutScene({ ...scene, contents: { ...scene.contents, [content.id]: nextContent } }, activeBox.box.id);
      commit(gridDocument.evidence ? mappingDocumentFromScene(nextScene, gridDocument.evidence)
        : { ...gridDocument, scene: nextScene, nodes: { ...gridDocument.nodes, [content.id]: nodesAfterPatch(nodes, result) },
          sections: { ...gridDocument.sections, [content.id]: sectionsAfterPatch(sections, result) } });
      if (operationOwnerRef.current === owner) {
        setSelectedNodeIds([]);
        setSelectionRect({ startLine: result.startLine, endLine: result.newEndLine,
          startColumn: selectionRect.startColumn, endColumn: selectionRect.endColumn });
      }
      updateSurface(owner, { promptOpen: false });
      updateSurface(owner, { promptText: "" });
      updateSurface(owner, { promptPhase: "applied" });
      updateSurface(owner, { statusMessage: `patch applied · ${result.verticalDelta >= 0 ? "+" : ""}${result.verticalDelta} rows · revision ${result.diagramRevision}` });
    } catch (error) {
      updateSurface(owner, { promptPhase: "error" });
      updateSurface(owner, { statusMessage: error instanceof Error ? error.message : "diagram prompt failed" });
    }
  };

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
    try {
      const result = await promptMappingPocSelection({
        ...props.projectContext,
        clientSessionId: `${clientSessionId}-${crypto.randomUUID()}`, operation: "generate",
        diagramAscii: ascii, diagramRevision, mappings: [...content.mappings], selection: selectionRect,
        instruction: `${diagramPlacement}\nAim for ${minimumSize.columns} columns by ${minimumSize.rows} rows; the canvas can grow if needed.`
      }, message => updateSurface(owner, { statusMessage: message }));
      const id = `diagram-${crypto.randomUUID()}`;
      const next = insertGridDiagram(gridDocument, targetParent.box.id, {
        id, kind: "diagram", contentId: id, collapsed: false, minimumSize,
        position: { column: column - targetParent.bounds.column, row: row - targetParent.bounds.row }
      }, { id, ascii: result.diagramAscii, revision: result.diagramRevision, mappings: result.mappings ?? [] });
      commit(next);
      if (operationOwnerRef.current === owner) { clearSelection(); setActiveBoxId(id); }
      updateSurface(owner, { promptPhase: "applied", promptOpen: false, statusMessage: "Sub-diagram generated; layout updated" });
      if (operationOwnerRef.current === 'draft') setStatusMessage("Sub-diagram generated; layout updated");
    } catch (error) {
      updateSurface(owner, { promptPhase: "error" });
      updateSurface(owner, { statusMessage: error instanceof Error ? error.message : "Sub-diagram generation failed" });
    }
  };

  const wrapInGroup = (boxId: string) => {
    const id = `group-${crypto.randomUUID()}`;
    const summaryId = `${id}-summary`;
    const next = updateGridBox({ ...scene, contents: { ...scene.contents,
      [summaryId]: { id: summaryId, revision: 0, ascii: "[Diagram group]", mappings: [] } } }, boxId, (box) => ({
      id, kind: "container", position: box.position, collapsed: false, collapsedContentId: summaryId,
      children: [{ ...box, position: { column: 0, row: 0 } }], layout: { collisionPolicy: "push-right", gap: 3 }
    }));
    commitScene(next, id);
  };

  const hotkeyHandler = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const handle = (event: globalThis.KeyboardEvent) => hotkeyHandler.current(event);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useLayoutEffect(() => {
    hotkeyHandler.current = (event: globalThis.KeyboardEvent) => {
      if (props.active === false) return;
      if (event.target instanceof Element && event.target.closest(".mapping-floating-pane, .mapping-submenu, [data-display-node]")) return;
      if (event.key === "Escape" && activeSelectionRef.current) {
        event.preventDefault(); clearSelection(); return;
      }
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

  const rectStyle = selectionRect && cell.width > 0 && cell.height > 0 ? {
    left: (selectionRect.startColumn - 1) * cell.width,
    top: (selectionRect.startLine - 1) * cell.height,
    width: (selectionRect.endColumn - selectionRect.startColumn + 1) * cell.width,
    height: (selectionRect.endLine - selectionRect.startLine + 1) * cell.height
  } : undefined;
  const threadSource = boxes.find((node) => node.box.id === (activeThread?.selection.boxId ?? "overview"));
  const activeThreadRectStyle = activeThread && threadSource && !threadSource.box.collapsed && cell.width > 0 && cell.height > 0 ? {
    left: (threadSource.bounds.column - activeBox.bounds.column + activeThread.selection.rect.startColumn - 1) * cell.width,
    top: (threadSource.bounds.row - activeBox.bounds.row + activeThread.selection.rect.startLine - 1) * cell.height,
    width: (activeThread.selection.rect.endColumn - activeThread.selection.rect.startColumn + 1) * cell.width,
    height: (activeThread.selection.rect.endLine - activeThread.selection.rect.startLine + 1) * cell.height
  } : undefined;
  const selectionPhase = askOpen ? "asking" : promptPhase;
  const showSelectionMenu = Boolean(selectionRect && rectStyle && !diagramPlacement
    && (!retainedSelectionId || promptOpen || askOpen || actionsOpen));

  return (
    <div
      ref={stageRef}
      tabIndex={-1}
      className={`mapping-poc-graph-stage${ctrlSelecting ? " is-selecting" : ""}`}
      aria-label="Graph A selectable nodes"
      style={cell.width ? { width: (resolved.bounds.columns + 65) * cell.width, minHeight: (resolved.bounds.rows + 16) * cell.height } : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as Element).closest("[data-mapping-static-ui]")) return;
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
          || (event.target as Element).closest("[data-mapping-static-ui]")) return;
        const scenePoint = scenePointAtClient(event.clientX, event.clientY);
        const hit = scenePoint && hitTest(scene, scenePoint);
        const targetBox = hit && boxes.find((node) => node.box.id === hit.boxId);
        if (!hit || !targetBox?.contentId || targetBox.box.collapsed) return;
        const anchor = { line: hit.local.row + 1, column: hit.local.column + 1 };
        event.currentTarget.focus({ preventScroll: true });
        setActiveBoxId(hit.boxId);

        event.preventDefault();
        event.stopPropagation();
        window.getSelection()?.removeAllRanges();
        event.currentTarget.setPointerCapture(event.pointerId);
        activeSelectionRef.current = { pointerId: event.pointerId, anchor };
        setRetainedSelectionId(null);
        setPromptPhase("ready");
        setStatusMessage("selection ready");
        setSelectionRect(normalizeRect(anchor, anchor));
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
        setSelectionRect(normalizeRect(active.anchor, focus));
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
        setSelectionRect(null);
      }}
    >
      <CanvasPasteMenu stageRef={stageRef} active={props.active !== false} busy={isGenerating || !!diagramPlacement || !!movingBoxId}
        toGrid={scenePointAtClient} onPaste={(point, text) => {
          const id = `diagram-${crypto.randomUUID()}`;
          const next = pasteGridDiagram(gridDocument, point, text, id);
          commit(next);
          clearSelection();
          setActiveBoxId(id);
          setStatusMessage("Sub-diagram pasted; layout updated");
        }} />
      <span ref={probeRef} className="mapping-poc-cell-probe" aria-hidden="true">0000000000</span>
      <pre
        ref={preRef}
        className="mapping-poc-ascii"
        style={cell.width ? { width: resolved.bounds.columns * cell.width } : undefined}
        data-graph="A"
        data-line-count={resolved.bounds.rows}
        data-revision={diagramRevision}
      >{composedAscii}</pre>

      <div className="mapping-grid-tools" data-mapping-static-ui data-diagram-canvas-static-ui>
        <button type="button" disabled={!history.past.length || isGenerating} onClick={() => undo()}>Undo</button>
        <button type="button" disabled={!history.future.length || isGenerating} onClick={() => undo(true)}>Redo</button>
        <span role="status">{diagramPlacement ? "Drag a region to place the sub-diagram · Esc cancels" : movingBoxId ? "Click to move the box · Esc cancels" : statusMessage}</span>
      </div>
      {boxes.filter((node) => node.box.id !== "root").map((node) => (
        <div key={node.box.id} className={`mapping-grid-box${node.box.kind === "container" ? " is-container" : ""}`}
          data-grid-box={node.box.id} data-grid-column={node.bounds.column} data-grid-row={node.bounds.row}
          data-grid-columns={node.bounds.columns} data-grid-rows={node.bounds.rows} data-collapsed={node.box.collapsed}
          style={{ left: node.bounds.column * cell.width, top: node.bounds.row * cell.height,
            width: node.bounds.columns * cell.width, height: node.bounds.rows * cell.height }}>
          <div className="mapping-grid-box-tools" data-mapping-static-ui data-diagram-canvas-static-ui>
            <button type="button" disabled={isGenerating || !!diagramPlacement}
              aria-label={`${node.box.collapsed ? "Expand" : "Collapse"} ${node.box.id}`}
              onClick={() => commitScene(updateGridBox(scene, node.box.id, (box) => ({ ...box, collapsed: !box.collapsed })), node.box.id)}>
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
        {!activeBox.box.collapsed && cell.width > 0 && cell.height > 0 ? nodes.map((node) => (
          <span
            key={node.id}
            className={`mapping-poc-node-hit is-${node.selectableBecause}${selectedNodeIdSet.has(node.id) ? " is-selected" : ""}${selectedNodeIdSet.has(node.id) && (promptOpen || askOpen || promptPhase === "generating") ? " is-prompt-target" : ""}`}
            data-selectable-node={node.id}
            style={{
              left: (node.head.startColumn - 1) * cell.width,
              top: (node.head.line - 1) * cell.height,
              width: (node.head.endColumn - node.head.startColumn + 1) * cell.width,
              height: cell.height
            }}
          />
        )) : null}
      </div>

      {cell.width > 0 && cell.height > 0 ? (
        <div className="mapping-poc-a-section-layer" aria-label="Graph A detail sections">
          {sections.map((section, index) => (
            <section
              key={section.id}
              className={`mapping-poc-a-section${openDetailIds.has(section.id) ? " is-open" : ""}`}
              data-a-section={section.id}
              style={{
                top: (section.startLine - 1) * cell.height,
                height: (section.endLine - section.startLine + 1) * cell.height
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
      <SelectionEffectsLayer state={display} setState={setDisplay} boxes={boxes} scene={scene} cell={cell}
        catalog={props.projectionCatalog} dirtyRepresentationIds={props.dirtyRepresentationIds} onRemove={removeEffect}
        busySelectionIds={Object.entries(canvasState.controls.surfaces).filter(([, surface]) => surface.promptPhase === 'generating').map(([id]) => id)}
        onActivate={root => {
          setActiveBoxId(root.sourceBoxId); setRetainedSelectionId(root.id); setSelectionRect(root.rect); setSelectedNodeIds(root.selectedIds);
          setActionsOpen(true);
          stageRef.current?.focus({ preventScroll: true });
        }} />
    </div>
  );
}
