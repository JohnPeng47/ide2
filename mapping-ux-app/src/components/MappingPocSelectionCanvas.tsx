import { formatAsciiWithCodeReferences } from "../diagramClipboard";
import { asciiForSelection } from "../diagramSelection";
import {
  composeScene,
  flattenGrid,
  hitTest,
  layoutScene,
  resolveScene,
  updateGridBox,
  type GridPoint as ScenePoint
} from "../lineGrid";
import { mappingDocumentFromScene } from "../mappingDocument";
import { initialMappingGrid, insertGridDiagram, type MappingGridDocument } from "../mappingGrid";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent
} from "react";
import { createPortal } from "react-dom";
import { projectCompactions } from "../compactionProjection";
import { projectSelection, validateProjection } from "../diagramProjection";
import type { ProjectRepresentationCatalogRecord } from "../projectCatalog";
import { localChatResponder, promptMappingPocSelection } from "../api";
import {
  isLocalChatSubmitHotkey,
  type LocalChatVerbosity,
  type LocalChatThread,
  type LocalChatVariant
} from "../localChat";
import {
  projectASelectionToB,
  type MappingPocANode,
  type MappingPocGridRect,
  type MappingPocProjection
} from "../mappingPoc";
import {
  MAPPING_POC_A_SECTIONS,
  MAPPING_POC_DETAIL_OVERLAYS,
  MAPPING_POC_OVERLAY_PLACEMENTS,
  type MappingPocASection
} from "../mappingPocOverlays";
import type { MappingPocPromptResult } from "../mappingPocPrompt";
import { LocalChatVerbosityToggle } from "./LocalChatVerbosityToggle";
import { ProjectedSourcePane } from "./ProjectedSourcePane";
import { LocalChatConvo } from "./LocalChatConvo";

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

const SIDE_GUTTER_PX = 112;
const PATCH_SUCCESS_VISIBLE_MS = 2400;

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

type PromptPhase = "ready" | "composing" | "generating" | "applied" | "error";

