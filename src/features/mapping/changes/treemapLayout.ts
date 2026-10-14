export interface TreemapRect { x: number; y: number; width: number; height: number }
/** Balanced binary partition: deterministic, area preserving, and no artificial minimum weight. */
export function treemapLayout<T extends { value: number }>(nodes: readonly T[], width: number, height: number): { node: T; rect: TreemapRect }[] {
  const output: { node: T; rect: TreemapRect }[] = [];
  const items = nodes.filter(node => Number.isFinite(node.value) && node.value > 0);
  const place = (start: number, end: number, total: number, rect: TreemapRect) => {
    if (end - start === 1) { output.push({ node: items[start], rect }); return; }
    let split = start + 1, weight = items[start].value;
    while (split < end - 1 && Math.abs(weight + items[split].value - total / 2) < Math.abs(weight - total / 2)) weight += items[split++].value;
    const fraction = weight / total;
    if (rect.width >= rect.height) {
      const left = rect.width * fraction;
      place(start, split, weight, { ...rect, width: left });
      place(split, end, total - weight, { ...rect, x: rect.x + left, width: rect.width - left });
    } else {
      const top = rect.height * fraction;
      place(start, split, weight, { ...rect, height: top });
      place(split, end, total - weight, { ...rect, y: rect.y + top, height: rect.height - top });
    }
  };
  if (items.length && width > 0 && height > 0) place(0, items.length, items.reduce((sum, n) => sum + n.value, 0), { x: 0, y: 0, width, height });
  return output;
}
