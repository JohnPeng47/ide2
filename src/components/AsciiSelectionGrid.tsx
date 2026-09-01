import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent
} from "react";
import type {
  CodeEntityRecord,
  DiagramElementMapping,
  DiagramSelectionBounds
} from "../domain";
import {
  normalizeDiagramSelection,
  type DiagramGridPoint
} from "../diagramSelection";
import { hiddenAsciiTreeLines, parseAsciiTree } from "../asciiTree";
import { referenceFromMapping, referenceIdentityKey } from "../refBuffer";
import {
  representationElementIdForMapping,
  type RepresentationIndex
} from "../representationIndex";
import type { RepresentationPresentation } from "../representationPresentation";
import type { PartialDiffDefinition } from "../partialDiff";
import { DiagramSelectionOverlay, type SelectionOverlayRect, type SelectionOverlayReference } from "./DiagramSelectionOverlay";
import { DiagramPartialDiffOverlay } from "./DiagramPartialDiffOverlay";

export type AsciiGridMode = "read" | "capture" | "select-refs" | "marker";

interface ActiveRectangle {
  pointerId: number;
  kind: "capture" | "select-refs";
  anchor: DiagramGridPoint;
  alt: boolean;
}

interface CellMetrics {
  width: number;
  height: number;
}

interface GridOrigin {
  left: number;
  top: number;
}

function mappingReferenceKey(
  mapping: DiagramElementMapping,
  entities: readonly CodeEntityRecord[]
): string {
  return referenceIdentityKey(referenceFromMapping(mapping, entities));
}

