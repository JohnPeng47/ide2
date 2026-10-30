import { expect, it } from 'vitest';
import { materializeRollUp, materializeAttachment } from './rollUpMaterializer';
import { CanvasHistory, documentFromHistory, validateCanvasHistory } from '../../../domain/core/diagrams/canvasHistory';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { validateConnections } from '../../../domain/core/diagrams/diagramConnection';
import { connectionContentNodes, validateConnectionAnchor } from '../../../domain/core/diagrams/diagramConnection';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';

const rollup = { explanation: 'Compressed details', diagrams: [{ id: 'summary', ascii: 'Summary\n`-- Detail', position: { column: 0, row: 0 } }], edges: [] };
const parent = () => new CanvasHistory({ scene: singleDiagramScene('Parent\n`-- Existing detail'), edges: [], sections: {} }, initialCanvasState()).export();
const attachment = () => ({ attachment: 'a', explanation: 'Existing anchor', edits: [] as { diagram: string; ascii: string; merged: string[] }[],
  placements: [{ diagram: 'summary', position: { column: 90, row: 0 } }],
  edges: [{ source: { diagram: 'summary', line: 1 }, target: { diagram: 'grid:overview', line: 2 }, label: 'extends' }] });

it('requires exactly one diagram in each new r2 output', () => {
  expect(() => materializeRollUp({ ...rollup, diagrams: [] })).toThrow('r2 must contain exactly one diagram');
  expect(() => materializeRollUp({ ...rollup, diagrams: [...rollup.diagrams,
    { id: 'other', ascii: 'Other', position: { column: 60, row: 0 } }] })).toThrow('r2 must contain exactly one diagram');
});

it('materializes r2 then stores g2 as a CanvasView over an immutable pinned parent', () => {
  const baseline = parent(), before = JSON.stringify(baseline), r2 = materializeRollUp(rollup), g2 = materializeAttachment(baseline, r2.output, attachment());
  validateCanvasHistory(g2.history);
  expect(JSON.stringify(baseline)).toBe(before);
  const view = g2.history.canvasViews!.saved[g2.viewId];
  expect(view.forkCheckpointId).toBe(baseline.headId);
  expect(g2.history.snapshots[view.forkCheckpointId!].document).toEqual(baseline.snapshots[baseline.headId].document);
  const document = documentFromHistory(g2.history);
  expect(document.scene.contents.overview.revisionId).toBe(documentFromHistory(baseline).scene.contents.overview.revisionId);
  expect(document.edges).toHaveLength(1); validateConnections(document.scene, document.edges);
  expect(documentFromHistory(r2.history).scene.contents['rollup-summary'].content.ascii).toBe(rollup.diagrams[0].ascii);
});

it('supports anchor edits and resolves edge nodes against the new revision', () => {
  const plan = attachment(); plan.attachment = 'b'; plan.edits = [{ diagram: 'grid:overview', ascii: 'Parent\n|-- Existing detail\n`-- Roll-up anchor', merged: [] }]; plan.edges[0].target.line = 3;
  const result = materializeAttachment(parent(), rollup, plan), document = documentFromHistory(result.history);
  expect(document.edges[0].target).toMatchObject({ revisionId: document.scene.contents.overview.content.revisionId });
});

it('rebases existing parent edges when adding an attachment anchor changes a revision', () => {
  const history = parent(), document = documentFromHistory(history), content = document.scene.contents.overview.content;
  const c = new MappingDocumentController(document, initialCanvasState(), 0, undefined, undefined, history);
  c.applyUpdate(0, [{ method: 'edge-create', edge: { id: 'existing-edge', source: { kind: 'content-node', displayNodeId: 'grid:overview',
    contentNodeId: connectionContentNodes(content)[0].id, revisionId: content.revisionId, side: 'auto' },
  target: { kind: 'box', displayNodeId: 'grid:overview', side: 'auto' }, appearance: { color: '#88c0d0', lineStyle: 'solid', label: 'existing' } } }]);
  const plan = attachment(); plan.attachment = 'b'; plan.edits = [{ diagram: 'grid:overview', ascii: 'Parent\n|-- Existing detail\n`-- New anchor', merged: [] }];
  const result = materializeAttachment(c.exportHistory(), rollup, plan), after = documentFromHistory(result.history);
  expect(() => validateConnectionAnchor(after.scene, after.edges.find(e => e.id === 'existing-edge')!.source)).not.toThrow();
});

it('supports merging a roll-up diagram into a parent while preserving the remaining parent diagrams', () => {
  const baseline = parent();
  const c = new MappingDocumentController(documentFromHistory(baseline), initialCanvasState(), 0, undefined, undefined, baseline);
  c.applyUpdate(0, [{ method: 'diagram-create', id: 'other', ascii: 'Other parent diagram', position: { column: 90, row: 0 } }]);
  const other = c.getSnapshot().document.scene.contents.other;
  const result = materializeAttachment(c.exportHistory(), rollup, { attachment: 'c', explanation: 'Merge common concepts',
    edits: [{ diagram: 'grid:overview', ascii: 'Parent\n|-- Existing detail\n`-- Summary detail', merged: ['summary'] }],
    placements: [],
    edges: [{ source: { diagram: 'grid:overview', line: 3 }, target: { diagram: 'grid:other', line: 1 }, label: 'uses' }] });
  const document = documentFromHistory(result.history);
  expect(document.scene.contents['rollup-summary']).toBeUndefined();
  expect(document.scene.contents.other).toEqual(other);
});

it.each(['missing', 'duplicate', 'strategy', 'anchor', 'attachment'])('rejects invalid attachment output: %s', kind => {
  const plan = attachment();
  if (kind === 'missing') plan.placements = [];
  if (kind === 'duplicate') plan.placements.push(plan.placements[0]);
  if (kind === 'strategy') plan.edits.push({ diagram: 'grid:overview', ascii: 'Changed', merged: [] });
  if (kind === 'anchor') plan.edges[0].target.line = 999;
  if (kind === 'attachment') plan.edges[0].target.diagram = 'summary';
  expect(() => materializeAttachment(parent(), rollup, plan)).toThrow();
});
