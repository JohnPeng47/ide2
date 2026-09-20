import { expect, it } from 'vitest';
import { createDiagram } from '../../../core/diagrams/diagram';
import { buildDiagramContent } from '../../../core/diagrams/diagramContent';
import { activeDiagramJumps, validateDiagramJumps, type DiagramJump } from '../../../core/diagrams/diagramJump';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { diagramSceneText } from '../diagramSceneText';
import { MappingDocumentController } from '../mappingDocumentController';
import { mappingDocumentFromScene } from '../mappingDocument';
import { initialCanvasState } from '../mappingWorkspace';
import { serializeWorkspace, deserializeWorkspace } from '../mappingWorkspaceCodec';

function fixture() {
  const ascii = 'Root\n|-- [*] Rendering\nplain text';
  const scene = singleDiagramScene(ascii);
  scene.contents = { ...scene.contents, overview: createDiagram({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }) };
  const content = scene.contents.overview.content;
  const jump: DiagramJump = { id: 'rendering', source: { revisionId: content.revisionId, contentHash: content.asciiSha256,
    line: 2, startColumn: 5, endColumn: 17 }, target: { representationId: 'saved-target', displayNodeId: 'grid:overview' } };
  const controller = new MappingDocumentController(mappingDocumentFromScene(scene), initialCanvasState());
  return { scene, content, jump, controller, ascii };
}

it('adds coordinate-fallback jumps without changing text, with undo/redo and workspace round trips', () => {
  const { controller, jump, ascii } = fixture();
  controller.transact(0, [{ method: 'setJumps', nodeId: 'grid:overview', jumps: [jump] }]);
  const { document, canvas } = controller.getSnapshot();
  expect(document.scene.contents.overview.content.ascii).toBe(ascii);
  expect(diagramSceneText(document.scene).rows.flatMap(row => row.runs).find(run => run.jump)?.text).toBe('[*] Rendering');
  const workspace = { schemaVersion: 3 as const, projectId: 'project', documents: [{ representationId: 'source', name: 'Source',
    savedName: 'Source', revisionId: 'revision', savedScene: JSON.stringify(document.scene), document, canvas }] };
  expect(deserializeWorkspace(serializeWorkspace(workspace)).documents[0].document.scene.contents.overview.jumps).toEqual([jump]);
  controller.undo(); expect(controller.getSnapshot().document.scene.contents.overview.jumps).toBeUndefined();
  controller.undo(true); expect(controller.getSnapshot().document.scene.contents.overview.jumps).toEqual([jump]);
});

it('rebases unchanged text and disables stale links after replacement, without losing the metadata', () => {
  const { controller, jump, ascii } = fixture();
  controller.transact(0, [{ method: 'setJumps', nodeId: 'grid:overview', jumps: [jump] }]);
  controller.transact(1, [{ method: 'replace', nodeId: 'grid:overview', ascii }]);
  let diagram = controller.getSnapshot().document.scene.contents.overview;
  expect(activeDiagramJumps(diagram.content, diagram.jumps)).toHaveLength(1);
  expect(diagram.jumps![0].source.revisionId).toBe('overview:1');
  controller.transact(2, [{ method: 'replace', nodeId: 'grid:overview', ascii: ascii.replace('Rendering', 'Different') }]);
  diagram = controller.getSnapshot().document.scene.contents.overview;
  expect(diagram.jumps).toHaveLength(1);
  expect(activeDiagramJumps(diagram.content, diagram.jumps)).toEqual([]);
});

it('rejects stale source ranges, invalid node IDs and overlapping links atomically', () => {
  const { controller, jump, content } = fixture();
  expect(() => validateDiagramJumps(content, [{ ...jump, source: { ...jump.source, contentNodeId: 'fake' } }], false)).toThrow('STALE_CONTENT_NODE');
  expect(() => validateDiagramJumps(content, [{ ...jump, source: { ...jump.source, revisionId: 'old' } }], false)).toThrow('STALE_JUMP_SOURCE');
  expect(() => controller.transact(0, [{ method: 'setJumps', nodeId: 'grid:overview', jumps: [jump, { ...jump, id: 'another' }] }])).toThrow('Overlapping');
  expect(controller.getSnapshot().version).toBe(0);
});

it('restores legacy parsed structures exactly instead of upgrading their grammar on workspace load', () => {
  const { controller } = fixture();
  const { document, canvas } = structuredClone(controller.getSnapshot());
  const diagram = document.scene.contents.overview;
  diagram.content = buildDiagramContent(diagram.content.ascii, diagram.content.revisionId, 'tree', 'ascii-tree-1');
  const workspace = { schemaVersion: 3 as const, projectId: 'project', documents: [{ representationId: 'source', name: 'Source',
    savedName: 'Source', revisionId: 'revision', savedScene: JSON.stringify(document.scene), document, canvas }] };
  const restored = deserializeWorkspace(serializeWorkspace(workspace));
  expect(restored.documents[0].document.scene.contents.overview.content).toEqual(diagram.content);
});
