import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSourceSnippet, type SourceSnippet } from "../api";
import type {
  CodeEntitiesSetRecord,
  CodeEntityRecord,
  DiagramComponentRecord,
  DiagramRecord
} from "../domain";
import type { ContentPresentation } from "../domainProfile";
import { contentLanguageName, SourceCodeView } from "./SourceCodeView";
import { isMarkdownDocumentPath, TerminalMarkdownView } from "./TerminalMarkdownView";
import type { TerminalMarkdownOutline } from "../terminalMarkdown/toc";

const CONTEXT_STORAGE_KEY = "new-diagram:code-context-percent";
const DEFAULT_CONTEXT_PERCENT = 20;
const MIN_CONTEXT_PERCENT = 12;
const MAX_CONTEXT_PERCENT = 45;

function clampContextPercent(value: number): number {
  return Math.max(MIN_CONTEXT_PERCENT, Math.min(MAX_CONTEXT_PERCENT, value));
}

function categoryLabel(entity: CodeEntityRecord): string {
  if (entity.category === "interface-data-struct") return "INTERFACE / DATA";
  return entity.category.toUpperCase();
}

export interface CodeEntityReveal {
  entityId?: string;
  sourceRangeIndex?: number;
  path?: string;
  targetLine?: number;
  highlightRange?: { startLine: number; endLine: number };
  requestId: number;
}

