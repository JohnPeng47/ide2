import { analysisArtifactSchema, type AnalysisArtifact, type AnalysisMetricValue, type AnalysisRange } from './schema';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid analysis artifact: ${message}`);
}
function unique(values: readonly string[], label: string) {
  check(new Set(values).size === values.length, `duplicate ${label}`);
}
function close(a: number, b: number) { return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); }
function ratio(value: AnalysisMetricValue, numerator: number, denominator: number, label: string) {
  check(denominator ? value.status === 'ok' && close(value.value, numerator / denominator)
    : value.status === 'na' && value.reason === 'zero-denominator', `incorrect ${label}`);
}

/** Structural validation is not extraction. Optional texts verify exact UTF-16 coordinates. */
export function validateAnalysisArtifact(input: unknown, texts?: ReadonlyMap<string, string>): AnalysisArtifact {
  const artifact = analysisArtifactSchema.parse(input);
  const { snapshot, entities, relations, uncertainties, layers, derived } = artifact;
  unique(snapshot.files.map(file => file.path), 'snapshot path');
  unique(snapshot.dirtyFiles.map(file => file.path), 'dirty path');
  unique(snapshot.tsconfigs.map(file => file.path), 'tsconfig path');
  const files = new Map(snapshot.files.map(file => [file.path, file]));
  const entityIds = new Set(entities.map(entity => entity.id));
  const relationIds = new Set(relations.map(relation => relation.id));
  const layerIds = new Set(layers.map(layer => layer.id));
  const partitionIds = new Set(derived.partitions.map(partition => partition.id));
  const allRecords = [...entities, ...relations, ...uncertainties, ...layers, ...derived.sccs, ...derived.trees,
    ...derived.partitions, ...derived.metrics, ...derived.sourceJoins, ...derived.findings];
  unique(allRecords.map(record => record.id), 'record ID');
  unique(entities.map(entity => entity.identity.key), 'entity identity key');
  const requireEntity = (value: string) => check(entityIds.has(value), `missing entity ${value}`);
  const requireRelation = (value: string) => check(relationIds.has(value), `missing relation ${value}`);
  const requireLayer = (value: string) => check(layerIds.has(value), `missing layer ${value}`);
  function range(value: AnalysisRange) {
    const file = files.get(value.path);
    check(value.snapshotId === snapshot.id && file?.contentHash === value.fileHash, `unpinned range ${value.path}`);
    check(value.end.offset <= file.utf16Length, `range past EOF ${value.path}`);
    check(value.end.line <= Math.max(1, file.lineCount + 1), `range line past EOF ${value.path}`);
    const text = texts?.get(value.path);
    if (text !== undefined) for (const position of [value.start, value.end]) {
      check(text.length === file.utf16Length, `text length differs ${value.path}`);
      const prefix = text.slice(0, position.offset), lastNewline = prefix.lastIndexOf('\n');
      check(position.line === prefix.split('\n').length && position.column === position.offset - lastNewline,
        `coordinates disagree ${value.path}`);
    }
  }
  for (const config of snapshot.tsconfigs) check(files.get(config.path)?.contentHash === config.contentHash,
    `tsconfig not pinned ${config.path}`);
  for (const dirty of snapshot.dirtyFiles) {
    if (dirty.status === 'deleted') check(dirty.contentHash === null && !files.has(dirty.path), 'deleted file has content');
    else if (files.has(dirty.path)) check(files.get(dirty.path)?.contentHash === dirty.contentHash, 'dirty hash differs');
    if (dirty.status === 'renamed') check(dirty.previousPath, 'rename requires previousPath');
  }
  for (const fact of [...entities, ...relations, ...uncertainties, ...derived.findings]) {
    fact.provenance.locations.forEach(range);
    fact.provenance.supportingRelationIds.forEach(requireRelation);
    check(fact.provenance.status !== 'observed' || fact.provenance.method === 'runtime-probe', 'observed fact needs runtime probe');
  }
  for (const entity of entities) {
    if (entity.metadata.sourceEntityId) requireEntity(entity.metadata.sourceEntityId);
    if (['runtime-instance', 'execution-event', 'value-version'].includes(entity.kind)) {
      check(entity.identity.origin === 'runtime' && entity.identity.stability === 'runtime' && entity.metadata.runId
        && entity.metadata.sourceEntityId && entity.provenance.status === 'observed', 'runtime entity requires run/source identity and observed provenance');
      if (entity.kind === 'execution-event') check(entity.metadata.sequence !== undefined, 'runtime event requires sequence');
    }
  }
  for (const relation of relations) {
    requireEntity(relation.from); requireEntity(relation.to);
    if (relation.view === 'lexical' && relation.declaringScopeId) requireEntity(relation.declaringScopeId);
    if (relation.view === 'calls' && relation.callSiteId) requireEntity(relation.callSiteId);
  }
  for (const issue of uncertainties) {
    issue.entityIds.forEach(requireEntity); issue.candidateEntityIds.forEach(requireEntity);
    issue.relationIds.forEach(requireRelation);
  }
  for (const finding of derived.findings) {
    finding.entityIds.forEach(requireEntity); finding.relationIds.forEach(requireRelation);
    finding.partitionIds.forEach(value => check(partitionIds.has(value), 'missing finding partition'));
  }
  const kindsByView = {
    containment: ['contains', 'imports', 'reexports', 'jsx-child'],
    lexical: ['scope-parent', 'declares', 'references', 'captures', 'captures-this'],
    calls: ['calls', 'constructs', 'registers', 'schedules', 'resumes', 'returns-to'],
    ownership: ['creates', 'retains', 'aliases', 'can-mutate', 'exposes-read-api', 'subscribes', 'unsubscribes', 'disposes', 'escapes'],
    dependencies: ['value-flow', 'argument', 'return', 'reads', 'writes', 'control', 'reactive', 'selects', 'prop-flow', 'context-read', 'effect-dependency', 'awaits'],
  };
  for (const layer of layers) {
    unique(layer.relationKinds, 'layer relation kind'); unique(layer.statuses, 'layer status');
    check(layer.relationKinds.every(kind => kindsByView[layer.view].includes(kind)), 'layer kind does not match view');
    if (layer.weighting === 'runtime-frequency') check(layer.statuses.every(status => status === 'observed'), 'runtime frequency requires observed-only layer');
  }
  // `contains` alone forms the canonical tree; imports/JSX/capture/call relations may cycle.
  const roots = entities.filter(entity => entity.kind === 'repository');
  check(roots.length === 1, 'expected one repository root');
  const parent = new Map<string, string>();
  for (const edge of relations) if (edge.view === 'containment' && edge.kind === 'contains') {
    check(edge.to !== roots[0].id && !parent.has(edge.to), 'containment has multiple parents or a parented root');
    parent.set(edge.to, edge.from);
  }
  const visited = new Set<string>([roots[0].id]);
  for (const entity of entities) {
    const chain = new Set<string>(); let cursor = entity.id;
    while (!visited.has(cursor)) {
      check(!chain.has(cursor), 'containment cycle'); chain.add(cursor);
      const ancestor = parent.get(cursor); check(ancestor, `orphan entity ${cursor}`); cursor = ancestor;
    }
    for (const member of chain) visited.add(member);
  }
  for (const tree of derived.trees) {
    if (tree.layerId) requireLayer(tree.layerId);
    unique(tree.occurrences.map(node => node.id), 'tree occurrence');
    const nodes = new Map(tree.occurrences.map(node => [node.id, node]));
    check(nodes.get(tree.rootOccurrenceId)?.parentOccurrenceId === null, 'missing tree root');
    for (const node of tree.occurrences) {
      requireEntity(node.entityId);
      if (node.referenceToOccurrenceId) check(nodes.get(node.referenceToOccurrenceId)?.entityId === node.entityId
        && node.referenceToOccurrenceId !== node.id, 'invalid shared identity reference');
      const seen = new Set<string>(); let cursor = node;
      while (cursor.id !== tree.rootOccurrenceId) {
        check(!seen.has(cursor.id), 'projection cycle'); seen.add(cursor.id);
        const ancestor = cursor.parentOccurrenceId && nodes.get(cursor.parentOccurrenceId);
        check(ancestor, 'orphan projection occurrence'); cursor = ancestor;
      }
    }
    for (const edge of tree.liftedEdges) {
      requireRelation(edge.relationId);
      check(nodes.has(edge.fromOccurrenceId) && nodes.has(edge.toOccurrenceId), 'missing lifted endpoint');
    }
  }
  for (const scc of derived.sccs) {
    requireLayer(scc.layerId); scc.universeEntityIds.forEach(requireEntity); unique(scc.universeEntityIds, 'SCC universe');
    unique(scc.components.map(component => component.id), 'SCC component');
    const members = scc.components.flatMap(component => component.entityIds);
    unique(members, 'SCC membership'); members.forEach(requireEntity);
    check(members.length === scc.universeEntityIds.length && members.every(member => scc.universeEntityIds.includes(member)), 'SCC universe differs');
    const componentIds = new Set(scc.components.map(component => component.id));
    const componentFor = new Map(scc.components.flatMap(component => component.entityIds.map(entityId => [entityId, component.id] as const)));
    const outgoing = new Map([...componentIds].map(component => [component, new Set<string>()]));
    const indegrees = new Map([...componentIds].map(component => [component, 0]));
    for (const edge of scc.edges) {
      check(componentIds.has(edge.from) && componentIds.has(edge.to) && edge.from !== edge.to, 'invalid SCC edge');
      edge.relationIds.forEach(requireRelation);
      for (const relationId of edge.relationIds) {
        const relation = relations.find(relation => relation.id === relationId)!;
        check(componentFor.get(relation.from) === edge.from && componentFor.get(relation.to) === edge.to, 'SCC edge provenance differs from component endpoints');
      }
      if (!outgoing.get(edge.from)!.has(edge.to)) {
        outgoing.get(edge.from)!.add(edge.to); indegrees.set(edge.to, indegrees.get(edge.to)! + 1);
      }
    }
    const queue = [...componentIds].filter(component => !indegrees.get(component)); let removed = 0;
    for (let index = 0; index < queue.length; index++) {
      removed++;
      for (const target of outgoing.get(queue[index])!) {
        indegrees.set(target, indegrees.get(target)! - 1); if (!indegrees.get(target)) queue.push(target);
      }
    }
    check(removed === componentIds.size, 'SCC condensation cycle');
  }
  for (const partition of derived.partitions) {
    unique(partition.universeEntityIds, 'partition universe'); partition.universeEntityIds.forEach(requireEntity);
    unique(partition.groups.map(group => group.id), 'partition group');
    unique(partition.memberships.map(member => member.entityId), 'partition membership');
    const universe = new Set(partition.universeEntityIds), groups = new Set(partition.groups.map(group => group.id));
    check(partition.memberships.length === universe.size, 'partition must record uncovered members');
    for (const member of partition.memberships) {
      check(universe.has(member.entityId), 'membership outside universe'); unique(member.groupIds, 'group membership');
      check(member.groupIds.every(group => groups.has(group)), 'unknown group');
      check(member.primaryGroupId === null ? member.groupIds.length === 0 : member.groupIds.includes(member.primaryGroupId), 'invalid primary membership');
    }
  }
  for (const report of derived.metrics) {
    check(partitionIds.has(report.partitionId), 'missing metric partition'); requireLayer(report.layerId);
    if (report.comparisonPartitionId) check(partitionIds.has(report.comparisonPartitionId), 'missing comparison partition');
    const { coverage, edgeMass: mass } = report;
    check(coverage.overlappingLines <= coverage.coveredLines && coverage.coveredLines <= coverage.totalLines, 'invalid coverage counts');
    ratio(coverage.fraction, coverage.coveredLines, coverage.totalLines, 'line coverage');
    ratio(coverage.overlapFraction, coverage.overlappingLines, coverage.totalLines, 'line overlap');
    check(close(mass.total, mass.internal + mass.between + mass.boundary + mass.uncovered), 'edge mass not conserved');
    ratio(report.internalFraction, mass.internal, mass.total, 'internal fraction');
    ratio(report.coveredCohesion, mass.internal, mass.internal + mass.between, 'covered cohesion');
    if (report.variationOfInformation.status === 'ok') check(report.variationOfInformation.value >= 0 && report.comparisonPartitionId, 'invalid VI');
  }
  for (const join of derived.sourceJoins) {
    // Stale joins retain the old requested range but must not claim current entities.
    if (join.status === 'stale') check(join.entityIds.length === 0, 'stale source join has entities');
    else range(join.range);
    join.entityIds.forEach(requireEntity);
    if (join.status === 'matched') check(join.entityIds.length > 0, 'matched source join empty');
    if (join.status === 'unmapped') check(join.entityIds.length === 0, 'unmapped source join has entities');
  }
  check(artifact.coverage.analyzedFiles === snapshot.files.filter(file => file.role === 'analyzed').length, 'analyzed file count differs');
  check(artifact.coverage.resolutionOnlyFiles === snapshot.files.filter(file => file.role === 'resolution-only').length, 'resolution file count differs');
  check(artifact.coverage.unresolvedCount === uncertainties.filter(issue => ['unresolved', 'unsupported', 'ambiguous-identity'].includes(issue.kind)).length, 'unresolved count differs');
  unique(artifact.coverage.views.map(view => view.view), 'view coverage');
  check(artifact.coverage.views.length === 5, 'coverage must include all five views');
  for (const view of artifact.coverage.views) {
    check(view.candidateSites === view.resolvedSites + view.unresolvedSites, 'candidate sites not accounted for');
    if (view.status === 'not-run') check(view.candidateSites === 0, 'not-run view has sites');
  }
  return artifact;
}

function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
/** All arrays in v1 are sets except propertyPath (which is ordered). */
function canonical(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const items = value.map(item => canonical(item));
    return key === 'propertyPath' ? items : items.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => compare(a, b)).map(([name, item]) => [name, canonical(item, name)]));
  return value;
}

export function serializeAnalysisArtifact(input: AnalysisArtifact): string {
  return JSON.stringify(canonical(validateAnalysisArtifact(input)), null, 2) + '\n';
}
export function parseAnalysisArtifact(json: string): AnalysisArtifact {
  return validateAnalysisArtifact(JSON.parse(json));
}
