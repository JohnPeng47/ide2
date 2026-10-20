import { useEffect, useRef, useState } from 'react';

/** Keep the selected DOM intact while tokens arrive; release it when selection ends. */
export function useSelectableStream(text: string, streaming: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [held, setHeld] = useState(false);
  const [display, setDisplay] = useState({ text, streaming });
  if (!held && (display.text !== text || display.streaming !== streaming)) setDisplay({ text, streaming });

  useEffect(() => {
    if (!streaming && !held) return;
    const selected = () => {
      const selection = window.getSelection();
      return !!selection && !selection.isCollapsed && !!root.current
        && Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
          .some(range => range.intersectsNode(root.current!));
    };
    const changed = () => setHeld(dragging.current || selected());
    const released = () => { dragging.current = false; changed(); };
    document.addEventListener('selectionchange', changed);
    window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', released);
    window.addEventListener('blur', released);
    return () => {
      document.removeEventListener('selectionchange', changed);
      window.removeEventListener('pointerup', released);
      window.removeEventListener('pointercancel', released);
      window.removeEventListener('blur', released);
    };
  }, [streaming, held]);

  return { root, ...display, onPointerDown: () => {
    if (streaming) { dragging.current = true; setHeld(true); }
  } };
}
