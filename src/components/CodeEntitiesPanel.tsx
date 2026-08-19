import { useState } from "react";
import { fetchSourceSnippet, type SourceSnippet } from "../api";
import type { CodeEntitiesSetRecord, CodeEntityRecord, DiagramRecord } from "../domain";

function categoryLabel(entity: CodeEntityRecord): string {
  if (entity.category === "interface-data-struct") return "INTERFACE / DATA";
  return entity.category.toUpperCase();
}

function SourcePreview(props: { setId: string; entity: CodeEntityRecord }) {
  const [preview, setPreview] = useState<SourceSnippet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRange, setOpenRange] = useState<number | null>(null);
  const open = async (index: number) => {
    if (openRange === index) {
      setOpenRange(null);
      setPreview(null);
      return;
    }
    setError(null);
    try {
      setPreview(await fetchSourceSnippet(props.setId, props.entity.id, index));
      setOpenRange(index);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "source preview failed");
    }
  };
  return (
    <div className="entity-sources">
      {props.entity.sourceRanges.map((range, index) => (
        <button
          type="button"
          className="source-link"
          key={`${range.path}:${range.startLine}:${index}`}
          onClick={() => void open(index)}
        >
          {range.path}:{range.startLine}-{range.endLine}{range.symbol ? ` · ${range.symbol}` : ""}
        </button>
      ))}
      {error ? <p className="inline-error">{error}</p> : null}
      {preview && openRange !== null ? (
        <pre className="source-preview" aria-label={`Source preview for ${preview.path}`}>
          {preview.lines.map((line, index) => (
            <span key={preview.startLine + index}>
              <i>{String(preview.startLine + index).padStart(4, " ")}</i>{line || " "}{"\n"}
            </span>
          ))}
        </pre>
      ) : null}
    </div>
  );
}

export function CodeEntitiesPanel(props: {
  setId: string;
  codeEntities: CodeEntitiesSetRecord;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  diagram?: DiagramRecord;
}) {
  const visible = props.diagram
    ? props.codeEntities.entities.filter((entity) => props.diagram?.codeEntityIds.includes(entity.id))
    : props.codeEntities.entities;
  return (
    <div className="entities-panel">
      <header className="pane-header">
        <div>
          <span className="eyebrow">CODE ENTITIES · REV {props.codeEntities.revision}</span>
          <h2>{props.diagram ? "Diagram context" : "Generation context"}</h2>
        </div>
        <span className={`status-pill status-pill--${props.codeEntities.status}`}>
          {props.codeEntities.status}
        </span>
      </header>
      <div className="entity-list" role={props.onToggle ? "group" : undefined} aria-label="Code entities">
        {visible.length === 0 ? (
          <p className="empty-copy">This diagram does not declare any CodeEntities.</p>
        ) : visible.map((entity) => {
          const selected = props.selectedIds?.has(entity.id) ?? true;
          return (
            <article
              className={selected ? "entity-card is-selected" : "entity-card"}
              data-entity-id={entity.id}
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
              <SourcePreview setId={props.setId} entity={entity} />
            </article>
          );
        })}
      </div>
    </div>
  );
}
