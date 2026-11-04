/** Persisted resources represented by a navigation node, independent of its grouping. */
export interface TreeDeletion {
  judgementIds: string[];
  runIds: string[];
  canvasIds: string[];
  sessionIds: string[];
  comparisonRunIds: string[];
}

export interface DeletableTreeNode {
  resources?: Partial<TreeDeletion>;
  children?: DeletableTreeNode[];
}

/** Include collapsed descendants and deduplicate resources shared by multiple rows. */
export function treeDeletion(node: DeletableTreeNode): TreeDeletion {
  const result: TreeDeletion = { judgementIds: [], runIds: [], canvasIds: [], sessionIds: [], comparisonRunIds: [] };
  const visit = (node: DeletableTreeNode) => {
    for (const key of Object.keys(result) as (keyof TreeDeletion)[]) result[key].push(...node.resources?.[key] ?? []);
    node.children?.forEach(visit);
  };
  visit(node);
  for (const key of Object.keys(result) as (keyof TreeDeletion)[]) result[key] = [...new Set(result[key])];
  return result;
}
