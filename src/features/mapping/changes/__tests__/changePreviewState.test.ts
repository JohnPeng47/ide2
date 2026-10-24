import { expect, it } from 'vitest';
import { ChangePreviewState } from '../changePreviewState';
import { revisionFixture } from '../../../../../tests/support/diagramRevisions';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';

it('folds a transported preview without creating revisions or modifying its diagram', () => {
  const service = revisionFixture();
  const diagram = service.create({ id: 'overview', revision: 0, ascii: 'Root\n`-- Child', structureKind: 'tree' }).diagram;
  const scene = singleDiagramScene(diagram.content.ascii);
  scene.contents = { ...scene.contents, overview: diagram };
  const state = { document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() };
  const before = structuredClone(state), revisions = service.listRevisions(diagram.diagramId);
  const preview = new ChangePreviewState(state, 7), root = diagramContentNodes(diagram.content)[0];
  preview.collapse('grid:overview', root.id, true);
  expect(preview.getSnapshot().canvas.diagramViews!['grid:overview'].collapsedContentNodeIds).toEqual([root.id]);
  expect(preview.nodes().find(node => node.id === 'grid:overview')?.version).toBe(7);
  preview.collapse('grid:overview', root.id, false);
  expect(preview.getSnapshot().canvas.diagramViews!['grid:overview'].collapsedContentNodeIds).toEqual([]);
  expect(preview.getSnapshot().document.scene.contents.overview).toEqual(diagram);
  expect(Object.isFrozen(preview.getSnapshot().document.scene.contents.overview.content)).toBe(true);
  expect(service.listRevisions(diagram.diagramId)).toEqual(revisions);
  expect(state).toEqual(before);
});
