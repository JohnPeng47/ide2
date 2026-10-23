import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Keep whole-diagram actions in the viewport, independent of page pan and zoom. */
export function CanvasSelectionActions(props: {
  stageRef: RefObject<HTMLDivElement | null>;
  count: number;
  open: boolean;
  disabled: boolean;
  onToggle(): void;
  onGenerate(): void;
  onDelete(): void;
}) {
  const [viewport, setViewport] = useState<Element | null>(null);
  useLayoutEffect(() => { setViewport(props.stageRef.current?.closest('[data-diagram-canvas]') ?? null); }, [props.stageRef]);
  if (!viewport) return null;
  return createPortal(<div className="mapping-whole-actions" data-mapping-static-ui data-diagram-canvas-static-ui>
    <button type="button" aria-haspopup="menu" aria-expanded={props.open} onClick={props.onToggle}>Actions (A)</button>
    {props.open && <div role="menu" aria-label="Selection actions">
      <button type="button" role="menuitem" onClick={props.onGenerate}>LLM [Ctrl+B, L]</button>
      <button type="button" role="menuitem" disabled={props.disabled} onClick={props.onDelete}>
        Delete {props.count === 1 ? 'diagram' : 'diagrams'}
      </button>
    </div>}
  </div>, viewport);
}
