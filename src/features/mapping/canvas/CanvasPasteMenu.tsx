import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { GridPoint } from '../../../../domain/core/diagrams/lineGrid';

type Menu = { x: number; y: number; point: GridPoint; pending: boolean; error?: string; manual: boolean; text: string };

/** Transient UI only; insertion and undo remain owned by the diagram document. */
export function CanvasPasteMenu(props: {
  stageRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  busy: boolean;
  toGrid: (x: number, y: number) => GridPoint | null;
  onPaste: (point: GridPoint, text: string) => void;
  selectionCount?: number;
  onTransfer?: (mode: 'copy' | 'move') => void;
  onCancelSelection?: () => void;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const request = useRef(0);
  const pending = useRef(false);
  const dismiss = () => { request.current++; pending.current = false; setMenu(null); };

  useEffect(() => {
    if (!props.active || props.busy) { dismiss(); return; }
    const viewport = props.stageRef.current?.closest('[data-diagram-canvas]');
    if (!viewport) return;
    const open = (event: Event) => {
      if (!current.current.active || current.current.busy) return;
      const mouse = event as MouseEvent;
      if ((mouse.target as Element).closest('button, a, input, textarea, select, [contenteditable="true"], [data-diagram-canvas-static-ui], [data-mapping-static-ui], .mapping-floating-pane')) return;
      const point = current.current.toGrid(mouse.clientX, mouse.clientY);
      if (!point) return;
      mouse.preventDefault();
      dismiss();
      setMenu({ x: mouse.clientX, y: mouse.clientY, point, pending: false, manual: false, text: '' });
    };
    viewport.addEventListener('contextmenu', open);
    return () => { viewport.removeEventListener('contextmenu', open); request.current++; pending.current = false; };
  }, [props.active, props.busy, props.stageRef]);

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) dismiss(); };
    const wheel = (event: WheelEvent) => { if (!menuRef.current?.contains(event.target as Node)) dismiss(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); current.current.onCancelSelection?.(); }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('wheel', wheel);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('wheel', wheel);
    };
  }, [Boolean(menu)]);

  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLElement>(menu.manual ? 'textarea' : 'button')?.focus();
  }, [Boolean(menu), menu?.manual]);

  if (!menu) return null;
  const paste = async (manual = false) => {
    if (pending.current) return;
    pending.current = true;
    const token = ++request.current;
    setMenu(value => value && { ...value, pending: true, error: undefined });
    try {
      if (!manual && !navigator.clipboard?.readText) throw new Error('Clipboard is unavailable. Paste your diagram below.');
      const text = manual ? menu.text : await navigator.clipboard.readText().catch(() => { throw new Error('Clipboard access failed. Paste your diagram below.'); });
      if (token !== request.current || !current.current.active || current.current.busy) return;
      current.current.onPaste(menu.point, text);
      dismiss();
    } catch (error) {
      if (token !== request.current) return;
      setMenu(value => value && { ...value, pending: false, manual: true,
        error: error instanceof Error ? error.message : 'Could not paste diagram.' });
    } finally { if (token === request.current) pending.current = false; }
  };
  return createPortal(
    <div ref={menuRef} className="canvas-paste-menu" role={menu.manual ? 'dialog' : 'menu'} aria-label="Canvas actions"
      data-diagram-canvas-static-ui data-mapping-static-ui
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 328)), top: Math.max(8, Math.min(menu.y, window.innerHeight - (menu.manual ? 350 : props.selectionCount ? 175 : 100))) }}
      onContextMenu={event => {
        if (!(event.target as Element).closest('input, textarea, [contenteditable="true"]')) event.preventDefault();
      }}>
      {props.selectionCount && props.onTransfer ? <>
        <span>{props.selectionCount} diagrams selected</span>
        <button role="menuitem" onClick={() => { dismiss(); props.onTransfer?.('copy'); }}>Copy to canvas…</button>
        <button role="menuitem" onClick={() => { dismiss(); props.onTransfer?.('move'); }}>Move to canvas…</button>
      </> : menu.manual ? <form onSubmit={event => { event.preventDefault(); void paste(true); }}>
        <label>Paste ASCII diagram<textarea aria-label="ASCII diagram" rows={6} value={menu.text}
          onChange={event => setMenu(value => value && { ...value, text: event.target.value })} /></label>
        <button type="submit" disabled={menu.pending || !menu.text.trim()}>Paste sub-diagram here</button>
      </form> : <button role="menuitem" disabled={menu.pending} onClick={() => void paste()}>
        {menu.pending ? 'Reading clipboard…' : 'Paste sub-diagram here'}
      </button>}
      <button type="button" role={menu.manual ? undefined : 'menuitem'} aria-keyshortcuts="Escape"
        onClick={() => { dismiss(); props.onCancelSelection?.(); }}>Esc</button>
      {menu.error && <p role="alert">{menu.error}</p>}
    </div>, document.body
  );
}
