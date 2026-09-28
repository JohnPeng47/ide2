import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { selectsDiagramVertices, type SelectionBounds } from '../../../../domain/mapping/selection/diagramPlacementSelection';

export function DiagramSelectionLayer(props: { stageRef: RefObject<HTMLDivElement | null>; active: boolean;
  diagramIds: string[]; selected: string[]; onSelect: (ids: string[]) => void }) {
  const current = useRef(props); current.current = props;
  const [rect, setRect] = useState<SelectionBounds>();
  useEffect(() => {
    const stage = props.stageRef.current, viewport = stage?.closest<HTMLElement>('[data-diagram-canvas]');
    if (!viewport || !props.active) { setRect(undefined); return; }
    let drag: { x: number; y: number; pointerId: number; prior: string[]; additive: boolean } | undefined;
    const boxes = () => [...stage!.querySelectorAll<HTMLElement>('[data-grid-box]')]
      .filter(el => current.current.diagramIds.includes(`grid:${el.dataset.gridBox}`))
      .map(el => ({ id: `grid:${el.dataset.gridBox}`, bounds: el.getBoundingClientRect() }));
    const ui = (event: Event) => (event.target as Element).closest('button, a, input, textarea, select, [contenteditable=true], [data-mapping-static-ui], [data-diagram-canvas-static-ui]');
    const hit = (event: MouseEvent) => boxes().find(({ bounds: r }) => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom);
    const doubleClick = (event: MouseEvent) => {
      // Panning captures the pointer on the viewport, so dblclick.target can be
      // the viewport even when both presses hit a source node.
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (ui(event) || event.button !== 0 || (!(event.ctrlKey || event.metaKey) && target?.closest('[data-content-node-id]'))) return;
      const box = hit(event); if (!box) return;
      event.preventDefault(); event.stopPropagation(); window.getSelection()?.removeAllRanges();
      const selected = current.current.selected;
      current.current.onSelect(event.ctrlKey || event.metaKey
        ? selected.includes(box.id) ? selected.filter(id => id !== box.id) : [...selected, box.id] : [box.id]);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || ui(event)) return;
      if (!event.shiftKey) { if (!hit(event) && !event.ctrlKey && !event.metaKey) current.current.onSelect([]); return; }
      event.preventDefault(); event.stopPropagation();
      drag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, prior: [...current.current.selected], additive: event.ctrlKey || event.metaKey };
      viewport.setPointerCapture(event.pointerId);
      setRect({ left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY });
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const bounds = { left: Math.min(drag.x, event.clientX), top: Math.min(drag.y, event.clientY), right: Math.max(drag.x, event.clientX), bottom: Math.max(drag.y, event.clientY) };
      setRect(bounds);
      current.current.onSelect([...new Set([...(drag.additive ? drag.prior : []), ...boxes().filter(box => selectsDiagramVertices(box.bounds, bounds)).map(box => box.id)])]);
    };
    const up = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      move(event); drag = undefined; setRect(undefined);
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    };
    const cancel = () => { if (drag) { current.current.onSelect(drag.prior); drag = undefined; } setRect(undefined); };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || ui(event) || event.key !== 'Escape') return;
      // Completed selection and panel dismissal share the canvas Escape handler.
      if (drag) { event.preventDefault(); cancel(); }
    };
    viewport.addEventListener('dblclick', doubleClick, true);
    viewport.addEventListener('pointerdown', down, true);
    viewport.addEventListener('pointermove', move, true);
    viewport.addEventListener('pointerup', up, true);
    viewport.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key);
    return () => {
      viewport.removeEventListener('dblclick', doubleClick, true); viewport.removeEventListener('pointerdown', down, true);
      viewport.removeEventListener('pointermove', move, true); viewport.removeEventListener('pointerup', up, true);
      viewport.removeEventListener('pointercancel', cancel, true); window.removeEventListener('keydown', key);
    };
  }, [props.stageRef, props.active]);
  return rect ? createPortal(<div className="diagram-selection-marquee" aria-hidden="true" style={{ left: rect.left, top: rect.top,
    width: rect.right - rect.left, height: rect.bottom - rect.top }} />, document.body) : null;
}
