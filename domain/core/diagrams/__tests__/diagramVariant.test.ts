import { getDiagramRevision, retainDiagramRevision } from '../diagramRevisionStore';
import type { DiagramRevision } from '../diagramRevision';
import { resolveRevisionLines, revisionSelectionKey } from '../diagramRevisionSelection';
import { expect, it } from 'vitest';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../diagramContentNodes';
import { stripNodeContinuity } from '../diagramNodeContinuity';
import { applyRevisionReview as prepareRevisionReview, revisionChanges, reviewRevision, type DiagramRevisionReview } from '../diagramRevisionReview';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';
import { workspaceRecords, recordsWorkspace, validateRecordUpdate } from '../../../mapping/workspace/workspaceRecords';

const applyRevisionReview = (review: DiagramRevisionReview, current: DiagramRevision) => retainDiagramRevision(prepareRevisionReview(review, current, getDiagramRevision));

function fixture() {
  const service = revisionFixture();
  const base = service.create({ id: 'shop', revision: 0, structureKind: 'tree', ascii: 'Shop\n|-- Payment\n|   |-- Authorize\n|   `-- Capture\n`-- Cart' }).revision;
  const logical = Object.fromEntries(diagramContentNodes(base.diagram.content).map(n => [n.label, base.nodeRefs[n.id]]));
  const controller = new MappingDocumentController({ scene: { root: { id: 'root', kind: 'container', position: { column: 0, row: 0 }, collapsed: false,
    layout: { collisionPolicy: 'push-right', gap: 3 }, children: [{ id: 'shop', kind: 'diagram', contentId: 'shop', position: { column: 0, row: 0 }, collapsed: false }] }, contents: { shop: base.diagram } }, edges: [], sections: {} }, initialCanvasState(), 0, undefined, undefined, undefined);
  const next = service.revise(base.id, { kind: 'replace', input: { ascii: 'Shop\n|-- Payment\n|   |-- Authorize asynchronously\n|   `-- Capture later\n`-- Cart', structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(diagramContentNodes(base.diagram.content).map(n => [base.nodeRefs[n.id], n.line])) }).revision;
  const variant: DiagramRevisionReview = { id: 'variant-a', name: 'Async payment', contentId: 'shop', diagramId: base.diagramId, ownerNodeId: logical.Payment,
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
  expect(revisionChanges(base, next, variant.ownerNodeId).map(c => c.id)).toEqual([logical.Authorize, logical.Capture]);
  variant.decisions[logical.Authorize] = 'accept';
  const current = service.revise(base.id, { kind: 'patch', start: 5, end: 5, patch: '`-- Cart updated' });
  const result = applyRevisionReview(variant, current.revision);
  expect(result.diagram.content.ascii).toBe('Shop\n|-- Payment\n|   |-- Authorize asynchronously\n|   `-- Capture\n`-- Cart updated');
  expect(Object.values(result.revision.nodeRefs)).toContain(logical.Authorize);
  variant.appliedReview = { headRevisionId: next.id, decisions: { ...variant.decisions } }; variant.appliedRevisionId = result.revision.id;
  variant.decisions[logical.Authorize] = 'reject';
  expect(applyRevisionReview(variant, result.revision).diagram.content.ascii).toBe('Shop\n|-- Payment\n|   |-- Authorize\n|   `-- Capture\n`-- Cart updated');
});
it('refuses to overwrite an intervening edit to an accepted logical node', () => {
  const { service, base, variant, logical } = fixture();
  variant.decisions[logical.Authorize] = 'accept';
  const changed = service.revise(base.id, { kind: 'replace', input: { ascii: base.diagram.content.ascii.replace('Authorize', 'Manual authorization'), structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(diagramContentNodes(base.diagram.content).map(n => [base.nodeRefs[n.id], n.line])) });
  expect(() => applyRevisionReview(variant, changed.revision)).toThrow('VARIANT_CONFLICT');
});
it('retains independent candidates without changing live content, survives persistence and undo', () => {
  const { controller, variant, next, base, logical } = fixture();
  controller.applyUpdate(0, [{ method: 'variant-store', nodeId: 'grid:shop', expectedRevisionId: base.id, variants: [{ variant, revision: next }, { variant: { ...variant, id: 'variant-b', name: 'Second alternative' }, revision: next }] }]);
  expect(controller.getSnapshot().document.scene.contents.shop.revisionId).toBe(base.id);
  controller.applyUpdate(1, [{ method: 'variant-review', variantId: variant.id, decisions: { [logical.Authorize]: 'accept' }, nodeId: 'grid:shop', apply: true }]);
  expect(controller.getSnapshot().document.revisionReviews!['variant-b'].decisions).toEqual({});
  const state = controller.getSnapshot();
  const records = workspaceRecords({ schemaVersion: 3, projectId: 'p', documents: [{ representationId: 'draft-test', name: 'Test', savedName: '', savedScene: JSON.stringify(state.document.scene), revisionId: '',
    document: state.document, canvas: state.canvas, history: controller.exportHistory() }] });
  validateRecordUpdate(records, Object.keys(records), 'p');
  const loaded = recordsWorkspace(records)!.documents[0];
  const restored = new MappingDocumentController(loaded.document, loaded.canvas, 0, undefined, undefined, loaded.history);
  expect(restored.getSnapshot().document.revisionReviews).toEqual(state.document.revisionReviews);
  restored.undo();
  expect(restored.getSnapshot().document.scene.contents.shop.revisionId).toBe(base.id);
  expect(Object.keys(restored.getSnapshot().document.revisionReviews!)).toHaveLength(2);
  restored.undo(true); expect(restored.getSnapshot().document.scene.contents.shop.content.ascii).toContain('Authorize asynchronously');
});
it('requires related structural changes together and preserves added logical identities', () => {
  const { service, base, variant, logical } = fixture();
  const added = service.revise(base.id, { kind: 'replace', input: { ascii: base.diagram.content.ascii.replace('|   `-- Capture', '|   |-- Capture\n|   `-- Notify'), structureKind: 'tree' },
    nodeCorrespondence: { [logical.Shop]: 1, [logical.Payment]: 2, [logical.Authorize]: 3, [logical.Capture]: 4, [logical.Cart]: 6 } }).revision;
  variant.headRevisionId = added.id; variant.revisionIds.push(added.id);
  const changes = revisionChanges(base, added, variant.ownerNodeId), addition = changes.find(c => c.kind === 'added')!;
  variant.decisions[addition.id] = 'accept';
  expect(reviewRevision(variant, id => service.getRevision(id)).error).toContain('REVIEW_DEPENDENCY');
  variant.decisions = Object.fromEntries(changes.map(c => [c.id, 'accept']));
  const applied = applyRevisionReview(variant, base);
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
  const applied = applyRevisionReview(variant, base);
  variant.appliedReview = { headRevisionId: next.id, decisions: { ...variant.decisions } }; variant.appliedRevisionId = applied.revision.id;
  const later = service.revise(applied.revision.id, { kind: 'patch', start: 4, end: 4, patch: '|   |   `-- Audit\n|   `-- Capture' });
  variant.decisions[logical.Authorize] = 'reject';
  expect(applyRevisionReview(variant, later.revision).diagram.content.ascii).toContain('|   |-- Authorize\n|   |   `-- Audit');
});
it('supports whole-diagram alternatives and preserves identities across moves', () => {
  const { service, base, variant, logical } = fixture();
  const moved = service.revise(base.id, { kind: 'replace', input: { ascii: 'Shop\n|-- Payment\n|   `-- Capture\n`-- Cart\n    `-- Authorize', structureKind: 'tree' },
    nodeCorrespondence: { [logical.Shop]: 1, [logical.Payment]: 2, [logical.Capture]: 3, [logical.Cart]: 4, [logical.Authorize]: 5 } }).revision;
  variant.ownerNodeId = 'root'; variant.headRevisionId = moved.id; variant.revisionIds = [moved.id];
  variant.decisions = Object.fromEntries(revisionChanges(base, moved, 'root').map(c => [c.id, 'accept']));
  const result = applyRevisionReview(variant, base);
  expect(result.diagram.content.ascii).toBe(moved.diagram.content.ascii);
  const authorize = diagramContentNodes(result.diagram.content).find(n => n.label === 'Authorize')!;
  expect(result.revision.nodeRefs[authorize.id]).toBe(logical.Authorize);
  variant.ownerNodeId = logical.Payment;
  expect(() => applyRevisionReview(variant, base)).toThrow('SUBTREE_SCOPE');
});
it('rejects structural application that would discard non-node prose', () => {
  const { service, base, variant, logical } = fixture();
  const withNotes = service.revise(base.id, {kind:'replace', input:{ascii:base.diagram.content.ascii + '\n\nNotes: retain this explanation',structureKind:'tree'},
    nodeCorrespondence:Object.fromEntries(diagramContentNodes(base.diagram.content).map(n=>[base.nodeRefs[n.id],n.line]))}).revision;
  const candidate = service.revise(withNotes.id, {kind:'replace', input:{ascii:withNotes.diagram.content.ascii.replace('|   `-- Capture','|   |-- Capture\n|   `-- Notify'),structureKind:'tree'},
    nodeCorrespondence:{[logical.Shop]:1,[logical.Payment]:2,[logical.Authorize]:3,[logical.Capture]:4,[logical.Cart]:6}}).revision;
  Object.assign(variant,{ownerNodeId:'root',baseRevisionId:withNotes.id,headRevisionId:candidate.id,revisionIds:[candidate.id]});
  variant.decisions=Object.fromEntries(revisionChanges(withNotes,candidate,'root').map(c=>[c.id,'accept']));
  expect(()=>applyRevisionReview(variant, withNotes)).toThrow('VARIANT_LAYOUT');
});

it('cycles saved alternatives without accepting them, preserves outside edits, and restores selection after persistence and undo', () => {
  const { controller, service, base, next, logical, variant } = fixture();
  const update = (operations: Parameters<typeof controller.applyUpdate>[1]) => controller.applyUpdate(controller.getSnapshot().version, operations);
  update([{ method: 'variant-store', nodeId: 'grid:shop', expectedRevisionId: base.id, variants: [{ variant, revision: next }] }]);
  update([{ method: 'patchDiagram', nodeId: 'grid:shop', start: 5, end: 5, patch: '`-- Cart updated elsewhere' }]);
  const selection = { method: 'variant-select' as const, nodeId: 'grid:shop', ownerNodeId: logical.Payment, contextVariantId: null, variantId: variant.id };
  update([selection]);
  const render = (document = controller.getSnapshot().document) => resolveRevisionLines(service.getRevision(document.scene.contents.shop.revisionId), document, id => service.getRevision(id)).map(l => l.revision.diagram.content.ascii.split('\n')[l.sourceLine - 1]).join('\n');
  expect(render()).toContain('Authorize asynchronously');
  expect(render()).toContain('Cart updated elsewhere');
  expect(controller.getSnapshot().document.revisionReviews![variant.id].decisions).toEqual({});
  update([{ ...selection, variantId: null }]);
  expect(render()).not.toContain('asynchronously');
  controller.undo(); expect(render()).toContain('asynchronously');
  const snapshot = controller.getSnapshot();
  const restored = new MappingDocumentController(snapshot.document, snapshot.canvas, 0, undefined, undefined, JSON.parse(JSON.stringify(controller.exportHistory())));
  expect(render(restored.getSnapshot().document)).toBe(render());
});
it('scopes nested selections to their parent variant and remembers them when switching back', () => {
  const { controller, service, base, next, logical, variant } = fixture();
  const nested = service.revise(next.id, { kind: 'replace', input: { ascii: next.diagram.content.ascii.replace('Authorize asynchronously', 'Authorize with retry'), structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(diagramContentNodes(next.diagram.content).map(n => [next.nodeRefs[n.id], n.line])) }).revision;
  const child = { ...variant, id: 'child', contextVariantId: variant.id, ownerNodeId: logical.Authorize, baseRevisionId: next.id, headRevisionId: nested.id, revisionIds: [nested.id] };
  controller.applyUpdate(0, [{ method: 'variant-store', nodeId: 'grid:shop', expectedRevisionId: base.id, variants: [{ variant, revision: next }, { variant: child, revision: nested }] }]);
  const select = (ownerNodeId: string, contextVariantId: string | null, variantId: string | null) => controller.applyUpdate(controller.getSnapshot().version, [{ method: 'variant-select', nodeId: 'grid:shop', ownerNodeId, contextVariantId, variantId }]);
  select(logical.Payment, null, variant.id); select(logical.Authorize, variant.id, child.id);
  const text = () => resolveRevisionLines(base, controller.getSnapshot().document, id => service.getRevision(id)).map(l => l.revision.diagram.content.ascii.split('\n')[l.sourceLine - 1]).join('\n');
  expect(text()).toContain('Authorize with retry');
  select(logical.Payment, null, null); expect(text()).not.toContain('with retry');
  select(logical.Payment, null, variant.id); expect(text()).toContain('Authorize with retry');
  expect(controller.getSnapshot().document.revisionSelections![revisionSelectionKey('shop', logical.Authorize, next.id)].revisionId).toBe(child.headRevisionId);
  expect(() => select(logical.Authorize, null, child.id)).toThrow('Invalid branch');
});

it('stores and selects generated variants in a single undo step', () => {
  const { controller, service, base, next, variant } = fixture();
  controller.applyUpdate(0, [{ method: 'variant-store', nodeId: 'grid:shop', expectedRevisionId: base.id, variants: [{ variant, revision: next }], selectFirst: true }]);
  const selected = controller.getSnapshot();
  expect(selected.document.revisionSelections![revisionSelectionKey('shop', variant.ownerNodeId, null)].revisionId).toBe(variant.headRevisionId);
  expect(resolveRevisionLines(base, selected.document, id => service.getRevision(id)).some(l => l.revision.id === variant.headRevisionId)).toBe(true);
  controller.undo();
  expect(controller.getSnapshot().document.revisionReviews).toBeUndefined();
  expect(controller.getSnapshot().document.revisionSelections).toBeUndefined();
  controller.undo(true);
  expect(controller.getSnapshot().document.revisionSelections).toEqual(selected.document.revisionSelections);
});