export function CodeEntitiesPanel(props: {
  setId: string;
  codeEntities: CodeEntitiesSetRecord;
  contentPresentation: ContentPresentation;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  diagram?: DiagramRecord | DiagramComponentRecord;
  reveal?: CodeEntityReveal;
  onMarkdownOutlineChange?: (outline: (TerminalMarkdownOutline & { path: string }) | null) => void;
  onMarkdownActiveSectionChange?: (section: {
    path: string;
    id: string;
    line: number;
    scrollTop: number;
  }) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visible = useMemo(() => {
    const base = props.diagram
      ? props.codeEntities.entities.filter((entity) => props.diagram?.codeEntityIds.includes(entity.id))
      : props.codeEntities.entities;
    const revealed = props.reveal?.entityId
      ? props.codeEntities.entities.find((entity) => entity.id === props.reveal?.entityId)
      : undefined;
    return revealed && !base.some((entity) => entity.id === revealed.id)
      ? [...base, revealed]
      : base;
  }, [props.codeEntities.entities, props.diagram, props.reveal?.entityId]);
  const [activeEntityId, setActiveEntityId] = useState(() => visible[0]?.id ?? "");
  const [activeRangeIndex, setActiveRangeIndex] = useState(0);
  const [preview, setPreview] = useState<SourceSnippet | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [jumpTarget, setJumpTarget] = useState<{
    requestId: number;
    line: number;
    startLine: number;
    endLine: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [contextPercent, setContextPercent] = useState(() => {
    const stored = Number(window.localStorage.getItem(CONTEXT_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampContextPercent(stored)
      : DEFAULT_CONTEXT_PERCENT;
  });

  const activeEntity = visible.find((entity) => entity.id === activeEntityId) ?? visible[0];
  const activeRange = activeEntity?.sourceRanges[activeRangeIndex] ?? activeEntity?.sourceRanges[0];
  const selected = activeEntity ? props.selectedIds?.has(activeEntity.id) ?? true : false;
  const markdownAnchor = Boolean(
    preview
    && props.contentPresentation.markdownRendering === "terminal"
    && isMarkdownDocumentPath(preview.path)
  );

  const selectEntity = useCallback((entityId: string, rangeIndex = 0) => {
    setActiveEntityId(entityId);
    setActiveRangeIndex(rangeIndex);
    setJumpTarget(null);
  }, []);

  const openLinkedAnchor = useCallback((path: string) => {
    for (const entity of visible) {
      const rangeIndex = entity.sourceRanges.findIndex((range) => range.path === path);
      if (rangeIndex >= 0) {
        selectEntity(entity.id, rangeIndex);
        return;
      }
    }
    setSourceError(`Linked file is not available as a CodeEntity anchor: ${path}`);
  }, [selectEntity, visible]);

  useEffect(() => {
    if (visible.length === 0 || visible.some((entity) => entity.id === activeEntityId)) return;
    selectEntity(visible[0].id);
  }, [activeEntityId, selectEntity, visible]);

  useEffect(() => {
    if (!props.reveal) return;
    if (props.reveal.entityId) {
      const entity = visible.find((candidate) => candidate.id === props.reveal?.entityId);
      const rangeIndex = props.reveal.sourceRangeIndex ?? 0;
      const range = entity?.sourceRanges[rangeIndex];
      if (!entity || !range) return;
      selectEntity(entity.id, rangeIndex);
      setJumpTarget({
        requestId: props.reveal.requestId,
        line: props.reveal.targetLine ?? range.startLine,
        startLine: props.reveal.highlightRange?.startLine ?? range.startLine,
        endLine: props.reveal.highlightRange?.endLine ?? range.endLine
      });
      return;
    }
    if (!props.reveal.path || !props.reveal.targetLine) return;
    const matches = visible.flatMap((entity) => entity.sourceRanges.flatMap((range, rangeIndex) => (
      range.path === props.reveal?.path ? [{ entity, range, rangeIndex }] : []
    )));
    const target = matches
      .filter(({ range }) => range.startLine <= props.reveal!.targetLine!
        && props.reveal!.targetLine! <= range.endLine)
      .sort((left, right) => (
        (left.range.endLine - left.range.startLine) - (right.range.endLine - right.range.startLine)
      ))[0] ?? matches[0];
    if (!target) return;
    selectEntity(target.entity.id, target.rangeIndex);
    setJumpTarget({
      requestId: props.reveal.requestId,
      line: props.reveal.targetLine,
      startLine: props.reveal.highlightRange?.startLine ?? props.reveal.targetLine,
      endLine: props.reveal.highlightRange?.endLine ?? props.reveal.targetLine
    });
  }, [props.reveal?.requestId, selectEntity, visible]);

  useEffect(() => {
    if (!activeEntity || activeEntity.sourceRanges[activeRangeIndex]) return;
    setActiveRangeIndex(0);
  }, [activeEntity, activeRangeIndex]);

  useEffect(() => {
    if (!activeEntity || !activeRange) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    // Keep an already-rendered document mounted while jumping between ranges
    // in that same file. This lets smooth scrolling begin at the reader's
    // current position instead of recreating the iframe at scroll position 0.
    setPreview((current) => current?.path === activeRange.path ? current : null);
    setSourceError(null);
    if (activeEntity.origin && activeEntity.origin.diagramSetId !== props.setId) {
      if (activeRange.originalLines) {
        setPreview({
          path: activeRange.path,
          startLine: activeRange.startLine,
          lines: activeRange.originalLines
        });
        setSourceLoading(false);
      } else {
        setSourceError("The foreign CodeEntity does not include a captured source snapshot.");
        setSourceLoading(false);
      }
      return;
    }
    setSourceLoading(true);
    void fetchSourceSnippet(props.setId, activeEntity.id, activeRangeIndex)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((caught) => {
        if (!cancelled) {
          setSourceError(caught instanceof Error ? caught.message : "source preview failed");
        }
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeEntity?.id, activeRange, activeRangeIndex, props.setId]);

  useEffect(() => {
    window.localStorage.setItem(CONTEXT_STORAGE_KEY, contextPercent.toFixed(2));
  }, [contextPercent]);

  useEffect(() => {
    if (!markdownAnchor) props.onMarkdownOutlineChange?.(null);
  }, [markdownAnchor, props.onMarkdownOutlineChange]);

  const updateFromClientY = useCallback((clientY: number) => {
    const root = rootRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    setContextPercent(clampContextPercent(((clientY - bounds.top) / bounds.height) * 100));
  }, []);

  return (
    <div
      ref={rootRef}
      className={props.diagram
        ? "entities-panel is-source-only"
        : dragging ? "entities-panel is-dragging" : "entities-panel"}
      style={{ ["--entity-context-percent" as string]: `${contextPercent}%` }}
    >
      {!props.diagram ? <>
      <section className="entity-context" aria-label="Code entity context">
        <header className="pane-header entity-context__header">
          <div>
            <span className="eyebrow">CODE ENTITIES · REV {props.codeEntities.revision}</span>
            <h2>Generation context</h2>
          </div>
          <span className={`status-pill status-pill--${props.codeEntities.status}`}>
            {props.codeEntities.status}
          </span>
        </header>
        {activeEntity ? (
          <div className="entity-context__body" data-active-entity-id={activeEntity.id}>
            <label className="entity-context__select">
              <span>Entity</span>
              <select
                aria-label="Active code entity"
                value={activeEntity.id}
                onChange={(event) => selectEntity(event.target.value)}
              >
                {visible.map((entity) => (
                  <option value={entity.id} key={entity.id}>{entity.label}</option>
                ))}
              </select>
            </label>
            <div className="entity-context__description">
              <div>
                <strong>{activeEntity.label}</strong>
                <code>{categoryLabel(activeEntity)}</code>
              </div>
              <p>{activeEntity.summary}</p>
              <code className="entity-handle">@entity/{activeEntity.handle}</code>
            </div>
            <label className="entity-context__select entity-context__range">
              <span>Source range</span>
              <select
                aria-label="Active source range"
                value={activeRangeIndex}
                onChange={(event) => {
                  setActiveRangeIndex(Number(event.target.value));
                }}
              >
                {activeEntity.sourceRanges.map((range, index) => (
                  <option value={index} key={`${range.path}:${range.startLine}:${index}`}>
                    {range.path}:{range.startLine}-{range.endLine}
                  </option>
                ))}
              </select>
            </label>
            {props.onToggle ? (
              <label className="entity-context__toggle">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => props.onToggle?.(activeEntity.id)}
                />
                <span>Include in generation</span>
              </label>
            ) : null}
          </div>
        ) : <p className="empty-copy">This artifact does not declare any CodeEntities.</p>}
      </section>

      <div
        className="entity-context-divider"
        role="separator"
        aria-label="Resize code entity context and source code"
        aria-orientation="horizontal"
        aria-valuemin={MIN_CONTEXT_PERCENT}
        aria-valuemax={MAX_CONTEXT_PERCENT}
        aria-valuenow={Math.round(contextPercent)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          updateFromClientY(event.clientY);
        }}
        onPointerMove={(event) => {
          if (dragging && event.buttons === 1) updateFromClientY(event.clientY);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setContextPercent((current) => clampContextPercent(current - 2));
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setContextPercent((current) => clampContextPercent(current + 2));
          } else if (event.key === "Home") {
            event.preventDefault();
            setContextPercent(MIN_CONTEXT_PERCENT);
          } else if (event.key === "End") {
            event.preventDefault();
            setContextPercent(MAX_CONTEXT_PERCENT);
          }
        }}
      ><span aria-hidden="true" /></div>
      </> : null}

      <section
        className={props.reveal?.entityId === activeEntity?.id ? "source-workspace is-revealed" : "source-workspace"}
        aria-label="Source code"
        data-active-entity-id={activeEntity?.id}
      >
        <header className="source-workspace__toolbar">
          <div>
            <strong>{preview?.path ?? activeRange?.path ?? "No source selected"}</strong>
            {activeRange?.symbol ? <span>{activeRange.symbol}</span> : null}
          </div>
          <div className="source-workspace__actions">
            {preview ? <code>{markdownAnchor
              ? "Terminal Markdown"
              : contentLanguageName(preview.path, props.contentPresentation)}</code> : null}
          </div>
        </header>
        <div className="source-workspace__body">
          {sourceLoading ? <p className="source-state">Loading source...</p> : null}
          {sourceError ? <p className="source-state inline-error">{sourceError}</p> : null}
          {preview && activeRange && markdownAnchor ? (
            <TerminalMarkdownView
              source={preview.lines.join("\n")}
              path={preview.path}
              targetLine={jumpTarget?.line ?? activeRange.startLine}
              targetRange={jumpTarget ?? {
                startLine: activeRange.startLine,
                endLine: activeRange.endLine
              }}
              jumpRequestId={jumpTarget?.requestId}
              onOpenRepositoryFile={openLinkedAnchor}
              onOutlineChange={props.onMarkdownOutlineChange}
              onActiveSectionChange={(section) => props.onMarkdownActiveSectionChange?.({
                path: preview.path,
                ...section
              })}
            />
          ) : preview && activeRange ? (
            <SourceCodeView
              preview={preview}
              range={activeRange}
              compacted={Boolean(activeRange.compactedSource)}
              presentation={props.contentPresentation}
              targetLine={jumpTarget?.line}
              revealed={props.reveal?.entityId === activeEntity?.id}
              revealRequestId={props.reveal?.requestId}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
