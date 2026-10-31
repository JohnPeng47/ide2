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
  // Validate records individually so Zod never retains a second complete repository graph.
  check(input && typeof input === 'object', 'expected object');
  const candidate = input as Record<string, unknown>;
  check(candidate.derived && typeof candidate.derived === 'object', 'expected derived object');
  const derivedInput = candidate.derived as Record<string, unknown>;
  const shape = analysisArtifactSchema.shape, derivedShape = shape.derived.shape;
  const topArrays = ['entities', 'relations', 'uncertainties', 'layers'] as const;
  const derivedArrays = ['sccs', 'trees', 'partitions', 'metrics', 'sourceJoins', 'findings'] as const;
  analysisArtifactSchema.parse({ ...candidate, ...Object.fromEntries(topArrays.map(key => [key, []])),
    derived: { ...derivedInput, ...Object.fromEntries(derivedArrays.map(key => [key, []])) } });
  for (const key of topArrays) {
    const records = candidate[key]; check(Array.isArray(records), `expected ${key} array`);
    for (const record of records) shape[key].element.parse(record);
  }
  for (const key of derivedArrays) {
    const records = derivedInput[key]; check(Array.isArray(records), `expected ${key} array`);
    for (const record of records) derivedShape[key].element.parse(record);
  }
  const artifact = input as AnalysisArtifact;
  const { snapshot, entities, relations, uncertainties, layers, derived } = artifact;
  unique(snapshot.files.map(file => file.path), 'snapshot path');
  unique(snapshot.dirtyFiles.map(file => file.path), 'dirty path');
  unique(snapshot.tsconfigs.map(file => file.path), 'tsconfig path');
  const files = new Map(snapshot.files.map(file => [file.path, file]));
  const lineStarts = new Map<string, number[]>();
  const entityIds = new Set(entities.map(entity => entity.id));
  const relationIds = new Set(relations.map(relation => relation.id));
  const relationById = new Map(relations.map(relation => [relation.id, relation]));
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
      let starts = lineStarts.get(value.path);
      if (!starts) { starts = [0]; for (let index = 0; index < text.length; index++) if (text[index] === '\n') starts.push(index + 1); lineStarts.set(value.path, starts); }
      const start = starts[position.line - 1], end = starts[position.line] ?? text.length + 1;
      check(start !== undefined && position.offset >= start && position.offset < end && position.column === position.offset - start + 1,
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
    const universe = new Set(scc.universeEntityIds);
    check(members.length === universe.size && members.every(member => universe.has(member)), 'SCC universe differs');
    const componentIds = new Set(scc.components.map(component => component.id));
    const componentFor = new Map(scc.components.flatMap(component => component.entityIds.map(entityId => [entityId, component.id] as const)));
    const outgoing = new Map([...componentIds].map(component => [component, new Set<string>()]));
    const indegrees = new Map([...componentIds].map(component => [component, 0]));
    for (const edge of scc.edges) {
      check(componentIds.has(edge.from) && componentIds.has(edge.to) && edge.from !== edge.to, 'invalid SCC edge');
      edge.relationIds.forEach(requireRelation);
      for (const relationId of edge.relationIds) {
        const relation = relationById.get(relationId)!;
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
function orderKey(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') return record.id;
    if (typeof record.entityId === 'string') return record.entityId;
  }
  return JSON.stringify(value);
}
/** All arrays in v1 are sets except propertyPath (which is ordered). */
function canonical(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const items = value.map(item => canonical(item));
    return key === 'propertyPath' ? items : items.map(item => ({ item, key: orderKey(item) }))
      .sort((a, b) => compare(a.key, b.key)).map(entry => entry.item);
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => compare(a, b)).map(([name, item]) => [name, canonical(item, name)]));
  return value;
}

