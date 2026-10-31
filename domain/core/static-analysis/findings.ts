import type { AnalysisArtifact, AnalysisRelation } from './schema';

/** Findings describe structural evidence; none assert that a boundary crossing is a defect. */
export function deriveFindings(artifact: AnalysisArtifact, identify: (value: string) => string) {
  const entities = new Map(artifact.entities.map(entity => [entity.id, entity]));
  const partitions = new Map(artifact.derived.partitions.map(partition => [partition.basis, partition]));
  const directory = partitions.get('directory'), layer = partitions.get('layer');
  const labels = (partition: typeof directory) => new Map(partition?.memberships.map(member => [member.entityId, member.primaryGroupId]) ?? []);
  const directories = labels(directory), layers = labels(layer);
  const different = (groups: Map<string, string | null>, edge: AnalysisRelation) => !!groups.get(edge.from) && !!groups.get(edge.to) && groups.get(edge.from) !== groups.get(edge.to);
  const add = (kind: AnalysisArtifact['derived']['findings'][number]['kind'], edges: AnalysisRelation[], summary: string, partitionIds: string[] = []) => {
    const relationIds = edges.map(edge => edge.id).sort(), entityIds = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))].sort();
    const locations = new Map(edges.flatMap(edge => edge.provenance.locations).map(range => [`${range.path}:${range.start.offset}:${range.end.offset}`, range]));
    artifact.derived.findings.push({ id: `finding:${identify(JSON.stringify([kind, relationIds]))}`, kind, entityIds, relationIds, partitionIds,
      provenance: { status: 'inferred', method: 'derived', rule: `${kind}:v1`, locations: [...locations.values()], supportingRelationIds: relationIds,
        explanation: 'Derived from static relations. Runtime frequency, exclusive ownership and defect status are not established.' }, summary, assessment: 'investigate' });
  };
  const consumers = new Map<string, AnalysisRelation[]>();
  for (const edge of artifact.relations) {
    if (edge.view === 'lexical' && ['captures', 'captures-this'].includes(edge.kind) && edge.access.some(access => access !== 'read'))
      add('mutable-capture', [edge], `${entities.get(edge.from)?.name} captures ${entities.get(edge.to)?.name} with ${edge.access.filter(access => access !== 'read').join(', ')} access.`);
    if (edge.view === 'dependencies' && ['reads', 'writes', 'reactive', 'selects'].includes(edge.kind)) {
      const resource = edge.kind === 'writes' ? edge.to : edge.from;
      const current = consumers.get(resource) ?? []; current.push(edge); consumers.set(resource, current);
      if (edge.kind === 'writes' && different(directories, edge)) add('cross-boundary-write', [edge],
        `${entities.get(edge.from)?.name} writes ${entities.get(edge.to)?.name} across directory groups.`, directory ? [directory.id] : []);
    }
    if (directory && layer && ['calls', 'dependencies', 'ownership'].includes(edge.view) && different(directories, edge)
      && layers.get(edge.from) && layers.get(edge.from) === layers.get(edge.to)) add('cross-view-boundary', [edge],
        `${edge.kind}: local to an architectural layer, crossing directory containment groups.`, [directory.id, layer.id]);
  }
  for (const [resource, edges] of consumers) {
    const users = new Set(edges.map(edge => edge.kind === 'writes' ? edge.from : edge.to));
    if (users.size >= 3 && edges.some(edge => edge.kind === 'writes')) add('shared-state', edges,
      `${entities.get(resource)?.name} has ${users.size} static readers/writers/subscribers and at least one write.`);
  }
}
