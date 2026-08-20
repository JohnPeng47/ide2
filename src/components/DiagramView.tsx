import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import type {
  CodeEntityRecord,
  DiagramCodeEntityMapRecord,
  DiagramComponentRecord,
  DiagramElementMapping,
  DiagramRecord,
  DiagramSelectionBounds
} from "../domain";

interface CharacterPoint {
  line: number;
  column: number;
}

function pointFromTarget(target: Element | null): CharacterPoint | null {
  const character = target?.closest<HTMLElement>("[data-ascii-char]");
  if (!character) return null;
  return {
    line: Number(character.dataset.line),
    column: Number(character.dataset.column)
  };
}

export function DiagramView(props: {
  active: DiagramRecord | DiagramComponentRecord;
  artifactKind: "diagram" | "diagram-component";
  onDerive: () => void;
  onCapture: (bounds: DiagramSelectionBounds) => Promise<void>;
  editMode?: boolean;
  markerMode?: boolean;
  editBusy?: boolean;
  codeEntities: CodeEntityRecord[];
  codeEntityMap?: DiagramCodeEntityMapRecord;
  mappingBusy?: boolean;
  mappingProgress?: string;
  mappingError?: string | null;
  onToggleEdit?: () => void;
  onMapCodeEntities?: () => void;
  onRevealCodeEntity?: (mapping: DiagramElementMapping) => void;
  onManualEdit?: (ascii: string) => void;
  onMarker?: (line: number, column: number) => void;
  onUndoEdit?: () => void;
  onRedoEdit?: () => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [anchor, setAnchor] = useState<CharacterPoint | null>(null);
  const [focus, setFocus] = useState<CharacterPoint | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftAscii, setDraftAscii] = useState(props.active.ascii);
  useEffect(() => setDraftAscii(props.active.ascii), [props.active.ascii, props.active.id]);
  const grid = useMemo(() => {
    const lines = props.active.ascii.split("\n");
    const width = Math.max(...lines.map((line) => line.length));
    return lines.map((line) => line.padEnd(width, " "));
  }, [props.active.ascii]);

  const reset = () => {
    setDragging(false);
    setAnchor(null);
    setFocus(null);
    setError(null);
  };

  const selected = (line: number, column: number) => {
    if (!anchor || !focus) return false;
    return line >= Math.min(anchor.line, focus.line)
      && line <= Math.max(anchor.line, focus.line)
      && column >= Math.min(anchor.column, focus.column)
      && column <= Math.max(anchor.column, focus.column);
  };

  const pointAtEvent = (event: PointerEvent<HTMLPreElement>) => (
    pointFromTarget(document.elementFromPoint(event.clientX, event.clientY))
    ?? pointFromTarget(event.target as Element)
  );

  const startCapture = (event: PointerEvent<HTMLPreElement>) => {
    if (!capturing || saving || event.button !== 0) return;
    const point = pointAtEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setAnchor(point);
    setFocus(point);
    setDragging(true);
    setError(null);
  };

  const moveCapture = (event: PointerEvent<HTMLPreElement>) => {
    if (!dragging) return;
    const point = pointAtEvent(event);
    if (point) setFocus(point);
  };

  const finishCapture = async (event: PointerEvent<HTMLPreElement>) => {
    if (!dragging || !anchor) return;
    const end = pointAtEvent(event) ?? focus ?? anchor;
    setFocus(end);
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSaving(true);
    setError(null);
    try {
      await props.onCapture({
        startLine: Math.min(anchor.line, end.line),
        endLine: Math.max(anchor.line, end.line),
        startColumn: Math.min(anchor.column, end.column),
        endColumn: Math.max(anchor.column, end.column)
      });
      setCapturing(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "component capture failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`diagram-panel ${props.artifactKind === "diagram-component" ? "diagram-component-panel" : ""}`}>
      <header className="pane-header">
        <div>
          <span className="eyebrow">
            {props.artifactKind === "diagram" ? "DIAGRAM VIEW" : "DIAGRAM COMPONENT VIEW"}
          </span>
          <h2>{props.active.name}</h2>
        </div>
        <div className="diagram-actions">
          <button
            type="button"
            className={capturing ? "button is-active" : "button"}
            disabled={saving || props.editMode}
            onClick={() => {
              setCapturing((current) => !current);
              reset();
            }}
          >
            {saving ? "saving component…" : capturing ? "cancel capture" : "capture component"}
          </button>
          <button type="button" className="button create-derivative" disabled={props.editMode} onClick={props.onDerive}>
            create derivative →
          </button>
          <button
            type="button"
            className={props.editMode ? "button edit-mode-toggle is-active" : "button edit-mode-toggle"}
            aria-pressed={Boolean(props.editMode)}
            disabled={saving || props.editBusy}
            onClick={props.onToggleEdit}
          >
            {props.editMode ? "exit edit" : "edit mode"}
          </button>
          <button
            type="button"
            className="button map-code-entities"
            disabled={saving || props.editBusy || props.editMode || props.mappingBusy || props.active.codeEntityIds.length === 0}
            onClick={props.onMapCodeEntities}
          >
            {props.mappingBusy
              ? "mapping…"
              : props.codeEntityMap
                ? "remap code entities"
                : "map code entities"}
          </button>
        </div>
      </header>
      {capturing ? (
        <div className="capture-instructions" role="status">
          Drag a rectangle over the ASCII. Releasing saves a child component automatically.
        </div>
      ) : null}
      {props.markerMode ? (
        <div className="capture-instructions marker-instructions" role="status">
          Click one character to replace it with a unique location marker.
        </div>
      ) : null}
      {props.mappingProgress ? (
        <div className="mapping-status" role="status">{props.mappingProgress}</div>
      ) : null}
      <div className={capturing || props.markerMode ? "ascii-stage is-capturing" : "ascii-stage"}>
        {capturing || props.markerMode ? (
          <pre
            className={props.markerMode ? "ascii-selector is-marking" : "ascii-selector"}
            onPointerDown={props.markerMode ? undefined : startCapture}
            onPointerMove={props.markerMode ? undefined : moveCapture}
            onPointerUp={props.markerMode ? undefined : (event) => void finishCapture(event)}
          >
            {grid.map((line, lineIndex) => (
              <span className="ascii-line" key={lineIndex}>
                {[...line].map((character, columnIndex) => (
                  <span
                    className={selected(lineIndex + 1, columnIndex + 1) ? "ascii-char is-selected" : "ascii-char"}
                    data-ascii-char="true"
                    data-line={lineIndex + 1}
                    data-column={columnIndex + 1}
                    key={columnIndex}
                    onClick={props.markerMode ? () => props.onMarker?.(lineIndex + 1, columnIndex + 1) : undefined}
                  >{character}</span>
                ))}
                {lineIndex < grid.length - 1 ? "\n" : null}
              </span>
            ))}
          </pre>
        ) : props.editMode ? (
          <textarea
            className="ascii-editor"
            value={draftAscii}
            disabled={props.editBusy}
            aria-label="ASCII diagram editor"
            wrap="off"
            spellCheck={false}
            onChange={(event) => {
              setDraftAscii(event.target.value);
            }}
            onBlur={() => {
              if (draftAscii !== props.active.ascii) props.onManualEdit?.(draftAscii);
            }}
            onKeyDown={(event) => {
              if (!(event.ctrlKey || event.metaKey)) return;
              if (event.key.toLowerCase() === "z" && !event.shiftKey) {
                event.preventDefault();
                if (draftAscii !== props.active.ascii) props.onManualEdit?.(draftAscii);
                props.onUndoEdit?.();
              } else if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) {
                event.preventDefault();
                if (draftAscii !== props.active.ascii) props.onManualEdit?.(draftAscii);
                props.onRedoEdit?.();
              }
            }}
          />
        ) : (
          <MappedAscii
            ascii={props.active.ascii}
            mapping={props.codeEntityMap}
            entities={props.codeEntities}
            onReveal={props.onRevealCodeEntity}
          />
        )}
      </div>
      {error ? <p className="capture-error" role="alert">{error}</p> : null}
      {props.mappingError ? <p className="capture-error" role="alert">{props.mappingError}</p> : null}
      <footer className="diagram-meta">
        <code>@{props.artifactKind === "diagram" ? "diagram" : "component"}/{props.active.handle}</code>
        <span>{props.active.codeEntityIds.length} code entities</span>
        <span>{props.artifactKind === "diagram"
          ? (props.active as DiagramRecord).origin === "imported"
            ? "IMPORTED"
            : props.active.derivedFromDiagramIds.length ? "DERIVATIVE" : "ROOT"
          : (props.active as DiagramComponentRecord).origin.toUpperCase()}</span>
      </footer>
    </div>
  );
}

function MappedAscii(props: {
  ascii: string;
  mapping?: DiagramCodeEntityMapRecord;
  entities: CodeEntityRecord[];
  onReveal?: (mapping: DiagramElementMapping) => void;
}) {
  if (!props.mapping) return <pre>{props.ascii}</pre>;
  const entitiesById = new Map(props.entities.map((entity) => [entity.id, entity]));
  const mappingsByLine = new Map<number, DiagramElementMapping[]>();
  for (const mapping of props.mapping?.mappings ?? []) {
    const lineMappings = mappingsByLine.get(mapping.line) ?? [];
    lineMappings.push(mapping);
    mappingsByLine.set(mapping.line, lineMappings);
  }
  for (const mappings of mappingsByLine.values()) {
    mappings.sort((left, right) => left.startColumn - right.startColumn);
  }
  return (
    <pre className="mapped-ascii">
      {props.ascii.split("\n").map((line, lineIndex, lines) => {
        const mappings = mappingsByLine.get(lineIndex + 1) ?? [];
        const content: ReactNode[] = [];
        let cursor = 0;
        for (const mapping of mappings) {
          const start = mapping.startColumn - 1;
          const end = mapping.endColumn;
          if (start > cursor) content.push(line.slice(cursor, start));
          const entity = entitiesById.get(mapping.entityId);
          const range = entity?.sourceRanges[mapping.sourceRangeIndex];
          content.push(
            <span className="mapped-element-wrap" key={mapping.id}>
              <button
                type="button"
                className="mapped-element"
                data-mapping-id={mapping.id}
                data-entity-id={mapping.entityId}
                aria-label={entity ? `Reveal ${entity.label} in Code Entities` : "Reveal mapped CodeEntity"}
                title={entity
                  ? `${entity.label}\n${entity.summary}${range ? `\n${range.path}:${range.startLine}-${range.endLine}` : ""}`
                  : undefined}
                onClick={() => props.onReveal?.(mapping)}
              >
                {line.slice(start, end)}
              </button>
            </span>
          );
          cursor = end;
        }
        if (cursor < line.length) content.push(line.slice(cursor));
        return <span className="mapped-ascii-line" key={lineIndex}>{content}{lineIndex < lines.length - 1 ? "\n" : null}</span>;
      })}
    </pre>
  );
}
