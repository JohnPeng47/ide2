import { useRef, type RefObject } from 'react';
import { saveWindowPanelSize } from './windowPanelSize';

type Edge = 'left' | 'bottom' | 'corner';

/** Resize the right-anchored overlay without rerendering its transcript on every pointer move. */
export function TabbedPanelResize({ panel, sizeStorageKey }: { panel: RefObject<HTMLElement | null>; sizeStorageKey?: string }) {
  const drag = useRef<{ pointerId: number; x: number; y: number; width: number; height: number } | null>(null);
  const save = () => {
    const element = panel.current;
    if (!element) return;
    // Inline dimensions retain the preferred size even when CSS clamps the other axis.
    saveWindowPanelSize(sizeStorageKey, 'pixels', {
      width: parseFloat(element.style.width) || undefined,
      height: parseFloat(element.style.height) || undefined,
    });
  };
  const finish = () => { if (drag.current) { drag.current = null; save(); } };
  const resize = (edge: Edge, width: number, height: number) => {
    const element = panel.current;
    if (!element) return;
    const rect = element.getBoundingClientRect(), area = element.parentElement!.getBoundingClientRect();
    const style = getComputedStyle(element);
    // CSS also clamps to the available workspace when the viewport changes.
    if (edge !== 'bottom') element.style.width = `${Math.max(parseFloat(style.minWidth), Math.min(rect.right - area.left - 16, width))}px`;
    if (edge !== 'left') element.style.height = `${Math.max(parseFloat(style.minHeight), Math.min(area.bottom - rect.top - 16, height))}px`;
  };
  return (['left', 'bottom', 'corner'] as const).map(edge => <div key={edge}
    className={`window-panel-resize window-panel-resize-${edge}`}
    role="separator" aria-label={edge === 'left' ? 'Resize window width' : edge === 'bottom' ? 'Resize window height' : 'Resize window'}
    aria-orientation={edge === 'bottom' ? 'horizontal' : 'vertical'} tabIndex={0}
    title={edge === 'corner' ? 'Drag to resize · use arrow keys when focused' : `Drag to resize ${edge === 'left' ? 'width' : 'height'}`}
    onKeyDown={event => {
      const horizontal = edge !== 'bottom' && ['ArrowLeft', 'ArrowRight'].includes(event.key);
      const vertical = edge !== 'left' && ['ArrowUp', 'ArrowDown'].includes(event.key);
      if (!horizontal && !vertical) return;
      event.preventDefault(); event.stopPropagation();
      const rect = panel.current!.getBoundingClientRect();
      resize(edge, rect.width + (horizontal ? event.key === 'ArrowLeft' ? 24 : -24 : 0),
        rect.height + (vertical ? event.key === 'ArrowDown' ? 24 : -24 : 0));
      save();
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      const rect = panel.current!.getBoundingClientRect();
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      resize(edge, start.width + start.x - event.clientX, start.height + event.clientY - start.y);
    }}
    onPointerUp={event => {
      finish();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={finish} onLostPointerCapture={finish}
  />);
}
