import { expect, it } from 'vitest';
import { completeMarquee } from '../completeMarquee';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { flattenGrid, resolveScene } from '../../../core/diagrams/lineGrid';
import { initialCanvasState } from '../../workspace/mappingWorkspace';
import { diagramSelectionItem } from '../selectionState';

const scene = singleDiagramScene('Root\nChild'), boxes = flattenGrid(resolveScene(scene));
const region = { diagramIds: [], regions: [{ boxId: 'overview', rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 } }] };
it('applies add/replace while retaining region identity, child panels, and existing surfaces', () => {
  const first = completeMarquee(initialCanvasState(), region, scene, boxes, 'replace');
  const id = first.selection.items[0].id;
  first.display.nodes[id].childIds = ['panel'];
  first.controls.surfaces[id] = { ...first.controls.surfaces[id], promptText: 'Retained draft', actionsOpen: true };
  const whole = completeMarquee(first, { diagramIds: ['grid:elsewhere'], regions: [] }, scene, boxes, 'add');
  expect(whole.selection.items.map(item => item.id)).toEqual([id, 'grid:elsewhere']);
  const replaced = completeMarquee(whole, region, scene, boxes, 'replace');
  expect(replaced.selection.items.map(item => item.id)).toEqual([id]);
  expect(replaced.display.nodes[id].childIds).toEqual(['panel']);
  expect(replaced.controls.surfaces[id]).toMatchObject({ promptText: 'Retained draft', actionsOpen: false });
});
it('a second-contact marquee can rebase on pre-tap membership without deleting retained context', () => {
  const original = initialCanvasState();
  original.selection = { items: [diagramSelectionItem('grid:elsewhere')] };
  const tap = completeMarquee(original, region, scene, boxes, 'add');
  const final = completeMarquee({ ...tap, selection: original.selection }, { diagramIds: ['grid:overview'], regions: [] }, scene, boxes, 'add');
  expect(final.selection.items.map(item => item.id)).toEqual(['grid:elsewhere', 'grid:overview']);
  expect(Object.keys(final.display.nodes)).toEqual(Object.keys(tap.display.nodes));
});
