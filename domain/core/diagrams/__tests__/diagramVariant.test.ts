import { expect, it } from 'vitest';
import { RevisionedDiagramService } from '../diagramService';
import { diagramContentNodes } from '../diagramContentNodes';
import { stripNodeContinuity } from '../diagramNodeContinuity';
import { applyVariant, variantChanges, reviewVariant, type DiagramVariant } from '../diagramVariant';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';
import { workspaceRecords, recordsWorkspace, validateRecordUpdate } from '../../../mapping/workspace/workspaceRecords';

function fixture() {
  const service = new RevisionedDiagramService();
  const base = service.create({ id: 'shop', revision: 0, structureKind: 'tree', ascii: 'Shop\n|-- Payment\n|   |-- Authorize\n|   `-- Capture\n`-- Cart' }).revision;
  const logical = Object.fromEntries(diagramContentNodes(base.diagram.content).map(n => [n.label, base.nodeRefs[n.id]]));
  const controller = new MappingDocumentController({ scene: { root: { id: 'root', kind: 'container', position: { column: 0, row: 0 }, collapsed: false,
    layout: { collisionPolicy: 'push-right', gap: 3 }, children: [{ id: 'shop', kind: 'diagram', contentId: 'shop', position: { column: 0, row: 0 }, collapsed: false }] }, contents: { shop: base.diagram } }, edges: [], sections: {} }, initialCanvasState(), 0, undefined, undefined, undefined, service);
  const next = service.revise(base.id, { kind: 'replace', input: { ascii: 'Shop\n|-- Payment\n|   |-- Authorize asynchronously\n|   `-- Capture later\n`-- Cart', structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(diagramContentNodes(base.diagram.content).map(n => [base.nodeRefs[n.id], n.line])) }).revision;
  const variant: DiagramVariant = { id: 'variant-a', name: 'Async payment', contentId: 'shop', diagramId: base.diagramId, ownerNodeId: logical.Payment,
    baseRevisionId: base.id, headRevisionId: next.id, revisionIds: [next.id], prompt: 'Use asynchronous payments', decisions: {} };
  return { service, base, next, logical, controller, variant };
}
it('strips explicit continuity claims and rejects unknown, duplicate and ambiguous claims', () => {
  const { base, logical, service } = fixture();
  expect(stripNodeContinuity(`Renamed [[keep:${logical.Shop}]]`, base.nodeRefs)).toEqual({ ascii: 'Renamed', nodeCorrespondence: { [logical.Shop]: 1 } });
  expect(() => stripNodeContinuity('X [[keep:missing]]', base.nodeRefs)).toThrow('unknown');
  expect(() => stripNodeContinuity(`X [[keep:${logical.Shop}]]\nY [[keep:${logical.Shop}]]`, base.nodeRefs)).toThrow('duplicate');
  expect(() => service.revise(base.id, { kind: 'replace', input: { ascii: 'New\n`-- Child', structureKind: 'tree' }, nodeCorrespondence: { [logical.Shop]: 1, [logical.Payment]: 1 } })).toThrow('multiple');
});
it('reviews matched nodes independently, preserves siblings, and reverses an applied decision', () => {
  const { service, base, next, logical, variant } = fixture();
  expect(variantChanges(base, next, variant.ownerNodeId).map(c => c.id)).toEqual([logical.Authorize, logical.Capture]);
  variant.decisions[logical.Authorize] = 'accept';
  const current = service.revise(base.id, { kind: 'patch', start: 5, end: 5, patch: '`-- Cart updated' });
  const result = applyVariant(variant, current.revision, service);
  expect(result.diagram.content.ascii).toBe('Shop\n|-- Payment\n|   |-- Authorize asynchronously\n|   `-- Capture\n`-- Cart updated');
  expect(Object.values(result.revision.nodeRefs)).toContain(logical.Authorize);
  variant.appliedReview = { headRevisionId: next.id, decisions: { ...variant.decisions } }; variant.appliedRevisionId = result.revision.id;
  variant.decisions[logical.Authorize] = 'reject';
  expect(applyVariant(variant, result.revision, service).diagram.content.ascii).toBe('Shop\n|-- Payment\n|   |-- Authorize\n|   `-- Capture\n`-- Cart updated');
});
it('refuses to overwrite an intervening edit to an accepted logical node', () => {
  const { service, base, variant, logical } = fixture();
  variant.decisions[logical.Authorize] = 'accept';
  const changed = service.revise(base.id, { kind: 'replace', input: { ascii: base.diagram.content.ascii.replace('Authorize', 'Manual authorization'), structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(diagramContentNodes(base.diagram.content).map(n => [base.nodeRefs[n.id], n.line])) });
  expect(() => applyVariant(variant, changed.revision, service)).toThrow('VARIANT_CONFLICT');
});
it('retains independent candidates without changing live content, survives persistence and undo', () => {
  const { controller, variant, next, base, logical } = fixture();
  controller.applyUpdate(0, [{ method: 'variant-store', nodeId: 'grid:shop', expectedRevisionId: base.id, variants: [{ variant, revision: next }, { variant: { ...variant, id: 'variant-b', name: 'Second alternative' }, revision: next }] }]);
  expect(controller.getSnapshot().document.scene.contents.shop.revisionId).toBe(base.id);
  controller.applyUpdate(1, [{ method: 'variant-review', variantId: variant.id, decisions: { [logical.Authorize]: 'accept' }, nodeId: 'grid:shop', apply: true }]);
  expect(controller.getSnapshot().document.variants!['variant-b'].decisions).toEqual({});
  const state = controller.getSnapshot();
  const records = workspaceRecords({ schemaVersion: 3, projectId: 'p', documents: [{ representationId: 'draft-test', name: 'Test', savedName: '', savedScene: JSON.stringify(state.document.scene), revisionId: '',
    document: state.document, canvas: state.canvas, history: controller.exportHistory() }] });
  validateRecordUpdate(records, Object.keys(records), 'p');
  const loaded = recordsWorkspace(records)!.documents[0];
  const restored = new MappingDocumentController(loaded.document, loaded.canvas, 0, undefined, undefined, loaded.history);
  expect(restored.getSnapshot().document.variants).toEqual(state.document.variants);
  restored.undo();
  expect(restored.getSnapshot().document.scene.contents.shop.revisionId).toBe(base.id);
  expect(Object.keys(restored.getSnapshot().document.variants!)).toHaveLength(2);
  restored.undo(true); expect(restored.getSnapshot().document.scene.contents.shop.content.ascii).toContain('Authorize asynchronously');
});
it('requires related structural changes together and preserves added logical identities', () => {
  const { service, base, variant, logical } = fixture();
  const added = service.revise(base.id, { kind: 'replace', input: { ascii: base.diagram.content.ascii.replace('|   `-- Capture', '|   |-- Capture\n|   `-- Notify'), structureKind: 'tree' },
    nodeCorrespondence: { [logical.Shop]: 1, [logical.Payment]: 2, [logical.Authorize]: 3, [logical.Capture]: 4, [logical.Cart]: 6 } }).revision;
  variant.headRevisionId = added.id; variant.revisionIds.push(added.id);
  const changes = variantChanges(base, added, variant.ownerNodeId), addition = changes.find(c => c.kind === 'added')!;
  variant.decisions[addition.id] = 'accept';
  expect(reviewVariant(variant, id => service.getRevision(id)).error).toContain('REVIEW_DEPENDENCY');
  variant.decisions = Object.fromEntries(changes.map(c => [c.id, 'accept']));
  const applied = applyVariant(variant, base, service);
  expect(applied.diagram.content.ascii).toContain('Notify');
  expect(Object.values(applied.revision.nodeRefs)).toContain(addition.id);
});
it('preserves connections and folded branches through a reviewed rename and undo', () => {
  const { controller, variant, next, base, logical } = fixture();
  const nodes = diagramContentNodes(base.diagram.content), authorize = nodes.find(n => n.label === 'Authorize')!, payment = nodes.find(n => n.label === 'Payment')!;
  controller.applyUpdate(0, [
    { method: 'edge-create', edge: { id: 'payment-edge', source: { kind: 'content-node', displayNodeId: 'grid:shop', contentNodeId: authorize.id, revisionId: base.diagram.content.revisionId, side: 'auto' },
      target: { kind: 'box', displayNodeId: 'grid:shop', side: 'auto' }, appearance: { color: '#88c0d0', lineStyle: 'solid', label: '' } } },
    { method: 'collapse', nodeId: 'grid:shop', contentNodeId: payment.id, collapsed: true },
    { method: 'variant-store', nodeId: 'grid:shop', expectedRevisionId: base.id, variants: [{ variant, revision: next }] }
  ]);
  controller.applyUpdate(1, [{ method: 'variant-review', variantId: variant.id, decisions: { [logical.Authorize]: 'accept' }, nodeId: 'grid:shop', apply: true }]);
  const state = controller.getSnapshot(), content = state.document.scene.contents.shop.content;
  expect(state.document.edges[0].source.revisionId).toBe(content.revisionId);
  expect(diagramContentNodes(content).find(n => n.id === state.document.edges[0].source.contentNodeId)?.label).toBe('Authorize asynchronously');
  expect(state.canvas.diagramViews!['grid:shop'].collapsedContentNodeIds).toEqual([diagramContentNodes(content).find(n => n.label === 'Payment')!.id]);
  controller.undo(); expect(controller.getSnapshot().document.edges[0].source.contentNodeId).toBe(authorize.id);
});
it('merges a label decision with later children and preserves them when reversing the decision', () => {
  const { service, base, next, variant, logical } = fixture();
  variant.decisions[logical.Authorize] = 'accept';
  const applied = applyVariant(variant, base, service);
  variant.appliedReview = { headRevisionId: next.id, decisions: { ...variant.decisions } }; variant.appliedRevisionId = applied.revision.id;
  const later = service.revise(applied.revision.id, { kind: 'patch', start: 4, end: 4, patch: '|   |   `-- Audit\n|   `-- Capture' });
  variant.decisions[logical.Authorize] = 'reject';
  expect(applyVariant(variant, later.revision, service).diagram.content.ascii).toContain('|   |-- Authorize\n|   |   `-- Audit');
});
it('supports whole-diagram alternatives and preserves identities across moves', () => {
  const { service, base, variant, logical } = fixture();
  const moved = service.revise(base.id, { kind: 'replace', input: { ascii: 'Shop\n|-- Payment\n|   `-- Capture\n`-- Cart\n    `-- Authorize', structureKind: 'tree' },
    nodeCorrespondence: { [logical.Shop]: 1, [logical.Payment]: 2, [logical.Capture]: 3, [logical.Cart]: 4, [logical.Authorize]: 5 } }).revision;
  variant.ownerNodeId = 'root'; variant.headRevisionId = moved.id; variant.revisionIds = [moved.id];
  variant.decisions = Object.fromEntries(variantChanges(base, moved, 'root').map(c => [c.id, 'accept']));
  const result = applyVariant(variant, base, service);
  expect(result.diagram.content.ascii).toBe(moved.diagram.content.ascii);
  const authorize = diagramContentNodes(result.diagram.content).find(n => n.label === 'Authorize')!;
  expect(result.revision.nodeRefs[authorize.id]).toBe(logical.Authorize);
  variant.ownerNodeId = logical.Payment;
  expect(() => applyVariant(variant, base, service)).toThrow('SUBTREE_SCOPE');
});
it('rejects structural application that would discard non-node prose', () => {
  const { service, base, variant, logical } = fixture();
  const withNotes = service.revise(base.id, {kind:'replace', input:{ascii:base.diagram.content.ascii + '\n\nNotes: retain this explanation',structureKind:'tree'},
    nodeCorrespondence:Object.fromEntries(diagramContentNodes(base.diagram.content).map(n=>[base.nodeRefs[n.id],n.line]))}).revision;
  const candidate = service.revise(withNotes.id, {kind:'replace', input:{ascii:withNotes.diagram.content.ascii.replace('|   `-- Capture','|   |-- Capture\n|   `-- Notify'),structureKind:'tree'},
    nodeCorrespondence:{[logical.Shop]:1,[logical.Payment]:2,[logical.Authorize]:3,[logical.Capture]:4,[logical.Cart]:6}}).revision;
  Object.assign(variant,{ownerNodeId:'root',baseRevisionId:withNotes.id,headRevisionId:candidate.id,revisionIds:[candidate.id]});
  variant.decisions=Object.fromEntries(variantChanges(withNotes,candidate,'root').map(c=>[c.id,'accept']));
  expect(()=>applyVariant(variant,withNotes,service)).toThrow('VARIANT_LAYOUT');
});
