import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from "react";
import {
  MAPPING_POC_A_NODES,
  MAPPING_POC_GRAPH_A,
  MAPPING_POC_GRAPH_A_LINE_COUNT,
  projectASelectionToB,
  selectANodesInRect,
  type MappingPocGridRect,
  type MappingPocProjection
} from "../mappingPoc";
import {
  MAPPING_POC_A_SECTIONS,
  MAPPING_POC_DETAIL_OVERLAYS,
  MAPPING_POC_OVERLAY_PLACEMENTS
} from "../mappingPocOverlays";

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
const MAX_COLUMN = Math.max(...MAPPING_POC_GRAPH_A.split("\n").map((line) => line.length));

function normalizeRect(anchor: GridPoint, focus: GridPoint): MappingPocGridRect {
  return {
    startLine: Math.min(anchor.line, focus.line),
    endLine: Math.max(anchor.line, focus.line),
    startColumn: Math.min(anchor.column, focus.column),
    endColumn: Math.max(anchor.column, focus.column)
  };
}

export function MappingPocSelectionCanvas() {
  const stageRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openMappedRef = useRef<HTMLButtonElement>(null);
  const activeSelectionRef = useRef<ActiveSelection | null>(null);
  const [cell, setCell] = useState<CellMetrics>({ width: 0, height: 0 });
  const [selectionRect, setSelectionRect] = useState<MappingPocGridRect | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [openedProjection, setOpenedProjection] = useState<MappingPocProjection | null>(null);
  const [openDetailOverlayId, setOpenDetailOverlayId] = useState<string | null>(null);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedNodes = useMemo(
    () => MAPPING_POC_A_NODES.filter((node) => selectedNodeIdSet.has(node.id)),
    [selectedNodeIdSet]
  );
  const candidateProjection = useMemo(
    () => projectASelectionToB(selectedNodeIds),
    [selectedNodeIds]
  );
  const firstSelectedANode = useMemo(() => {
    const selectedIds = new Set(openedProjection?.selectedANodeIds ?? []);
    return MAPPING_POC_A_NODES.find((node) => selectedIds.has(node.id));
  }, [openedProjection]);
  const openDetailOverlay = MAPPING_POC_DETAIL_OVERLAYS.find((overlay) => overlay.id === openDetailOverlayId);
  const openDetailPlacement = MAPPING_POC_OVERLAY_PLACEMENTS.find(
    (placement) => placement.overlayId === openDetailOverlayId
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

  const pointAtClient = useCallback((clientX: number, clientY: number): GridPoint | null => {
    const pre = preRef.current;
    if (!pre || !(cell.width > 0) || !(cell.height > 0)) return null;
    const bounds = pre.getBoundingClientRect();
    const scaleX = pre.offsetWidth > 0 ? bounds.width / pre.offsetWidth : 1;
    const scaleY = pre.offsetHeight > 0 ? bounds.height / pre.offsetHeight : scaleX;
    return {
      line: Math.max(1, Math.min(
        MAPPING_POC_GRAPH_A_LINE_COUNT,
        Math.floor((clientY - bounds.top) / (cell.height * scaleY)) + 1
      )),
      column: Math.max(1, Math.min(
        MAX_COLUMN,
        Math.floor((clientX - bounds.left) / (cell.width * scaleX)) + 1
      ))
    };
  }, [cell]);

  const finishSelection = (event: PointerEvent<HTMLDivElement>) => {
    const active = activeSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const focus = pointAtClient(event.clientX, event.clientY) ?? active.anchor;
    const rect = normalizeRect(active.anchor, focus);
    const nodes = selectANodesInRect(rect);
    activeSelectionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setOpenedProjection(null);
    setSelectedNodeIds(nodes.map((node) => node.id));
    setSelectionRect(nodes.length ? rect : null);
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
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b" && selectedNodeIds.length) {
        event.preventDefault();
        const menu = menuRef.current;
        if (menu?.contains(document.activeElement)) {
          (stageRef.current?.closest("[data-diagram-canvas]") as HTMLElement | null)?.focus();
        } else if (candidateProjection.bRange) {
          openMappedRef.current?.focus();
        } else {
          menu?.focus();
        }
        return;
      }
      if (event.key === "Escape" && selectedNodeIds.length && !openedProjection) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [candidateProjection.bRange, clearSelection, openedProjection, selectedNodeIds.length]);

  useEffect(() => {
    if (!selectedNodeIds.length || openedProjection) return undefined;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const stage = stageRef.current;
      if (stage && event.composedPath().includes(stage)) return;
      clearSelection();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [clearSelection, openedProjection, selectedNodeIds.length]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key.toLowerCase() !== "n" || !candidateProjection.bRange) return;
    event.preventDefault();
    openMapped();
  };

  const rectStyle = selectionRect && cell.width > 0 && cell.height > 0 ? {
    left: (selectionRect.startColumn - 1) * cell.width,
    top: (selectionRect.startLine - 1) * cell.height,
    width: (selectionRect.endColumn - selectionRect.startColumn + 1) * cell.width,
    height: (selectionRect.endLine - selectionRect.startLine + 1) * cell.height
  } : undefined;

  return (
    <div
      ref={stageRef}
      className="mapping-poc-graph-stage"
      aria-label="Graph A selectable nodes"
      onPointerDown={(event) => {
        if (openedProjection
          || openDetailOverlay
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
        data-line-count={MAPPING_POC_GRAPH_A_LINE_COUNT}
      >{MAPPING_POC_GRAPH_A}</pre>

      <div className="mapping-poc-node-layer" aria-hidden="true">
        {cell.width > 0 && cell.height > 0 ? MAPPING_POC_A_NODES.map((node) => (
          <span
            key={node.id}
            className={`mapping-poc-node-hit is-${node.selectableBecause}${selectedNodeIdSet.has(node.id) ? " is-selected" : ""}`}
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
          {MAPPING_POC_A_SECTIONS.map((section, index) => (
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

      {rectStyle ? <span className="mapping-poc-selection-rect" style={rectStyle} aria-hidden="true" /> : null}

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

      {selectionRect && selectedNodes.length && rectStyle ? (
        <div
          ref={menuRef}
          className="mapping-poc-selection-menu"
          data-mapping-static-ui
          data-diagram-canvas-static-ui
          role="menu"
          tabIndex={-1}
          aria-label="Selected node operations"
          aria-keyshortcuts="Control+B Meta+B"
          style={{ left: rectStyle.left + rectStyle.width + 12, top: rectStyle.top + rectStyle.height + 8 }}
          onKeyDown={onMenuKeyDown}
        >
          <span>{selectedNodes.length} selected · {candidateProjection.mappedANodeIds.length} mapped</span>
          <button
            ref={openMappedRef}
            type="button"
            role="menuitem"
            disabled={!candidateProjection.bRange}
            aria-keyshortcuts="N"
            onClick={openMapped}
          >
            <kbd>N</kbd>
            open mapped
          </button>
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
