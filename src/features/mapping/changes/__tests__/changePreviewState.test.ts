import { expect, it } from 'vitest';
import { ChangePreviewState } from '../changePreviewState';
import { createDiagram } from '../../../../../domain/core/diagrams/diagramRevision';
import { listDiagramRevisions } from '../../../../../domain/core/diagrams/diagramRevisionStore';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';

it('folds a transported preview without creating revisions or modifying its diagram', () => {
  const diagram = createDiagram({ id: 'overview', revision: 0, ascii: 'Root\n`-- Child', structureKind: 'tree' }).diagram;
  const scene = singleDiagramScene(diagram.content.ascii);
  scene.contents = { ...scene.contents, overview: diagram };
  const state = { document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() };
  const before = structuredClone(state), revisions = listDiagramRevisions(diagram.diagramId);
  const preview = new ChangePreviewState(state, 7), root = diagramContentNodes(diagram.content)[0];
  const expanded = preview.nodes();
  expect(preview.nodes()).toBe(expanded); // Unchanged preview reads must not reroute edges.
  preview.configureEndpointBounds({});
  const measured = preview.nodes();
  expect(measured).not.toBe(expanded);
  preview.configureEndpointBounds({});
  expect(preview.nodes()).toBe(measured);
  preview.collapse('grid:overview', root.id, true);
  const folded = preview.nodes();
  expect(folded).not.toBe(measured);
  expect(preview.nodes()).toBe(folded);
  expect(preview.getSnapshot().canvas.diagramViews!['grid:overview'].collapsedContentNodeIds).toEqual([root.id]);
  expect(preview.nodes().find(node => node.id === 'grid:overview')?.version).toBe(7);
  preview.collapse('grid:overview', root.id, false);
  expect(preview.nodes()).not.toBe(folded);
  expect(preview.getSnapshot().canvas.diagramViews!['grid:overview'].collapsedContentNodeIds).toEqual([]);
  expect(preview.getSnapshot().document.scene.contents.overview).toEqual(diagram);
  expect(Object.isFrozen(preview.getSnapshot().document.scene.contents.overview.content)).toBe(true);
  expect(listDiagramRevisions(diagram.diagramId)).toEqual(revisions);
  expect(state).toEqual(before);
});
