import { describe, expect, it } from 'vitest';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { connectionContentNodes, defaultArrowAppearance, reconcileConnections, type ContentNodeAnchor, type DiagramConnection } from '../../../core/diagrams/diagramConnection';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { MappingDocumentController, type DiagramOperation } from '../mappingDocumentController';
import { mappingDocumentFromScene } from '../mappingDocument';
import { initialCanvasState } from '../mappingWorkspace';
import { deserializeWorkspace, serializeWorkspace } from '../mappingWorkspaceCodec';
import { drawEdge } from '../connectionLayout';

function setup() {
  const scene = singleDiagramScene('Root\n+-- Branch\n|   `-- Leaf\n`-- Leaf');
  scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision: 0, ascii: scene.contents.overview.content.ascii, structureKind: 'tree' }).diagram };
  if (scene.root.kind === 'container') scene.root.children = [...scene.root.children, {
    id: 'second', kind: 'diagram', contentId: 'overview', position: { column: 40, row: 2 }, collapsed: false
  }];
  const controller = new MappingDocumentController(mappingDocumentFromScene(scene), initialCanvasState());
  const source = (line = 3, displayNodeId = 'grid:overview'): ContentNodeAnchor => {
    const content = controller.getSnapshot().document.scene.contents.overview.content;
    return { kind: 'content-node', displayNodeId, contentNodeId: connectionContentNodes(content).find(node => node.line === line)!.id, revisionId: content.revisionId, side: 'right' };
  };
  const edge: DiagramConnection = { id: 'link', source: source(), target: { kind: 'box', displayNodeId: 'grid:second', side: 'left' }, appearance: { ...defaultArrowAppearance } };
  const apply = (...ops: DiagramOperation[]) => controller.transact(controller.getSnapshot().version, ops);
  const geometry = () => { const s = controller.getSnapshot(); return drawEdge(s.document.edges[0], s.document.scene, s.canvas.diagramViews, { width: 8, height: 18 }); };
  return { controller, source, edge, apply, geometry };
}

