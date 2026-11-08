import { expect, it } from 'vitest';
import { diagramPlacements, placementSnapshot } from './diagramPlacement';
import { materializeLinkedCanvases } from '../../../application/mapping/evals/linkedCanvasesMaterializer';
import { linkedOutput } from '../../../tests/support/linkedCanvasOutput';

it('records absolute positions for each instance, including descendants of folded containers', () => {
  const { result } = materializeLinkedCanvases(linkedOutput(), [], 'positions');
  const scene = structuredClone(result.canvases[0].proposed.document.scene);
  if (scene.root.kind !== 'container') throw Error('Expected container');
  const child = scene.root.children[0];
  scene.root = { ...scene.root, position: { column: 7, row: 11 }, collapsed: true, children: [
    { ...scene.root, id: 'nested', position: { column: 3, row: 5 }, children: [
      { ...child, position: { column: 2, row: 4 } }, { ...child, id: 'second-instance', position: { column: 20, row: 4 } }
    ] }
  ] };
  const saved = placementSnapshot([{ id: 'canvas', scene }]);
  expect(saved.diagrams.map(p => [p.diagramId, p.column, p.row])).toEqual([
    [`grid:${child.id}`, 12, 20], ['grid:second-instance', 30, 20]
  ]);
  expect(saved.diagrams[0].contentId).toBe(saved.diagrams[1].contentId);
  scene.root.position.column = 100;
  expect(saved.diagrams[0].column).toBe(12);
  expect(diagramPlacements(scene, 'canvas')[0].column).toBe(105);
});