/** Record-at-a-time canonical JSON avoids duplicating the entire graph during persistence. */
export function* analysisArtifactChunks(input: AnalysisArtifact, texts?: ReadonlyMap<string, string>): Generator<string> {
  validateAnalysisArtifact(input, texts);
  function* object(value: Record<string, unknown>): Generator<string> {
    yield '{\n';
    const entries = Object.entries(value).sort(([a], [b]) => compare(a, b));
    for (let index = 0; index < entries.length; index++) {
      const [key, item] = entries[index];
      yield `${JSON.stringify(key)}:`;
      if (Array.isArray(item)) {
        yield '[\n';
        const records = item.map(record => ({ record, key: orderKey(canonicalOrderKey(record)) }));
        records.sort((a, b) => compare(a.key, b.key));
        for (let i = 0; i < records.length; i++) yield JSON.stringify(canonical(records[i].record)) + (i + 1 < records.length ? ',\n' : '\n');
        yield ']';
      } else if (key === 'derived') yield* object(item as Record<string, unknown>);
      else yield JSON.stringify(canonical(item));
      yield index + 1 < entries.length ? ',\n' : '\n';
    }
    yield '}';
  }
  yield* object(input as unknown as Record<string, unknown>); yield '\n';
}
function canonicalOrderKey(value: unknown): unknown {
  if (value && typeof value === 'object' && 'id' in value) return { id: value.id };
  return canonical(value);
}
export function serializeAnalysisArtifact(input: AnalysisArtifact): string {
  return [...analysisArtifactChunks(input)].join('');
}
export function parseAnalysisArtifact(json: string): AnalysisArtifact {
  return validateAnalysisArtifact(JSON.parse(json));
}

/** Verify the record-at-a-time wire format without constructing a second graph.
 * Cross-record invariants are checked by validateAnalysisArtifact before emission.
 * Each record is parsed, schema checked and re-encoded byte-for-byte here.
 */
export function verifyCanonicalAnalysisStream(chunks: Iterable<string>): Record<string, number> {
  const shape = analysisArtifactSchema.shape, derivedShape = shape.derived.shape;
  const counts: Record<string, number> = {}, fields = new Set<string>();
  let container = '', array = '', started = false, ended = false;
  const parts: string[] = [];
  function line(raw: string) {
    if (!raw) return;
    check(!ended, 'data after streamed document');
    if (!started) { check(raw === '{', 'expected streamed object'); started = true; return; }
    const text = raw.endsWith(',') ? raw.slice(0, -1) : raw;
    if (array) {
      if (text === ']') { array = ''; return; }
      const value: unknown = JSON.parse(text);
      const schema = container ? derivedShape[array as keyof typeof derivedShape] : shape[array as 'entities' | 'relations' | 'uncertainties' | 'layers'];
      check(schema && 'element' in schema, 'unknown streamed array'); schema.element.parse(value);
      check(JSON.stringify(canonical(value)) === text, 'noncanonical streamed record'); counts[`${container}${array}`]++;
      return;
    }
    if (text === '}') { if (container) container = ''; else ended = true; return; }
    const match = /^"([A-Za-z]+)":(.*)$/.exec(text); check(match, 'invalid streamed property');
    const [, key, content] = match, field = `${container}${key}`;
    check(!fields.has(field), 'duplicate streamed field'); fields.add(field);
    if (key === 'derived' && !container) { check(content === '{', 'invalid derived container'); container = 'derived.'; return; }
    if (content === '[') {
      const allowed = container ? Object.keys(derivedShape) : ['entities', 'relations', 'uncertainties', 'layers'];
      check(allowed.includes(key), 'unknown streamed array'); array = key; counts[field] = 0; return;
    }
    check(!container && ['schemaVersion', 'snapshot', 'coverage'].includes(key), 'unknown streamed field');
    const value: unknown = JSON.parse(content); shape[key as 'schemaVersion' | 'snapshot' | 'coverage'].parse(value);
    check(JSON.stringify(canonical(value)) === content, 'noncanonical streamed header');
  }
  for (const chunk of chunks) {
    let start = 0;
    for (let end = chunk.indexOf('\n'); end !== -1; end = chunk.indexOf('\n', start)) {
      parts.push(chunk.slice(start, end)); line(parts.join('')); parts.length = 0; start = end + 1;
    }
    if (start < chunk.length) parts.push(chunk.slice(start));
  }
  if (parts.length) line(parts.join(''));
  check(started && ended && !container && !array, 'truncated streamed document');
  for (const key of Object.keys(shape)) check(fields.has(key), `missing streamed field ${key}`);
  for (const key of Object.keys(derivedShape)) check(fields.has(`derived.${key}`), `missing streamed field derived.${key}`);
  return counts;
}
