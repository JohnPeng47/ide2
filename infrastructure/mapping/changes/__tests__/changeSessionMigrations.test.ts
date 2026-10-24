import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { canvasSaveFixture } from '../../../../tests/support/mappingDiagram';
import { DiagramChangeSessionStore } from '../diagramChangeSessionStore';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { QuickJsAgentRuntime } from '../../agent/execRuntime';
import { ProjectCatalogStore } from '../../../core/persistence/projectCatalogStore';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import type { DiagramMigration } from '../../../../domain/mapping/changes/diagramMigration';

it('authors paired migrations through the public API, validates stale endpoints and preserves accepted review metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'migration-api-'));
  try {
    const catalog = new ProjectCatalogStore(root);
    const save = async (name: string, ascii: string) => {
      const scene = singleDiagramScene(ascii);
      scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram };
      return (await catalog.saveMappingDiagram('project', canvasSaveFixture({ name, scene }))).representation.id;
    };
    const sourceId = await save('Controller', 'Controller\n|-- undo / redo\n`-- checkpoints');
    const destinationId = await save('Editor', 'Editor\n`-- HistoryManager\n    `-- undo / redo');
    const repository = { loadProject: async () => ({ id: 'project' }), projectCatalogs: catalog } as unknown as DiagramRepository;
    const bridge: CanvasSessionPort = { register() {}, list: () => [], poll: async () => [], reply() {}, unregister() {}, dispose() {}, dispatch: async () => { throw Error('Touched live bridge'); } };
    const changes = new ChangeSessionService(new DiagramChangeSessionStore(root), repository, bridge);
    const agent = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, repository, new QuickJsAgentRuntime(), changes);
    const call = (name: Parameters<typeof agent.call>[0], input: unknown): Promise<any> => agent.call(name, input);
    const { changeSessionId } = await call('create_diagram_change_session', { title: 'Live undo ownership', requestId: 'create' });
    let seq = 0;
    const update = async (input: object) => call('update_diagram_change_session', { changeSessionId, expectedVersion: (await changes.get(changeSessionId)).version, requestId: `update-${++seq}`, ...input });
    const read = (documentId: string, snapshot: string) => call('diagram-search', { changeSessionId, operation: 'read', representationId: documentId, snapshot });
    const endpoint = async (documentId: string, snapshot: 'baseline' | 'proposed', label: string) => {
      const node = (await read(documentId, snapshot)).nodes.find((node: any) => node.id === 'grid:overview');
      return { documentId, displayNodeId: node.id, revisionId: node.content.revisionId, snapshot, scope: 'node' as const,
        contentNodeId: (Object.values(node.content.structure.nodes) as any[]).find(n => n.label === label).id };
    };
    await changes.apply(changeSessionId, sourceId, 0, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 2, end: 2, patch: '' }], 'remove-source');
    const migration: DiagramMigration = { id: 'U', title: 'Live undo/redo', description: 'Mounted editor owns live undo; controller keeps checkpoints.', kind: 'feature-ownership',
      source: await endpoint(sourceId, 'baseline', 'undo / redo'),
      destination: { ...await endpoint(destinationId, 'proposed', 'HistoryManager'), snapshot: 'proposed', scope: 'subtree' } };
    expect(migration.source.contentNodeId).toMatch(/^@/);
    const request = { changeSessionId, requestId: 'annotate', expectedVersion: (await changes.get(changeSessionId)).version, migrations: [migration], status: 'ready' };
    const result = await call('update_diagram_change_session', request);
    expect(result.migrations).toEqual([migration]);
    expect(await call('update_diagram_change_session', request)).toEqual(result);
    const persisted = await changes.get(changeSessionId);
    expect(persisted.migrations![0].source.contentNodeId).not.toMatch(/^@/);
    expect(persisted.changes).toHaveLength(1); // Unchanged destination does not need a fake content edit.
    expect((await read(sourceId, 'baseline')).changeSession.migrations).toEqual([migration]);
    expect((await call('diagram-search', { changeSessionId, operation: 'search', snapshot: 'baseline', query: 'undo / redo' })).hits.length).toBeGreaterThan(0);
    const restarted = new ChangeSessionService(new DiagramChangeSessionStore(root), repository, bridge);
    expect((await restarted.list())[0].migrations).toEqual(persisted.migrations);
    expect((await restarted.preview(changeSessionId, destinationId))?.migrations).toEqual(persisted.migrations);
    await expect(update({ migrations: [migration, migration] })).rejects.toThrow('Duplicate migration ID');
    await expect(update({ migrations: [{ ...migration, destination: { ...migration.destination, revisionId: 'stale' } }] })).rejects.toThrow('revision is stale');
    await expect(update({ migrations: [{ ...migration, destination: { ...migration.destination, snapshot: 'baseline' } }] })).rejects.toThrow();
    await expect(call('diagram-search', { operation: 'read', snapshot: 'baseline', representationId: sourceId })).rejects.toThrow('snapshot requires');
    expect((await changes.get(changeSessionId)).version).toBe(persisted.version);
    await update({ migrations: [] });
    expect((await changes.get(changeSessionId)).migrations).toEqual([]);
    await update({ migrations: [migration] });
    await update({ title: 'Reviewed ownership' });
    expect((await changes.get(changeSessionId)).migrations).toEqual(persisted.migrations);
    await changes.apply(changeSessionId, destinationId, 0, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 3, end: 3, patch: '    `-- native undo / redo' }], 'destination-edit');
    await expect(update({ status: 'ready' })).rejects.toThrow('revision is stale');
    await update({ action: 'undo', documentId: destinationId });
    await update({ status: 'ready' });
    const ready = await changes.get(changeSessionId);
    expect(ready.migrations).toEqual(persisted.migrations);
    const before = await catalog.loadRepresentationCatalog('project');
    await call('accept_diagram_change_session', { changeSessionId, expectedVersion: ready.version, requestId: 'accept' });
    const accepted = await restarted.get(changeSessionId);
    expect(accepted.status).toBe('accepted');
    expect(accepted.migrations).toEqual(persisted.migrations);
    expect(accepted.documents.find(d => d.id === sourceId)!.baseline!.document.scene.contents.overview.content.ascii).toContain('undo / redo');
    const after = await catalog.loadRepresentationCatalog('project');
    expect(after.representations[destinationId].currentRevisionId).toBe(before.representations[destinationId].currentRevisionId);
    await expect(update({ migrations: [] })).rejects.toThrow('cannot be edited');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