describe('document connections', () => {
  it('does not revive an already-stale endpoint using correspondence for the current revision', () => {
    const { controller, edge } = setup();
    const before = controller.getSnapshot().document.scene;
    const base = before.contents.overview;
    const next = revisionFixture().revise(base.revisionId, { kind: 'patch', start: 4, end: 4, patch: '`-- New leaf' });
    const after = { ...before, contents: { ...before.contents, overview: next.diagram } };
    const stale = { ...edge, source: { ...edge.source, revisionId: 'older-content-revision' } };
    expect(next.nodeIds.has(edge.source.contentNodeId)).toBe(true);
    expect(reconcileConnections(before, after, [stale], next.nodeIds)).toEqual([stale]);
  });
  it('creates an independent relationship and derived FloatingBoxArrow without changing any diagram or panel', () => {
    const { controller, edge, apply } = setup();
    const before = structuredClone(controller.getSnapshot());
    apply({ method: 'edge-create', edge });
    expect(controller.getSnapshot().document.scene).toEqual(before.document.scene);
    expect(controller.getSnapshot().canvas).toEqual(before.canvas);
    expect(controller.nodes().find(node => node.id === 'floating:edge:link')).toMatchObject({ layout: 'floating', kind: 'arrow', collapsible: { self: false }, value: { edgeId: 'link', status: 'resolved' } });
    expect(controller.getSnapshot().canvas.display.nodes).toEqual({});
    controller.undo(); expect(controller.getSnapshot().document.edges).toEqual([]);
    controller.undo(true); expect(controller.getSnapshot().document.edges).toEqual([edge]);
    apply({ method: 'remove', nodeId: 'floating:edge:link' });
    expect(controller.getSnapshot().document.scene).toEqual(before.document.scene);
  });
  it('anchors duplicate labels and repeated diagram instances independently; follows moves in canvas pixels', () => {
    const { controller, source, edge, apply, geometry } = setup();
    edge.target = { ...source(4, 'grid:second'), side: 'left' };
    apply({ method: 'edge-create', edge });
    const before = geometry();
    expect(before.source).toMatchObject({ x: 96, y: 45, side: 'right', proxy: false });
    expect(before.target).toMatchObject({ x: 352, y: 99, side: 'left' });
    apply({ method: 'move', nodeId: 'grid:second', position: { column: 50, row: 5 } });
    expect(geometry().source).toEqual(before.source);
    expect(geometry().target!.x).toBe(before.target!.x + 80);
    expect(geometry().target!.y).toBe(before.target!.y + 54);
    expect(controller.getSnapshot().document.edges[0]).toEqual(edge);
  });
  it('projects folded nodes to visible ancestors and restores the precise attachment on expansion', () => {
    const { controller, source, edge, apply, geometry } = setup();
    apply({ method: 'edge-create', edge });
    const before = geometry();
    apply({ method: 'collapse', nodeId: 'grid:overview', contentNodeId: source(2).contentNodeId, collapsed: true });
    expect(geometry()).toMatchObject({ status: 'proxy', source: { y: 27, proxy: true } });
    expect(controller.getSnapshot().document.edges[0]).toEqual(edge);
    controller.undo(); expect(geometry()).toEqual(before);
    apply({ method: 'collapse', nodeId: 'grid:overview', collapsed: true });
    expect(geometry().status).toBe('proxy');
  });
  it('follows an enclosing collapsed GridBox and prunes incident edges when the group is deleted', () => {
    const { controller, edge, apply, geometry } = setup();
    const doc = structuredClone(controller.getSnapshot().document);
    if (doc.scene.root.kind !== 'container') throw new Error();
    const second = doc.scene.root.children[1];
    doc.scene.root.children = [doc.scene.root.children[0], { id: 'group', kind: 'container', position: { column: 40, row: 2 }, collapsed: false,
      collapsedContentId: 'overview-summary', layout: { collisionPolicy: 'push-right', gap: 3 }, children: [{ ...second, position: { column: 0, row: 0 } }] }];
    controller.commitDocument(doc);
    apply({ method: 'edge-create', edge }, { method: 'collapse', nodeId: 'grid:group', collapsed: true });
    expect(geometry()).toMatchObject({ status: 'proxy', target: { proxy: true, x: 320 } });
    apply({ method: 'remove', nodeId: 'grid:group' });
    expect(controller.getSnapshot().document.edges).toEqual([]);
    controller.undo(); expect(controller.getSnapshot().document.edges).toEqual([edge]);
  });
  it('preserves revision identity on unchanged text; changed text is stale until explicitly reattached', () => {
    const { controller, source, edge, apply, geometry } = setup();
    apply({ method: 'edge-create', edge });
    apply({ method: 'replace', nodeId: 'grid:overview', ascii: controller.getSnapshot().document.scene.contents.overview.content.ascii });
    expect(geometry().status).toBe('resolved');
    expect(controller.getSnapshot().document.edges[0].source.revisionId).not.toBe(edge.source.revisionId);
    apply({ method: 'replace', nodeId: 'grid:overview', ascii: 'Root\n+-- Changed\n|   `-- Leaf\n`-- Leaf' });
    expect(geometry().status).toBe('stale');
    const stale = controller.getSnapshot().document.edges[0];
    apply({ method: 'edge-update', edge: { ...stale, appearance: { ...stale.appearance, label: 'Needs repair' } } });
    expect(geometry().status).toBe('stale');
    apply({ method: 'edge-update', edge: { ...stale, source: source() } });
    expect(geometry().status).toBe('resolved');
  });
  it('validates endpoint kinds and revisions; rejects malformed or stale transactions atomically', () => {
    const { controller, edge, apply } = setup();
    const before = controller.getSnapshot();
    expect(() => apply({ method: 'edge-create', edge }, { method: 'edge-create', edge })).toThrow('already exists');
    expect(controller.getSnapshot()).toBe(before);
    expect(() => apply({ method: 'edge-create', edge: { ...edge, source: { ...edge.source, revisionId: 'old' } } })).toThrow('STALE');
    expect(() => apply({ method: 'edge-create', edge: { ...edge, target: { ...edge.target, displayNodeId: 'floating:missing' } } })).toThrow('GridBox');
    expect(() => apply({ method: 'edge-create', edge: { ...edge, source: edge.target as ContentNodeAnchor } })).toThrow();
    apply({ method: 'edge-create', edge });
    expect(() => controller.transact(before.version, [{ method: 'edge-remove', edgeId: edge.id }])).toThrow('VERSION_CONFLICT');
  });
  it('does not revive deleted attachments when a GridBox ID is reused in the same transaction', () => {
    const { controller, edge, apply } = setup();
    apply({ method: 'edge-create', edge });
    apply({ method: 'remove', nodeId: 'grid:second' }, { method: 'diagram-create', id: 'second', ascii: 'New diagram' });
    expect(controller.getSnapshot().document.edges).toEqual([]);
    controller.undo(); expect(controller.getSnapshot().document.edges).toEqual([edge]);
  });
  it('indexes graph labels without converting or editing the diagram', () => {
    const content = revisionFixture().create({ id: 'graph', revision: 0, ascii: '[Alpha] ---> [Beta]', structureKind: 'diagram' }).diagram.content;
    const before = structuredClone(content);
    expect(connectionContentNodes(content).map(node => node.label)).toEqual(['[Alpha]', '[Beta]']);
    expect(content).toEqual(before);
  });
  it('round-trips saved and unsaved edges and migrates old workspaces to an empty edge array', () => {
    const { controller, edge, apply } = setup();
    apply({ method: 'edge-create', edge });
    const { document, canvas } = controller.getSnapshot();
    const workspace = { schemaVersion: 3 as const, projectId: 'project', documents: [{ representationId: 'diagram', revisionId: 'revision', name: 'Test', savedName: 'Test',
      savedScene: JSON.stringify(document.scene), savedEdges: '[]', document, canvas }] };
    expect(deserializeWorkspace(serializeWorkspace(workspace))).toEqual(workspace);
    const old: any = structuredClone(workspace); delete old.documents[0].document.edges; delete old.documents[0].savedEdges;
    expect(deserializeWorkspace(old).documents[0].document.edges).toEqual([]);
    old.documents[0].document.edges = [edge, edge];
    expect(() => deserializeWorkspace(old)).toThrow('Duplicate connection');
  });
});
