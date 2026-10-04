import { DiagramPersistence } from '../../../../domain/core/diagrams/diagramPersistence';
import { canvasSaveFixture } from '../../../../tests/support/mappingDiagram';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCatalogStore } from '../canvasCatalogStore';
import { DiagramRevisionStore } from '../diagramRevisionStore';
import { RevisionedDiagramService } from '../../../../domain/core/diagrams/diagramService';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { MappingWorkspaceStore } from '../../../mapping/persistence/workspace/mappingWorkspaceStore';
import { DiagramChangeSessionStore } from '../../../mapping/changes/diagramChangeSessionStore';
import type { DiagramChangeSession } from '../../../../domain/mapping/changes/diagramChangeSession';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'diagram-records-')); roots.push(root);
  const records = new DiagramRevisionStore(root), service = new DiagramPersistence(records);
  const canvas = initialCanvasState();
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original')), canvas, 0, undefined, undefined, undefined, new RevisionedDiagramService());
  controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Changed' }]);
  return { root, records, service, controller, canvas };
}

it('stores diagram revisions and bindings separately and restores durable undo in a new process', async () => {
  const { root, service, controller } = await setup();
  const catalog = new CanvasCatalogStore(root, service);
  const saved = await catalog.saveMappingDiagram('project', { name: 'Canvas', scene: controller.getSnapshot().document.scene, history: controller.exportHistory() });
  const disk = JSON.parse(await readFile(path.join(root, 'canvases/catalog.json'), 'utf8'));
  const history = disk.revisions[saved.representation.currentRevisionId].content.history;
  expect(history.diagramRevisions).toBeUndefined();
  expect(history.diagramHistory.$diagramRecord).toBe('history');
  expect(history.snapshots[history.headId].diagramBindings).toBeUndefined();
  expect(history.snapshots[history.headId].document.scene.contents).toBeUndefined();
  expect((await readdir(path.join(root, 'diagrams/revision'))).length).toBeGreaterThan(1);
  const loaded = await new CanvasCatalogStore(root).loadRepresentationCatalog('project');
  expect(loaded).toEqual(JSON.parse(JSON.stringify(saved.catalog)));
  const stored = loaded.revisions[saved.representation.currentRevisionId].content;
  if (stored?.kind !== 'canvas-history') throw new Error();
  const reopened = new MappingDocumentController(documentFromHistory(stored.history), initialCanvasState(), 0, undefined, undefined, stored.history);
  reopened.undo(); expect(reopened.resolveDiagram('overview').ascii).toBe('Original');
  reopened.undo(true); expect(reopened.resolveDiagram('overview').ascii).toBe('Changed');
});

it('reads the legacy catalog without modifying it, then publishes to the canvas store', async () => {
  const { root, controller } = await setup();
  const catalog = new CanvasCatalogStore(root);
  const saved = await catalog.saveMappingDiagram('project', { name: 'Before', scene: controller.getSnapshot().document.scene, history: controller.exportHistory() });
  await mkdir(path.join(root, 'representations'));
  const original = JSON.stringify(saved.catalog);
  await writeFile(path.join(root, 'representations/catalog.json'), original);
  await rm(path.join(root, 'canvases'), { recursive: true });
  await rm(path.join(root, 'diagrams'), { recursive: true });
  expect(await catalog.loadRepresentationCatalog('project')).toEqual(JSON.parse(original));
  await catalog.saveMappingDiagram('project', canvasSaveFixture({ name: 'After', representationId: saved.representation.id,
    expectedRevisionId: saved.representation.currentRevisionId, scene: controller.getSnapshot().document.scene }));
  expect(await readFile(path.join(root, 'representations/catalog.json'), 'utf8')).toBe(original);
  expect((await catalog.loadRepresentationCatalog('project')).representations[saved.representation.id].name).toBe('After');
});

