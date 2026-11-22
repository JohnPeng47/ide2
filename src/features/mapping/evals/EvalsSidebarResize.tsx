import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const storageKey = 'evals-nav-width';
const clamp = (width: number) => Math.round(Math.max(200, Math.min(560, width)));

/** Preview width in CSS during a drag; commit React state and storage once on release. */
export function EvalsSidebarResize({ layout }: { layout: RefObject<HTMLDivElement | null> }) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved) : 300;
  });
  const separator = useRef<HTMLDivElement>(null);
  const current = useRef(width), frame = useRef<number | undefined>(undefined);
  const drag = useRef<{ pointerId: number; left: number } | undefined>(undefined);
  const paint = () => {
    frame.current = undefined;
    if (layout.current) layout.current.style.gridTemplateColumns = `${current.current}px 5px minmax(0, 1fr)`;
    separator.current?.setAttribute('aria-valuenow', String(current.current));
  };
  useLayoutEffect(paint, [layout]);
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  const commit = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    paint();
    setWidth(current.current);
    localStorage.setItem(storageKey, String(current.current));
  };
  const resize = (next: number) => { current.current = clamp(next); commit(); };
  const finish = () => {
    if (!drag.current) return;
    drag.current = undefined;
    commit();
  };
  return <div ref={separator} role="separator" aria-label="Resize sidebar" aria-orientation="vertical"
    aria-valuemin={200} aria-valuemax={560} aria-valuenow={width} tabIndex={0}
    className="evals-divider evals-nav-divider" onDoubleClick={() => resize(300)}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      resize(event.key === 'Home' ? 300 : current.current + (event.key === 'ArrowLeft' ? -16 : 16));
    }}
    onPointerDown={event => {
      if (event.button !== 0 || !layout.current) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      drag.current = { pointerId: event.pointerId, left: layout.current.getBoundingClientRect().left };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (drag.current?.pointerId !== event.pointerId) return;
      current.current = clamp(event.clientX - drag.current.left);
      if (frame.current === undefined) frame.current = requestAnimationFrame(paint);
    }}
    onPointerUp={event => {
      if (drag.current?.pointerId !== event.pointerId) return;
      finish();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={finish} onLostPointerCapture={finish} />;
}
