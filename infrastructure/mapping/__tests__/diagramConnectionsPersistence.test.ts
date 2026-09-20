import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { connectionContentNodes, defaultArrowAppearance, type DiagramConnection } from '../../../domain/core/diagrams/diagramConnection';
import { singleDiagramScene, sceneFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { ProjectCatalogStore } from '../../core/persistence/projectCatalogStore';

it('persists connections in immutable document revisions while preserving diagram content exactly', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'connection-persistence-'));
  try {
    const store = new ProjectCatalogStore(root);
    const scene = singleDiagramScene('[Alpha] ---> [Beta]');
    if (scene.root.kind !== 'container') throw new Error();
    scene.root.children = [...scene.root.children, { ...scene.root.children[0], id: 'second', position: { column: 40, row: 2 } }];
    const content = scene.contents.overview.content;
    const edge: DiagramConnection = { id: 'edge-1', source: { kind: 'content-node', displayNodeId: 'grid:overview', revisionId: content.revisionId,
      contentNodeId: connectionContentNodes(content)[0].id, side: 'right' }, target: { kind: 'box', displayNodeId: 'grid:second', side: 'left' }, appearance: { ...defaultArrowAppearance, label: 'Uses' } };
    scene.contents.overview.jumps = [{ id: 'jump', source: { revisionId: content.revisionId, contentHash: content.asciiSha256,
      line: 1, startColumn: 1, endColumn: 7 }, target: { representationId: 'another-saved-canvas', displayNodeId: 'grid:overview' } }];
    const created = await store.saveMappingDiagram('project-one', { name: 'Connections', scene, edges: [edge] });
    const reopened = await new ProjectCatalogStore(root).loadRepresentationCatalog('project-one');
    const revision = reopened.revisions[created.representation.currentRevisionId];
    expect(revision.content).toEqual({ kind: 'mapping-canvas', scene, edges: [edge] });
    expect(sceneFromRevision(revision)).toEqual(scene);
    const saved = await store.saveMappingDiagram('project-one', { name: 'Connections', scene, edges: [],
      representationId: created.representation.id, expectedRevisionId: revision.id });
    expect(saved.catalog.revisions[revision.id].content).toEqual(revision.content);
    expect(saved.catalog.revisions[saved.representation.currentRevisionId].content).toEqual({ kind: 'mapping-canvas', scene, edges: [] });
    await expect(store.saveMappingDiagram('project-one', { name: 'Invalid', scene, edges: [{ ...edge, target: { ...edge.target, displayNodeId: 'grid:missing' } }] })).rejects.toThrow('GridBox');
  } finally { await rm(root, { recursive: true, force: true }); }
});
