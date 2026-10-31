import type { AnalysisArtifact, AnalysisEntity } from './schema';
import { evaluateAllPartitions } from './metrics';
import { deriveFindings } from './findings';

export function deriveAnalysis(artifact: AnalysisArtifact, input: { partitions: readonly ('directory' | 'layer' | 'single-group')[]; shuffleSeed: number; shuffleSamples: number },
  identify: (text: string) => string) {
  const analyzed = new Set(artifact.snapshot.files.filter(file => file.role === 'analyzed').map(file => file.path));
  const excludedKinds = new Set(['repository', 'directory', 'package', 'module', 'scope', 'interface', 'type', 'external', 'unknown-target']);
  const universe = artifact.entities.filter(entity => entity.identity.origin === 'source' && !excludedKinds.has(entity.kind)
    && entity.provenance.locations.some(location => analyzed.has(location.path)));
  const ids = universe.map(entity => entity.id).sort(), byId = new Map(universe.map(entity => [entity.id, entity]));
  for (const basis of input.partitions) {
    const groups = new Map<string, string>();
    const groupIds = new Map<string, string>();
    const groupFor = (entity: AnalysisEntity) => basis === 'single-group' ? 'All source entities' : basis === 'layer' ? entity.metadata.layer ?? 'other'
      : entity.provenance.locations[0].path.split('/').slice(0, -1).join('/') || '.';
    const memberships = ids.map(entityId => {
      const label = groupFor(byId.get(entityId)!);
      let group = groupIds.get(label);
      if (!group) { group = `group:${identify(JSON.stringify([basis, label]))}`; groupIds.set(label, group); groups.set(group, label); }
      return { entityId, groupIds: [group], primaryGroupId: group };
    });
    artifact.derived.partitions.push({ id: `partition:${basis}`, basis: basis === 'single-group' ? 'custom' : basis,
      universeEntityIds: ids, groups: [...groups].map(([id, label]) => ({ id, label })), memberships });
  }
  const active = new Set(artifact.coverage.views.filter(view => view.status !== 'not-run').map(view => view.view));
  const layers: AnalysisArtifact['layers'] = [
    { id: 'layer:calls', view: 'calls', relationKinds: ['calls', 'constructs'], statuses: ['resolved', 'inferred'], weighting: 'unit-per-relation', excludeSelfEdges: true },
    { id: 'layer:data', view: 'dependencies', relationKinds: ['value-flow', 'argument', 'return', 'reads', 'writes'], statuses: ['resolved', 'inferred'], weighting: 'unit-per-relation', excludeSelfEdges: true },
    { id: 'layer:state', view: 'dependencies', relationKinds: ['reads', 'writes'], statuses: ['resolved', 'inferred'], weighting: 'unit-per-relation', excludeSelfEdges: true },
    { id: 'layer:reactive', view: 'dependencies', relationKinds: ['reactive', 'selects', 'prop-flow', 'context-read', 'effect-dependency'], statuses: ['resolved', 'inferred'], weighting: 'unit-per-relation', excludeSelfEdges: true },
  ];
  artifact.layers = layers.filter(layer => active.has(layer.view));
  artifact.derived.metrics.push(...evaluateAllPartitions(artifact, { ...input,
    comparisonPartitionId: artifact.derived.partitions.some(item => item.id === 'partition:directory') ? 'partition:directory' : undefined }));
  for (const layer of artifact.layers) {
    const kinds = new Set(layer.relationKinds);
    const edges = artifact.relations.filter(edge => edge.view === layer.view && kinds.has(edge.kind)
      && layer.statuses.includes(edge.provenance.status) && byId.has(edge.from) && byId.has(edge.to));
    const participating = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))].sort();
    const adjacency = new Map(participating.map(id => [id, [] as string[]])), reverse = new Map(participating.map(id => [id, [] as string[]]));
    for (const edge of edges) { adjacency.get(edge.from)!.push(edge.to); reverse.get(edge.to)!.push(edge.from); }
    const seen = new Set<string>(), order: string[] = [];
    // Iterative Kosaraju avoids exhausting the JS call stack on deep repository graphs.
    for (const start of participating) if (!seen.has(start)) {
      seen.add(start); const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
      while (stack.length) {
        const frame = stack[stack.length - 1], next = adjacency.get(frame.id)!;
        if (frame.next < next.length) { const child = next[frame.next++]; if (!seen.has(child)) { seen.add(child); stack.push({ id: child, next: 0 }); } }
        else { order.push(frame.id); stack.pop(); }
      }
    }
    const componentFor = new Map<string, string>(), components: { id: string; entityIds: string[] }[] = [];
    for (const start of order.reverse()) if (!componentFor.has(start)) {
      const members: string[] = [], stack = [start]; componentFor.set(start, 'pending');
      while (stack.length) { const id = stack.pop()!; members.push(id); for (const child of reverse.get(id)!) if (!componentFor.has(child)) { componentFor.set(child, 'pending'); stack.push(child); } }
      members.sort(); const id = `component:${identify(JSON.stringify([layer.id, members]))}`;
      members.forEach(member => componentFor.set(member, id)); components.push({ id, entityIds: members });
    }
    const condensed = new Map<string, { from: string; to: string; relationIds: string[] }>();
    for (const edge of edges) {
      const from = componentFor.get(edge.from)!, to = componentFor.get(edge.to)!; if (from === to) continue;
      const key = `${from}:${to}`, entry = condensed.get(key) ?? { from, to, relationIds: [] }; entry.relationIds.push(edge.id); condensed.set(key, entry);
    }
    artifact.derived.sccs.push({ id: `scc:${layer.id}`, layerId: layer.id, universeEntityIds: participating, components, edges: [...condensed.values()] });
  }
  deriveFindings(artifact, identify);
  const containment = artifact.relations.filter(edge => edge.view === 'containment' && edge.kind === 'contains');
  const parent = new Map(containment.map(edge => [edge.to, edge.from]));
  const root = artifact.entities.find(entity => entity.kind === 'repository')!;
  artifact.derived.trees.push({ id: 'tree:containment', rootOccurrenceId: `occ:${root.id}`,
    occurrences: artifact.entities.map(entity => ({ id: `occ:${entity.id}`, entityId: entity.id, parentOccurrenceId: parent.has(entity.id) ? `occ:${parent.get(entity.id)}` : null })), liftedEdges: [] });
}
