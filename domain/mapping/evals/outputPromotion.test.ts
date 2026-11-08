import { expect, it } from 'vitest';
import { prepareOutputPromotion, type OutputPromotion } from './outputPromotion';
import { materializeLinkedCanvases } from '../../../application/mapping/evals/linkedCanvasesMaterializer';
import { linkedOutput } from '../../../tests/support/linkedCanvasOutput';
import { CanvasHistory, documentFromHistory, validateCanvasHistory } from '../../core/diagrams/canvasHistory';
import { activeDiagramJumps } from '../../core/diagrams/diagramJump';
import { compareWorkspaceFixture } from '../../../tests/support/compareWorkspace';

const input = (): OutputPromotion => ({ requestId: crypto.randomUUID(), cellKey: 'cell', name: 'Shopify', destination: 'new-project' });
it('copies the entire set with working jump spans and targets, without changing evidence', () => {
  const { result } = materializeLinkedCanvases(linkedOutput(), [], 'promotion');
  const before = JSON.stringify(result);
  const copies = prepareOutputPromotion(result, input());
  expect(copies).toHaveLength(2);
  const jumps = copies.flatMap(c => Object.values(c.scene.contents).flatMap(d => {
    expect(activeDiagramJumps(d.content, d.jumps)).toHaveLength(d.jumps?.length ?? 0);
    return d.jumps ?? [];
  }));
  expect(jumps).toHaveLength(1);
  expect(jumps[0].target.representationId).toBe(copies[1].id);
  for (const copy of copies) validateCanvasHistory(copy.history);
  expect(JSON.stringify(result)).toBe(before);
});
it('promoting one canvas includes its outgoing linked dependencies', () => {
  const { result } = materializeLinkedCanvases(linkedOutput(), [], 'promotion');
  const copies = prepareOutputPromotion(result, { ...input(), destination: 'new-canvas', canvasId: result.canvases[0].id });
  expect(copies).toHaveLength(2);
});
it('inserts diagrams with fresh IDs and retains destination content and undo', () => {
  const { result } = materializeLinkedCanvases(linkedOutput(), [], 'promotion');
  const target = compareWorkspaceFixture('project').documents[0];
  const history = new CanvasHistory(target.document, target.canvas).export();
  const before = JSON.stringify(history);
  const copies = prepareOutputPromotion(result, { ...input(), destination: 'existing-canvas', canvasId: result.canvases[0].id,
    targetCanvasId: 'target', expectedRevisionId: 'revision' }, { history, name: 'Destination' });
  const saved = copies[0];
  expect(saved.id).toBe('target');
  expect(Object.keys(saved.scene.contents).length).toBeGreaterThan(Object.keys(target.document.scene.contents).length);
  expect(saved.edges.length).toBe(target.document.edges.length);
  expect(saved.history.past).toContain(history.headId);
  expect(Object.values(saved.history.snapshots).some(s => s.transactionId)).toBe(false);
  validateCanvasHistory(saved.history);
  expect(JSON.stringify(history)).toBe(before);
});
it('promotes an individual diagram without flattening its content', () => {
  const { result } = materializeLinkedCanvases(linkedOutput(), [], 'promotion');
  const copies = prepareOutputPromotion(result, { ...input(), destination: 'new-canvas', canvasId: result.canvases[1].id, diagramId: 'grid:promotion-detail-d' });
  expect(copies).toHaveLength(1);
  const doc = documentFromHistory(copies[0].history);
  expect(Object.values(doc.scene.contents).some(d => d.content.ascii === 'Details\n`-- Evidence')).toBe(true);
});

it('keeps internal diagram edges when copying a whole canvas into another canvas', async () => {
  const { linkedCanvasesOutputSchema } = await import('./linkedCanvases');
  const output = linkedCanvasesOutputSchema.parse(linkedOutput());
  const root = output.canvases[1];
  if (root.kind !== 'new') throw Error('Expected new root');
  root.diagrams.push({ id: 'child', ascii: 'Child\n`-- Evidence', position: { column: 60, row: 0 } });
  root.edges.push({ source: { diagram: 'r', line: 1 }, target: { diagram: 'child', line: 1 }, label: 'contains' });
  const { result } = materializeLinkedCanvases(output, [], 'edges');
  const target = compareWorkspaceFixture('project').documents[0];
  const history = new CanvasHistory(target.document, target.canvas).export();
  const copies = prepareOutputPromotion(result, { ...input(), destination: 'existing-canvas', canvasId: result.canvases[0].id,
    targetCanvasId: 'target', expectedRevisionId: 'revision' }, { history, name: 'Destination' });
  expect(copies[0].edges).toHaveLength(1);
  validateCanvasHistory(copies[0].history);
});

it('pins generated geometry and maps only copied instances to their inserted positions', () => {
  const { result } = materializeLinkedCanvases(linkedOutput(), [], 'positions');
  expect(result.placementSnapshot?.diagrams).toHaveLength(2);
  const target = compareWorkspaceFixture('project').documents[0];
  const history = new CanvasHistory(target.document, target.canvas).export();
  const copies = prepareOutputPromotion(result, { ...input(), destination: 'existing-canvas', canvasId: result.canvases[1].id,
    targetCanvasId: 'target', expectedRevisionId: 'revision' }, { history, name: 'Destination' });
  expect(copies).toHaveLength(1);
  const bindings = copies[0].placementBindings;
  expect(bindings).toHaveLength(1);
  expect(bindings[0].generated).toEqual(result.placementSnapshot!.diagrams[1]);
  expect(bindings[0].promoted.canvasId).toBe('target');
  expect(bindings[0].promoted.diagramId).not.toBe(bindings[0].generated.diagramId);
  expect(bindings[0].promoted.column).toBeGreaterThan(bindings[0].generated.column);
  expect(copies[0].scene.contents[bindings[0].promoted.contentId].content.ascii)
    .toBe(result.canvases[1].proposed.document.scene.contents[bindings[0].generated.contentId].content.ascii);
});
