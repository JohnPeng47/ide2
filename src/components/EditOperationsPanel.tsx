import { useRef } from "react";
import { EDIT_MODELS, type EditModelId, type EditSessionRecord } from "../domain";

export function EditOperationsPanel(props: {
  session: EditSessionRecord;
  prompt: string;
  modelId: EditModelId;
  markerMode: boolean;
  busy: boolean;
  progress: string;
  error: string | null;
  onPrompt: (value: string) => void;
  onModel: (value: EditModelId) => void;
  onMarkerMode: (value: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onLlmEdit: () => void;
  onFinish: () => void;
  onDiscard: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const applied = props.session.operations.slice(0, props.session.operationCursor);
  const undone = props.session.operations.slice(props.session.operationCursor);

  return (
    <div
      className="edit-operations-panel"
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey) || (event.target as HTMLElement).closest("#edit-prompt")) return;
        if (event.key.toLowerCase() === "z" && !event.shiftKey) {
          event.preventDefault();
          props.onUndo();
        } else if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) {
          event.preventDefault();
          props.onRedo();
        }
      }}
    >
      <header className="pane-header edit-operations-header">
        <div>
          <span className="eyebrow">EDIT SESSION</span>
          <h2>Operations buffer</h2>
        </div>
        <span className="edit-revision">REV {props.session.revision}</span>
      </header>

      <section className="edit-tools" aria-label="Edit tools">
        <div className="edit-history-actions">
          <button
            type="button"
            className="button"
            disabled={props.busy || props.session.operationCursor === 0}
            onClick={props.onUndo}
            title="Undo (Ctrl+Z)"
          >undo</button>
          <button
            type="button"
            className="button"
            disabled={props.busy || props.session.operationCursor === props.session.operations.length}
            onClick={props.onRedo}
            title="Redo (Ctrl+Y)"
          >redo</button>
          <button
            type="button"
            className={props.markerMode ? "button marker-tool is-active" : "button marker-tool"}
            disabled={props.busy}
            aria-pressed={props.markerMode}
            onClick={() => props.onMarkerMode(!props.markerMode)}
          >{props.markerMode ? "cancel marker" : "single marker"}</button>
        </div>
        <p className="field-help">Manual typing is recorded continuously. Select Single Marker, then click one character in the diagram.</p>
      </section>

      <section className="edit-prompt prompt-field">
        <div className="edit-prompt-heading">
          <label htmlFor="edit-prompt">LLM EDIT INSTRUCTION</label>
          <label className="edit-model-field" htmlFor="edit-model">
            <span>MODEL</span>
            <select
              id="edit-model"
              value={props.modelId}
              disabled={props.busy}
              onChange={(event) => props.onModel(event.target.value as EditModelId)}
            >
              {EDIT_MODELS.map((model) => (
                <option value={model.id} key={model.id}>{model.label}</option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          ref={textareaRef}
          id="edit-prompt"
          value={props.prompt}
          disabled={props.busy}
          placeholder="Describe the next change. Marker refs such as @^ identify exact characters…"
          spellCheck={false}
          onChange={(event) => props.onPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              props.onLlmEdit();
            }
          }}
        />
        <p className="field-help">The complete current artifact is always included. Ctrl+Enter submits.</p>
        <button
          type="button"
          className="button button--primary edit-submit"
          disabled={props.busy || !props.prompt.trim()}
          onClick={props.onLlmEdit}
        >{props.busy ? "editing…" : "apply LLM edit →"}</button>
      </section>

      <section className="operation-buffer" aria-label="Operation history">
        <div className="operation-buffer-title">
          <span className="eyebrow">BUFFER</span>
          <span>{applied.length} APPLIED · {undone.length} REDOABLE</span>
        </div>
        {props.session.operations.length ? (
          <ol>
            {props.session.operations.map((operation, index) => (
              <li
                className={index < props.session.operationCursor ? "is-applied" : "is-undone"}
                key={operation.id}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{operation.subtype === "marker" ? "MARKER" : operation.kind.toUpperCase()}</strong>
                  {operation.modelId ? <small>{operation.modelId}</small> : null}
                  <p>{operation.label}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="operation-empty">No operations yet.</p>}
      </section>

      {props.progress ? <p className="run-progress" aria-live="polite"><span />{props.progress}</p> : null}
      {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}
      <footer className="edit-session-actions">
        <button type="button" className="button" disabled={props.busy} onClick={props.onDiscard}>discard</button>
        <button
          type="button"
          className="button button--primary"
          disabled={props.busy || props.session.operationCursor === 0}
          onClick={props.onFinish}
        >save copy →</button>
      </footer>
    </div>
  );
}
