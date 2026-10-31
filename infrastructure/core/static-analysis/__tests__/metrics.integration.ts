import { describe, expect, it } from 'vitest';
import { evaluatePartition } from '../../../../domain/core/static-analysis/metrics';
import type { AnalysisArtifact, AnalysisPartition } from '../../../../domain/core/static-analysis/schema';
import { contractFixture } from '../../../../domain/core/static-analysis/__tests__/contractFixture';
import { validateAnalysisArtifact } from '../../../../domain/core/static-analysis/persistence';

/** Independent numerical oracle:
 * A->B:3, B->C:1, C->D:2, D->A:2. For AB|CD, internal=5, between=3.
 * Four equally weighted entities. VI(AB|CD, AC|BD)=2 bits; VI(P,P)=0.
 * Six balanced assignments: internal fractions {5/8,0,3/8,3/8,0,5/8}; mean=1/3.
 * This graph is written by hand and never obtained from analyzer output.
 */
export function metricFixture(): AnalysisArtifact {
  const artifact = contractFixture(), provenance = artifact.entities[0].provenance;
  artifact.entities = [artifact.entities[0], ...['A', 'B', 'C', 'D'].map(name => ({ ...artifact.entities[2], id: name, name,
    identity: { ...artifact.entities[2].identity, key: name }, provenance: { ...provenance, locations: [{ ...provenance.locations[0],
      start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 } }] } }))];
  artifact.relations = ['A', 'B', 'C', 'D'].map(name => ({ id: `contains:${name}`, view: 'containment' as const,
    kind: 'contains' as const, from: 'repository:test', to: name, weight: 1, provenance }));
  for (const [from, to, weight] of [['A', 'B', 3], ['B', 'C', 1], ['C', 'D', 2], ['D', 'A', 2]] as const)
    artifact.relations.push({ id: `flow:${from}:${to}`, view: 'dependencies', kind: 'value-flow', from, to, weight, provenance });
  artifact.layers[0].weighting = 'static-strength';
  const partition = (id: string, pairs: string[][]): AnalysisPartition => ({ id, basis: 'custom', universeEntityIds: ['A', 'B', 'C', 'D'],
    groups: pairs.map((_, i) => ({ id: `g${i}`, label: `Group ${i}` })),
    memberships: ['A', 'B', 'C', 'D'].map(entityId => {
      const index = pairs.findIndex(pair => pair.includes(entityId));
      return { entityId, groupIds: index < 0 ? [] : [`g${index}`], primaryGroupId: index < 0 ? null : `g${index}` };
    }) });
  artifact.derived.partitions = [partition('P', [['A', 'B'], ['C', 'D']]), partition('Q', [['A', 'C'], ['B', 'D']]),
    partition('partial', [['A', 'B']]), partition('one', [['A', 'B', 'C', 'D']])];
  artifact.coverage.views[0] = { view: 'containment', status: 'complete', candidateSites: 4, resolvedSites: 4, unresolvedSites: 0 };
  return artifact;
}
const options = { shuffleSeed: 1729, shuffleSamples: 0 };

