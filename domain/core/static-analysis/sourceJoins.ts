import type { AnalysisArtifact, AnalysisPartition } from './schema';

export type SourceJoinRequest = Omit<AnalysisArtifact['derived']['sourceJoins'][number], 'entityIds' | 'status'>;

/** π: pinned diagram leaf range → source entities. Never silently rebase stale evidence. */
export function joinSourceRange(artifact: AnalysisArtifact, request: SourceJoinRequest): AnalysisArtifact['derived']['sourceJoins'][number] {
  const file = artifact.snapshot.files.find(file => file.path === request.range.path);
  if (request.range.snapshotId !== artifact.snapshot.id || !file || file.contentHash !== request.range.fileHash)
    return { ...request, entityIds: [], status: 'stale' };
  if (request.range.start.offset < 0 || request.range.end.offset < request.range.start.offset || request.range.end.offset > file.utf16Length)
    throw new Error('Source mapping range is outside the pinned file');
  const eligible = new Set(['function', 'method', 'constructor', 'accessor', 'class', 'parameter', 'binding', 'field', 'definition', 'merge', 'allocation', 'expression', 'statement', 'state-resource']);
  const entityIds = artifact.entities.filter(entity => entity.identity.origin === 'source' && eligible.has(entity.kind)
    && entity.provenance.locations.some(range => range.path === request.range.path && range.fileHash === request.range.fileHash
      && (request.policy === 'fully-contained'
        ? range.start.offset >= request.range.start.offset && range.end.offset <= request.range.end.offset
        : range.start.offset < request.range.end.offset && range.end.offset > request.range.start.offset))).map(entity => entity.id).sort();
  return { ...request, entityIds, status: entityIds.length ? 'matched' : 'unmapped' };
}

/** Overlap is retained; lexicographic group ID breaks ties for primary-only metrics. */
export function partitionFromSourceJoins(input: {
  id: string; universeEntityIds: readonly string[]; groups: { id: string; label: string; leafIds: readonly string[] }[];
  joins: AnalysisArtifact['derived']['sourceJoins']; diagramRevisionId: string;
}): AnalysisPartition {
  const groupIds = new Set(input.groups.map(group => group.id));
  if (groupIds.size !== input.groups.length) throw new Error('Duplicate diagram partition group');
  const universe = new Set(input.universeEntityIds);
  if (universe.size !== input.universeEntityIds.length) throw new Error('Duplicate diagram partition universe member');
  const groupsByLeaf = new Map<string, Set<string>>();
  for (const group of input.groups) for (const leaf of group.leafIds) {
    const groups = groupsByLeaf.get(leaf) ?? new Set<string>(); groups.add(group.id); groupsByLeaf.set(leaf, groups);
  }
  const memberships = new Map([...universe].sort().map(id => [id, new Set<string>()]));
  for (const join of input.joins) {
    if (join.diagramRevisionId !== input.diagramRevisionId || join.status !== 'matched') continue;
    for (const id of join.entityIds) for (const group of groupsByLeaf.get(join.leafId) ?? []) memberships.get(id)?.add(group);
  }
  return { id: input.id, basis: 'concept', universeEntityIds: [...universe].sort(), groups: input.groups.map(({ id, label }) => ({ id, label })),
    memberships: [...memberships].map(([entityId, groups]) => { const groupIds = [...groups].sort(); return { entityId, groupIds, primaryGroupId: groupIds[0] ?? null }; }) };
}
