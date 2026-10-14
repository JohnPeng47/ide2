interface Size { width: number; height: number }
interface Rect { left: number; right: number; top: number; bottom: number }

/** Prefer a side, then above/below. Never clamp back over the hovered region. */
export function treemapTooltipPosition(anchor: Rect, tooltip: Size, viewport: Size) {
  const gap = 8;
  const left = Math.max(gap, Math.min(anchor.left, viewport.width - tooltip.width - gap));
  const top = Math.max(gap, Math.min(anchor.top, viewport.height - tooltip.height - gap));
  return [
    { left: anchor.right + gap, top },
    { left: anchor.left - tooltip.width - gap, top },
    { left, top: anchor.top - tooltip.height - gap },
    { left, top: anchor.bottom + gap },
  ].find(point => point.left >= gap && point.top >= gap
    && point.left + tooltip.width <= viewport.width - gap
    && point.top + tooltip.height <= viewport.height - gap);
}
