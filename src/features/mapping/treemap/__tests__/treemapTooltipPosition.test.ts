import { expect, it } from 'vitest';
import { treemapTooltipPosition } from '../treemapTooltipPosition';

it('places compact tooltips outside small edge tiles and large regions', () => {
  const viewport = { width: 1000, height: 700 }, tooltip = { width: 160, height: 28 };
  for (const anchor of [
    { left: 10, top: 10, right: 25, bottom: 25 },
    { left: 970, top: 670, right: 990, bottom: 690 },
    { left: 10, top: 100, right: 990, bottom: 690 },
    { left: 10, top: 10, right: 990, bottom: 600 },
  ]) {
    const position = treemapTooltipPosition(anchor, tooltip, viewport)!;
    expect(position).toBeDefined();
    expect(position.left >= 8 && position.top >= 8).toBe(true);
    expect(position.left + tooltip.width <= 992 && position.top + tooltip.height <= 692).toBe(true);
    expect(position.left >= anchor.right || position.left + tooltip.width <= anchor.left
      || position.top >= anchor.bottom || position.top + tooltip.height <= anchor.top).toBe(true);
  }
});
it('does not cover a region when no outside viewport space exists', () => {
  expect(treemapTooltipPosition({ left: 0, top: 0, right: 100, bottom: 100 },
    { width: 80, height: 30 }, { width: 100, height: 100 })).toBeUndefined();
});
