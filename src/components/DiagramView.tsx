import { useEffect, useMemo, useState } from "react";
import type { OpenCallGraphFocus } from "../callGraphFocus";
import type {
  CodeEntityRecord,
  DiagramCodeEntityMapRecord,
  DiagramComponentRecord,
  DiagramElementMapping,
  DiagramRecord,
  DiagramSelectionBounds,
  DiagramViewKind
} from "../domain";
import { mappingsForSelection } from "../diagramSelection";
import { referenceIdentityKey, referencesFromMappings } from "../refBuffer";
import { resolveReference, type ReferenceResolutionContext } from "../referenceResolver";
import { useRefBuffer } from "../ref-buffer/RefBufferContext";
import { RefBufferTray } from "../ref-buffer/RefBufferTray";
import { AsciiSelectionGrid, type AsciiGridMode } from "./AsciiSelectionGrid";
import type { SelectionOverlayReference } from "./DiagramSelectionOverlay";

export const DIAGRAM_VIEW_OPTIONS: Array<{ kind: DiagramViewKind; label: string }> = [
  { kind: "diagram", label: "DIAGRAM" },
  { kind: "call-graph", label: "CALL GRAPH" },
  { kind: "dir-view", label: "DIR VIEW" }
];

export function EmptyDiagramView(props: {
  viewKind: DiagramViewKind;
  viewCounts: Record<DiagramViewKind, number>;
  onGenerate: () => void;
}) {
  const label = DIAGRAM_VIEW_OPTIONS.find((option) => option.kind === props.viewKind)?.label ?? "DIAGRAM";
  const hasCandidates = props.viewCounts[props.viewKind] > 0;
  return (
    <div className="diagram-panel diagram-empty-panel">
      <header className="pane-header diagram-pane-header">
        <div className="diagram-heading">
          <span className="eyebrow">{label} VIEW</span>
          <h2>No starred {label.toLowerCase()}</h2>
        </div>
        <button type="button" className="button button--primary" onClick={props.onGenerate}>generate →</button>
      </header>
      <div className="diagram-empty-state">
        <span className="eyebrow">{hasCandidates ? "CANDIDATE REQUIRED" : "NO CANDIDATES"}</span>
        <h3>{hasCandidates ? `Choose and star a ${label.toLowerCase()} candidate.` : `Generate the first ${label.toLowerCase()} candidate.`}</h3>
        <p>{hasCandidates
          ? "Open a candidate from the Diagrams tree, then use its star control."
          : "The generated candidates will appear in the Diagrams tree."}</p>
        <button type="button" className="button button--primary" onClick={props.onGenerate}>generate {label.toLowerCase()} →</button>
      </div>
    </div>
  );
}

