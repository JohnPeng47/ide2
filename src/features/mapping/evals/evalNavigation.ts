import { useEffect, useRef } from 'react';

/**
 * Capture before canvas panning, while leaving editing and widget keys alone.
 * Plain ←/→ walk the experiment tree; Shift+←/→ step through pages inside one item; Alt gestures belong to browser visit history.
 */
export function useArrowNavigation(move: (direction: number) => void, enabled = true,
  { shift = false }: { shift?: boolean } = {}) {
  const latest = useRef(move); latest.current = move;
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey !== shift || event.isComposing || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="tree"], [role="textbox"], [role="separator"], [role="slider"], [role="menu"], [role="listbox"], [role="combobox"], [data-output-canvas-navigation], .evals-drawer')) return;
      event.preventDefault(); event.stopPropagation(); latest.current(event.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [enabled, shift]);
}
