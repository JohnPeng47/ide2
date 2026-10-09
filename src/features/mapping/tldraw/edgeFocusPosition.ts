/** Connection routes contain straight M/L segments. Anchor the hint to the
 * closest segment, so elbows use the direction of the part actually clicked. */
export function edgeFocusPosition(path: string, click: { x: number; y: number }) {
  const points = [...path.matchAll(/[ML]([^ML]+)/g)].map(match => {
    const [x, y] = match[1].trim().split(/[\s,]+/).map(Number); return { x, y };
  });
  let nearest: { x: number; y: number; orientation: 'horizontal' | 'vertical'; distance: number } | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) continue;
    const t = Math.max(0, Math.min(1, ((click.x - a.x) * dx + (click.y - a.y) * dy) / (dx * dx + dy * dy)));
    const x = a.x + t * dx, y = a.y + t * dy, distance = Math.hypot(click.x - x, click.y - y);
    if (!nearest || distance < nearest.distance) nearest = { x, y, distance, orientation: Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical' };
  }
  return nearest;
}
