import type { DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { flattenGrid, resolveScene } from '../../../../domain/core/diagrams/lineGrid';
import type { ChangePreviewDocument } from '../../../../domain/mapping/changes/diagramChangeSession';
import type { GitDiffHunk } from '../../../../domain/core/diffs/gitDiffHunk';
import type { DiffTreeRead } from './changeSessionApi';

export const isApplicationHunk = (hunk: GitDiffHunk) => !/(^|\/)(?:__tests__|__snapshots__|tests?|fixtures?|scripts|benchmarks?|node_modules)(\/|$)|\.(?:test|spec)\.|(?:^|\/)[^/]*config\.[^/]+$/.test(hunk.path)
  && /\.(?:[cm]?[jt]sx?|css|scss|sass|less|vue|svelte|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|rb|php)$/.test(hunk.path);
export function changedLines(hunk: GitDiffHunk) {
  return hunk.kind === 'text' ? hunk.patch.split('\n').slice(1).filter(line => line[0] === '+' || line[0] === '-').length : 0;
}
export function diffTreeCoverage(data: DiffTreeRead) {
  const tree = data.diffTree;
  const nodes = new Map(tree?.nodes.map(node => [node.id, node]));
  const direct = new Map<string, Set<string>>(), destinations = new Map<string, DiagramJumpTarget[]>();
  for (const mapping of tree?.mappings ?? []) {
    const set = direct.get(mapping.nodeId) ?? new Set<string>();
    mapping.targets.forEach(target => set.add(target.hunkId)); direct.set(mapping.nodeId, set);
    if (mapping.diagramTargets?.length) destinations.set(mapping.nodeId, [...destinations.get(mapping.nodeId) ?? [], ...mapping.diagramTargets]);
  }
  const subtrees = new Map<string, Set<string>>();
  const subtree = (id: string): Set<string> => {
    if (subtrees.has(id)) return subtrees.get(id)!;
    const ids = new Set(direct.get(id)); subtrees.set(id, ids);
    for (const child of nodes.get(id)?.childIds ?? []) subtree(child).forEach(hunk => ids.add(hunk));
    return ids;
  };
  tree?.nodes.forEach(node => subtree(node.id));
  const hunksFor = (id: string) => {
    if (id === '*') return new Set(data.hunks.map(hunk => hunk.id));
    const own = subtree(id); if (own.size) return own;
    let node = nodes.get(id);
    while (node?.parentId) { node = nodes.get(node.parentId); const ids = node && direct.get(node.id); if (ids?.size) return ids; }
    return new Set<string>();
  };
  const targetsFor = (id: string): DiagramJumpTarget[] => {
    let node = nodes.get(id);
    while (node) { const targets = destinations.get(node.id); if (targets?.length) return targets; node = node.parentId ? nodes.get(node.parentId) : undefined; }
    return [];
  };
  const source = new Map(data.hunks.filter(isApplicationHunk).map(hunk => [hunk.id, changedLines(hunk)]));
  const total = [...source.values()].reduce((a, b) => a + b, 0);
  const stats = (ids: Iterable<string>) => {
    let lines = 0, hunks = 0;
    for (const id of new Set(ids)) if (source.has(id)) { hunks++; lines += source.get(id)!; }
    return { lines, hunks, percent: total ? lines * 100 / total : 0, total };
  };
  const depth = (id: string) => { let value = 0, node = nodes.get(id); while (node?.parentId) { value++; node = nodes.get(node.parentId); } return value; };
  const nodesForHunk = (id: string) => [...direct].filter(([, ids]) => ids.has(id)).map(([node]) => node)
    .sort((a, b) => depth(b) - depth(a) || direct.get(a)!.size - direct.get(b)!.size);
  return { hunksFor, targetsFor, nodesForHunk, stats, subtrees, destinations };
}
export type DiffCoverage = ReturnType<typeof diffTreeCoverage>;
export const coverageLabel = (stats: ReturnType<DiffCoverage['stats']>) => `${stats.lines.toLocaleString()} LOC · ${stats.percent.toFixed(1)}%`;
export const coverageTitle = (stats: ReturnType<DiffCoverage['stats']>) => `${stats.hunks} unique application-code hunks; ${stats.lines} added + deleted lines / ${stats.total} total. Includes descendants and linked detail; excludes tests, tooling, dependencies and context lines.`;

/** Propagate explicitly mapped regions through content hierarchy and outgoing detail links. */
export function diagramCoverage(doc: ChangePreviewDocument, coverage: DiffCoverage) {
  const graph = new Map<string, Set<string>>(), sets = new Map<string, Set<string>>();
  const roots = new Map<string, string[]>();
  const key = (display: string, content?: string) => JSON.stringify([display, content ?? '']);
  const link = (from: string, to: string) => { const edges = graph.get(from) ?? new Set(); edges.add(to); graph.set(from, edges); };
  const boxes = flattenGrid(resolveScene(doc.proposed.document.scene));
  for (const { box } of boxes) {
    const display = `grid:${box.id}`;
    if (box.kind === 'container') { box.children.forEach(child => link(key(display), key(`grid:${child.id}`))); continue; }
    const content = doc.proposed.document.scene.contents[box.contentId].content;
    roots.set(display, diagramContentNodes(content).filter(node => !node.parentId).map(node => key(display, node.id)));
    for (const node of diagramContentNodes(content)) {
      link(key(display), key(display, node.id));
      node.childIds.forEach(child => link(key(display, node.id), key(display, child)));
    }
  }
  for (const [node, targets] of coverage.destinations) for (const target of targets) {
    if (target.representationId !== doc.id && target.representationId !== doc.representationId || !target.displayNodeId) continue;
    const destinations = target.contentNodeId ? [key(target.displayNodeId, target.contentNodeId)] : roots.get(target.displayNodeId) ?? [key(target.displayNodeId)];
    for (const k of destinations) { const ids = sets.get(k) ?? new Set<string>();
      coverage.hunksFor(node).forEach(id => ids.add(id)); sets.set(k, ids); }
  }
  const document = doc.proposed.document;
  for (const jump of document.jumps ?? []) if (jump.target.representationId === doc.id || jump.target.representationId === doc.representationId)
    link(key(jump.sourceDisplayNodeId, jump.source.contentNodeId), key(jump.target.displayNodeId ?? '', jump.target.contentNodeId));
  for (const edge of document.edges) link(key(edge.source.displayNodeId, edge.source.contentNodeId), key(edge.target.displayNodeId, edge.target.kind === 'content-node' ? edge.target.contentNodeId : undefined));
  // Finite set union handles shared descendants and cycles without double counting.
  let changed = true;
  while (changed) { changed = false;
    for (const [from, targets] of graph) {
      const ids = sets.get(from) ?? new Set<string>();
      for (const to of targets) for (const id of sets.get(to) ?? []) if (!ids.has(id)) { ids.add(id); changed = true; }
      sets.set(from, ids);
    }
  }
  return (display: string, content?: string) => coverage.stats(sets.get(key(display, content)) ?? []);
}
