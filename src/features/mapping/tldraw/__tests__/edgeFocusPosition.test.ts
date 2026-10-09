import { expect, it } from 'vitest';
import { edgeFocusPosition } from '../edgeFocusPosition';

it('uses the clicked segment of a bent edge and projects the hint onto the line', () => {
  const route = 'M-10 0 L100 0 L100 80 L160 80';
  expect(edgeFocusPosition(route, { x: 30, y: 4 })).toMatchObject({ x: 30, y: 0, orientation: 'horizontal' });
  expect(edgeFocusPosition(route, { x: 96, y: 45 })).toMatchObject({ x: 100, y: 45, orientation: 'vertical' });
  expect(edgeFocusPosition(route, { x: 150, y: 78 })).toMatchObject({ x: 150, y: 80, orientation: 'horizontal' });
});

it('ignores duplicate route points and clamps to the closest endpoint', () => {
  expect(edgeFocusPosition('M0 0 L0 0 L0 50', { x: 8, y: 80 })).toMatchObject({ x: 0, y: 50, orientation: 'vertical' });
  expect(edgeFocusPosition('M0 0 L0 0', { x: 8, y: 80 })).toBeUndefined();
});
