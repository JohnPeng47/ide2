import { expect, it } from 'vitest';
import { materializeTemplateAlternative } from './alternativeMaterializer';
import { layoutFromBounds } from '../../../domain/core/diagrams/layoutTemplate';
import { documentFromHistory } from '../../../domain/core/diagrams/canvasHistory';
import { flattenGrid, resolveScene } from '../../../domain/core/diagrams/lineGrid';

const geometry = layoutFromBounds([{ column: 0, row: 0, columns: 1, rows: 1 }, { column: 3, row: 0, columns: 1, rows: 1 }]);
const output = { format: 'template-slots-v1', explanation: 'Fresh linked content', diagrams: [{ slotId: 'slot-1', ascii: 'New source' }, { slotId: 'slot-2', ascii: 'New target' }],
  edges: [{ source: { slotId: 'slot-1', line: 1 }, target: { slotId: 'slot-2', line: 1 }, label: 'New relation' }] };

it('materializes fresh slot content and only explicitly generated edges', () => {
  const result = materializeTemplateAlternative(output, geometry), document = documentFromHistory(result.history);
  expect(flattenGrid(resolveScene(document.scene)).filter(node => node.contentId).map(node => document.scene.contents[node.contentId!].content.ascii)).toEqual(['New source', 'New target']);
  expect(document.edges).toHaveLength(1);
  expect(result.layoutPlacements[1]).toMatchObject({ bounds: { column: 13, row: 0 }, moved: true });
  expect(flattenGrid(resolveScene(document.scene)).filter(node => node.contentId).map(node => node.bounds)).toEqual(result.layoutPlacements.map(p => p.bounds));
  expect(documentFromHistory(materializeTemplateAlternative({ ...output, edges: [] }, geometry).history).edges).toEqual([]);
});

it('rejects model positions, incorrect slot sets and invalid generated edge anchors', () => {
  expect(() => materializeTemplateAlternative({ ...output, diagrams: output.diagrams.map(d => ({ ...d, position: { column: 0, row: 0 } })) }, geometry)).toThrow();
  expect(() => materializeTemplateAlternative({ ...output, diagrams: [output.diagrams[0], output.diagrams[0]] }, geometry)).toThrow('exactly one');
  expect(() => materializeTemplateAlternative({ ...output, edges: [{ ...output.edges[0], source: { slotId: 'slot-1', line: 99 } }] }, geometry)).toThrow();
});
