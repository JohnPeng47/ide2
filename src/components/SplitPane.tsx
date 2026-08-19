import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "new-diagram:split-percent";
const DEFAULT_PERCENT = 62;
const MIN_PERCENT = 28;
const MAX_PERCENT = 76;

function clamp(value: number): number {
  return Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, value));
}

export function SplitPane(props: { left: ReactNode; right: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [percent, setPercent] = useState(() => {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : DEFAULT_PERCENT;
  });
  const [dragging, setDragging] = useState(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const root = rootRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    setPercent(clamp(((clientX - bounds.left) / bounds.width) * 100));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, percent.toFixed(2));
  }, [percent]);

  return (
    <div
      ref={rootRef}
      className={dragging ? "split-pane is-dragging" : "split-pane"}
      style={{ ["--left-pane" as string]: `${percent}%` }}
    >
      <section className="split-pane__left">{props.left}</section>
      <div
        className="split-pane__divider"
        role="separator"
        aria-label="Resize diagram and code entity panes"
        aria-orientation="vertical"
        aria-valuemin={MIN_PERCENT}
        aria-valuemax={MAX_PERCENT}
        aria-valuenow={Math.round(percent)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          updateFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging && event.buttons === 1) updateFromClientX(event.clientX);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setPercent((current) => clamp(current - 2));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setPercent((current) => clamp(current + 2));
          } else if (event.key === "Home") {
            event.preventDefault();
            setPercent(MIN_PERCENT);
          } else if (event.key === "End") {
            event.preventDefault();
            setPercent(MAX_PERCENT);
          }
        }}
      >
        <span aria-hidden="true" />
      </div>
      <aside className="split-pane__right">{props.right}</aside>
    </div>
  );
}
