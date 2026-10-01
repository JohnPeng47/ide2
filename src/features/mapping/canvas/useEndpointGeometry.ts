import { useCallback, useLayoutEffect, useRef } from 'react';
import { endpointKey, type EndpointBounds, type EndpointIdentity, type EndpointRect } from '../../../../domain/mapping/workspace/endpointGeometry';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';

/** DOM measurements and SVG use the same origin/transform, retaining subpixel precision. */
export function measureEndpoint(element: Element, inverse: DOMMatrix): EndpointRect | undefined {
  if (!element.getClientRects().length) return;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const a = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
  const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function useEndpointGeometry(controller: { getSnapshot(): Pick<ReturnType<MappingDocumentController['getSnapshot']>, 'document' | 'canvas' | 'cell'>; configureEndpointBounds(bounds: EndpointBounds): void }, active: boolean) {
  const svgRef = useRef<SVGSVGElement>(null);
  const elements = useRef(new Map<string, Element>());
  const observer = useRef<ResizeObserver | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const activeRef = useRef(active); activeRef.current = active;
  const measure = useCallback(() => {
    frame.current = undefined;
    const svg = svgRef.current;
    if (!activeRef.current || !svg?.getClientRects().length) { controller.configureEndpointBounds({}); return; }
    const matrix = svg.getScreenCTM();
    if (!matrix || !matrix.a || !matrix.d) return;
    const inverse = matrix.inverse();
    const bounds: Record<string, EndpointRect> = {};
    for (const [key, element] of elements.current) {
      const rect = measureEndpoint(element, inverse);
      if (rect) bounds[key] = rect;
    }
    controller.configureEndpointBounds(bounds as EndpointBounds);
  }, [controller]);
  const schedule = useCallback(() => {
    if (frame.current === undefined) frame.current = requestAnimationFrame(measure);
  }, [measure]);
  const registerEndpoint = useCallback((identity: EndpointIdentity, element: Element | null) => {
    const key = endpointKey(identity), previous = elements.current.get(key);
    if (previous === element) return;
    if (previous) observer.current?.unobserve(previous);
    if (element) { elements.current.set(key, element); observer.current?.observe(element); }
    else elements.current.delete(key);
    schedule();
  }, [schedule]);
  const endpointRefs = useRef(new Map<string, (element: Element | null) => void>());
  const refForEndpoint = useCallback((identity: EndpointIdentity) => {
    const key = endpointKey(identity);
    let callback = endpointRefs.current.get(key);
    if (!callback) {
      callback = element => registerEndpoint(identity, element);
      endpointRefs.current.set(key, callback);
    }
    return callback;
  }, [registerEndpoint]);
  useLayoutEffect(() => {
    observer.current = new ResizeObserver(schedule);
    for (const element of elements.current.values()) observer.current.observe(element);
    if (svgRef.current) observer.current.observe(svgRef.current);
    window.addEventListener('resize', schedule);
    document.fonts.addEventListener('loadingdone', schedule);
    return () => {
      observer.current?.disconnect(); observer.current = null;
      window.removeEventListener('resize', schedule);
      document.fonts.removeEventListener('loadingdone', schedule);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [schedule]);
  // Movement/folding can relocate labels without resizing them. Selection controls
  // do neither, so they must not trigger a full-canvas DOM measurement.
  const { document: documentState, canvas, cell } = controller.getSnapshot();
  useLayoutEffect(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    measure();
  }, [measure, active, documentState.scene, canvas.diagramViews, canvas.display, cell]);
  return { svgRef, registerEndpoint, refForEndpoint };
}
