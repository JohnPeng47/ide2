import type { AnalysisArtifact, AnalysisEntity, AnalysisProvenance, AnalysisRange } from './schema';

/** Undirected closure is deliberately conservative for alias and callback summaries. */
export function dependencyComponents(paths: readonly string[], edges: readonly (readonly [string, string])[]): string[][] {
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    if (!parent.has(key)) parent.set(key, key);
    let value = key;
    while (parent.get(value) !== value) value = parent.get(value)!;
    while (key !== value) { const next = parent.get(key)!; parent.set(key, value); key = next; }
    return value;
  };
  for (const [from, to] of edges) { const a = root(from), b = root(to); if (a !== b) parent.set(b, a); }
  const groups = new Map<string, string[]>();
  for (const file of [...paths].sort()) { const key = root(file), group = groups.get(key) ?? []; group.push(file); groups.set(key, group); }
  return [...groups.values()].sort((a, b) => a[0].localeCompare(b[0], 'en'));
}

/** Extra connectivity from actual extracted facts, beyond syntactic imports. */
export function analysisDependencyEdges(artifact: AnalysisArtifact): [string, string][] {
  const owners = new Map(artifact.entities.filter(entity => entity.identity.origin === 'source')
    .map(entity => [entity.id, entity.provenance.locations[0].path]));
  const edges: [string, string][] = [];
  for (const relation of artifact.relations) {
    if (relation.view === 'containment' && relation.kind === 'contains') continue;
    const from = owners.get(relation.from), to = owners.get(relation.to);
    if (from && to && from !== to) edges.push([from, to]);
  }
  return edges;
}

/** Merge independent fragments, preserving shared containment and immutable caches. */
export function mergeAnalysisFacts(fragments: readonly AnalysisArtifact[], selected: ReadonlySet<string>) {
  const entities = new Map<string, AnalysisEntity>();
  const rank = (entity: AnalysisEntity) => `${selected.has(entity.provenance.locations[0].path) ? '0' : '1'}:${entity.provenance.locations[0].path}`;
  for (const fragment of fragments) for (const entity of fragment.entities) {
    const previous = entities.get(entity.id);
    if (!previous || rank(entity) < rank(previous)) entities.set(entity.id, entity);
  }
  const spans = new WeakMap<AnalysisRange, AnalysisRange>();
  const provenance = (value: AnalysisProvenance): AnalysisProvenance => ({ ...value, locations: value.locations.map(range => {
    let cloned = spans.get(range); if (!cloned) { cloned = { ...range }; spans.set(range, cloned); } return cloned;
  }) });
  const relations = new Map<string, AnalysisArtifact['relations'][number]>(), parents = new Set<string>();
  const uncertainties = new Map<string, AnalysisArtifact['uncertainties'][number]>();
  for (const fragment of fragments) {
    for (const edge of fragment.relations) {
      if (edge.view === 'containment' && edge.kind === 'contains') {
        const chosen = entities.get(edge.to)!.provenance.locations[0], location = edge.provenance.locations[0];
        if (chosen.path !== location.path || chosen.start.offset !== location.start.offset || parents.has(edge.to)) continue;
        parents.add(edge.to);
      }
      relations.set(edge.id, { ...edge, provenance: provenance(edge.provenance) });
    }
    for (const issue of fragment.uncertainties) uncertainties.set(issue.id, { ...issue, provenance: provenance(issue.provenance) });
  }
  return { entities: [...entities.values()].map(entity => ({ ...entity, provenance: provenance(entity.provenance) })),
    relations: [...relations.values()], uncertainties: [...uncertainties.values()] };
}
