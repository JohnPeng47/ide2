import { useEffect, useRef, useState } from "react";
import { fetchSourceSnippet, type SourceSnippet } from "../api";
import type {
  CodeEntitiesSetRecord,
  CodeEntityRecord,
  DiagramComponentRecord,
  DiagramRecord,
  SourceRange
} from "../domain";

function categoryLabel(entity: CodeEntityRecord): string {
  if (entity.category === "interface-data-struct") return "INTERFACE / DATA";
  return entity.category.toUpperCase();
}

function SourceLines(props: {
  preview: SourceSnippet;
  startLine: number;
  endLine: number;
  highlighted?: boolean;
}) {
  const first = Math.max(props.startLine, props.preview.startLine);
  const last = Math.min(
    props.endLine,
    props.preview.startLine + props.preview.lines.length - 1
  );
  if (last < first) return null;
  return <>
    {props.preview.lines.slice(first - props.preview.startLine, last - props.preview.startLine + 1)
      .map((line, index) => (
        <span className={props.highlighted ? "source-line is-highlighted" : "source-line"} key={first + index}>
          <i>{String(first + index).padStart(4, " ")}</i>{line || " "}
        </span>
      ))}
  </>;
}

function CompactedSourcePreview(props: { preview: SourceSnippet; range: SourceRange; highlighted?: boolean }) {
  return (
    <div className="source-preview source-preview--compacted" aria-label={`Compacted source preview for ${props.preview.path}`}>
      {props.range.compactedSource?.sections.map((section, index) => (
        section.kind === "source" ? (
          <SourceLines
            preview={props.preview}
            startLine={section.startLine}
            endLine={section.endLine}
            highlighted={props.highlighted}
            key={`source:${section.startLine}:${section.endLine}:${index}`}
          />
        ) : (
          <details
            className="source-collapse"
            key={`comment:${section.startLine}:${section.endLine}:${index}`}
          >
            <summary aria-label={`Reveal original lines ${section.startLine} through ${section.endLine}`}>
              <code>// Lines {section.startLine}-{section.endLine}: {section.comment}</code>
              <small>{Math.max(0, section.endLine - section.startLine + 1)} lines</small>
            </summary>
            <div className="source-collapse__lines">
              <SourceLines
                preview={props.preview}
                startLine={section.startLine}
                endLine={section.endLine}
                highlighted={props.highlighted}
              />
            </div>
          </details>
        )
      ))}
    </div>
  );
}

function SourcePreview(props: {
  setId: string;
  entity: CodeEntityRecord;
  reveal?: CodeEntityReveal;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<SourceSnippet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRange, setOpenRange] = useState<number | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const show = async (index: number) => {
    setError(null);
    try {
      setPreview(await fetchSourceSnippet(props.setId, props.entity.id, index));
      setOpenRange(index);
      setShowOriginal(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "source preview failed");
    }
  };
  const open = async (index: number) => {
    if (openRange === index) {
      setOpenRange(null);
      setPreview(null);
      setShowOriginal(false);
      return;
    }
    await show(index);
  };
  useEffect(() => {
    if (!props.reveal || props.reveal.entityId !== props.entity.id) return;
    void show(props.reveal.sourceRangeIndex);
  }, [props.reveal?.requestId]);
  useEffect(() => {
    if (!preview || props.reveal?.sourceRangeIndex !== openRange) return;
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(".source-preview-shell.is-revealed")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openRange, preview, props.reveal?.requestId]);
  return (
    <div ref={rootRef} className="entity-sources">
      {props.entity.sourceRanges.map((range, index) => (
        <button
          type="button"
          className={props.reveal?.sourceRangeIndex === index ? "source-link is-revealed" : "source-link"}
          key={`${range.path}:${range.startLine}:${index}`}
          onClick={() => void open(index)}
        >
          {range.path}:{range.startLine}-{range.endLine}{range.symbol ? ` · ${range.symbol}` : ""}
        </button>
      ))}
      {error ? <p className="inline-error">{error}</p> : null}
      {preview && openRange !== null ? (() => {
        const range = props.entity.sourceRanges[openRange];
        const compacted = range.compactedSource !== undefined;
        const highlighted = props.reveal?.sourceRangeIndex === openRange;
        return <div className={highlighted ? "source-preview-shell is-revealed" : "source-preview-shell"}>
          {compacted ? (
            <div className="source-preview-toolbar">
              <span>{range.compactedSource?.level} compaction</span>
              <button
                type="button"
                className="source-original-toggle"
                aria-pressed={showOriginal}
                onClick={() => setShowOriginal((current) => !current)}
              >
                {showOriginal ? "show compacted" : "peek original"}
              </button>
            </div>
          ) : null}
          {compacted && !showOriginal ? (
            <CompactedSourcePreview preview={preview} range={range} highlighted={highlighted} />
          ) : (
            <pre className="source-preview" aria-label={`Source preview for ${preview.path}`}>
              <SourceLines
                preview={preview}
                startLine={range.startLine}
                endLine={range.endLine}
                highlighted={highlighted}
              />
            </pre>
          )}
        </div>;
      })() : null}
    </div>
  );
}

export interface CodeEntityReveal {
  entityId: string;
  sourceRangeIndex: number;
  requestId: number;
}

export function CodeEntitiesPanel(props: {
  setId: string;
  codeEntities: CodeEntitiesSetRecord;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  diagram?: DiagramRecord | DiagramComponentRecord;
  reveal?: CodeEntityReveal;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const visible = props.diagram
    ? props.codeEntities.entities.filter((entity) => props.diagram?.codeEntityIds.includes(entity.id))
    : props.codeEntities.entities;
  useEffect(() => {
    if (!props.reveal) return;
    const frame = window.requestAnimationFrame(() => {
      const card = listRef.current?.querySelector<HTMLElement>(
        `[data-entity-id="${CSS.escape(props.reveal!.entityId)}"]`
      );
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.reveal?.requestId]);
  return (
    <div className="entities-panel">
      <header className="pane-header">
        <div>
          <span className="eyebrow">CODE ENTITIES · REV {props.codeEntities.revision}</span>
          <h2>{props.diagram ? "Artifact context" : "Generation context"}</h2>
        </div>
        <span className={`status-pill status-pill--${props.codeEntities.status}`}>
          {props.codeEntities.status}
        </span>
      </header>
      <div ref={listRef} className="entity-list" role={props.onToggle ? "group" : undefined} aria-label="Code entities">
        {visible.length === 0 ? (
          <p className="empty-copy">This artifact does not declare any CodeEntities.</p>
        ) : visible.map((entity) => {
          const selected = props.selectedIds?.has(entity.id) ?? true;
          return (
            <article
              className={[
                "entity-card",
                selected ? "is-selected" : "",
                props.reveal?.entityId === entity.id ? "is-revealed" : ""
              ].filter(Boolean).join(" ")}
              data-entity-id={entity.id}
              tabIndex={-1}
              key={entity.id}
            >
              <div className="entity-card__head">
                {props.onToggle ? (
                  <label className="entity-toggle">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => props.onToggle?.(entity.id)}
                    />
                    <span aria-hidden="true" />
                    <b>{entity.label}</b>
                  </label>
                ) : <b>{entity.label}</b>}
                <code>{categoryLabel(entity)}</code>
              </div>
              <p>{entity.summary}</p>
              <code className="entity-handle">@entity/{entity.handle}</code>
              <SourcePreview
                setId={props.setId}
                entity={entity}
                reveal={props.reveal?.entityId === entity.id ? props.reveal : undefined}
              />
            </article>
          );
        })}
      </div>
    </div>
  );
}