describe('independent partition metric oracles', () => {
  it('uses weighted edges, preserves direction, and computes VI in bits', () => {
    const report = evaluatePartition(metricFixture(), 'P', 'layer:data', { ...options, comparisonPartitionId: 'Q' });
    expect(report.edgeMass).toEqual({ internal: 5, between: 3, boundary: 0, uncovered: 0, total: 8 });
    expect(report.coveredCohesion).toEqual({ status: 'ok', value: 5 / 8 });
    expect(report.variationOfInformation).toEqual({ status: 'ok', value: 2 });
  });
  it('identical partitions have zero VI', () => {
    expect(evaluatePartition(metricFixture(), 'P', 'layer:data', { ...options, comparisonPartitionId: 'P' }).variationOfInformation)
      .toEqual({ status: 'ok', value: 0 });
  });
  it('distinguishes omitted code from clean group boundaries', () => {
    const report = evaluatePartition(metricFixture(), 'partial', 'layer:data', options);
    expect(report.edgeMass).toEqual({ internal: 3, between: 0, boundary: 3, uncovered: 2, total: 8 });
    expect(report.coveredCohesion).toEqual({ status: 'ok', value: 1 });
    expect(report.internalFraction).toEqual({ status: 'ok', value: 3 / 8 });
  });
  it('one giant group scores one, which is not evidence of a good decomposition', () => {
    expect(evaluatePartition(metricFixture(), 'one', 'layer:data', options).coveredCohesion).toEqual({ status: 'ok', value: 1 });
  });
  it('overlap does not make all edges internal; coverage counts unioned lines', () => {
    const artifact = metricFixture();
    artifact.derived.partitions[0].memberships[0].groupIds.push('g1');
    const report = evaluatePartition(artifact, 'P', 'layer:data', options);
    expect(report.coveredCohesion).toEqual({ status: 'ok', value: 5 / 8 });
    expect(report.coverage).toMatchObject({ totalLines: 1, coveredLines: 1, overlappingLines: 1 });
  });
  it('zero dependency mass is N/A, never NaN or an invented perfect score', () => {
    const artifact = metricFixture(); artifact.relations = artifact.relations.filter(edge => edge.view === 'containment');
    const report = evaluatePartition(artifact, 'P', 'layer:data', options);
    expect(report.coveredCohesion).toEqual({ status: 'na', reason: 'zero-denominator' });
    expect(report.internalFraction).toEqual({ status: 'na', reason: 'zero-denominator' });
  });
  it('VI refuses different universes instead of silently intersecting them', () => {
    const artifact = metricFixture(); artifact.derived.partitions[1].universeEntityIds.pop(); artifact.derived.partitions[1].memberships.pop();
    expect(evaluatePartition(artifact, 'P', 'layer:data', { ...options, comparisonPartitionId: 'Q' }).variationOfInformation)
      .toEqual({ status: 'na', reason: 'incompatible-universe' });
  });
  it('VI refuses uncovered entities unless the caller explicitly assigns them a group', () => {
    expect(evaluatePartition(metricFixture(), 'partial', 'layer:data', { ...options, comparisonPartitionId: 'P' }).variationOfInformation)
      .toEqual({ status: 'na', reason: 'missing-primary-membership' });
  });
  it('empty source universes report N/A', () => {
    const artifact = metricFixture(); artifact.snapshot.files[0].lineCount = 0; artifact.snapshot.files[0].utf16Length = 0;
    artifact.entities = artifact.entities.slice(0, 1); artifact.relations = [];
    artifact.entities[0].provenance.locations[0].start = { offset: 0, line: 1, column: 1 };
    artifact.entities[0].provenance.locations[0].end = { offset: 0, line: 1, column: 1 };
    for (const partition of artifact.derived.partitions) { partition.universeEntityIds = []; partition.memberships = []; }
    artifact.coverage.views[0] = { view: 'containment', status: 'complete', candidateSites: 0, resolvedSites: 0, unresolvedSites: 0 };
    validateAnalysisArtifact(artifact);
    const report = evaluatePartition(artifact, 'P', 'layer:data', options);
    expect(report.coverage.fraction).toEqual({ status: 'na', reason: 'zero-denominator' });
  });
  it('seeded shuffles preserve group sizes and approach the independently enumerated mean', () => {
    const artifact = metricFixture(), settings = { shuffleSeed: 1729, shuffleSamples: 4096 };
    const a = evaluatePartition(artifact, 'P', 'layer:data', settings), b = evaluatePartition(artifact, 'P', 'layer:data', settings);
    expect(a).toEqual(b);
    expect(a.baseline.preserves).toBe('primary-group-sizes-and-covered-set');
    expect(a.baseline.mean.status).toBe('ok');
    if (a.baseline.mean.status === 'ok') expect(Math.abs(a.baseline.mean.value - 1 / 3)).toBeLessThan(0.03);
  });
  it('runtime-frequency layers never silently include static edges', () => {
    const artifact = metricFixture(); artifact.layers[0].statuses = ['observed']; artifact.layers[0].weighting = 'runtime-frequency';
    expect(evaluatePartition(artifact, 'P', 'layer:data', options).edgeMass.total).toBe(0);
  });
});
