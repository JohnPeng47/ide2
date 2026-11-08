import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backfillPlacementLineage } from '../../../../domain/mapping/evals/placementLineage';
import { CanvasHistory, documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { historyFromRevision } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { CanvasCatalogStore } from '../canvasCatalogStore';
import { prepareOutputPromotion, type PromotionPublication } from '../../../../domain/mapping/evals/outputPromotion';
import { materializeLinkedCanvases } from '../../../../application/mapping/evals/linkedCanvasesMaterializer';
import { linkedOutput } from '../../../../tests/support/linkedCanvasOutput';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'output-promotion-')); roots.push(root);
  const store = new CanvasCatalogStore(root), requestId = crypto.randomUUID();
  const { result } = materializeLinkedCanvases(linkedOutput(), [], 'p');
  const documents = prepareOutputPromotion(result, { requestId, cellKey: 'cell', destination: 'new-project', name: 'Shopify', canvasProjectId: 'shopify' });
  const publication: PromotionPublication = { requestId, signature: 'request-signature', canvasProject: { id: 'shopify', name: 'Shopify' }, documents };
  return { root, store, publication, result };
}
it('atomically publishes a named project and remapped canvases; retries survive restart', async () => {
  const { root, store, publication } = await fixture();
  const receipt = await store.publishOutputPromotion('project', publication);
  const reopened = new CanvasCatalogStore(root);
  expect(await reopened.publishOutputPromotion('project', publication)).toEqual(receipt);
  const catalog = await reopened.loadRepresentationCatalog('project');
  expect(Object.values(catalog.representations)).toHaveLength(2);
  expect(catalog.canvasProjects?.shopify.name).toBe('Shopify');
  expect(Object.values(catalog.representations).every(c => c.canvasProjectId === 'shopify' && c.type === 'standard')).toBe(true);
  await expect(reopened.publishOutputPromotion('project', { ...publication, signature: 'changed' })).rejects.toThrow('REQUEST_ID_CONFLICT');
});
it('publishes nothing when a later canvas fails validation', async () => {
  const { store, publication } = await fixture();
  publication.documents[1].name = '';
  await expect(store.publishOutputPromotion('project', publication)).rejects.toThrow();
  const catalog = await store.loadRepresentationCatalog('project');
  expect(Object.keys(catalog.representations)).toHaveLength(0);
  expect(catalog.canvasProjects).toBeUndefined();
});

it('persists immutable promotion baselines and pins checkpoint/revision identities', async () => {
  const { store, publication, result } = await fixture();
  publication.placementSource = { runId: 'run', cellKey: 'cell' };
  const receipt = await store.publishOutputPromotion('project', publication);
  expect(receipt.placementLineage?.diagrams).toHaveLength(2);
  const catalog = await store.loadRepresentationCatalog('project');
  for (const binding of receipt.placementLineage!.diagrams) {
    const canvas = catalog.representations[binding.promoted.canvasId];
    expect(binding.promoted.canvasRevisionId).toBe(canvas.currentRevisionId);
    expect(binding.promoted.checkpointId).toBe(historyFromRevision(catalog.revisions[canvas.currentRevisionId]).headId);
    expect(result.placementSnapshot!.diagrams).toContainEqual(binding.generated);
  }
  expect(await store.publishOutputPromotion('project', publication)).toEqual(receipt);
});
it('backfills from original promotion history despite later moves, preserving every canvas revision', async () => {
  const { store, publication, result } = await fixture();
  const receipt = await store.publishOutputPromotion('project', publication);
  let catalog = await store.loadRepresentationCatalog('project');
  const original = catalog.representations[receipt.canvases[0].id];
  const history = historyFromRevision(catalog.revisions[original.currentRevisionId]);
  const doc = documentFromHistory(history);
  const changed = structuredClone(doc);
  changed.scene.root.position.column += 50;
  const next = new CanvasHistory(doc, history.snapshots[history.headId].view, history);
  next.append(changed, history.snapshots[history.headId].view);
  await store.saveMappingDiagram('project', { representationId: original.id, expectedRevisionId: original.currentRevisionId,
    name: 'Renamed after promotion', type: 'standard', history: next.export(), scene: changed.scene, edges: changed.edges });
  catalog = await store.loadRepresentationCatalog('project');
  const lineage = backfillPlacementLineage(result, { runId: 'run', cellKey: 'cell' }, receipt, catalog);
  expect(lineage.diagrams[0].promoted.column).toBe(lineage.diagrams[0].generated.column);
  expect(lineage.diagrams[0].promoted.canvasRevisionId).toBe(original.currentRevisionId);
  const patch = { requestId: publication.requestId, signature: publication.signature, lineage };
  const patched = await store.backfillPromotionPlacementLineage('project', patch);
  expect(await store.backfillPromotionPlacementLineage('project', patch)).toEqual(patched);
  await expect(store.backfillPromotionPlacementLineage('project', { ...patch, lineage: { ...lineage, promotedAt: 'changed' } })).rejects.toThrow('immutable');
  const after = await store.loadRepresentationCatalog('project');
  expect(after.representations).toEqual(catalog.representations);
  expect(after.revisions).toEqual(catalog.revisions);
  const ambiguous = { ...result, canvases: [...result.canvases, { ...result.canvases[0], id: 'duplicate' }] };
  expect(() => backfillPlacementLineage(ambiguous, lineage.source, receipt, catalog)).toThrow('uniquely');
});
