import { z } from 'zod';

export interface Repository {
  id: string;
  name: string;
  /** Canonical Git common directory; linked worktrees share this identity. */
  identity: string;
  checkoutRoots: string[];
}
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const repositoryContextSchema = z.object({
  repositoryId: z.string().min(1).max(200), commits: z.array(sha).max(2000), head: sha,
  /** When present, hunks compare this tree to head; null means an empty tree (new branch). */
  comparisonBase: sha.nullable().optional()
}).strict().refine(context => new Set(context.commits).size === context.commits.length, 'Duplicate commits');
export type RepositoryContext = z.infer<typeof repositoryContextSchema>;

/** Canvas membership is stored once, on the canvas; repositories own that collection. */
export function repositoryGroups<T extends { repositoryId?: string }>(repositories: readonly Repository[], items: readonly T[]) {
  const groups = repositories.map(repository => ({ id: repository.id, name: repository.name, items: items.filter(item => item.repositoryId === repository.id) }));
  const known = new Set(repositories.map(repository => repository.id));
  const unassigned = items.filter(item => !item.repositoryId || !known.has(item.repositoryId));
  return [...groups, ...(unassigned.length ? [{ id: 'unassigned', name: 'Unassigned', items: unassigned }] : [])];
}

/** Legacy canvases with mixed/unknown source identities remain unassigned. */
export function inferRepositoryId(scene: import('../diagrams/lineGrid').LineGridScene, repositories: readonly Repository[]) {
  const identities = new Set(Object.values(scene.contents).flatMap(diagram => diagram.sourceContext.binding ? [diagram.sourceContext.binding.repositoryIdentity] : []));
  if (!identities.size) return repositories.length === 1 ? repositories[0].id : undefined;
  if (identities.size !== 1) return undefined;
  return repositories.find(repository => identities.has(repository.identity))?.id;
}
