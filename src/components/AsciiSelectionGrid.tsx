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
import { DiagramSelectionOverlay, type SelectionOverlayRect, type SelectionOverlayReference } from "./DiagramSelectionOverlay";

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
  mode: AsciiGridMode;
  mappings: readonly DiagramElementMapping[];
  entities: readonly CodeEntityRecord[];
  previewMappingIds: ReadonlySet<string>;
  bufferedReferenceKeys: ReadonlySet<string>;
  highlightedMappingIds: ReadonlySet<string>;
  highlightBusyMappingIds: ReadonlySet<string>;
  overlayReferences: SelectionOverlayReference[];
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
          const treeNode = treeNodesByLine.get(lineNumber);
          const indexedTreeNode = indexedTreeNodesByLine.get(lineNumber);
          const canCollapse = props.collapseSubtrees !== false
            && props.mode === "read"
            && Boolean(treeNode && indexedTreeNode?.childIds.length);
          const collapseColumn = canCollapse ? treeNode!.textColumn - 1 : undefined;
          const content = [];
          let cursor = 0;
          let collapseInserted = false;
          const insertCollapse = () => {
            if (collapseColumn === undefined || collapseInserted) return;
            if (collapseColumn > cursor) content.push(line.slice(cursor, collapseColumn));
            const elementId = indexedTreeNode!.id;
            const collapsed = collapsedNodeIds.has(elementId);
            content.push(
              <button
                type="button"
                className="tree-node-collapse"
                key={`collapse:${elementId}`}
                data-collapse-line={lineNumber}
                data-representation-element-id={elementId}
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${treeNode!.text}`}
                aria-expanded={!collapsed}
                title={`${collapsed ? "Expand" : "Collapse"} this tree node`}
                onClick={() => setCollapsedNodeIds((current) => {
                  const next = new Set(current);
                  if (next.has(elementId)) next.delete(elementId);
                  else next.add(elementId);
                  return next;
                })}
              >[{collapsed ? "+" : "-"}]</button>
            );
            content.push(" ");
            cursor = collapseColumn;
            collapseInserted = true;
          };
          for (const mapping of mappings) {
            const start = mapping.startColumn - 1;
            const end = mapping.endColumn;
            if (collapseColumn !== undefined && collapseColumn <= start) insertCollapse();
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
            content.push(
              <span
                className="mapped-element-wrap"
                data-representation-element-id={representationElementId}
                key={mapping.id}
              >
                {props.onToggleHighlight ? <>
                  <button
                    type="button"
                    className={`mapped-highlight-toggle${props.highlightedMappingIds.has(mapping.id) ? " is-highlighted" : ""}`}
                    data-highlight-mapping-id={mapping.id}
                    aria-label={`${props.highlightedMappingIds.has(mapping.id) ? "Remove" : "Add"} ${entity?.label ?? "mapped node"} ${props.highlightedMappingIds.has(mapping.id) ? "from" : "to"} highlights`}
                    aria-pressed={props.highlightedMappingIds.has(mapping.id)}
                    disabled={props.highlightBusyMappingIds.has(mapping.id)}
                    title={props.highlightedMappingIds.has(mapping.id) ? "Remove from highlights" : "Add to highlights"}
                    onClick={() => props.onToggleHighlight?.(mapping)}
                  >[{props.highlightedMappingIds.has(mapping.id) ? "★" : "☆"}]</button>
                  {" "}
                </> : null}
                <button
                  type="button"
                  className={`${classes} mapped-element-marker`}
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
                  [(**)]
                </button>
                <span className="mapped-element-copy"> {line.slice(start, end)}</span>
              </span>
            );
            cursor = end;
          }
          if (!collapseInserted) insertCollapse();
          if (cursor < line.length) content.push(line.slice(cursor));
          return (
            <span className="ascii-line mapped-ascii-line" data-ascii-line={lineNumber} key={lineNumber}>
              {content}{visibleIndex < visibleLines.length - 1 ? "\n" : null}
            </span>
          );
        })}
      </pre>
      {overlayRect && liveSelection ? (
        <DiagramSelectionOverlay rect={overlayRect} references={props.overlayReferences} />
      ) : null}
    </div>
  );
}
