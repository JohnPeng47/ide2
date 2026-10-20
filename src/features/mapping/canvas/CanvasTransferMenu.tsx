import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Menu = { x: number; y: number };

/** Context actions for selected diagrams. */
export function CanvasTransferMenu(props: {
  stageRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  busy: boolean;
  selectionCount?: number;
  onTransfer?: (mode: 'copy' | 'move') => void;
  onCancelSelection?: () => void;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const dismiss = () => setMenu(null);

  useEffect(() => {
    if (!props.active || props.busy || !props.selectionCount || !props.onTransfer) { dismiss(); return; }
    const viewport = props.stageRef.current?.closest('[data-diagram-canvas]');
    if (!viewport) return;
    const open = (event: Event) => {
      if (!current.current.active || current.current.busy) return;
      const mouse = event as MouseEvent;
      if ((mouse.target as Element).closest('button, a, input, textarea, select, [contenteditable="true"], [data-diagram-canvas-static-ui], [data-mapping-static-ui], .mapping-floating-pane')) return;
      if (!current.current.selectionCount || !current.current.onTransfer) return;
      mouse.preventDefault();
      dismiss();
      setMenu({ x: mouse.clientX, y: mouse.clientY });
    };
    viewport.addEventListener('contextmenu', open);
    return () => { viewport.removeEventListener('contextmenu', open); };
  }, [props.active, props.busy, props.stageRef, props.selectionCount, props.onTransfer]);

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
    if (menu) menuRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [Boolean(menu)]);

  if (!menu) return null;
  return createPortal(
    <div ref={menuRef} className="canvas-transfer-menu" role="menu" aria-label="Canvas actions"
      data-diagram-canvas-static-ui data-mapping-static-ui
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 328)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 175)) }}
      onContextMenu={event => {
        if (!(event.target as Element).closest('input, textarea, [contenteditable="true"]')) event.preventDefault();
      }}>
      <span>{props.selectionCount} diagrams selected</span>
      <button role="menuitem" onClick={() => { dismiss(); props.onTransfer?.('copy'); }}>Copy to canvas…</button>
      <button role="menuitem" onClick={() => { dismiss(); props.onTransfer?.('move'); }}>Move to canvas…</button>
      <button type="button" role="menuitem" aria-keyshortcuts="Escape"
        onClick={() => { dismiss(); props.onCancelSelection?.(); }}>Esc</button>
    </div>, document.body
  );
}
