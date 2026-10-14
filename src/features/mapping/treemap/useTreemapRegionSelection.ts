import { useCallback, useEffect, useRef, useState } from 'react';
import type { TreemapDiagramColor } from '../changes/treemapDiagramColors';

/** Observe clicks through the decorative tint layer, without intercepting pan,
 * selection, source links or subtree controls. Hit-test the painted partition so
 * a parent's unoccupied area and a child's area select their respective tiles. */
export function useTreemapRegionSelection(colors?: readonly TreemapDiagramColor[]) {
  const latest = useRef(colors); latest.current = colors;
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const tintRef = useCallback((element: HTMLDivElement | null) => setContainer(element?.parentElement ?? null), []);
  useEffect(() => {
    if (!container) return;
    let start: { x: number; y: number; pointerId: number } | undefined;
    const down = (event: PointerEvent) => {
      start = undefined;
      if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest('button, a, input, select, textarea, [role="button"], [data-mapping-static-ui], [data-diagram-canvas-static-ui]')) return;
      start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    };
    const cancel = () => { start = undefined; };
    const move = (event: PointerEvent) => {
      if (start && (event.pointerId !== start.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)) cancel();
    };
    const up = (event: PointerEvent) => {
      const click = start; cancel();
      if (!click || event.pointerId !== click.pointerId || Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) return;
      const region = [...container.querySelectorAll<HTMLElement>('[data-treemap-region]')].reverse().find(element => {
        const r = element.getBoundingClientRect();
        return event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom;
      });
      if (!region) return;
      latest.current?.find(color => color.nodeId === region.dataset.treemapRegion)?.onSelect?.();
    };
    container.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    return () => {
      container.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
    };
  }, [container]);
  return tintRef;
}
