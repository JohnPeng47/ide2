import { expect, it } from 'vitest';
import { revealSearchMatches } from '../revealSearchMatches';
import { RevisionedDiagramService } from '../../../../../domain/core/diagrams/diagramService';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { DiagramSearchIndex } from '../../../../../domain/mapping/search/diagramSearch';

function fixture() {
  const scene = singleDiagramScene('Root');
  const diagram = new RevisionedDiagramService().create({ id: 'overview', revision: 0,
    ascii: 'Root\n|-- Branch\n|   `-- Needle\n`-- Other\n    `-- Keep folded', structureKind: 'tree' }).diagram;
  scene.contents = { ...scene.contents, overview: diagram };
  if (scene.root.kind !== 'container') throw Error('Expected container');
  scene.root = { ...scene.root, collapsed: true, children: scene.root.children.map(box => ({ ...box, collapsed: true })) };
  if (diagram.content.structure.kind !== 'tree') throw Error('Expected tree');
  const nodes = Object.values(diagram.content.structure.nodes);
  const branch = nodes.find(node => node.label === 'Branch')!.id, other = nodes.find(node => node.label === 'Other')!.id;
  const views = { 'grid:overview': { contentRevisionId: diagram.content.revisionId, collapsedContentNodeIds: [branch, other] } };
  const index = new DiagramSearchIndex();
  index.update({ generation: 1, remove: [], upsert: [{ key: 'content', content: diagram.content }], placements: [{ contentKey: 'content',
    canvasDocumentId: 'canvas', canvasName: 'Canvas', scope: 'project', displayNodeId: 'grid:overview', diagramId: 'overview', diagramName: 'Root' }] });
  const matches = [...index.search({ text: 'Needle', caseSensitive: false, scope: { kind: 'global' } })].flatMap(batch => batch.results);
  return { scene, views, matches, other };
}

it('reveals matching diagrams and ancestors while preserving unrelated folds and content identities', () => {
  const { scene, views, matches, other } = fixture();
  const result = revealSearchMatches(scene, views, matches);
  expect(result.root.collapsed).toBe(false);
  expect(result.root.kind === 'container' && result.root.children[0].collapsed).toBe(false);
  expect(result.views?.['grid:overview'].collapsedContentNodeIds).toEqual([other]);
  expect(scene.root.collapsed).toBe(true);
  expect(views['grid:overview'].collapsedContentNodeIds).toHaveLength(2);
  const again = revealSearchMatches({ ...scene, root: result.root }, result.views, matches);
  expect(again.root).toBe(result.root); expect(again.views).toBe(result.views);
});

it('ignores stale results and returns unchanged presentation for empty results', () => {
  const { scene, views, matches } = fixture();
  for (const results of [[], matches.map(match => ({ ...match, asciiSha256: 'stale' }))]) {
    const result = revealSearchMatches(scene, views, results);
    expect(result.root).toBe(scene.root); expect(result.views).toBe(views);
  }
});
