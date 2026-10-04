import type { DiagramContentNode } from './diagramContent';

/** Shared selection traversal for source-code and diff-hunk mapping handlers. */
export function resolveNodeResources<T>(nodes: readonly DiagramContentNode[], selected: readonly string[],
  direct: ReadonlyMap<string, readonly T[]>, inherit = true) {
  const index = new Map(nodes.map(node => [node.id, node]));
  const matches: { selectedNode: DiagramContentNode; mappedNode: DiagramContentNode; resources: readonly T[] }[] = [];
  const unmappedNodeIds: string[] = [];
  for (const id of new Set(selected)) {
    const selectedNode = index.get(id);
    if (!selectedNode) throw Error('Selected node belongs to another diagram revision');
    let node: DiagramContentNode | undefined = selectedNode;
    const visited = new Set<string>();
    let found = false;
    while (node && !visited.has(node.id)) {
      visited.add(node.id);
      const resources = direct.get(node.id);
      if (resources?.length) { matches.push({ selectedNode, mappedNode: node, resources }); found = true; break; }
      node = inherit && node.parentId ? index.get(node.parentId) : undefined;
    }
    if (!found) unmappedNodeIds.push(id);
  }
  return { matches, unmappedNodeIds };
}
