import { expect, it } from 'vitest';
import { treemapLayout } from '../treemapLayout';
it('preserves relative area without overlaps for skewed and equal weights at different sizes', () => {
  for (const values of [[1], [1000, 1, 1, 1], [4, 4, 4, 4], [30, 20, 17, 10, 1]]) for (const [width, height] of [[600, 350], [180, 700]]) {
    const result = treemapLayout(values.map(value => ({ value })), width, height), total = values.reduce((a, b) => a + b, 0);
    for (const { node, rect } of result) {
      expect(rect.width * rect.height).toBeCloseTo(width * height * node.value / total, 5);
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1e-8); expect(rect.y + rect.height).toBeLessThanOrEqual(height + 1e-8);
    }
    for (let a = 0; a < result.length; a++) for (let b = a + 1; b < result.length; b++) {
      const x = result[a].rect, y = result[b].rect;
      expect(Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) <= 1e-8
        || Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) <= 1e-8).toBe(true);
    }
  }
});
it('omits zero area and safely handles a hidden panel', () => {
  expect(treemapLayout([{ value: 0 }], 100, 100)).toEqual([]);
  expect(treemapLayout([{ value: 4 }], 0, 100)).toEqual([]);
});
