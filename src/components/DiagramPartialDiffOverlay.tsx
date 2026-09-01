import { useEffect, useMemo, useRef, useState } from "react";
import type { PartialDiffDefinition } from "../partialDiff";

export interface DiagramCellMetrics {
  width: number;
  height: number;
}

export interface DiagramPixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function diagramPixelRect(
  diff: PartialDiffDefinition,
  cell: DiagramCellMetrics
): DiagramPixelRect {
  return {
    x: (diff.region.startColumn - 1) * cell.width,
    y: (diff.region.startLine - 1) * cell.height,
    width: (diff.region.endColumn - diff.region.startColumn + 1) * cell.width,
    height: (diff.region.endLine - diff.region.startLine + 1) * cell.height
  };
}

export function DiagramPartialDiffOverlay(props: {
  diff: PartialDiffDefinition;
  cell: DiagramCellMetrics;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rect = diagramPixelRect(props.diff, props.cell);
  const asciiSize = useMemo(() => {
    const lines = props.diff.expandedAscii.split("\n");
    return {
      columns: Math.max(...lines.map((line) => line.length)),
      lines: lines.length
    };
  }, [props.diff.expandedAscii]);
  const modalSide = Math.max(
    rect.width,
    (asciiSize.columns + props.diff.padding.columns * 2) * props.cell.width,
    (asciiSize.lines + props.diff.padding.lines * 2 + 2) * props.cell.height
  );

  useEffect(() => {
    setOpen(false);
  }, [props.diff.id]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="partial-diff-layer" data-partial-diff-id={props.diff.id}>
      <div
        className="partial-diff-region"
        data-partial-diff-region="true"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      />
      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          className="partial-diff-trigger"
          style={{ left: rect.x, top: rect.y }}
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-controls={`${props.diff.id}-dialog`}
          title={props.diff.label}
          onClick={() => setOpen(true)}
        >[diff ↗]</button>
      ) : (
        <section
          id={`${props.diff.id}-dialog`}
          className="partial-diff-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={props.diff.label}
          style={{ left: rect.x, top: rect.y, width: modalSide, height: modalSide }}
        >
          <header>
            <span>SEMANTIC OWNERSHIP-TRANSFER DIFF</span>
            <button
              ref={closeRef}
              type="button"
              aria-label="Close semantic diff"
              onClick={() => {
                setOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
            >[close]</button>
          </header>
          <div className="partial-diff-dialog__body">
            <pre style={{
              padding: `${props.diff.padding.lines * props.cell.height}px ${props.diff.padding.columns * props.cell.width}px`
            }}>{props.diff.expandedAscii}</pre>
          </div>
        </section>
      )}
    </div>
  );
}
