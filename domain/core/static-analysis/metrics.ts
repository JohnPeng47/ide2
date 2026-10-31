import type { AnalysisArtifact, AnalysisMetricReport, AnalysisMetricValue, AnalysisPartition } from './schema';

export interface MetricOptions { comparisonPartitionId?: string; shuffleSeed: number; shuffleSamples: number }

const ok = (value: number): AnalysisMetricValue => ({ status: 'ok', value });
const na = (reason: Extract<AnalysisMetricValue, { status: 'na' }>['reason']): AnalysisMetricValue => ({ status: 'na', reason });
const ratio = (n: number, d: number) => d ? ok(n / d) : na('zero-denominator');

function variation(a: AnalysisPartition, b?: AnalysisPartition): AnalysisMetricValue {
  if (!b) return na('not-requested');
  const universe = new Set(a.universeEntityIds);
  if (universe.size !== b.universeEntityIds.length || b.universeEntityIds.some(id => !universe.has(id))) return na('incompatible-universe');
  if (!universe.size) return na('empty-universe');
  const labels = new Map(b.memberships.map(member => [member.entityId, member.primaryGroupId]));
  const countsA = new Map<string, number>(), countsB = new Map<string, number>(), joint = new Map<string, { a: string; b: string; count: number }>();
  for (const member of a.memberships) {
    const left = member.primaryGroupId, right = labels.get(member.entityId);
    if (left == null || right == null) return na('missing-primary-membership');
    countsA.set(left, (countsA.get(left) ?? 0) + 1); countsB.set(right, (countsB.get(right) ?? 0) + 1);
    const key = JSON.stringify([left, right]), item = joint.get(key) ?? { a: left, b: right, count: 0 };
    item.count++; joint.set(key, item);
  }
  let value = 0;
  for (const item of joint.values()) value += item.count / universe.size * Math.log2(countsA.get(item.a)! * countsB.get(item.b)! / item.count ** 2);
  return ok(Math.max(0, value));
}

function lineCoverage(artifact: AnalysisArtifact, partition: AnalysisPartition) {
  const entities = new Map(artifact.entities.map(entity => [entity.id, entity]));
  const files = new Map(artifact.snapshot.files.filter(file => file.role === 'analyzed').map(file => [file.path, file]));
  const events = new Map<string, Map<number, [string, number][]>>();
  for (const member of partition.memberships) {
    const entity = entities.get(member.entityId);
    if (!entity || entity.identity.origin !== 'source') continue;
    for (const range of entity.provenance.locations) {
      const file = files.get(range.path); if (!file || range.end.offset === range.start.offset) continue;
      const start = range.start.line, end = Math.min(file.lineCount, range.end.line - (range.end.column === 1 ? 1 : 0));
      if (end < start) continue;
      const table = events.get(range.path) ?? new Map<number, [string, number][]>(); events.set(range.path, table);
      for (const group of member.groupIds) for (const [line, delta] of [[start, 1], [end + 1, -1]]) {
        const changes = table.get(line) ?? []; changes.push([group, delta]); table.set(line, changes);
      }
    }
  }
  let coveredLines = 0, overlappingLines = 0;
  for (const table of events.values()) {
    const active = new Map<string, number>(); let previous = 1;
    for (const [line, changes] of [...table].sort(([a], [b]) => a - b)) {
      if (active.size) coveredLines += line - previous;
      if (active.size > 1) overlappingLines += line - previous;
      for (const [group, delta] of changes) { const next = (active.get(group) ?? 0) + delta; if (next) active.set(group, next); else active.delete(group); }
      previous = line;
    }
  }
  const totalLines = [...files.values()].reduce((sum, file) => sum + file.lineCount, 0);
  return { totalLines, coveredLines, overlappingLines, fraction: ratio(coveredLines, totalLines), overlapFraction: ratio(overlappingLines, totalLines) };
}

export function evaluatePartition(artifact: AnalysisArtifact, partitionId: string, layerId: string,
  options: MetricOptions): AnalysisMetricReport {
  const partition = artifact.derived.partitions.find(item => item.id === partitionId), layer = artifact.layers.find(item => item.id === layerId);
  if (!partition || !layer) throw new Error('Unknown partition or dependency layer');
  if (!Number.isInteger(options.shuffleSamples) || options.shuffleSamples < 0) throw new Error('Expected a nonnegative shuffle sample count');
  const members = [...partition.memberships].sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0);
  const indices = new Map(members.map((member, index) => [member.entityId, index]));
  const labels = members.map(member => member.primaryGroupId);
  const kinds = new Set(layer.relationKinds), statuses = new Set(layer.statuses);
  const edges: { from: number; to: number; weight: number }[] = [];
  const mass = { internal: 0, between: 0, boundary: 0, uncovered: 0, total: 0 };
  for (const edge of artifact.relations) {
    if (edge.view !== layer.view || !kinds.has(edge.kind) || !statuses.has(edge.provenance.status)
      || layer.weighting === 'runtime-frequency' && edge.provenance.status !== 'observed'
      || layer.excludeSelfEdges && edge.from === edge.to) continue;
    const from = indices.get(edge.from), to = indices.get(edge.to); if (from === undefined || to === undefined) continue;
    const weight = layer.weighting === 'unit-per-relation' ? 1 : edge.weight;
    edges.push({ from, to, weight }); mass.total += weight;
    const a = labels[from], b = labels[to];
    if (a == null && b == null) mass.uncovered += weight;
    else if (a == null || b == null) mass.boundary += weight;
    else if (a === b) mass.internal += weight;
    else mass.between += weight;
  }
  const coveredCohesion = ratio(mass.internal, mass.internal + mass.between);
  let mean: AnalysisMetricValue = na('not-requested'), standardDeviation = mean, excessCohesion = mean;
  if (options.shuffleSamples && coveredCohesion.status === 'ok') {
    let state = options.shuffleSeed >>> 0;
    const random = () => { state = (state + 0x6d2b79f5) >>> 0; let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296; };
    const covered = members.map((member, i) => member.primaryGroupId === null ? -1 : i).filter(index => index !== -1);
    const original = covered.map(index => labels[index]); let average = 0, m2 = 0;
    for (let sample = 0; sample < options.shuffleSamples; sample++) {
      const shuffled = [...original], assigned = [...labels];
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      covered.forEach((index, i) => { assigned[index] = shuffled[i]; });
      let internal = 0;
      for (const edge of edges) if (assigned[edge.from] !== null && assigned[edge.from] === assigned[edge.to]) internal += edge.weight;
      const value = internal / (mass.internal + mass.between), delta = value - average;
      average += delta / (sample + 1); m2 += delta * (value - average);
    }
    mean = ok(average); standardDeviation = ok(Math.sqrt(Math.max(0, m2 / options.shuffleSamples))); excessCohesion = ok(coveredCohesion.value - average);
  } else if (options.shuffleSamples) mean = standardDeviation = excessCohesion = na('zero-denominator');
  return { id: `metric:${partitionId}:${layerId}:${options.comparisonPartitionId ?? 'none'}`, partitionId, layerId,
    ...(options.comparisonPartitionId ? { comparisonPartitionId: options.comparisonPartitionId } : {}),
    coverage: lineCoverage(artifact, partition), edgeMass: mass, internalFraction: ratio(mass.internal, mass.total), coveredCohesion,
    variationOfInformation: variation(partition, artifact.derived.partitions.find(item => item.id === options.comparisonPartitionId)),
    baseline: { seed: options.shuffleSeed, samples: options.shuffleSamples, preserves: 'primary-group-sizes-and-covered-set', mean, standardDeviation, excessCohesion } };
}
