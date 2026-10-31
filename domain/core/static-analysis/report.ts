import type { AnalysisArtifact, AnalysisMetricValue } from './schema';

const escape = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
const value = (metric: AnalysisMetricValue, percent = false) => metric.status === 'ok'
  ? percent ? `${(100 * metric.value).toFixed(2)}%` : metric.value.toFixed(4) : `N/A (${metric.reason})`;

/** Deterministic Markdown; timing belongs in a separate run manifest. */
export function architectureReport(artifact: AnalysisArtifact, artifactLink: string) {
  const entities = new Map(artifact.entities.map(entity => [entity.id, entity]));
  const partitions = new Map(artifact.derived.partitions.map(partition => [partition.id, partition]));
  const source = (id: string) => {
    const entity = entities.get(id)!; const range = entity.provenance.locations[0];
    return `[${escape(entity.name).replaceAll('[', '\\[').replaceAll(']', '\\]')}](${encodeURI(`../../${range.path}`)}#L${range.start.line})`;
  };
  const lines = [
    '# Repository architectural analysis', '',
    `Static source snapshot \`${artifact.snapshot.id}\`, based on commit \`${artifact.snapshot.commit ?? 'non-Git corpus'}\`.`, '',
    `[Persisted analysis JSON](${artifactLink}) contains every entity, relation, source range, uncertainty, partition and finding. Gzip is lossless; decompress it before using the JSON schema.`, '',
    `Analyzed **${artifact.coverage.analyzedFiles} files**, with **${artifact.coverage.resolutionOnlyFiles} resolution-only files**, **${artifact.entities.length} entities** and **${artifact.relations.length} relations**. The snapshot records ${artifact.snapshot.dirtyFiles.length} dirty inputs with content hashes.`, '',
    '## What these measurements mean', '',
    'This is a static possibility graph. Calls are not an execution trace; source-level ownership means aliases, mutation capabilities and lifecycle evidence, not exclusive ownership. A crossing is a candidate for investigation, not a defect. No observed/runtime evidence is emitted.', '',
    'The five views share source identities but keep their own relations. Only containment is required to be a tree. Recursive calls and reactive cycles remain in the graphs; SCC condensation and containment occurrences are derived views.', '',
    '## Per-view coverage', '',
    '| View | Status | Relations | Resolved sites | Unresolved sites |', '|---|---|---:|---:|---:|',
  ];
  for (const view of artifact.coverage.views) lines.push(`| ${view.view} | ${view.status} | ${artifact.relations.filter(edge => edge.view === view.view).length} | ${view.resolvedSites} | ${view.unresolvedSites} |`);
  lines.push('', 'Site counts count distinct source spans touched by an extraction rule. They are not recall estimates: unsupported language features can hide additional dependencies. Multiple facts can share a site.', '',
    '## Cohesion, containment agreement and shuffled baselines', '',
    'The universe is source declarations and value/definition/allocation entities in analyzed files, excluding modules, scopes, type-only and external entities. Each directed relation has unit weight; self-edges are excluded. Data, state and reactive layers overlap in relation kinds and must not be summed. Local def-use edges can dominate data cohesion, so call/state/reactive results are shown separately.', '',
    'Cohesion is internal / (internal + between) among primary memberships. Coverage and overlap use unions of source lines, including nested declaration ranges, with physical analyzed lines as denominator. VI is in bits (lower means greater agreement), compared to the directory partition on the same entity universe. These full partitions have no uncovered members; diagram partitions can.', '',
    'The null model shuffles group labels over the covered entity set while preserving group sizes. Excess cohesion is observed minus shuffled mean; this controls for a single giant group scoring 1. It does not control for degree distribution or prove near-decomposability under runtime workloads.', '',
    '| Partition | Edge layer | Edges | Cohesion | Shuffled mean | Excess | VI vs directories |', '|---|---|---:|---:|---:|---:|---:|');
  for (const metric of artifact.derived.metrics) lines.push(`| ${partitions.get(metric.partitionId)?.basis} | ${metric.layerId.replace('layer:', '')} | ${metric.edgeMass.total} | ${value(metric.coveredCohesion, true)} | ${value(metric.baseline.mean, true)} | ${value(metric.baseline.excessCohesion, true)} | ${value(metric.variationOfInformation)} |`);
  for (const partition of artifact.derived.partitions) {
    const metric = artifact.derived.metrics.find(item => item.partitionId === partition.id);
    if (metric) lines.push('', `**${partition.basis}**: ${partition.groups.length} groups; line coverage ${value(metric.coverage.fraction, true)}, overlap ${value(metric.coverage.overlapFraction, true)}; baseline ${metric.baseline.samples} shuffles, seed ${metric.baseline.seed}.`);
  }
  lines.push('', '## Cross-view boundary evidence', '',
    'The mismatch rule compares directory containment with architectural-layer membership: an edge can stay within a layer while crossing directory groups. Mutable captures and ownership relations provide additional views of the same endpoints. This is a concrete pair of partitions, not a claim that every possible tree mismatch has been found.');
  const names = { 'cross-view-boundary': 'Edges local to a layer but crossing directory groups', 'cross-boundary-write': 'Cross-directory writes', 'mutable-capture': 'Mutable captures', 'shared-state': 'Widely shared state' } as const;
  for (const [kind, title] of Object.entries(names)) {
    const findings = artifact.derived.findings.filter(finding => finding.kind === kind)
      .sort((a, b) => b.entityIds.length - a.entityIds.length || b.relationIds.length - a.relationIds.length || (a.id < b.id ? -1 : 1));
    lines.push('', `### ${title}`, '', `${findings.length} findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.`, '');
    for (const finding of findings.slice(0, 12)) lines.push(`- ${escape(finding.summary)} ${finding.entityIds.slice(0, 5).map(source).join(', ')}. Evidence: \`${finding.id}\` (${finding.relationIds.length} relations).`);
    if (!findings.length) lines.push('No finding matched this rule in the selected corpus.');
  }
  lines.push('', '## Cycles', '', '| Layer | Nontrivial SCCs | Largest component |', '|---|---:|---:|');
  for (const scc of artifact.derived.sccs) lines.push(`| ${scc.layerId} | ${scc.components.filter(component => component.entityIds.length > 1).length} | ${Math.max(0, ...scc.components.map(component => component.entityIds.length))} |`);
  const counts = new Map<string, number>();
  for (const issue of artifact.uncertainties) { const key = `${issue.view} / ${issue.kind} / ${issue.reason}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  lines.push('', '## Uncertainty and limitations', '', `${artifact.coverage.unresolvedCount} unresolved/unsupported/ambiguous records, plus separately classified escape and diagnostic records. All retain source evidence in the artifact.`, '', '| View / classification / reason | Count |', '|---|---:|');
  for (const [label, count] of [...counts].sort(([a], [b]) => a < b ? -1 : 1)) lines.push(`| ${label} | ${count} |`);
  lines.push('',
    '- External declarations identify signatures without modeling their bodies. Interface/union/computed dispatch is conservative and incomplete; dynamic JavaScript prevents a complete static call graph.',
    '- Ownership is a local alias/capability approximation. Read-only facades restrict APIs shallowly; returned nested objects can remain mutable. Disposal sites do not prove that every allocation is disposed.',
    '- Def-use uses structured local reaching definitions. Loops and exceptional/switch control flow are explicitly reported as unsupported for precise fixed-point analysis. Heap aliasing and interprocedural flow are partial.',
    '- React captures and declared dependency arrays are separate facts; a mismatch alone is not an effect bug. Framework summaries recognize supported library identities and receiver shapes, not arbitrary custom hooks or wrappers.',
    '- Static edge counts are not coupling frequencies. Tests and generated declarations can strongly affect layer/group sizes. Compare selected production scopes before making a refactoring decision.', '',
    '## Diagram integration', '',
    'Join diagram leaf mappings through snapshot-pinned source ranges to entity IDs, retaining overlapping memberships and explicit uncovered entities. Existing source-evidence IDs and source-range IDs can be stored on source joins. A stale snapshot must not silently match current code. Concept-tree occurrences remain distinct from source entity identities, allowing the same code to appear in several canvases. Metrics can evaluate those induced partitions with the same layer definitions.', '');
  return lines.join('\n');
}