it('does not publish a canvas if diagram persistence fails', async () => {
  const { root, records, service, controller } = await setup();
  const catalog = new CanvasCatalogStore(root, service);
  const first = await catalog.saveMappingDiagram('project', canvasSaveFixture({ name: 'Before', scene: controller.getSnapshot().document.scene }));
  const before = await readFile(path.join(root, 'canvases/catalog.json'), 'utf8');
  vi.spyOn(records, 'put').mockRejectedValue(new Error('Disk full'));
  await expect(async () => catalog.saveMappingDiagram('project', canvasSaveFixture({ name: 'After', representationId: first.representation.id,
    expectedRevisionId: first.representation.currentRevisionId, scene: singleDiagramScene('New') }))).rejects.toThrow('Disk full');
  expect(await readFile(path.join(root, 'canvases/catalog.json'), 'utf8')).toBe(before);
});

it('externalizes workspace and change-session diagrams while keeping their public exports portable', async () => {
  const { root, service, controller, canvas } = await setup();
  const document = controller.getSnapshot().document, history = controller.exportHistory();
  const workspace = { schemaVersion: 3 as const, projectId: 'project', documents: [{ representationId: 'draft-test',
    name: 'Draft', savedName: '', revisionId: '', document, canvas, history, savedScene: JSON.stringify(document.scene) }] };
  const workspaces = new MappingWorkspaceStore(root, service);
  await workspaces.save('project', workspace);
  const raw = JSON.parse(await readFile(path.join(root, 'mapping-workspace.json'), 'utf8'));
  expect(raw.documents[0].document.scene.contents.overview.$diagramRecord).toBe('diagram');
  expect(raw.documents[0].history.diagramRevisions).toBeUndefined();
  expect(await new MappingWorkspaceStore(root).load('project')).toEqual(JSON.parse(JSON.stringify(workspace)));
  const time = new Date().toISOString();
  const session: DiagramChangeSession = { schemaVersion: 1, id: 'change-test', projectId: 'project', title: 'Proposal', description: '',
    status: 'draft', version: 0, createdAt: time, updatedAt: time, changes: [], migrations: [], receipts: {}, documents: [{ id: 'doc', name: 'Canvas',
      history, baseline: { document, canvas }, proposed: { document, canvas }, version: 0, past: [], future: [] }] };
  await new DiagramChangeSessionStore(root, service).write(session);
  const sessionDisk = JSON.parse(await readFile(path.join(root, 'mapping-change-sessions/project/change-test.manifest.json'), 'utf8'));
  const blob = async (id: string) => JSON.parse(await readFile(path.join(root, 'change-session-records', `${id}.json`), 'utf8'));
  const storedDoc = await blob(sessionDisk.documents.doc);
  expect((await blob(storedDoc.history.header)).diagramRevisions).toBeUndefined();
  expect((await blob(storedDoc.proposed)).document.scene.contents.overview.$diagramRecord).toBe('diagram');
  expect(await new DiagramChangeSessionStore(root).read('project', 'change-test')).toEqual(JSON.parse(JSON.stringify(session)));
  // Missing dependencies must be reported, not interpreted as an absent workspace.
  await rm(path.join(root, 'diagrams'), { recursive: true });
  await expect(workspaces.load('project')).rejects.toThrow();
});

it('rejects corrupted and escaping diagram references', async () => {
  const { root, records, service, controller } = await setup();
  const stored = await service.persist(controller.getSnapshot().document) as any;
  const ref = stored.scene.contents.overview;
  await writeFile(path.join(root, 'diagrams/diagram', `${ref.id}.json`), '{}');
  await expect(service.restore(stored)).rejects.toThrow('integrity');
  await expect(records.get('diagram', '../project')).rejects.toThrow('identity');
});

it('rejects saves without supplied history before publishing any catalog', async () => {
  const { root, controller } = await setup();
  const catalog = new CanvasCatalogStore(root);
  // @ts-expect-error Simulate an untyped HTTP/MCP caller omitting required history.
  await expect(catalog.saveMappingDiagram('project', { name: 'Missing history', scene: controller.getSnapshot().document.scene }))
    .rejects.toThrow('Canvas history is required');
  expect(await readdir(root)).not.toContain('canvases');
});