export function DiagramView(props: {
  active: DiagramRecord | DiagramComponentRecord;
  artifactKind: "diagram" | "diagram-component";
  onGenerate: () => void;
  onExport: () => Promise<void>;
  onCapture: (bounds: DiagramSelectionBounds) => Promise<void>;
  editMode?: boolean;
  markerMode?: boolean;
  editBusy?: boolean;
  codeEntities: CodeEntityRecord[];
  codeEntityMap?: DiagramCodeEntityMapRecord;
  referenceResolutionContext: ReferenceResolutionContext;
  projectId: string;
  diagramSetId: string;
  onInsertReferenceTokens: (tokens: string) => void;
  mappingBusy?: boolean;
  mappingProgress?: string;
  mappingError?: string | null;
  starred?: boolean;
  starBusy?: boolean;
  onToggleStarred?: () => void;
  onToggleEdit?: () => void;
  onMapCodeEntities?: () => void;
  onRevealCodeEntity?: (mapping: DiagramElementMapping) => void;
  onManualEdit?: (ascii: string) => void;
  onMarker?: (line: number, column: number) => void;
  onUndoEdit?: () => void;
  onRedoEdit?: () => void;
  onOpenCallGraphFocus?: OpenCallGraphFocus;
}) {
  const refBuffer = useRefBuffer();
  const [capturing, setCapturing] = useState(false);
  const [selectingRefs, setSelectingRefs] = useState(false);
  const [liveSelection, setLiveSelection] = useState<DiagramSelectionBounds | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectionStatus, setSelectionStatus] = useState("");
  const [draftAscii, setDraftAscii] = useState(props.active.ascii);
  useEffect(() => setDraftAscii(props.active.ascii), [props.active.ascii, props.active.id]);
  useEffect(() => {
    setCapturing(false);
    setSelectingRefs(false);
    setLiveSelection(null);
    setSelectionStatus("");
  }, [props.active.id, props.active.ascii, props.codeEntityMap?.producedByRunId]);
  useEffect(() => {
    if (!props.editMode && !props.markerMode) return;
    setCapturing(false);
    setSelectingRefs(false);
    setLiveSelection(null);
  }, [props.editMode, props.markerMode]);

  const mappings = props.codeEntityMap?.mappings ?? [];
  const liveMappings = useMemo(
    () => liveSelection ? mappingsForSelection(mappings, liveSelection) : [],
    [liveSelection, mappings]
  );
  const liveReferences = useMemo(
    () => referencesFromMappings(liveMappings, props.codeEntities),
    [liveMappings, props.codeEntities]
  );
  const previewMappingIds = useMemo(
    () => new Set(liveMappings.map((mapping) => mapping.id)),
    [liveMappings]
  );
  const bufferedReferenceKeys = useMemo(
    () => new Set(refBuffer.entries.map(referenceIdentityKey)),
    [refBuffer.entries]
  );
  const mappedReferenceKeys = useMemo(
    () => new Set(referencesFromMappings(mappings, props.codeEntities).map(referenceIdentityKey)),
    [mappings, props.codeEntities]
  );
  const overlayReferences = useMemo(() => {
    const result: SelectionOverlayReference[] = [];
    const seen = new Set<string>();
    for (const identity of liveReferences) {
      const key = referenceIdentityKey(identity);
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = resolveReference(identity, props.referenceResolutionContext);
      const text = resolved?.selectableText?.getSelectionText(identity);
      if (text !== undefined) result.push({ key, identity, text });
    }
    return result;
  }, [liveReferences, props.referenceResolutionContext]);

  const gridMode: AsciiGridMode = props.markerMode
    ? "marker"
    : capturing
      ? "capture"
      : selectingRefs
        ? "select-refs"
        : "read";
  const callGraphFocusSource = props.artifactKind === "diagram"
    && (props.active as DiagramRecord).viewKind === "diagram"
    && props.onOpenCallGraphFocus
      ? props.active as DiagramRecord
      : undefined;

  const saveCapture = async (bounds: DiagramSelectionBounds) => {
    setSaving(true);
    setError(null);
    try {
      await props.onCapture(bounds);
      setCapturing(false);
      setSelectionStatus("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "component capture failed");
    } finally {
      setSaving(false);
    }
  };

  const completeSelection = (
    kind: "capture" | "select-refs",
    bounds: DiagramSelectionBounds
  ) => {
    if (kind === "capture") {
      void saveCapture(bounds);
      return;
    }
    if (!props.codeEntityMap) {
      setSelectionStatus("map code entities first");
      return;
    }
    const selectedMappings = mappingsForSelection(mappings, bounds);
    const refs = referencesFromMappings(selectedMappings, props.codeEntities);
    refBuffer.add(refs);
    setSelectionStatus(refs.length === 0
      ? "no mapped references in selection"
      : `added ${refs.length} mapped ref${refs.length === 1 ? "" : "s"}`);
  };

  return (
    <div className={`diagram-panel ${props.artifactKind === "diagram-component" ? "diagram-component-panel" : ""}`}>
      <header className="pane-header diagram-pane-header">
        <div className="diagram-heading">
          <span className="eyebrow">
            {props.artifactKind === "diagram" ? "DIAGRAM VIEW" : "DIAGRAM COMPONENT VIEW"}
          </span>
          <div className="diagram-heading__title">
            <h2>{props.active.name}</h2>
            {props.artifactKind === "diagram" ? (
              <button
                type="button"
                className={`diagram-star-toggle${props.starred ? " is-starred" : ""}`}
                aria-label={props.starred ? "Remove chosen diagram status" : "Choose this diagram"}
                aria-pressed={Boolean(props.starred)}
                title={props.starred
                  ? "Chosen for downstream workflows; click to clear"
                  : "Choose for downstream workflows"}
                disabled={props.starBusy}
                onClick={props.onToggleStarred}
              >
                <span aria-hidden="true">{props.starred ? "★" : "☆"}</span>
              </button>
            ) : null}
          </div>
        </div>
        <div className="diagram-actions">
          <button
            type="button"
            className="button export-mapped-artifact"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              setError(null);
              void props.onExport().catch((caught) => {
                setError(caught instanceof Error ? caught.message : "mapped artifact export failed");
              }).finally(() => setExporting(false));
            }}
          >{exporting ? "exporting…" : "export mapped"}</button>
          <button
            type="button"
            className={capturing ? "button capture-component is-active" : "button capture-component"}
            aria-keyshortcuts="Escape"
            disabled={saving || props.editMode}
            onClick={() => {
              setCapturing((current) => !current);
              setSelectingRefs(false);
              setError(null);
              setSelectionStatus("");
            }}
          >
            {saving ? "saving component…" : capturing ? "cancel capture" : "capture component"}
          </button>
          <button
            type="button"
            className={selectingRefs ? "button select-refs is-active" : "button select-refs"}
            aria-pressed={selectingRefs}
            aria-keyshortcuts="Escape"
            disabled={saving || props.editMode || props.markerMode}
            title={props.codeEntityMap ? "Drag over mapped elements to buffer their references" : "Map code entities first"}
            onClick={() => {
              if (!props.codeEntityMap) {
                setSelectionStatus("map code entities first");
                return;
              }
              setSelectingRefs((current) => !current);
              setCapturing(false);
              setError(null);
              setSelectionStatus("");
            }}
          >{selectingRefs ? "cancel select" : "select refs"}</button>
          <button type="button" className="button create-derivative" disabled={props.editMode} onClick={props.onGenerate}>
            generate →
          </button>
          <button
            type="button"
            className={props.editMode ? "button edit-mode-toggle is-active" : "button edit-mode-toggle"}
            aria-pressed={Boolean(props.editMode)}
            disabled={saving || props.editBusy}
            onClick={() => {
              setCapturing(false);
              setSelectingRefs(false);
              props.onToggleEdit?.();
            }}
          >
            {props.editMode ? "exit edit" : "edit mode"}
          </button>
          <button
            type="button"
            className="button map-code-entities"
            disabled={saving || capturing || selectingRefs || props.editBusy || props.editMode || props.mappingBusy || props.active.codeEntityIds.length === 0}
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
          Drag a rectangle over the ASCII. Releasing saves a child component automatically. Press Escape to cancel.
        </div>
      ) : selectingRefs ? (
        <div className="capture-instructions ref-selection-instructions" role="status">
          Drag over mapped elements to add their references to the buffer. Ctrl/Cmd-drag also works in read mode. Press Escape to cancel.
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
      {selectionStatus ? <div className="ref-selection-status" role="status">{selectionStatus}</div> : null}
      <RefBufferTray
        resolutionContext={props.referenceResolutionContext}
        projectId={props.projectId}
        diagramSetId={props.diagramSetId}
        sourceArtifactId={props.active.id}
        onInsertTokens={props.onInsertReferenceTokens}
        previewEntries={capturing ? [] : liveReferences}
        showWhenEmpty={selectingRefs || (!capturing && liveSelection !== null)}
        sourceDiagram={callGraphFocusSource}
        onOpenCallGraphFocus={callGraphFocusSource ? props.onOpenCallGraphFocus : undefined}
        callGraphFocusReferenceKeys={callGraphFocusSource ? mappedReferenceKeys : undefined}
      />
      <div className={gridMode === "read" ? "ascii-stage" : "ascii-stage is-capturing"}>
        {props.editMode && !props.markerMode ? (
          <textarea
            className="ascii-editor"
            value={draftAscii}
            disabled={props.editBusy}
            aria-label="ASCII diagram editor"
            wrap="off"
            spellCheck={false}
            onChange={(event) => setDraftAscii(event.target.value)}
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
          <AsciiSelectionGrid
            ascii={props.active.ascii}
            mode={gridMode}
            mappings={mappings}
            entities={props.codeEntities}
            previewMappingIds={previewMappingIds}
            bufferedReferenceKeys={bufferedReferenceKeys}
            overlayReferences={overlayReferences}
            onLiveSelection={setLiveSelection}
            onSelectionComplete={completeSelection}
            onCancelMode={(mode) => {
              setCapturing(false);
              setSelectingRefs(false);
              setLiveSelection(null);
              setSelectionStatus(mode === "select-refs" ? "selection cancelled" : "");
            }}
            onReveal={props.onRevealCodeEntity}
            onMarker={props.onMarker}
          />
        )}
      </div>
      {error ? <p className="capture-error" role="alert">{error}</p> : null}
      {props.mappingError ? <p className="capture-error" role="alert">{props.mappingError}</p> : null}
      <footer className="diagram-meta">
        <code>@{props.artifactKind === "diagram" ? "diagram" : "component"}/{props.active.handle}</code>
        {props.artifactKind === "diagram" ? <span>[{(props.active as DiagramRecord).viewKind.toUpperCase()}]</span> : null}
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
