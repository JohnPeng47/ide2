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
import {
  MAPPING_POC_A_NODES,
  MAPPING_POC_GRAPH_A,
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
import { promptMappingPocSelection } from "../api";
import type { MappingPocPromptResult } from "../mappingPocPrompt";
import {
  createCyclingMockLocalChatResponder,
  isLocalChatSubmitHotkey,
  type LocalChatMessage,
  type LocalChatResponder,
  type LocalChatSelection,
  type LocalChatThread,
  type LocalChatVariant
} from "../localChat";
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
  onLineCountChange?: (lineCount: number) => void;
  localChatVariant?: LocalChatVariant;
  mockReplyDelayMs?: number;
  showPlacementGuide?: boolean;
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
  const mockReplyDelayRef = useRef(props.mockReplyDelayMs ?? 0);
  mockReplyDelayRef.current = props.mockReplyDelayMs ?? 0;
  const responderRef = useRef<LocalChatResponder | null>(null);
  if (!responderRef.current) {
    responderRef.current = createCyclingMockLocalChatResponder(undefined, {
      delayMs: () => mockReplyDelayRef.current
    });
  }
  const [clientSessionId] = useState(() => `mapping-${crypto.randomUUID()}`);
  const [cell, setCell] = useState<CellMetrics>({ width: 0, height: 0 });
  const [ascii, setAscii] = useState(MAPPING_POC_GRAPH_A);
  const [diagramRevision, setDiagramRevision] = useState(0);
  const [nodes, setNodes] = useState<MappingPocANode[]>(() => MAPPING_POC_A_NODES.map((node) => ({
    ...node,
    head: { ...node.head },
    extent: { ...node.extent }
  })));
  const [sections, setSections] = useState<MappingPocASection[]>(() => MAPPING_POC_A_SECTIONS.map((section) => ({
    ...section
  })));
  const [selectionRect, setSelectionRect] = useState<MappingPocGridRect | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [openedProjection, setOpenedProjection] = useState<MappingPocProjection | null>(null);
  const [openDetailOverlayId, setOpenDetailOverlayId] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptPhase, setPromptPhase] = useState<PromptPhase>("ready");
  const [statusMessage, setStatusMessage] = useState("selection ready");
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [pendingPlacement, setPendingPlacement] = useState<{
    query: string;
    selection: LocalChatSelection;
  } | null>(null);
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
  const candidateProjection = useMemo(
    () => projectASelectionToB(selectedNodeIds),
    [selectedNodeIds]
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
    props.onLineCountChange?.(lineCount);
  }, [lineCount, props]);

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

  const pointAtClient = useCallback((clientX: number, clientY: number): GridPoint | null => {
    const pre = preRef.current;
    if (!pre || !(cell.width > 0) || !(cell.height > 0)) return null;
    const bounds = pre.getBoundingClientRect();
    const scaleX = pre.offsetWidth > 0 ? bounds.width / pre.offsetWidth : 1;
    const scaleY = pre.offsetHeight > 0 ? bounds.height / pre.offsetHeight : scaleX;
    return {
      line: Math.max(1, Math.min(
        lineCount,
        Math.floor((clientY - bounds.top) / (cell.height * scaleY)) + 1
      )),
      column: Math.max(1, Math.min(
        maxColumn,
        Math.floor((clientX - bounds.left) / (cell.width * scaleX)) + 1
      ))
    };
  }, [cell, lineCount, maxColumn]);

  const stagePointAtClient = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const bounds = stage.getBoundingClientRect();
    const scaleX = stage.offsetWidth > 0 ? bounds.width / stage.offsetWidth : 1;
    const scaleY = stage.offsetHeight > 0 ? bounds.height / stage.offsetHeight : scaleX;
    return {
      x: Math.max(12, Math.min(stage.offsetWidth - 12, (clientX - bounds.left) / scaleX)),
      y: Math.max(12, Math.min(stage.offsetHeight - 12, (clientY - bounds.top) / scaleY))
    };
  }, []);

  const requestLocalReply = useCallback((
    threadId: string,
    query: string,
    selection: LocalChatSelection,
    history: readonly LocalChatMessage[]
  ) => {
    const responder = responderRef.current;
    if (!responder) return;
    void responder.reply({ query, selection, history }).then((reply) => {
      setChatThreads((current) => current.map((thread) => thread.id === threadId ? {
        ...thread,
        pending: false,
        messages: [...thread.messages, {
          id: `local-message-${crypto.randomUUID()}`,
          role: "assistant",
          text: reply
        }]
      } : thread));
    }).catch((error) => {
      setChatThreads((current) => current.map((thread) => thread.id === threadId ? {
        ...thread,
        pending: false,
        messages: [...thread.messages, {
          id: `local-message-${crypto.randomUUID()}`,
          role: "assistant",
          text: error instanceof Error ? error.message : "The mock response failed."
        }]
      } : thread));
    });
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
    setSelectedNodeIds([]);
    setSelectionRect(null);
    setOpenedProjection(null);
    setPromptOpen(false);
    setPromptText("");
    setAskOpen(false);
    setAskText("");
    setPendingPlacement(null);
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
    setPendingPlacement({
      query,
      selection: {
        nodeIds: [...selectedNodeIds],
        rect: { ...selectionRect },
        summary
      }
    });
    setAskOpen(false);
    setAskText("");
    setStatusMessage("click the canvas to place this conversation");
  };

  const placeLocalChat = useCallback((clientX: number, clientY: number) => {
    if (!pendingPlacement) return;
    const anchor = stagePointAtClient(clientX, clientY);
    if (!anchor) return;
    const threadId = `local-thread-${crypto.randomUUID()}`;
    const userMessage: LocalChatMessage = {
      id: `local-message-${crypto.randomUUID()}`,
      role: "user",
      text: pendingPlacement.query
    };
    const thread: LocalChatThread = {
      id: threadId,
      title: pendingPlacement.selection.summary,
      anchor,
      selection: pendingPlacement.selection,
      messages: [userMessage],
      pending: true
    };
    setChatThreads((current) => [...current, thread]);
    setPendingPlacement(null);
    setSelectedNodeIds([]);
    setSelectionRect(null);
    setPromptPhase("ready");
    setStatusMessage("selection ready");
    requestLocalReply(threadId, pendingPlacement.query, pendingPlacement.selection, [userMessage]);
  }, [pendingPlacement, requestLocalReply, stagePointAtClient]);

  const submitLocalFollowUp = useCallback((threadId: string, text: string) => {
    const thread = chatThreads.find((candidate) => candidate.id === threadId);
    if (!thread || thread.pending) return;
    const userMessage: LocalChatMessage = {
      id: `local-message-${crypto.randomUUID()}`,
      role: "user",
      text
    };
    const history = [...thread.messages, userMessage];
    setChatThreads((current) => current.map((candidate) => candidate.id === threadId ? {
      ...candidate,
      pending: true,
      messages: history
    } : candidate));
    requestLocalReply(threadId, text, thread.selection, history);
  }, [chatThreads, requestLocalReply]);

  const submitPrompt = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectionRect || !promptText.trim() || promptPhase === "generating") return;
    setPromptPhase("generating");
    setStatusMessage("starting diagram agent…");
    try {
      const result = await promptMappingPocSelection({
        clientSessionId,
        diagramAscii: ascii,
        diagramRevision,
        selection: selectionRect,
        instruction: promptText.trim()
      }, (message) => setStatusMessage(message));
      setAscii(result.diagramAscii);
      setDiagramRevision(result.diagramRevision);
      setNodes((current) => nodesAfterPatch(current, result));
      setSections((current) => sectionsAfterPatch(current, result));
      setOpenDetailOverlayId(null);
      setOpenedProjection(null);
      setSelectedNodeIds([]);
      setSelectionRect({
        startLine: result.startLine,
        endLine: result.newEndLine,
        startColumn: selectionRect.startColumn,
        endColumn: selectionRect.endColumn
      });
      setPromptOpen(false);
      setPromptText("");
      setPromptPhase("applied");
      setStatusMessage(
        `patch applied · ${result.verticalDelta >= 0 ? "+" : ""}${result.verticalDelta} rows · revision ${result.diagramRevision}`
      );
    } catch (error) {
      setPromptPhase("error");
      setStatusMessage(error instanceof Error ? error.message : "diagram prompt failed");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
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
      if (event.key === "Escape" && pendingPlacement) {
        event.preventDefault();
        setPendingPlacement(null);
        setStatusMessage("selection ready");
        return;
      }
      if (!selectedNodeIds.length || !selectionRect) return;
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
    askOpen,
    candidateProjection.bRange,
    clearSelection,
    openMapped,
    openedProjection,
    openAsk,
    openPrompt,
    pendingPlacement,
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
      || pendingPlacement
      || promptPhase === "generating") return undefined;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const stage = stageRef.current;
      if (stage && event.composedPath().includes(stage)) return;
      clearSelection();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [askOpen, clearSelection, openedProjection, pendingPlacement, promptOpen, promptPhase, selectedNodeIds.length]);

  const rectStyle = selectionRect && cell.width > 0 && cell.height > 0 ? {
    left: (selectionRect.startColumn - 1) * cell.width,
    top: (selectionRect.startLine - 1) * cell.height,
    width: (selectionRect.endColumn - selectionRect.startColumn + 1) * cell.width,
    height: (selectionRect.endLine - selectionRect.startLine + 1) * cell.height
  } : undefined;
  const activeThreadRectStyle = activeThread && cell.width > 0 && cell.height > 0 ? {
    left: (activeThread.selection.rect.startColumn - 1) * cell.width,
    top: (activeThread.selection.rect.startLine - 1) * cell.height,
    width: (activeThread.selection.rect.endColumn - activeThread.selection.rect.startColumn + 1) * cell.width,
    height: (activeThread.selection.rect.endLine - activeThread.selection.rect.startLine + 1) * cell.height
  } : undefined;
  const selectionPhase = pendingPlacement ? "placing-chat" : askOpen ? "asking" : promptPhase;

  return (
    <div
      ref={stageRef}
      className={`mapping-poc-graph-stage${pendingPlacement ? " is-placing-chat" : ""}`}
      aria-label="Graph A selectable nodes"
      onPointerDown={(event) => {
        if (pendingPlacement) {
          if (event.button !== 0 || (event.target as Element).closest("[data-mapping-static-ui]")) return;
          event.preventDefault();
          event.stopPropagation();
          placeLocalChat(event.clientX, event.clientY);
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
        const anchor = pointAtClient(event.clientX, event.clientY);
        if (!anchor) return;
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
        const active = activeSelectionRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const focus = pointAtClient(event.clientX, event.clientY);
        if (!focus) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectionRect(normalizeRect(active.anchor, focus));
      }}
      onPointerUp={finishSelection}
      onPointerCancel={(event) => {
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
        data-graph="A"
        data-line-count={lineCount}
        data-revision={diagramRevision}
      >{ascii}</pre>

      <div className="mapping-poc-node-layer" aria-hidden="true">
        {cell.width > 0 && cell.height > 0 ? nodes.map((node) => (
          <span
            key={node.id}
            className={`mapping-poc-node-hit is-${node.selectableBecause}${selectedNodeIdSet.has(node.id) ? " is-selected" : ""}${selectedNodeIdSet.has(node.id) && (promptOpen || askOpen || pendingPlacement || promptPhase === "generating") ? " is-prompt-target" : ""}`}
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

      {selectionRect && selectedNodes.length && rectStyle && !pendingPlacement ? (
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
            <span>{selectedNodes.length} selected · {candidateProjection.mappedANodeIds.length} mapped</span>
            <em className={hasCompleteSourceCoverage ? "is-covered" : "is-missing"}>
              source {sourceCoveredNodeCount}/{selectedNodes.length} · {selectedSourceRangeCount} ranges
            </em>
            <small className={`is-${askOpen ? "asking" : promptPhase}`} aria-live="polite">{statusMessage}</small>
          </header>
          {!promptOpen && !askOpen ? (
            <div className="mapping-poc-selection-actions">
              <button
                ref={openMappedRef}
                type="button"
                disabled={!candidateProjection.bRange}
                aria-keyshortcuts="N"
                onClick={openMapped}
              >
                <kbd>N</kbd>
                open mapped
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
                title="Ask a question and place the conversation on the canvas"
                onClick={openAsk}
              >
                <kbd>A</kbd>
                ask about selection
              </button>
            </div>
          ) : promptOpen ? (
            <form className="mapping-poc-prompt-form" onSubmit={submitPrompt}>
              <label htmlFor="mapping-poc-prompt">Change selected rows</label>
              <textarea
                ref={promptInputRef}
                id="mapping-poc-prompt"
                value={promptText}
                maxLength={4000}
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
                >{promptPhase === "generating" ? "applying…" : "apply patch"}</button>
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
                id="mapping-poc-local-question"
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
              <p>Your next canvas click places the conversation bubble.</p>
              <footer>
                <button
                  type="button"
                  onClick={() => {
                    setAskOpen(false);
                    setAskText("");
                    setStatusMessage("selection ready");
                  }}
                >cancel</button>
                <button type="submit" className="is-primary" disabled={!askText.trim()} title="Continue (Ctrl+Enter)">
                  place answer
                </button>
              </footer>
            </form>
          )}
        </div>
      ) : null}

      {pendingPlacement && rectStyle && (props.showPlacementGuide ?? true) ? (
        <div
          className="local-chat-placement-guide"
          data-local-chat-placement="pending"
          aria-live="polite"
          style={{ left: rectStyle.left + rectStyle.width / 2, top: rectStyle.top - 12 }}
        >
          <span>PLACE LOCAL CHAT</span>
          <strong>click anywhere on the diagram · Esc cancels</strong>
        </div>
      ) : null}

      {chatThreads.map((thread) => {
        const isActive = thread.id === activeThreadId;
        return (
          <div
            key={thread.id}
            className={`local-chat-anchor${isActive ? " is-active" : ""}`}
            data-mapping-static-ui
            data-diagram-canvas-static-ui
            style={{ left: thread.anchor.x, top: thread.anchor.y }}
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
              />
            ) : null}
          </div>
        );
      })}

      {activeThread && localChatVariant === "docked" && typeof document !== "undefined" ? createPortal(
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
          style={{
            left: `calc(100% + ${SIDE_GUTTER_PX}px)`,
            top: (firstSelectedANode.head.line - 1) * cell.height
          }}
        >
          <header className="mapping-poc-companion-controls">
            <span>B_SELECTED</span>
            <span className="mapping-poc-companion-meta">
              <strong>
                mapped {openedProjection.mappedBRange?.startLine}–{openedProjection.mappedBRange?.endLine}
                {" · "}aligned {openedProjection.alignedBRange?.startLine}–{openedProjection.alignedBRange?.endLine}
                {" · "}{openedProjection.alignedSectionIds.length} sections
              </strong>
              <button
                type="button"
                aria-label="Close mapped B"
                title="Close mapped B"
                onClick={() => setOpenedProjection(null)}
              >×</button>
            </span>
          </header>
          <pre>{openedProjection.bAscii}</pre>
        </aside>
      ) : null}
    </div>
  );
}
