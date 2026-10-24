import { expect, it } from 'vitest';
import { emptyCanvasDocument } from '../canvasTransfer';
import { diagramCenterOfMass, placeTransferredGroup } from '../canvasTransferPlacement';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { boxesOverlap, resolveScene, type GridBounds } from '../lineGrid';
const scene = (bounds: GridBounds[]) => {
  const result = emptyCanvasDocument().scene;
  result.contents = { text: revisionFixture().create({ id: 'text', revision: 0, ascii: 'X' }).diagram };
  if (result.root.kind !== 'container') throw Error();
  result.root.children = bounds.map((bounds, index) => ({ id: `box${index}`, kind: 'diagram', contentId: 'text',
    position: { column: bounds.column, row: bounds.row }, minimumSize: { columns: bounds.columns, rows: bounds.rows }, collapsed: false }));
  return result;
};
it('weights by diagram areas rather than averaging diagram centers', () => {
  expect(diagramCenterOfMass([{ column: 0, row: 0, columns: 10, rows: 10 }, { column: 20, row: 0, columns: 2, rows: 2 }]))
    .toEqual({ column: (5*100+21*4)/104, row: (5*100+1*4)/104 });
});
it.each([
  [{column:50,row:5,columns:10,rows:10}],
  [{column:0,row:0,columns:8,rows:20},{column:30,row:3,columns:8,rows:5}],
  [{column:0,row:0,columns:8,rows:3},{column:30,row:0,columns:8,rows:3}],
  [{column:50,row:0,columns:4,rows:3},{column:70,row:0,columns:30,rows:5}],
])('finds the global nearest free horizontal grid position while keeping the group together: %j', (...boxes) => {
  const destination = scene(boxes), incomingBoxes = [{column:0,row:0,columns:8,rows:3},{column:14,row:3,columns:6,rows:5}], incoming = scene(incomingBoxes);
  const before = structuredClone(destination), position = placeTransferredGroup(destination, incoming);
  const center = diagramCenterOfMass(boxes), groupCenter = diagramCenterOfMass(incomingBoxes), group = resolveScene(incoming).bounds;
  expect(position.row).toBe(Math.max(0, Math.round(center.row - groupCenter.row)));
  expect(boxes.some(box => boxesOverlap({...group,...position}, box, 3))).toBe(false);
  const distance = Math.abs(position.column + groupCenter.column - center.column);
  for (let column = 0; column < 200; column++) if (!boxes.some(box => boxesOverlap({...group, column, row:position.row}, box, 3)))
    expect(distance).toBeLessThanOrEqual(Math.abs(column + groupCenter.column - center.column));
  expect(destination).toEqual(before);
});
it('uses the origin for an empty destination', () => {
  expect(placeTransferredGroup(emptyCanvasDocument().scene, scene([{column:0,row:0,columns:8,rows:3}]))).toEqual({column:0,row:0});
});
