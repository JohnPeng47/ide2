import { useRef, type HTMLAttributes } from 'react';

/** Keep symbol clicks separate from canvas drags and modified selection gestures. */
export function useDiagramSymbolSearch(enabled: boolean, search: (text: string) => void): HTMLAttributes<HTMLDivElement> {
  const pressed = useRef<{ text: string; x: number; y: number } | undefined>(undefined);
  return {
    onPointerDownCapture(event) {
      pressed.current = undefined;
      if (!enabled || event.button !== 0 || event.pointerType !== 'mouse'
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const token = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-diagram-symbol]') : null;
      if (!token || !['type', 'variable', 'function'].includes(token.dataset.syntaxKind ?? '')) return;
      const row = token.closest('.mapping-poc-ascii .ascii-line');
      if (!row) return;
      // Mappings can split a single identifier into several rendered spans.
      const before = document.createRange(); before.selectNodeContents(row); before.setEndBefore(token);
      const text = row.textContent ?? '';
      let start = before.toString().length, end = start + (token.textContent?.length ?? 0);
      while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
      while (end < text.length && /[\w$]/.test(text[end])) end++;
      const word = text.slice(start, end);
      if (/^[A-Za-z_$][\w$]*$/.test(word)) pressed.current = { text: word, x: event.clientX, y: event.clientY };
    },
    onPointerMoveCapture(event) {
      const start = pressed.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) pressed.current = undefined;
    },
    onPointerCancelCapture() { pressed.current = undefined; },
    onClickCapture(event) {
      const start = pressed.current; pressed.current = undefined;
      if (!enabled || !start || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
      event.preventDefault(); event.stopPropagation();
      search(start.text);
    },
  };
}
