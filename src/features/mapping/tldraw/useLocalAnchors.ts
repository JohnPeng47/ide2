import { useCallback, useLayoutEffect, useRef } from 'react';
import { endpointKey, type EndpointIdentity } from '../../../../domain/mapping/workspace/endpointGeometry';
import type { CanvasRuntime } from './CanvasRuntimeContext';

/** Read relative to the shape's own DOM origin in one layout pass. Translation
 * cancels out; the camera never invalidates this hook. A culled node has no rect,
 * which means "not measurable", not "this semantic anchor was deleted". */
export function useLocalAnchors(runtime: CanvasRuntime, nodeId: string, layoutKey: string) {
  const elements = useRef(new Map<string, { identity: EndpointIdentity; element: Element }>());
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const measure = useCallback(() => {
    frame.current = undefined;
    for (const { identity, element } of elements.current.values()) {
      const body = element.closest<HTMLElement>('.mapping-native-body');
      if (!body || !element.getClientRects().length) continue;
      const origin = body.getBoundingClientRect(), rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || !origin.width || !body.offsetWidth) continue;
      // offsetWidth rounds fractional CSS widths and introduces endpoint drift.
      const scale = origin.width / parseFloat(getComputedStyle(body).width);
      runtime.anchors.set(identity, layoutKey, { x: (rect.x - origin.x) / scale, y: (rect.y - origin.y) / scale,
        width: rect.width / scale, height: rect.height / scale });
    }
  }, [runtime, nodeId, layoutKey]);
  const schedule = useCallback(() => { if (frame.current === undefined) frame.current = requestAnimationFrame(measure); }, [measure]);
  const registerEndpoint = useCallback((identity: EndpointIdentity, element: Element | null) => {
    const key = endpointKey(identity), previous = elements.current.get(key);
    if (previous?.element === element) return;
    if (previous) observer.current?.unobserve(previous.element);
    if (element) { elements.current.set(key, { identity, element }); observer.current?.observe(element); }
    else elements.current.delete(key);
    schedule();
  }, [schedule]);
  useLayoutEffect(() => {
    observer.current = new ResizeObserver(schedule);
    for (const { element } of elements.current.values()) observer.current.observe(element);
    schedule();
    document.fonts.addEventListener('loadingdone', schedule);
    return () => {
      observer.current?.disconnect(); observer.current = undefined;
      document.fonts.removeEventListener('loadingdone', schedule);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [schedule]);
  return registerEndpoint;
}