export function AsciiSelectionGrid(props: {
  ascii: string;
  representationIndex?: RepresentationIndex;
  presentation: RepresentationPresentation;
  spatialProgressByElementId?: ReadonlyMap<string, "current" | "visited" | "complete" | "failed">;
  mode: AsciiGridMode;
  mappings: readonly DiagramElementMapping[];
  entities: readonly CodeEntityRecord[];
  previewMappingIds: ReadonlySet<string>;
  bufferedReferenceKeys: ReadonlySet<string>;
  highlightedMappingIds: ReadonlySet<string>;
  highlightBusyMappingIds: ReadonlySet<string>;
  overlayReferences: SelectionOverlayReference[];
  partialDiff?: PartialDiffDefinition;
  onLiveSelection: (bounds: DiagramSelectionBounds | null) => void;
  onSelectionComplete: (
    kind: ActiveRectangle["kind"],
    bounds: DiagramSelectionBounds,
    modifiers: { alt: boolean }
  ) => void;
  onCancelMode?: (mode: "capture" | "select-refs") => void;
  onReveal?: (mapping: DiagramElementMapping) => void;
  onToggleHighlight?: (mapping: DiagramElementMapping) => void;
  collapseSubtrees?: boolean;
  onMarker?: (line: number, column: number) => void;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef<ActiveRectangle | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingPointRef = useRef<DiagramGridPoint | null>(null);
  const gridOriginRef = useRef<GridOrigin | null>(null);
  const suppressClickRef = useRef(false);
  const [liveSelection, setLiveSelection] = useState<DiagramSelectionBounds | null>(null);
  const [cellMetrics, setCellMetrics] = useState<CellMetrics>({ width: 0, height: 0 });
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const entitiesById = useMemo(
    () => new Map(props.entities.map((entity) => [entity.id, entity])),
    [props.entities]
  );
  const rawLines = useMemo(() => props.ascii.split("\n"), [props.ascii]);
  const treeNodes = useMemo(
    () => props.representationIndex?.kind === "tree" ? parseAsciiTree(props.ascii) : [],
    [props.ascii, props.representationIndex]
  );
  const treeNodesByLine = useMemo(
    () => new Map(treeNodes.map((node) => [node.line, node])),
    [treeNodes]
  );
  const indexedTreeNodesByLine = useMemo(() => new Map(
    props.representationIndex?.kind === "tree"
      ? Object.values(props.representationIndex.nodes).map((node) => [node.line, node] as const)
      : []
  ), [props.representationIndex]);
  const collapsedNodeLines = useMemo(() => new Set(
    [...collapsedNodeIds].flatMap((nodeId) => {
      if (props.representationIndex?.kind !== "tree") return [];
      const node = props.representationIndex.nodes[nodeId];
      return node ? [node.line] : [];
    })
  ), [collapsedNodeIds, props.representationIndex]);
  const hiddenLines = useMemo(
    () => props.mode === "read" ? hiddenAsciiTreeLines(props.ascii, collapsedNodeLines) : new Set<number>(),
    [collapsedNodeLines, props.ascii, props.mode]
  );
  const columnCount = useMemo(
    () => Math.max(0, ...rawLines.map((line) => line.length)),
    [rawLines]
  );
  const padRows = props.mode !== "read" || liveSelection !== null;
  const lines = useMemo(
    () => padRows ? rawLines.map((line) => line.padEnd(columnCount, " ")) : rawLines,
    [columnCount, padRows, rawLines]
  );
  const mappingsByLine = useMemo(() => {
    const result = new Map<number, DiagramElementMapping[]>();
    for (const mapping of props.mappings) {
      result.set(mapping.line, [...(result.get(mapping.line) ?? []), mapping]);
    }
    for (const mappings of result.values()) {
      mappings.sort((left, right) => left.startColumn - right.startColumn);
    }
    return result;
  }, [props.mappings]);

  const updateLiveSelection = useCallback((bounds: DiagramSelectionBounds | null) => {
    setLiveSelection(bounds);
    props.onLiveSelection(bounds);
  }, [props.onLiveSelection]);

  const clearPendingFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    pendingPointRef.current = null;
  }, []);

  const cancelRectangle = useCallback(() => {
    const active = activeRef.current;
    if (active && preRef.current?.hasPointerCapture(active.pointerId)) {
      preRef.current.releasePointerCapture(active.pointerId);
    }
    activeRef.current = null;
    clearPendingFrame();
    updateLiveSelection(null);
  }, [clearPendingFrame, updateLiveSelection]);

  useLayoutEffect(() => {
    const pre = preRef.current;
    const probe = probeRef.current;
    if (!pre || !probe) return;
    const measure = () => {
      const probeBounds = probe.getBoundingClientRect();
      const computed = getComputedStyle(pre);
      const width = probeBounds.width / 10;
      const height = Number.parseFloat(computed.lineHeight);
      if (!(width > 0) || !(height > 0)) return;
      gridOriginRef.current = null;
      setCellMetrics((current) => (
        Math.abs(current.width - width) < 0.01 && Math.abs(current.height - height) < 0.01
          ? current
          : { width, height }
      ));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(pre);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [props.ascii]);

  useEffect(() => {
    if (activeRef.current) cancelRectangle();
  }, [cancelRectangle, props.ascii, props.mode]);

  useEffect(() => setCollapsedNodeIds(new Set()), [props.ascii, props.representationIndex?.revision]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activeRef.current) {
        event.preventDefault();
        cancelRectangle();
        return;
      }
      if (props.mode === "capture" || props.mode === "select-refs") {
        event.preventDefault();
        props.onCancelMode?.(props.mode);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelRectangle, props.mode, props.onCancelMode]);

  useEffect(() => () => clearPendingFrame(), [clearPendingFrame]);

  const pointAtClient = (
    clientX: number,
    clientY: number,
    refreshOrigin = false
  ): DiagramGridPoint | null => {
    const pre = preRef.current;
    if (!pre || !(cellMetrics.width > 0) || !(cellMetrics.height > 0) || columnCount === 0) return null;
    if (refreshOrigin || !gridOriginRef.current) {
      const bounds = pre.getBoundingClientRect();
      gridOriginRef.current = { left: bounds.left, top: bounds.top };
    }
    const origin = gridOriginRef.current;
    return {
      line: Math.min(rawLines.length, Math.max(1, Math.floor((clientY - origin.top) / cellMetrics.height) + 1)),
      column: Math.min(columnCount, Math.max(1, Math.floor((clientX - origin.left) / cellMetrics.width) + 1))
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLPreElement>) => {
    if (event.button !== 0 || props.mode === "marker") return;
    const kind = props.mode === "capture"
      ? "capture"
      : props.mode === "select-refs" || (props.mode === "read" && (event.ctrlKey || event.metaKey))
        ? "select-refs"
        : null;
    if (!kind) return;
    const anchor = pointAtClient(event.clientX, event.clientY, true);
    if (!anchor) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeRef.current = { pointerId: event.pointerId, kind, anchor, alt: event.altKey };
    suppressClickRef.current = true;
    updateLiveSelection(normalizeDiagramSelection(anchor, anchor));
  };

  const onPointerMove = (event: PointerEvent<HTMLPreElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const focus = pointAtClient(event.clientX, event.clientY);
    if (!focus) return;
    pendingPointRef.current = focus;
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pendingPoint = pendingPointRef.current;
      const current = activeRef.current;
      pendingPointRef.current = null;
      if (pendingPoint && current) {
        updateLiveSelection(normalizeDiagramSelection(current.anchor, pendingPoint));
      }
    });
  };

  const finishRectangle = (event: PointerEvent<HTMLPreElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const focus = pointAtClient(event.clientX, event.clientY) ?? active.anchor;
    const bounds = normalizeDiagramSelection(active.anchor, focus);
    activeRef.current = null;
    clearPendingFrame();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    updateLiveSelection(null);
    props.onSelectionComplete(active.kind, bounds, { alt: active.alt });
  };

  const onClickCapture = (event: MouseEvent<HTMLPreElement>) => {
    if (props.mode === "marker") {
      const point = pointAtClient(event.clientX, event.clientY, true);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      props.onMarker?.(point.line, point.column);
      return;
    }
    if (!suppressClickRef.current && props.mode !== "capture" && props.mode !== "select-refs") return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  const overlayRect: SelectionOverlayRect | null = liveSelection && cellMetrics.width > 0 && cellMetrics.height > 0
    ? {
      x: (liveSelection.startColumn - 1) * cellMetrics.width,
      y: (liveSelection.startLine - 1) * cellMetrics.height,
      width: (liveSelection.endColumn - liveSelection.startColumn + 1) * cellMetrics.width,
      height: (liveSelection.endLine - liveSelection.startLine + 1) * cellMetrics.height
    }
    : null;

  return (
    <div className="ascii-grid-shell">
      <span className="ascii-cell-probe" ref={probeRef} aria-hidden="true">0000000000</span>
      {props.mode === "read" ? (
        <span className="representation-control-gutter" aria-label="Representation controls">
          {lines.map((line, lineIndex) => ({ line, lineNumber: lineIndex + 1 }))
            .filter(({ lineNumber }) => !hiddenLines.has(lineNumber))
            .map(({ lineNumber }) => {
              const mappings = mappingsByLine.get(lineNumber) ?? [];
              const treeNode = treeNodesByLine.get(lineNumber);
              const indexedTreeNode = indexedTreeNodesByLine.get(lineNumber);
              const canCollapse = props.presentation.controls.collapse === "gutter"
                && props.collapseSubtrees !== false
                && Boolean(treeNode && indexedTreeNode?.childIds.length);
              const collapsed = Boolean(indexedTreeNode && collapsedNodeIds.has(indexedTreeNode.id));
              const spatialStatus = indexedTreeNode
                ? props.spatialProgressByElementId?.get(indexedTreeNode.id)
                : undefined;
              return (
                <span className="representation-line-controls" data-control-line={lineNumber} key={lineNumber}>
                  {canCollapse ? (
                    <button
                      type="button"
                      className={`tree-node-collapse${spatialStatus ? ` has-agent-${spatialStatus}` : ""}`}
                      data-collapse-line={lineNumber}
                      data-representation-element-id={indexedTreeNode!.id}
                      aria-label={`${collapsed ? "Expand" : "Collapse"} ${treeNode!.text}`}
                      aria-expanded={!collapsed}
                      title={`${collapsed ? "Expand" : "Collapse"} this tree node`}
                      onClick={() => setCollapsedNodeIds((current) => {
                        const next = new Set(current);
                        if (next.has(indexedTreeNode!.id)) next.delete(indexedTreeNode!.id);
                        else next.add(indexedTreeNode!.id);
                        return next;
                      })}
                    >[{collapsed ? "+" : "-"}]</button>
                  ) : null}
                  {props.presentation.controls.savedHighlight === "gutter" && props.onToggleHighlight
                    ? mappings.map((mapping) => {
                      const entity = entitiesById.get(mapping.entityId);
                      const highlighted = props.highlightedMappingIds.has(mapping.id);
                      return (
                        <button
                          type="button"
                          className={`mapped-highlight-toggle${highlighted ? " is-highlighted" : ""}`}
                          data-highlight-mapping-id={mapping.id}
                          aria-label={`${highlighted ? "Remove" : "Add"} ${entity?.label ?? "mapped node"} ${highlighted ? "from" : "to"} highlights`}
                          aria-pressed={highlighted}
                          disabled={props.highlightBusyMappingIds.has(mapping.id)}
                          title={highlighted ? "Remove from highlights" : "Add to highlights"}
                          onClick={() => props.onToggleHighlight?.(mapping)}
                        >[{highlighted ? "★" : "☆"}]</button>
                      );
                    })
                    : null}
                </span>
              );
            })}
        </span>
      ) : null}
      <pre
        ref={preRef}
        className={`ascii-grid${props.mode === "read" ? "" : " ascii-selector"} ascii-selector--${props.mode}${props.mode === "marker" ? " is-marking" : ""}${activeRef.current ? " is-dragging" : ""}`}
        data-cell-width={cellMetrics.width || undefined}
        data-line-height={cellMetrics.height || undefined}
        data-grid-lines={rawLines.length}
        data-grid-columns={columnCount}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishRectangle}
        onPointerCancel={cancelRectangle}
        onClickCapture={onClickCapture}
      >
        {lines.map((line, lineIndex) => ({ line, lineNumber: lineIndex + 1 }))
          .filter(({ lineNumber }) => !hiddenLines.has(lineNumber))
          .map(({ line, lineNumber }, visibleIndex, visibleLines) => {
          const mappings = mappingsByLine.get(lineNumber) ?? [];
          const indexedTreeNode = indexedTreeNodesByLine.get(lineNumber);
          const content = [];
          let cursor = 0;
          for (const mapping of mappings) {
            const start = mapping.startColumn - 1;
            const end = mapping.endColumn;
            if (start > cursor) content.push(line.slice(cursor, start));
            const entity = entitiesById.get(mapping.entityId);
            const range = mapping.sourceRangeId
              ? entity?.sourceRanges.find((candidate) => candidate.id === mapping.sourceRangeId)
              : entity?.sourceRanges[mapping.sourceRangeIndex];
            const classes = [
              "mapped-element",
              props.previewMappingIds.has(mapping.id) ? "is-selection-preview" : "",
              props.bufferedReferenceKeys.has(mappingReferenceKey(mapping, props.entities)) ? "is-buffered-ref" : ""
            ].filter(Boolean).join(" ");
            const representationElementId = props.representationIndex
              ? representationElementIdForMapping(props.representationIndex, mapping.id)
              : undefined;
            const spatialStatus = representationElementId
              ? props.spatialProgressByElementId?.get(representationElementId)
              : undefined;
            content.push(
              <span
                className={`mapped-element-wrap${spatialStatus ? ` has-agent-${spatialStatus}` : ""}`}
                data-representation-element-id={representationElementId}
                data-agent-progress={spatialStatus}
                key={mapping.id}
              >
                {props.onReveal ? (
                  <button
                    type="button"
                    className={`${classes} representation-link--${props.presentation.evidenceLinks.kind}`}
                    data-mapping-id={mapping.id}
                    data-entity-id={mapping.entityId}
                    data-reference-key={mappingReferenceKey(mapping, props.entities)}
                    data-line={mapping.line}
                    data-start-column={mapping.startColumn}
                    data-end-column={mapping.endColumn}
                    aria-label={entity ? `Reveal ${entity.label} in Code Entities` : "Reveal mapped CodeEntity"}
                    title={entity
                      ? `${entity.label}\n${entity.summary}${range ? `\n${range.path}:${range.startLine}-${range.endLine}` : ""}`
                      : undefined}
                    onClick={() => props.onReveal?.(mapping)}
                  >
                    {line.slice(start, end)}
                  </button>
                ) : line.slice(start, end)}
              </span>
            );
            cursor = end;
          }
          if (cursor < line.length) content.push(line.slice(cursor));
          const lineSpatialStatus = indexedTreeNode
            ? props.spatialProgressByElementId?.get(indexedTreeNode.id)
            : undefined;
          return (
            <span
              className={`ascii-line mapped-ascii-line${lineSpatialStatus ? ` has-agent-${lineSpatialStatus}` : ""}`}
              data-ascii-line={lineNumber}
              data-representation-element-id={indexedTreeNode?.id}
              data-agent-progress={lineSpatialStatus}
              key={lineNumber}
            >
              {content}{visibleIndex < visibleLines.length - 1 ? "\n" : null}
            </span>
          );
        })}
      </pre>
      {props.mode === "read" && props.partialDiff && cellMetrics.width > 0 && cellMetrics.height > 0 ? (
        <DiagramPartialDiffOverlay diff={props.partialDiff} cell={cellMetrics} />
      ) : null}
      {overlayRect && liveSelection ? (
        <DiagramSelectionOverlay rect={overlayRect} references={props.overlayReferences} />
      ) : null}
    </div>
  );
}
