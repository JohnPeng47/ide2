import { useCallback, useLayoutEffect, useRef } from 'react';
import { transact } from 'tldraw';
import { endpointKey, type EndpointIdentity } from '../../../../domain/mapping/workspace/endpointGeometry';
import { diagramRoutingObstacles } from '../../../../domain/mapping/workspace/routingObstacles';
import type { CanvasRuntime } from './CanvasRuntimeContext';

/** Read relative to the shape's own DOM origin in one layout pass. Translation
 * cancels out; the camera never invalidates this hook. A culled node has no rect,
 * which means "not measurable", not "this semantic anchor was deleted". */
export function useLocalAnchors(runtime: CanvasRuntime, nodeId: string, layoutKey: string) {
  const elements = useRef(new Map<string, { identity: EndpointIdentity; element: Element }>());
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const text = useRef<HTMLPreElement | null>(null);
  const measure = useCallback(() => {
    frame.current = undefined;
    transact(() => {
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
      const pre = text.current, body = pre?.closest<HTMLElement>('.mapping-native-body');
      const model = runtime.grids.get(nodeId).get();
      if (!pre || !body || !model?.diagram || model.layoutKey !== layoutKey) return;
      const origin = body.getBoundingClientRect();
      const scale = origin.width / parseFloat(getComputedStyle(body).width);
      if (!Number.isFinite(scale) || scale <= 0) return;
      // Measure every text span, including unparsed notes and tree guides. Using
      // the model's estimated cell here disagrees with measured endpoints once
      // fonts or line heights differ from the default grid.
      const rows = [...pre.querySelectorAll(':scope > .ascii-line')].map(row => {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT), nodes: { node: Node; start: number; end: number }[] = [];
        let node: Node | null, offset = 0;
        while ((node = walker.nextNode())) {
          const end = offset + (node.textContent?.length ?? 0);
          nodes.push({ node, start: offset, end }); offset = end;
        }
        return nodes;
      });
      const round = (value: number) => Math.round(value * 100) / 100;
      const obstacles = diagramRoutingObstacles(nodeId, model.diagram.content, model.view, model.cell, (row, start, end) => {
        const nodes = rows[row], first = nodes?.find(part => part.start <= start && part.end > start);
        const last = nodes?.find(part => part.start < end && part.end >= end);
        if (!first || !last) return;
        const range = document.createRange();
        range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        return { x: round((rect.x - origin.x) / scale), y: round((rect.y - origin.y) / scale),
          width: round(rect.width / scale), height: round(rect.height / scale) };
      });
      runtime.routing.setMeasurements(nodeId, layoutKey, obstacles);
    });
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
  const registerText = useCallback((element: HTMLPreElement | null) => {
    if (text.current) observer.current?.unobserve(text.current);
    text.current = element;
    if (element) observer.current?.observe(element);
    schedule();
  }, [schedule]);
  useLayoutEffect(() => {
    observer.current = new ResizeObserver(schedule);
    for (const { element } of elements.current.values()) observer.current.observe(element);
    if (text.current) observer.current.observe(text.current);
    schedule();
    document.fonts.addEventListener('loadingdone', schedule);
    return () => {
      observer.current?.disconnect(); observer.current = undefined;
      document.fonts.removeEventListener('loadingdone', schedule);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [schedule]);
  return { registerEndpoint, registerText };
}
