import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CanvasCatalogStore } from '../canvasCatalogStore';
import { WorkspaceRecordStore } from '../../../mapping/persistence/workspace/workspaceRecordStore';
import { documentPrefix, historyChanges } from '../../../../domain/mapping/workspace/workspaceRecords';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { singleDiagramScene, historyFromRevision } from '../../../../domain/core/diagrams/projectDiagramCanvas';

it('publishes persisted records without expanding a >100 MiB archive, preserves it on restore, and deduplicates receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'checkpoint-publication-'));
  try {
    const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Service')), initialCanvasState());
    controller.applyUpdate(0, [{ method: 'highlight', nodeId: 'grid:overview', color: 'blue', highlightId: 'h' }]);
    const delta = controller.persistenceChanges();
    // Historical presentation data can dwarf the current document. Store it once.
    delta.snapshots = structuredClone(delta.snapshots);
    delta.snapshots[delta.header.baselineId].view = { archive: 'x'.repeat(101 * 1024 * 1024) };
    const workspace = new WorkspaceRecordStore(root);
    await workspace.state('project', async () => null);
    const prefix = documentPrefix('draft-doc');
    await workspace.apply('project', { requestId: 'persist', expectedRevision: 0, changes: [
      { key: 'workspace', value: { projectId: 'project', documentIds: ['draft-doc'], activeDocumentId: 'draft-doc', transfers: [] } },
      ...historyChanges('draft-doc', delta),
      { key: prefix + 'metadata', value: { representationId: 'draft-doc', name: 'Test', version: 1 } },
      { key: prefix + 'baseline', value: { revisionId: '', savedName: '', savedScene: JSON.stringify(controller.getSnapshot().document.scene), savedEdges: '[]' } },
      { key: prefix + 'canvas', value: controller.getSnapshot().canvas }
    ] });
    const catalog = new CanvasCatalogStore(root);
    const input = { documentId: 'draft-doc', checkpointId: delta.header.headId, expectedVersion: 1, requestId: 'publish', name: 'Saved' };
    const receipt = await catalog.publishCheckpoint('project', input, () => workspace.capture('project', input.documentId, input.checkpointId, input.expectedVersion));
    expect(Buffer.byteLength(JSON.stringify(receipt))).toBeLessThan(2000);
    expect(await catalog.publishCheckpoint('project', input, () => workspace.capture('project', input.documentId, input.checkpointId, input.expectedVersion))).toEqual(receipt);
    await expect(catalog.publishCheckpoint('project', { ...input, name: 'Different' }, async () => { throw Error('must not capture'); })).rejects.toThrow('REQUEST_ID_CONFLICT');
    await expect(catalog.publishCheckpoint('project', { ...input, requestId: 'stale', expectedVersion: 0 }, () => workspace.capture('project', input.documentId, input.checkpointId, 0))).rejects.toThrow('VERSION_CONFLICT');
    const stored = await readFile(join(root, 'canvases/catalog.json'), 'utf8');
    expect(Buffer.byteLength(stored)).toBeLessThan(30_000);
    expect(stored).toContain('workspaceRecords');
    const manifest = JSON.parse(await readFile(join(root, 'workspace-records.json'), 'utf8'));
    const archived = manifest.records[prefix + 'checkpoint/' + delta.header.baselineId];
    // A current read must not open an unrelated archived checkpoint.
    const archivePath = join(root, 'workspace-records', archived + '.json');
    await writeFile(archivePath, 'unreadable archive');
    const current = await catalog.loadCurrentRepresentationCatalog('project');
    const history = historyFromRevision(current.revisions[receipt.revisionId]);
    expect(Object.keys(history.snapshots)).toEqual([delta.header.headId]);
    expect(history.diagramRevisions[history.snapshots[history.headId].diagramBindings.overview].diagram.highlights).toHaveLength(1);
    // Save references still pin the exact archived record; restore the fixture and verify full-history readers.
    await writeFile(archivePath, JSON.stringify(delta.snapshots[delta.header.baselineId]));
    const restored = await catalog.loadRepresentationCatalog('project');
    const full = historyFromRevision(restored.revisions[receipt.revisionId]);
    expect((full.snapshots[full.baselineId].view as { archive: string }).archive.length).toBe(101 * 1024 * 1024);
    expect(full.past).toEqual(delta.header.past);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
