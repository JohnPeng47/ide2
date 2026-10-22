import { useEffect, useMemo, useRef, useState } from 'react';

/** Keep selected DOM intact while its content changes, including async highlighting. */
export function useSelectableContent<T>(value: T) {
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [held, setHeld] = useState(false);
  const [display, setDisplay] = useState(() => value);
  if (!held && display !== value) setDisplay(() => value);

  useEffect(() => {
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
  }, []);

  return { root, value: display, onPointerDown: () => {
    dragging.current = true; setHeld(true);
  } };
}

export function useSelectableStream(text: string, streaming: boolean) {
  const content = useSelectableContent(useMemo(() => ({ text, streaming }), [text, streaming]));
  return { ...content, ...content.value };
}
