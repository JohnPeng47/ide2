import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasCatalogStore } from '../canvasCatalogStore';
import { CanvasHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { prepareDiagramProjection } from '../../../../domain/core/diagrams/highlightProjection';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { WorkspaceRecordStore } from '../../../mapping/persistence/workspace/workspaceRecordStore';
import { documentRecords } from '../../../../domain/mapping/workspace/workspaceRecords';

it('retains projection types on publication and migrates legacy catalogs through both readers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-type-'));
  try {
    const store = new CanvasCatalogStore(root);
    const source = new CanvasHistory({ scene: singleDiagramScene('Source'), edges: [], sections: {} }, initialCanvasState()).export();
    const { destination } = prepareDiagramProjection(source, { sourceId: 'source', sourceAliases: ['source'],
      destinationId: 'projection', selectedIds: ['grid:overview'], destinationView: initialCanvasState() });
    const saved = await store.saveMappingDiagram('project', { name: 'Projection', scene: destination.document.scene,
      edges: destination.document.edges, history: destination.history });
    const id = saved.representation.id;
    expect(saved.representation.type).toBe('projection');
    const file = join(root, 'canvases/catalog.json');
    const catalog = JSON.parse(await readFile(file, 'utf8'));
    expect(catalog.representations[id].type).toBe('projection');
    delete catalog.representations[id].type;
    await writeFile(file, JSON.stringify(catalog));
    const restarted = new CanvasCatalogStore(root);
    expect((await restarted.loadCurrentRepresentationCatalog('project')).representations[id].type).toBe('projection');
    expect((await restarted.loadRepresentationCatalog('project')).representations[id].type).toBe('projection');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('publishes the persisted canvas type even without projection layout metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-type-checkpoint-'));
  try {
    const document = { scene: singleDiagramScene('Independent projection'), edges: [], sections: {} };
    const canvas = initialCanvasState(), history = new CanvasHistory(document, canvas).export();
    const records = documentRecords({ representationId: 'draft-projection', type: 'projection',
      name: 'Projection', revisionId: '', savedName: '', savedScene: JSON.stringify(document.scene), document, canvas, history });
    Object.assign(records['document/draft-projection/metadata'] as object, { version: 0 });
    const workspace = new WorkspaceRecordStore(root);
    await workspace.state('project', async () => null);
    await workspace.apply('project', { requestId: 'persist', expectedRevision: 0, changes: [
      { key: 'workspace', value: { projectId: 'project', documentIds: ['draft-projection'], activeDocumentId: 'draft-projection', transfers: [] } },
      ...Object.entries(records).map(([key, value]) => ({ key, value }))
    ] });
    const catalog = new CanvasCatalogStore(root);
    const receipt = await catalog.publishCheckpoint('project', { documentId: 'draft-projection', checkpointId: history.headId,
      expectedVersion: 0, requestId: 'publish', name: 'Projection' }, () => workspace.capture('project', 'draft-projection', history.headId, 0));
    expect(receipt.representation.type).toBe('projection');
    expect((await catalog.loadCurrentRepresentationCatalog('project')).representations[receipt.representation.id].type).toBe('projection');
  } finally { await rm(root, { recursive: true, force: true }); }
});