export function MappingPocSelectionCanvas(props: {
  initialDocument?: MappingGridDocument;
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
  const localChatVariant = props.localChatVariant ?? "compact";
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
  const [activeBoxId, setActiveBoxId] = useState("overview");
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
  const [promptOperation, setPromptOperation] = useState<"edit" | "generate">("edit");
  const [diagramPlacement, setDiagramPlacement] = useState<string | null>(null);
  const placementDragRef = useRef<ScenePoint | null>(null);
  const placementPointerRef = useRef<number | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{ start: ScenePoint; end: ScenePoint } | null>(null);
  const [movingBoxId, setMovingBoxId] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<MappingPocGridRect | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [openedProjection, setOpenedProjection] = useState<MappingPocProjection | null>(null);
  const [projectionChoice, setProjectionChoice] = useState("");
  const [compactionOpen, setCompactionOpen] = useState(false);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [sourceVisible, setSourceVisible] = useState(false);
  const sourceStackRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const stack = sourceStackRef.current;
    const parent = stack?.parentElement;
    const viewport = stack?.closest<HTMLElement>("[data-diagram-canvas]");
    if (!sourceVisible || !stack || !parent || !viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const anchor = parent.getBoundingClientRect();
    const scale = anchor.width / parent.offsetWidth || 1;
    // Keep the source attached to the stack; adapt its size instead of moving it away.
    const width = Math.min(920, Math.max(360, (bounds.right - 24 - anchor.left) / scale - 24));
    const height = Math.min(640, Math.max(320, (bounds.bottom - 32 - anchor.top) / scale - 24));
    stack.style.width = `${width}px`;
    stack.style.setProperty("--source-pane-height", `${height}px`);
  }, [sourceVisible, sourceFile]);
  const openSource = (path: string) => { setSourceFile(path); setSourceVisible(true); };
  useEffect(() => { if (!compactionOpen) { setSourceFile(null); setSourceVisible(false); } }, [compactionOpen]);
  const [openDetailOverlayId, setOpenDetailOverlayId] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptPhase, setPromptPhase] = useState<PromptPhase>("ready");
  const [statusMessage, setStatusMessage] = useState("selection ready");
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [askVerbosity, setAskVerbosity] = useState<LocalChatVerbosity>("low");
  const [chatThreads, setChatThreads] = useState<LocalChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const asciiLines = useMemo(() => ascii.split("\n"), [ascii]);
  const lineCount = asciiLines.length;
  const maxColumn = useMemo(() => Math.max(...asciiLines.map((line) => line.length), 1), [asciiLines]);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedNodes = useMemo(
    () => nodes.filter((node) => selectedNodeIdSet.has(node.id)),
    [nodes, selectedNodeIdSet]
  );
  const activeThread = chatThreads.find((thread) => thread.id === activeThreadId);
  const sourceCoveredNodeCount = selectedNodes.filter((node) => node.sourceRanges.length > 0).length;
  const selectedSourceRangeCount = selectedNodes.reduce(
    (count, node) => count + node.sourceRanges.length,
    0
  );
  const hasCompleteSourceCoverage = selectedNodes.length > 0
    && sourceCoveredNodeCount === selectedNodes.length;
  const copySelection = useCallback(async () => {
    if (!selectionRect || !selectedNodes.length) return;
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
  useEffect(() => { setOpenedProjection(null); }, [chosenProjection?.id, projectionContentDirty, props.projectionCatalog, props.dirtyRepresentationIds?.join(",")]);
  useEffect(() => { setCompactionOpen(false); }, [openedProjection, chosenProjection?.id]);
  const selectedCompactions = useMemo(() => {
    if (!openedProjection || !chosenProjection?.compactionProjection || !callTreeProjection.result) return [];
    return projectCompactions(chosenProjection.compactionProjection, callTreeProjection.result.projectedNodeIds);
  }, [openedProjection, chosenProjection, callTreeProjection.result]);
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
  const firstSelectedANode = useMemo(() => {
    const selectedIds = new Set(openedProjection?.selectedANodeIds ?? []);
    return nodes.find((node) => selectedIds.has(node.id));
  }, [nodes, openedProjection]);
  const openDetailOverlay = MAPPING_POC_DETAIL_OVERLAYS.find((overlay) => overlay.id === openDetailOverlayId);
  const baseOpenDetailPlacement = MAPPING_POC_OVERLAY_PLACEMENTS.find(
    (placement) => placement.overlayId === openDetailOverlayId
  );
  const openDetailSection = sections.find((section) => section.id === openDetailOverlay?.sectionId);
  const baseOpenDetailSection = MAPPING_POC_A_SECTIONS.find((section) => section.id === openDetailOverlay?.sectionId);
  const overlayLineDelta = openDetailSection && baseOpenDetailSection
    ? openDetailSection.startLine - baseOpenDetailSection.startLine
    : 0;
  const openDetailPlacement = baseOpenDetailPlacement && openDetailSection ? {
    ...baseOpenDetailPlacement,
    originLine: baseOpenDetailPlacement.originLine + overlayLineDelta,
    aAnchor: {
      ...baseOpenDetailPlacement.aAnchor,
      line: baseOpenDetailPlacement.aAnchor.line + overlayLineDelta
    }
  } : undefined;

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
  useEffect(() => { busyHandler.current?.(promptPhase === "generating"); }, [promptPhase]);

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

  useEffect(() => {
    if (promptPhase !== "applied") return undefined;
    const timeout = window.setTimeout(() => {
      setSelectionRect(null);
      setPromptPhase("ready");
      setStatusMessage("selection ready");
    }, PATCH_SUCCESS_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [promptPhase]);

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
      onContext: (sourceRanges) => updateThread((current) => ({ ...current, context: { ...current.context, sourceRanges } })),
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
  }, []);

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
    setOpenedProjection(null);
    setPromptOpen(false);
    setPromptText("");
    setAskOpen(false);
    setAskText("");
    setPromptPhase("ready");
    const sourceRangeCount = selected.reduce((count, node) => count + node.sourceRanges.length, 0);
    setStatusMessage(`${sourceRangeCount} mapped corpus range${sourceRangeCount === 1 ? "" : "s"} ready`);
    setSelectedNodeIds(selected.map((node) => node.id));
    setSelectionRect(selected.length ? rect : null);
  };

  const openMapped = useCallback(() => {
    if (!candidateProjection.bRange) return;
    setOpenedProjection(candidateProjection);
  }, [candidateProjection]);

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
    setOpenedProjection(null);
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
    setOpenedProjection(null);
    setAskOpen(false);
    setPromptOperation("edit");
    setPromptOpen(true);
    setPromptPhase("composing");
    setStatusMessage("describe the in-line change");
  }, [hasCompleteSourceCoverage, promptPhase, selectedNodeIds.length, selectionRect]);

  const openAsk = useCallback(() => {
    if (!selectionRect || !selectedNodeIds.length || promptPhase === "generating") return;
    setOpenedProjection(null);
    setPromptOpen(false);
    setAskOpen(true);
    setStatusMessage("ask about the selected region");
  }, [promptPhase, selectedNodeIds.length, selectionRect]);

  const submitAsk = (event: FormEvent) => {
    event.preventDefault();
    const query = askText.trim();
    if (!selectionRect || !selectedNodeIds.length || !query) return;
    const summary = `${selectedNodeIds.length} selected diagram node${selectedNodeIds.length === 1 ? "" : "s"}`;
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
    setChatThreads((current) => [...current, thread]);
    setActiveThreadId(thread.id);
    setAskOpen(false);
    setAskText("");
    setSelectedNodeIds([]);
    setSelectionRect(null);
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
    if (promptPhase === "generating") return;
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
    if (!selectionRect || !promptText.trim() || promptPhase === "generating") return;
    if (promptOperation === "generate") {
      setDiagramPlacement(promptText.trim());
      setPromptOpen(false);
      setStatusMessage("Drag a region on the canvas for the new diagram; Escape cancels");
      return;
    }
    setPromptPhase("generating");
    setStatusMessage("starting diagram agent…");
    try {
      const result = await promptMappingPocSelection({
        ...props.projectContext,
        clientSessionId: `${clientSessionId}-${crypto.randomUUID()}`,
        diagramAscii: ascii, diagramRevision, mappings: [...content.mappings],
        selection: selectionRect, instruction: promptText.trim()
      }, (message) => setStatusMessage(message));
      const nextContent = { ...content, ascii: result.diagramAscii, revision: result.diagramRevision,
        mappings: result.mappings ?? [] };
      const nextScene = layoutScene({ ...scene, contents: { ...scene.contents, [content.id]: nextContent } }, activeBox.box.id);
      commit(gridDocument.evidence ? mappingDocumentFromScene(nextScene, gridDocument.evidence)
        : { ...gridDocument, scene: nextScene, nodes: { ...gridDocument.nodes, [content.id]: nodesAfterPatch(nodes, result) },
          sections: { ...gridDocument.sections, [content.id]: sectionsAfterPatch(sections, result) } });
      setOpenDetailOverlayId(null);
      setOpenedProjection(null);
      setSelectedNodeIds([]);
      setSelectionRect({ startLine: result.startLine, endLine: result.newEndLine,
        startColumn: selectionRect.startColumn, endColumn: selectionRect.endColumn });
      setPromptOpen(false);
      setPromptText("");
      setPromptPhase("applied");
      setStatusMessage(`patch applied · ${result.verticalDelta >= 0 ? "+" : ""}${result.verticalDelta} rows · revision ${result.diagramRevision}`);
    } catch (error) {
      setPromptPhase("error");
      setStatusMessage(error instanceof Error ? error.message : "diagram prompt failed");
    }
  };

  const generateAt = async (start: ScenePoint, end: ScenePoint) => {
    if (!diagramPlacement || !selectionRect) return;
    const column = Math.min(start.column, end.column);
    const row = Math.min(start.row, end.row);
    const minimumSize = { columns: Math.abs(end.column - start.column) + 1, rows: Math.abs(end.row - start.row) + 1 };
    const parent = boxes.find((node) => node.children.some((child) => child.box.id === activeBox.box.id)) ?? resolved;
    // An area outside the source container belongs to the root canvas.
    const targetParent = column >= parent.bounds.column && row >= parent.bounds.row ? parent : resolved;
    setDiagramPlacement(null);
    setPlacementPreview(null);
    setPromptPhase("generating");
    setStatusMessage("generating sub-diagram…");
    try {
      const result = await promptMappingPocSelection({
        ...props.projectContext,
        clientSessionId: `${clientSessionId}-${crypto.randomUUID()}`, operation: "generate",
        diagramAscii: ascii, diagramRevision, mappings: [...content.mappings], selection: selectionRect,
        instruction: `${diagramPlacement}\nAim for ${minimumSize.columns} columns by ${minimumSize.rows} rows; the canvas can grow if needed.`
      }, setStatusMessage);
      const id = `diagram-${crypto.randomUUID()}`;
      const next = insertGridDiagram(gridDocument, targetParent.box.id, {
        id, kind: "diagram", contentId: id, collapsed: false, minimumSize,
        position: { column: column - targetParent.bounds.column, row: row - targetParent.bounds.row }
      }, { id, ascii: result.diagramAscii, revision: result.diagramRevision, mappings: result.mappings ?? [] });
      commit(next);
      clearSelection();
      setActiveBoxId(id);
      setPromptPhase("applied");
      setStatusMessage("Sub-diagram generated; layout updated");
    } catch (error) {
      setPromptPhase("error");
      setStatusMessage(error instanceof Error ? error.message : "Sub-diagram generation failed");
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

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (props.active === false) return;
      if (event.target instanceof Element && event.target.closest(".mapping-floating-pane, .mapping-submenu")) return;
      if (event.key === "Escape" && openedProjection) {
        if (compactionOpen && sourceVisible) {
          event.preventDefault();
          event.stopPropagation();
          setSourceVisible(false);
          return;
        }
        if (compactionOpen) {
          event.preventDefault();
          event.stopPropagation();
          setCompactionOpen(false);
          return;
        }
        event.preventDefault();
        setOpenedProjection(null);
        return;
      }
      if (event.key === "Escape" && (diagramPlacement || movingBoxId)) {
        event.preventDefault();
        clearSelection();
        return;
      }
      if (typingTarget(event.target)) {
        if (event.key === "Escape" && (promptOpen || askOpen) && promptPhase !== "generating") {
          event.preventDefault();
          setPromptOpen(false);
          setAskOpen(false);
          setPromptPhase("ready");
          setStatusMessage("selection ready");
        }
        return;
      }
      if (!selectedNodeIds.length || !selectionRect) return;
      if (event.key.toLowerCase() === "c" && !event.altKey && !openedProjection && !promptOpen && !askOpen
        && !window.getSelection()?.toString()) {
        event.preventDefault();
        void copySelection();
        return;
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
      if (event.key === "Escape" && !openedProjection && promptPhase !== "generating") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    props.active,
    askOpen,
    diagramPlacement,
    movingBoxId,
    candidateProjection.bRange,
    copySelection,
    clearSelection,
    openMapped,
    openedProjection,
    compactionOpen,
    sourceVisible,
    openAsk,
    openPrompt,
    promptOpen,
    promptPhase,
    selectedNodeIds.length,
    selectionRect
  ]);

  useEffect(() => {
    if (!selectedNodeIds.length
      || openedProjection
      || promptOpen
      || askOpen
      || diagramPlacement
      || promptPhase === "generating") return undefined;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (props.active === false || event.button !== 0) return;
      const stage = stageRef.current;
      if (stage && event.composedPath().includes(stage)) return;
      clearSelection();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [props.active, askOpen, clearSelection, openedProjection, diagramPlacement, promptOpen, promptPhase, selectedNodeIds.length]);

  const rectStyle = selectionRect && cell.width > 0 && cell.height > 0 ? {
    left: (selectionRect.startColumn - 1) * cell.width,
    top: (selectionRect.startLine - 1) * cell.height,
    width: (selectionRect.endColumn - selectionRect.startColumn + 1) * cell.width,
    height: (selectionRect.endLine - selectionRect.startLine + 1) * cell.height
  } : undefined;
  const threadSource = boxes.find((node) => node.box.id === activeThread?.selection.boxId);
  const activeThreadRectStyle = activeThread && threadSource && !threadSource.box.collapsed && cell.width > 0 && cell.height > 0 ? {
    left: (threadSource.bounds.column - activeBox.bounds.column + activeThread.selection.rect.startColumn - 1) * cell.width,
    top: (threadSource.bounds.row - activeBox.bounds.row + activeThread.selection.rect.startLine - 1) * cell.height,
    width: (activeThread.selection.rect.endColumn - activeThread.selection.rect.startColumn + 1) * cell.width,
    height: (activeThread.selection.rect.endLine - activeThread.selection.rect.startLine + 1) * cell.height
  } : undefined;
  const selectionPhase = askOpen ? "asking" : promptPhase;

  return (
    <div
      ref={stageRef}
      tabIndex={-1}
      className="mapping-poc-graph-stage"
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
        if (openedProjection
          || openDetailOverlay
          || promptOpen
          || askOpen
          || promptPhase === "generating"
          || event.button !== 0
          || event.shiftKey
          || event.ctrlKey
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
        setPromptPhase("ready");
        setStatusMessage("selection ready");
        setSelectionRect(normalizeRect(anchor, anchor));
        setSelectedNodeIds([]);
        setOpenedProjection(null);
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
        <button type="button" disabled={!history.past.length || promptPhase === "generating"} onClick={() => undo()}>Undo</button>
        <button type="button" disabled={!history.future.length || promptPhase === "generating"} onClick={() => undo(true)}>Redo</button>
        <span role="status">{diagramPlacement ? "Drag a region to place the sub-diagram · Esc cancels" : movingBoxId ? "Click to move the box · Esc cancels" : statusMessage}</span>
      </div>
      {boxes.filter((node) => node.box.id !== "root").map((node) => (
        <div key={node.box.id} className={`mapping-grid-box${node.box.kind === "container" ? " is-container" : ""}`}
          data-grid-box={node.box.id} data-grid-column={node.bounds.column} data-grid-row={node.bounds.row}
          data-grid-columns={node.bounds.columns} data-grid-rows={node.bounds.rows} data-collapsed={node.box.collapsed}
          style={{ left: node.bounds.column * cell.width, top: node.bounds.row * cell.height,
            width: node.bounds.columns * cell.width, height: node.bounds.rows * cell.height }}>
          <div className="mapping-grid-box-tools" data-mapping-static-ui data-diagram-canvas-static-ui>
            <button type="button" disabled={promptPhase === "generating" || !!diagramPlacement}
              aria-label={`${node.box.collapsed ? "Expand" : "Collapse"} ${node.box.id}`}
              onClick={() => commitScene(updateGridBox(scene, node.box.id, (box) => ({ ...box, collapsed: !box.collapsed })), node.box.id)}>
              {node.box.collapsed ? "Expand" : "Collapse"}
            </button>
            <button type="button" disabled={promptPhase === "generating" || !!diagramPlacement} onClick={() => { clearSelection(); setMovingBoxId(node.box.id); }}>Move</button>
            <button type="button" disabled={promptPhase === "generating" || !!diagramPlacement} onClick={() => wrapInGroup(node.box.id)}>Group</button>
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
              className={`mapping-poc-a-section${openDetailOverlayId === section.id ? " is-open" : ""}`}
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
                aria-pressed={openDetailOverlayId === section.id}
                onClick={() => setOpenDetailOverlayId(section.id)}
              >
                <span>{index + 1}</span>
                {section.label}
              </button>
            </section>
          ))}
        </div>
      ) : null}

      {rectStyle ? (
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

      {openDetailOverlay && openDetailPlacement && cell.width > 0 && cell.height > 0 ? (
        <aside
          className="mapping-poc-detail-overlay"
          data-mapping-static-ui
          data-diagram-canvas-static-ui
          data-overlay-id={openDetailOverlay.id}
          data-overlay-origin-line={openDetailPlacement.originLine}
          data-overlay-origin-column={openDetailPlacement.originColumn}
          data-a-anchor-line={openDetailPlacement.aAnchor.line}
          data-a-anchor-column={openDetailPlacement.aAnchor.startColumn}
          style={{
            left: (openDetailPlacement.originColumn - 1) * cell.width,
            top: (openDetailPlacement.originLine - 1) * cell.height
          }}
        >
          <header>
            <span>A{MAPPING_POC_A_SECTIONS.findIndex((section) => section.id === openDetailOverlay.sectionId) + 1}_DETAIL</span>
            <strong>{openDetailOverlay.label}</strong>
            <button
              type="button"
              aria-label={`Close ${openDetailOverlay.label} overlay`}
              onClick={() => setOpenDetailOverlayId(null)}
            >×</button>
          </header>
          <pre>{openDetailOverlay.ascii}</pre>
        </aside>
      ) : null}

      {selectionRect && selectedNodes.length && rectStyle && !diagramPlacement && !openedProjection ? (
        <div
          ref={menuRef}
          className={`mapping-poc-selection-menu${askOpen && localChatVariant === "floating" ? " has-floating-ask" : ""}`}
          data-mapping-static-ui
          data-diagram-canvas-static-ui
          role="dialog"
          tabIndex={-1}
          aria-label="Selected node operations"
          aria-keyshortcuts="C Control+C Meta+C N P A"
          style={{ left: rectStyle.left + rectStyle.width + 12, top: rectStyle.top + rectStyle.height + 8 }}
        >
          <header>
            <span>{selectedNodes.length} selected · {candidateProjection.mappedANodeIds.length} mapped</span>
            <em className={hasCompleteSourceCoverage ? "is-covered" : "is-missing"}>
              source {sourceCoveredNodeCount}/{selectedNodes.length} · {selectedSourceRangeCount} ranges
            </em>
            <small className={`is-${askOpen ? "asking" : promptPhase}`} aria-live="polite">{statusMessage}</small>
          </header>
          {!promptOpen && !askOpen ? (
            <div className="mapping-poc-selection-actions">
              <button type="button" aria-label="Copy ASCII + code refs" aria-keyshortcuts="C Control+C Meta+C"
                title="Copy selected ASCII and associated source locations (C or Ctrl/Cmd+C)"
                onClick={() => void copySelection()}>
                <kbd>C</kbd>copy ASCII + code refs
              </button>
              {props.projectContext && projections.length > 1 && <label className="mapping-projection-choice">
                Call tree<select aria-label="Call-tree projection" value={chosenProjection?.id ?? ""}
                  onChange={(event) => { setProjectionChoice(event.target.value); setOpenedProjection(null); }}>
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
                title="Ask about the selected diagram region"
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
                <button type="submit" className="is-primary" disabled={!askText.trim()} title="Ask (Ctrl+Enter)">
                  ask
                </button>
              </footer>
            </form>
          )}
        </div>
      ) : null}

      {chatThreads.map((thread) => {
        const isActive = thread.id === activeThreadId;
        const sourceBox = boxes.find((node) => node.box.id === thread.selection.boxId);
        if (!sourceBox?.contentId || sourceBox.box.collapsed) return null;
        const marker = {
          left: (sourceBox.bounds.column - activeBox.bounds.column + thread.selection.rect.endColumn) * cell.width,
          top: (sourceBox.bounds.row - activeBox.bounds.row + thread.selection.rect.startLine - 1) * cell.height
        };
        return (
          <div
            key={thread.id}
            className={`local-chat-anchor${isActive ? " is-active" : ""}`}
            data-mapping-static-ui
            data-diagram-canvas-static-ui
            style={marker}
          >
            <button
              type="button"
              className={`local-chat-bubble${thread.pending ? " is-pending" : ""}`}
              data-local-chat-bubble={thread.id}
              aria-label={`${isActive ? "Collapse" : "Open"} local conversation`}
              aria-expanded={isActive}
              onClick={() => setActiveThreadId(isActive ? null : thread.id)}
            >
              <span aria-hidden="true">?</span>
              <small>{thread.messages.filter((message) => message.role === "assistant").length}</small>
            </button>
            {isActive && localChatVariant !== "docked" ? (
              <LocalChatConvo
                thread={thread}
                variant={localChatVariant}
                onClose={() => setActiveThreadId(null)}
                onSubmit={(message) => submitLocalFollowUp(thread.id, message)}
                onVerbosityChange={(value) => changeThreadVerbosity(thread.id, value)}
                onRetry={() => retryLocalReply(thread.id)}
              />
            ) : null}
          </div>
        );
      })}

      {props.active !== false && activeThread && localChatVariant === "docked" && typeof document !== "undefined" ? createPortal(
        <div
          className="local-chat-docked-shell"
          data-mapping-static-ui
          data-diagram-canvas-static-ui
        >
          <LocalChatConvo
            thread={activeThread}
            variant="docked"
            onClose={() => setActiveThreadId(null)}
            onSubmit={(message) => submitLocalFollowUp(activeThread.id, message)}
            onVerbosityChange={(value) => changeThreadVerbosity(activeThread.id, value)}
            onRetry={() => retryLocalReply(activeThread.id)}
          />
        </div>,
        document.body
      ) : null}

      {selectionRect && !selectedNodes.length && rectStyle && (promptPhase === "applied" || promptPhase === "error") ? (
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

      {openedProjection?.bRange && firstSelectedANode && cell.height > 0 ? (
        <aside
          className="mapping-poc-companion"
          data-mapping-static-ui
          data-diagram-canvas-static-ui
          data-b-start-line={openedProjection.alignedBRange?.startLine}
          data-b-end-line={openedProjection.alignedBRange?.endLine}
          data-mapped-b-start-line={openedProjection.mappedBRange?.startLine}
          data-mapped-b-end-line={openedProjection.mappedBRange?.endLine}
          data-aligned-section-ids={openedProjection.alignedSectionIds.join(" ")}
          data-b-node-ids={openedProjection.selectedBNodeIds.join(" ")}
          data-projection-id={props.projectContext ? chosenProjection?.id : undefined}
          style={{
            left: `calc(100% + ${SIDE_GUTTER_PX}px)`,
            top: (firstSelectedANode.head.line - 1) * cell.height
          }}
        >
          <header className="mapping-poc-companion-controls">
            <span>{compactionOpen ? "COMPACTED SOURCE" : props.projectContext ? callTreeProjection.title ?? "CALL TREE" : "B_SELECTED"}</span>
            <span className="mapping-poc-companion-meta">
              <strong>
                {compactionOpen ? `${selectedCompactions.length} files · ${selectedCompactions.reduce((sum, file) => sum + file.selectedLineCount, 0)} mapped rows`
                  : props.projectContext ? `${callTreeProjection.result?.matchedSourceEvidenceIds.length ?? 0}/${selectedEvidenceIds.length} entities linked · ${openedProjection.directlyMappedBNodeIds.length} branches` : <>mapped {openedProjection.mappedBRange?.startLine}–{openedProjection.mappedBRange?.endLine}
                {" · "}aligned {openedProjection.alignedBRange?.startLine}–{openedProjection.alignedBRange?.endLine}
                {" · "}{openedProjection.alignedSectionIds.length} sections</>}
              </strong>
              {props.projectContext && <button type="button" className="mapping-compaction-action"
                aria-label={compactionOpen ? "Back to call tree" : "Open compaction"}
                disabled={!compactionOpen && !selectedCompactions.length}
                title={!selectedCompactions.length ? "No compaction projection is mapped for these branches" : "Show mapped compaction rows grouped by source file"}
                onClick={() => setCompactionOpen((open) => !open)}>
                {compactionOpen ? "Back to call tree" : "Open compaction"}
              </button>}
              {compactionOpen && sourceFile && <button type="button" className="mapping-compaction-action"
                aria-label="Return to source file" onClick={() => setSourceVisible(true)}>Source file →</button>}
              <button
                type="button"
                aria-label="Close call tree"
                title="Close call tree"
                onClick={() => setOpenedProjection(null)}
              >×</button>
            </span>
          </header>
          {compactionOpen ? <div data-projected-compactions>
            {selectedCompactions.map((file) => <section key={file.sourceFile} data-compaction-file={file.sourceFile}
              data-compaction-rows={file.rows.filter((row) => row.selected).map((row) => row.treeLine).join(" ")}>
              <header className="mapping-compaction-file"><span>{file.sourceFile}</span>
                <button type="button" aria-label={`Open source ${file.sourceFile}`} onClick={() => openSource(file.sourceFile)}>Open source ↗</button>
                <small>{file.selectedLineCount} mapped rows · source snapshot {file.sourceSha256.slice(0, 8)}</small>
              </header>
              <pre>{file.ascii}</pre>
            </section>)}
          </div> : <pre data-projected-tree>{openedProjection.bAscii}</pre>}
          {compactionOpen && sourceFile && props.projectContext && selectedCompactions.some((file) => file.sourceFile === sourceFile) &&
            <div ref={sourceStackRef} className="mapping-source-stack" hidden={!sourceVisible}>
              <ProjectedSourcePane key={sourceFile} projectId={props.projectContext.projectId} files={selectedCompactions}
                file={selectedCompactions.find((file) => file.sourceFile === sourceFile)!} onFileChange={openSource}
                onBack={() => setSourceVisible(false)} onCallTree={() => setCompactionOpen(false)} />
            </div>}

        </aside>
      ) : null}
      </div>
    </div>
  );
}
