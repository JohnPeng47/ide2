import { expect, it } from 'vitest';
import { selectsDiagramVertices } from '../diagramPlacementSelection';
const box = { left: 10, top: 10, right: 30, bottom: 30 };
it('requires at least two vertices, including vertices on the rectangle boundary', () => {
  expect(selectsDiagramVertices(box, { left: 0, top: 0, right: 20, bottom: 20 })).toBe(false);
  expect(selectsDiagramVertices(box, { left: 0, top: 0, right: 30, bottom: 20 })).toBe(true);
  expect(selectsDiagramVertices(box, { left: 0, top: 0, right: 40, bottom: 40 })).toBe(true);
  expect(selectsDiagramVertices(box, { left: 15, top: 0, right: 25, bottom: 40 })).toBe(false);
  expect(selectsDiagramVertices(box, { left: 15, top: 15, right: 25, bottom: 25 })).toBe(false);
  expect(selectsDiagramVertices(box, { left: 30, top: 10, right: 40, bottom: 30 })).toBe(true);
});
