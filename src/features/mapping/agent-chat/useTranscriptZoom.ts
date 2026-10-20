import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const storageKey = 'agent-chat-markdown-zoom';
const clamp = (value: number) => Math.round(Math.max(75, Math.min(200, value)));
function readZoom() {
  try {
    const value = Number(localStorage.getItem(storageKey));
    return Number.isFinite(value) && value >= 75 && value <= 200 ? clamp(value) : 100;
  } catch { return 100; }
}

/** Shared by the transcript and prompt, including when the conversation is empty. */
export function useChatZoom() {
  return useState(readZoom);
}

/** A non-passive wheel listener prevents browser/canvas zoom. Only text size changes. */
export function useTranscriptZoom(viewport: RefObject<HTMLDivElement | null>, beforeZoom: () => void, zoom: number, setZoom: (value: number) => void) {
  const current = useRef(zoom), before = useRef(beforeZoom);
  before.current = beforeZoom;
  current.current = zoom;
  const changeZoom = useCallback((value: number) => {
    const next = clamp(value);
    if (next === current.current) return;
    before.current();
    current.current = next;
    setZoom(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Zoom still works without storage. */ }
  }, [setZoom]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0, delta = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      delta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        const next = current.current * Math.exp(-delta / 1000);
        // Preserve sub-percent trackpad movement across frames instead of rounding it away.
        if (clamp(next) !== current.current || next <= 75 || next >= 200) {
          changeZoom(next);
          delta = 0;
        }
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { element.removeEventListener('wheel', wheel); cancelAnimationFrame(frame); };
  }, [viewport, changeZoom]);
  return { zoom, changeZoom };
}
