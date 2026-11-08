import { expect, it } from 'vitest';
import { evalOutputFixture } from '../../../tests/support/evalOutputResult';
import { captureChangeSessionOutput, summarizeEvalOutput } from './evalOutputResult';
import { changeDocumentPreview } from '../changes/changeDocumentPreview';
import { hasEvalOutput, summarizeEvalRun } from './evalRun';

it('retains independent before/after snapshots and counts several canvases as one output', () => {
  const { run, session } = evalOutputFixture();
  const result = captureChangeSessionOutput(session), before = JSON.stringify(result);
  session.documents[0].name = 'Later live edit';
  const scene = session.documents[0].proposed.document.scene;
  scene.contents = { ...scene.contents, overview: { ...scene.contents.overview,
    content: { ...scene.contents.overview.content, ascii: 'Later content' } } };
  expect(JSON.stringify(result)).toBe(before);
  expect(result.canvases[0]).not.toHaveProperty('past');
  expect(result.changeSession).not.toHaveProperty('receipts');
  run.outputResults = { [run.cells[0].key]: result }; run.cells[0].output = summarizeEvalOutput(result);
  expect(run.cells.filter(hasEvalOutput)).toHaveLength(1);
  expect(run.cells[0].output.canvases.map(canvas => canvas.kind)).toEqual(['existing', 'new']);
  expect(summarizeEvalRun(run)).not.toHaveProperty('outputResults');
});

it('shows redraws, added diagrams and removed ghost diagrams without altering the result', () => {
  const result = captureChangeSessionOutput(evalOutputFixture().session), before = JSON.stringify(result);
  const preview = changeDocumentPreview(result.canvases[0]);
  expect(preview.modifiedDiagramIds.has('grid:overview')).toBe(true);
  expect(preview.removedDiagramIds.has('grid:relationships')).toBe(true);
  expect(preview.diff.diagrams.get('grid:detail')!.counts.added).toBeGreaterThan(0);
  expect(JSON.stringify(preview.doc.proposed.document.scene)).toContain('removed:relationships');
  const added = changeDocumentPreview(result.canvases[1]);
  expect(added.diff.counts.added).toBeGreaterThan(0);
  expect(added.modifiedDiagramIds.size).toBe(0);
  expect(JSON.stringify(result)).toBe(before);
});
