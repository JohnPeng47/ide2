import { useEffect, useRef, useState } from "react";
import type { DiagramSetRecord } from "../domain";

export function DiagramSetPicker(props: {
  diagramSets: DiagramSetRecord[];
  activeSetId: string;
  onSelect: (setId: string) => void;
  onDelete: (setId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = props.diagramSets.find((set) => set.id === props.activeSetId)
    ?? props.diagramSets[0];

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, []);

  const remove = async (set: DiagramSetRecord) => {
    const confirmed = window.confirm(
      `Delete Diagram Set “${set.name}”?\n\nIts files will be moved to .diagrams/trash and can be manually recovered.`
    );
    if (!confirmed) return;
    setDeletingId(set.id);
    setError(null);
    try {
      await props.onDelete(set.id);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Diagram Set deletion failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="set-picker" ref={rootRef}>
      <span className="set-picker__label">DIAGRAM SET</span>
      <div className="set-picker__control">
        <button
          type="button"
          className="set-picker__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setError(null);
          }}
        >
          <span>{active
            ? `${active.name}${active.readiness === "failed" ? " — FAILED" : ""}`
            : "Choose a Diagram Set"}</span>
          <i aria-hidden="true">{open ? "▴" : "▾"}</i>
        </button>
        {open ? (
          <div className="set-picker__menu" role="listbox" aria-label="Diagram Sets">
            {props.diagramSets.map((set) => (
              <div
                className={set.id === props.activeSetId ? "set-picker__option is-active" : "set-picker__option"}
                role="option"
                aria-selected={set.id === props.activeSetId}
                key={set.id}
              >
                <button type="button" className="set-picker__select" onClick={() => {
                  props.onSelect(set.id);
                  setOpen(false);
                }}>{set.name}{set.readiness === "failed" ? " — FAILED" : ""}</button>
                <button
                  type="button"
                  className="set-picker__delete"
                  aria-label={`Delete Diagram Set ${set.name}`}
                  title={`Delete ${set.name}`}
                  disabled={deletingId !== null || set.readiness === "collecting"}
                  onClick={() => void remove(set)}
                >{deletingId === set.id ? "[…]" : "[x]"}</button>
              </div>
            ))}
            {error ? <p className="set-picker__error" role="alert">{error}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
