import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasMarqueeSelection, SelectionBounds } from '../../../../domain/mapping/selection/canvasSelection';

/** One gesture owner for region and whole-diagram selection. Preview never writes the document. */
export function CanvasSelectionLayer(props: { stageRef: RefObject<HTMLDivElement | null>; active: boolean;
  diagramIds: string[]; selected: string[];
  resolve: (bounds: SelectionBounds, promoted: string[]) => CanvasMarqueeSelection;
  onComplete: (selection: CanvasMarqueeSelection) => void;
  onSelectDiagram: (id: string, toggle: boolean) => void }) {
  const current = useRef(props); current.current = props;
  const [preview, setPreview] = useState<{ bounds: SelectionBounds; diagrams: SelectionBounds[] }>();
  useEffect(() => {
    const stage = props.stageRef.current, viewport = stage?.closest<HTMLElement>('[data-diagram-canvas]');
    if (!viewport || !props.active) { setPreview(undefined); return; }
    let drag: { x: number; y: number; pointerId: number; moved: boolean; promoted: string[] } | undefined;
    const boxes = () => [...stage!.querySelectorAll<HTMLElement>('[data-grid-box]')]
      .filter(el => current.current.diagramIds.includes(`grid:${el.dataset.gridBox}`))
      .map(el => ({ id: `grid:${el.dataset.gridBox}`, bounds: el.getBoundingClientRect() }));
    const ui = (event: MouseEvent) => {
      const target = event.target as Element;
      if (event.ctrlKey && target.closest('[data-diagram-jump-id]')) return false;
      return !!target.closest('button, a, input, textarea, select, [contenteditable=true], [data-mapping-static-ui], [data-diagram-canvas-static-ui], [data-display-node]');
    };
    const hit = (event: MouseEvent) => boxes().find(({ bounds: r }) => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom);
    const doubleClick = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (ui(event) || event.button !== 0 || (!(event.ctrlKey || event.metaKey) && target?.closest('[data-content-node-id]'))) return;
      const box = hit(event); if (!box) return;
      event.preventDefault(); event.stopPropagation(); window.getSelection()?.removeAllRanges();
      current.current.onSelectDiagram(box.id, event.ctrlKey || event.metaKey);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || ui(event)) return;
      if (!event.ctrlKey || event.metaKey) return;
      event.preventDefault(); event.stopPropagation(); window.getSelection()?.removeAllRanges();
      stage!.focus({ preventScroll: true });
      drag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, moved: false, promoted: [...current.current.selected] };
      viewport.setPointerCapture(event.pointerId);
    };
    const sample = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4;
      const bounds = { left: Math.min(drag.x, event.clientX), top: Math.min(drag.y, event.clientY), right: Math.max(drag.x, event.clientX), bottom: Math.max(drag.y, event.clientY) };
      const selection = current.current.resolve(bounds, drag.promoted);
      // Promotion is sticky until pointer-up, even if the marquee subsequently shrinks.
      drag.promoted = selection.diagramIds;
      setPreview({ bounds, diagrams: boxes().filter(box => selection.diagramIds.includes(box.id)).map(box => box.bounds) });
      return selection;
    };
    const release = () => {
      const pointerId = drag?.pointerId; drag = undefined; setPreview(undefined);
      if (pointerId !== undefined && viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    };
    const up = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const selection = sample(event), moved = drag.moved; release();
      if (moved && selection) current.current.onComplete(selection);
    };
    const key = (event: KeyboardEvent) => {
      if (!drag || event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); release();
    };
    viewport.addEventListener('dblclick', doubleClick, true);
    viewport.addEventListener('pointerdown', down, true);
    viewport.addEventListener('pointermove', sample, true);
    viewport.addEventListener('pointerup', up, true);
    viewport.addEventListener('pointercancel', release, true);
    viewport.addEventListener('lostpointercapture', release, true);
    window.addEventListener('keydown', key, true);
    return () => {
      release();
      viewport.removeEventListener('dblclick', doubleClick, true); viewport.removeEventListener('pointerdown', down, true);
      viewport.removeEventListener('pointermove', sample, true); viewport.removeEventListener('pointerup', up, true);
      viewport.removeEventListener('pointercancel', release, true); viewport.removeEventListener('lostpointercapture', release, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [props.stageRef, props.active]);
  return preview ? createPortal(<>
    <div className="diagram-selection-marquee" data-selection-preview aria-hidden="true" style={{ left: preview.bounds.left, top: preview.bounds.top,
      width: preview.bounds.right - preview.bounds.left, height: preview.bounds.bottom - preview.bounds.top }} />
    {preview.diagrams.map((bounds, i) => <div key={i} className="diagram-selection-marquee" data-diagram-selection-preview aria-hidden="true"
      style={{ left: bounds.left, top: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }} />)}
  </>, document.body) : null;
}
