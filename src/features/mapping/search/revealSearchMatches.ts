import type { DiagramLineSearchResult } from '../../../../domain/mapping/search/diagramSearch';
import type { GridBox, LineGridScene } from '../../../../domain/core/diagrams/lineGrid';
import type { DiagramViews } from '../../../../domain/mapping/workspace/diagramViewState';

/** Reveal matching lines without changing content or moving the camera. */
export function revealSearchMatches(scene: LineGridScene, views: DiagramViews | undefined, matches: readonly DiagramLineSearchResult[]) {
  let nextViews = views;
  const byBox = new Map<string, DiagramLineSearchResult[]>();
  for (const match of matches) {
    const bucket = byBox.get(match.displayNodeId) ?? [];
    bucket.push(match); byBox.set(match.displayNodeId, bucket);
  }
  const visit = (box: GridBox): { box: GridBox; matched: boolean } => {
    if (box.kind === 'container') {
      const children = box.children.map(visit), matched = children.some(child => child.matched);
      return { matched, box: children.some((child, i) => child.box !== box.children[i]) || matched && box.collapsed
        ? { ...box, collapsed: matched ? false : box.collapsed, children: children.map(child => child.box) } : box };
    }
    const content = scene.contents[box.contentId]?.content;
    const hits = byBox.get(`grid:${box.id}`)?.filter(hit => hit.revisionId === content?.revisionId && hit.asciiSha256 === content.asciiSha256);
    if (!hits?.length || !content) return { box, matched: false };
    const view = views?.[`grid:${box.id}`];
    if (view && content.structure.kind === 'tree') {
      const nodes = content.structure.nodes;
      const collapsedContentNodeIds = view.collapsedContentNodeIds.filter(id => !nodes[id]?.foldRanges.some(range => hits.some(hit => hit.line >= range.startLine && hit.line <= range.endLine)));
      if (collapsedContentNodeIds.length !== view.collapsedContentNodeIds.length)
        nextViews = { ...nextViews, [`grid:${box.id}`]: { ...view, collapsedContentNodeIds } };
    }
    return { matched: true, box: box.collapsed ? { ...box, collapsed: false } : box };
  };
  const root = visit(scene.root).box;
  return { root, views: nextViews };
}
