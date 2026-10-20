import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import type { CanvasSession } from '../workspace/canvasSession';
import type { GridPoint } from '../../../../domain/core/diagrams/lineGrid';
import './cursorCopy.css';

const typing = (target: EventTarget | null) => target instanceof HTMLElement
  && (!!target.closest('input,textarea,select') || target.isContentEditable);
const controls = 'button,a,input,textarea,select,[contenteditable=true],[data-mapping-static-ui],.window-panel,[data-display-node]';

/** Screen pointer tracking stays outside React and is converted at paste time, after camera changes. */
export function CursorCopyOverlay({ session, stage, active, disabled, pointAtClient }: {
  session: CanvasSession; stage: RefObject<HTMLDivElement | null>; active: boolean; disabled: boolean;
  pointAtClient: (x: number, y: number) => GridPoint | null;
}) {
  const ascii = useStore(session.cursorCopy.store, state => state.ascii);
  const badge = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);
  const feedback = useRef<HTMLSpanElement>(null);
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const latest = useRef({ active, disabled, pointAtClient }); latest.current = { active, disabled, pointAtClient };
  useEffect(() => {
    const root = stage.current?.closest<HTMLElement>('[data-diagram-canvas]') ?? stage.current;
    if (!root) return;
    const hide = () => {
      pointer.current = undefined;
      if (badge.current) badge.current.hidden = true;
      if (halo.current) halo.current.hidden = true;
    };
    const move = (event: PointerEvent) => {
      if (!latest.current.active || !(event.target instanceof Element) || !root.contains(event.target) || event.target.closest(controls)) { hide(); return; }
      pointer.current = { x: event.clientX, y: event.clientY };
      if (halo.current) {
        halo.current.hidden = false;
        halo.current.style.left = `${event.clientX}px`;
        halo.current.style.top = `${event.clientY}px`;
      }
      if (badge.current) {
        badge.current.hidden = false;
        badge.current.style.left = `${Math.max(8, Math.min(event.clientX + 18, window.innerWidth - badge.current.offsetWidth - 8))}px`;
        badge.current.style.top = `${Math.max(8, Math.min(event.clientY + 18, window.innerHeight - badge.current.offsetHeight - 8))}px`;
      }
    };
    const key = (event: KeyboardEvent) => {
      if (!latest.current.active || session.cursorCopy.store.getState().ascii === undefined || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); session.cursorCopy.clear(); return;
      }
      if (event.key.toLowerCase() !== 'v' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || typing(event.target)) return;
      const cursor = pointer.current;
      const target = cursor && document.elementFromPoint(cursor.x, cursor.y);
      if (!cursor || !target || !root.contains(target) || target.closest(controls)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (latest.current.disabled) { if (feedback.current) feedback.current.textContent = 'Canvas busy'; return; }
      const point = latest.current.pointAtClient(cursor.x, cursor.y);
      if (!point) return;
      try {
        session.cursorCopy.paste(session.controller, point);
        if (feedback.current) feedback.current.textContent = 'Pasted · ready for another';
      } catch (error) {
        if (feedback.current) feedback.current.textContent = `Paste failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerout', leave, true);
    window.addEventListener('blur', hide);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerout', leave, true);
      window.removeEventListener('blur', hide); window.removeEventListener('keydown', key, true);
    };
  }, [session, stage]);
  useEffect(() => {
    const root = stage.current?.closest<HTMLElement>('[data-diagram-canvas]') ?? stage.current;
    root?.classList.toggle('is-cursor-copy', active && ascii !== undefined);
    if (feedback.current) feedback.current.textContent = 'Diagram ready';
    return () => root?.classList.remove('is-cursor-copy');
  }, [active, ascii, stage]);
  if (!active || ascii === undefined) return null;
  const lines = ascii.split('\n');
  const preview = lines.slice(0, 6).map(line => line.length > 44 ? `${line.slice(0, 43)}…` : line).join('\n');
  return createPortal(<>
    <div ref={halo} className="canvas-cursor-copy-halo" aria-hidden="true" hidden={!pointer.current}
      style={{ left: pointer.current?.x ?? 0, top: pointer.current?.y ?? 0 }} />
    <div ref={badge} className="canvas-cursor-copy" role="status" hidden={!pointer.current}
    style={{ left: (pointer.current?.x ?? 0) + 18, top: (pointer.current?.y ?? 0) + 18 }}>
      <div className="canvas-cursor-copy__heading">
        <span className="canvas-cursor-copy__icon" aria-hidden="true">+</span>
        <span ref={feedback}>Diagram ready</span>
      </div>
      <pre className="canvas-cursor-copy__preview" aria-hidden="true">{preview}{lines.length > 6 ? '\n…' : ''}</pre>
      <div className="canvas-cursor-copy__keys">Ctrl+V to paste · Esc to cancel</div>
    </div>
  </>, document.body);
}
