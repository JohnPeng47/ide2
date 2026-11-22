import { expect, it } from 'vitest';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { singleDiagramScene } from '../../core/diagrams/projectDiagramCanvas';
import { defaultArrowAppearance } from '../../core/diagrams/diagramConnection';
import { projectCanvas } from './canvasProjection';

it('preserves line and column for adjacent concepts and distinguishes a stale source from a group endpoint', () => {
  const scene = singleDiagramScene('[A] -------> [B]');
  const content = scene.contents.overview.content;
  const [a, b] = diagramContentNodes(content);
  const endpoint = (id: string) => ({ kind: 'content-node' as const, displayNodeId: 'grid:overview',
    revisionId: content.revisionId, contentNodeId: id, side: 'auto' as const });
  const document = { scene, sections: {}, edges: [
    { id: 'adjacent', source: endpoint(a.id), target: endpoint(b.id), appearance: defaultArrowAppearance },
    { id: 'stale', source: { ...endpoint(a.id), revisionId: 'old' },
      target: { kind: 'box' as const, displayNodeId: 'grid:' + scene.root.id, side: 'auto' as const }, appearance: defaultArrowAppearance }
  ] };
  expect(projectCanvas(document, 'graph').edges).toEqual([
    { source: { node: 'grid:overview', line: 1, column: a.startColumn }, target: { node: 'grid:overview', line: 1, column: b.startColumn }, label: '' },
    { source: { node: 'grid:overview', status: 'stale' }, target: { node: 'grid:' + scene.root.id, kind: 'container' }, label: '' }
  ]);
  expect(a.startColumn).not.toBe(b.startColumn);
});
