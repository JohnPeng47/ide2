import { expect, it } from 'vitest';
import { materializeLinkedCanvases } from './linkedCanvasesMaterializer';
import { activeDiagramJumps } from '../../../domain/core/diagrams/diagramJump';
import { connectionBox } from '../../../domain/core/diagrams/diagramConnection';
import { copyCompareHistory } from '../compare/compareSessionService';
import { materializeDiagrams } from '../rollup/rollUpMaterializer';
import type { CompareCanvasCopy } from '../../../domain/mapping/compare/comparePageSession';

import { linkedOutput } from '../../../tests/support/linkedCanvasOutput';

it('materializes a portable rooted set with active span links and target focus', () => {
  const { result } = materializeLinkedCanvases(linkedOutput(), [], 'test');
  expect(result.canvases.map(c => c.name)).toEqual(['Overview', 'Detail']);
  const root = result.canvases[0].proposed.document;
  const box = connectionBox(root.scene, 'grid:test-root-r')!;
  if (box.kind !== 'diagram') throw Error('Not a diagram');
  const jump = root.scene.contents[box.contentId].jumps![0];
  expect(activeDiagramJumps(root.scene.contents[box.contentId].content, [jump])).toHaveLength(1);
  expect(jump.target).toMatchObject({ representationId: result.canvases[1].id, displayNodeId: 'grid:test-detail-d' });
  expect(jump.target.contentNodeId).toBeTruthy();
  expect(Object.keys(result.diagramRevisions).length).toBeGreaterThan(0);
});

it.each([
  ['duplicate canvas', (x: any) => { x.canvases[1].id = 'detail'; }],
  ['missing root', (x: any) => { x.rootCanvas = 'missing'; }],
  ['missing canvas', (x: any) => { x.jumps[0].target.canvas = 'missing'; }],
  ['missing diagram', (x: any) => { x.jumps[0].source.diagram = 'missing'; }],
  ['invalid span', (x: any) => { x.jumps[0].source.endColumn = 999; }],
  ['reversed span', (x: any) => { x.jumps[0].source.endColumn = 1; }],
  ['overlap', (x: any) => { x.jumps.push(structuredClone(x.jumps[0])); }],
  ['target concept', (x: any) => { x.jumps[0].target.line = 999; }],
  ['target line without diagram', (x: any) => { x.jumps[0].target.diagram = null; }],
  ['same canvas', (x: any) => { x.jumps[0].target = { canvas: 'root', diagram: 'r', line: 1 }; }],
  ['unreachable canvas', (x: any) => { x.canvases.push({ ...x.canvases[0], id: 'orphan' }); }]
])('rejects %s before publishing', (_, change) => {
  const output = linkedOutput(); change(output);
  expect(() => materializeLinkedCanvases(output, [], 'test')).toThrow();
});

it('edits pinned existing canvases without modifying their source and retains the baseline', () => {
  const history = materializeDiagrams([{ id: 'r', ascii: 'Overview\n`-- Open detail', position: { column: 0, row: 0 } }], [], 'existing');
  const copy = { id: 'copy', source: { documentId: 'original', checkpointId: history.headId }, canvasName: 'Original', view: { name: 'Original' }, history: copyCompareHistory(history, history.headId) } as CompareCanvasCopy;
  const before = JSON.stringify(copy);
  const output: any = linkedOutput();
  output.canvases[1] = { kind: 'existing', id: 'root', sourceCanvas: 'c1', edits: [{ diagram: 'grid:existing-r', ascii: 'Updated overview\n`-- Open detail' }] };
  output.jumps[0].source.diagram = 'grid:existing-r';
  const { result } = materializeLinkedCanvases(output, [copy], 'test');
  expect(result.canvases[0].baseline).not.toBeNull();
  expect(JSON.stringify(copy)).toBe(before);
  expect(JSON.stringify(result.canvases[0].proposed)).toContain('Updated overview');
  expect(() => materializeLinkedCanvases(linkedOutput(), [copy], 'test')).toThrow('every input canvas');
});
