import {
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import type { DiagramCandidateBatchRecord, DiagramRecord } from "../../../../domain/core/records/domain";

export function DiagramCandidateFeedbackDialog(props: {
  batch: DiagramCandidateBatchRecord;
  diagrams: Record<string, DiagramRecord>;
  batchLabel: string;
  onClose: () => void;
  onSave: (rankings: Array<{ diagramId: string; rank: number }>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    props.batch.diagramIds.map((diagramId) => [
      diagramId,
      props.batch.rankings[diagramId]?.toString() ?? ""
    ])
  ));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) props.onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props.onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const rankings: Array<{ diagramId: string; rank: number }> = [];
    for (const diagramId of props.batch.diagramIds) {
      const rank = Number(values[diagramId]);
      if (!Number.isInteger(rank) || rank < 1) {
        setError("Enter a positive whole-number rank for every candidate.");
        return;
      }
      rankings.push({ diagramId, rank });
    }
    setSaving(true);
    setError(null);
    try {
      await props.onSave(rankings);
      props.onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Candidate feedback could not be saved");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="candidate-feedback-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) props.onClose();
      }}
    >
      <form
        className="candidate-feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-feedback-title"
        data-candidate-batch-id={props.batch.id}
        onSubmit={(event) => void submit(event)}
      >
        <header>
          <div>
            <span className="eyebrow">DIAGRAM FEEDBACK · {props.batchLabel}</span>
            <h2 id="candidate-feedback-title">Rank diagram candidates</h2>
            <p>1 is best. Equal ranks are allowed.</p>
          </div>
          <button type="button" disabled={saving} onClick={props.onClose}>close</button>
        </header>
        <div className="candidate-feedback-list">
          {props.batch.diagramIds.map((diagramId, index) => {
            const diagram = props.diagrams[diagramId];
            return (
              <label key={diagramId}>
                <span className="candidate-feedback-name">
                  <strong>{String(index + 1).padStart(2, "0")}</strong>
                  <span>{diagram?.name ?? diagramId}</span>
                  {diagram?.archivedAt ? <em>ARCHIVED</em> : null}
                </span>
                <input
                  ref={index === 0 ? firstInput : undefined}
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  aria-label={`Rank for ${diagram?.name ?? diagramId}`}
                  value={values[diagramId] ?? ""}
                  disabled={saving}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [diagramId]: event.target.value
                  }))}
                />
              </label>
            );
          })}
        </div>
        {error ? <p className="candidate-feedback-error" role="alert">{error}</p> : null}
        <footer>
          <span>{props.batch.diagramIds.length} candidates</span>
          <button type="button" disabled={saving} onClick={props.onClose}>cancel</button>
          <button type="submit" disabled={saving}>{saving ? "saving…" : "save feedback"}</button>
        </footer>
      </form>
    </div>
  );
}
