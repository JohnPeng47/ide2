import { describe, expect, it } from 'vitest';
import { parseAnalysisArtifact, serializeAnalysisArtifact, validateAnalysisArtifact } from '../persistence';
import type { AnalysisArtifact, AnalysisMetricReport } from '../schema';
import { contractFixture, contractText } from './contractFixture';

describe('static analysis persistence boundary', () => {
  it('round trips hand-authored facts independently of record insertion order', () => {
    const original = contractFixture(), shuffled = structuredClone(original);
    shuffled.entities.reverse(); shuffled.relations.reverse(); shuffled.coverage.views.reverse();
    const json = serializeAnalysisArtifact(original);
    expect(serializeAnalysisArtifact(shuffled)).toBe(json);
    expect(serializeAnalysisArtifact(parseAnalysisArtifact(json))).toBe(json);
    expect(validateAnalysisArtifact(original, new Map([['source.ts', contractText]]))).toEqual(original);
  });

  const malformed: [string, (artifact: AnalysisArtifact) => void, string][] = [
    ['dangling endpoints', a => { a.relations[0].to = 'missing'; }, 'missing entity'],
    ['stale source hashes', a => { a.entities[0].provenance.locations[0].fileHash = 'b'.repeat(64); }, 'unpinned range'],
    ['foreign snapshots', a => { a.entities[0].provenance.locations[0].snapshotId = 'old'; }, 'unpinned range'],
    ['out of bounds ranges', a => { a.entities[0].provenance.locations[0].end.offset = 900; }, 'range past EOF'],
    ['duplicate IDs', a => { a.entities[1].id = a.entities[0].id; }, 'duplicate record ID'],
    ['containment cycles', a => { a.relations[0].from = 'binding:x'; }, 'containment cycle'],
    ['multiple containment parents', a => { a.relations.push({ ...a.relations[0], id: 'extra' }); }, 'multiple parents'],
    ['orphan entities', a => { a.relations.pop(); }, 'orphan entity'],
    ['unknown membership', a => { a.derived.partitions[0].memberships[0].groupIds = ['missing']; }, 'unknown group'],
    ['omitted uncovered membership', a => { a.derived.partitions[0].memberships = []; }, 'uncovered members'],
    ['false unresolved counts', a => { a.coverage.unresolvedCount = 3; }, 'unresolved count differs'],
    ['missing view coverage', a => { a.coverage.views.pop(); }, 'all five views'],
    ['unaccounted candidate sites', a => { a.coverage.views[0].candidateSites = 8; }, 'not accounted'],
    ['false runtime evidence', a => { a.entities[0].provenance.status = 'observed'; }, 'runtime probe'],
  ];
  it.each(malformed)('rejects %s', (_label, mutate, error) => {
    const artifact = structuredClone(contractFixture()); mutate(artifact);
    expect(() => validateAnalysisArtifact(artifact)).toThrow(error);
  });
  it('rejects accidental schema expansion and mismatched view/kind', () => {
    expect(() => validateAnalysisArtifact({ ...contractFixture(), surprise: true })).toThrow();
    const artifact = contractFixture();
    expect(() => validateAnalysisArtifact({ ...artifact, relations: [{ ...artifact.relations[0], kind: 'calls' }] })).toThrow();
  });
  it('validates coordinates in UTF-16 against the pinned text', () => {
    const artifact = structuredClone(contractFixture()); artifact.entities[0].provenance.locations[0].end.column = 3;
    expect(() => validateAnalysisArtifact(artifact, new Map([['source.ts', contractText]]))).toThrow('coordinates disagree');
  });
  it('preserves property access order while sorting set-like collections', () => {
    const artifact = contractFixture();
    artifact.relations.push({ id: 'read', from: 'binding:x', to: 'module:source', view: 'dependencies', kind: 'reads',
      propertyPath: ['z', 'a'], weight: 1, provenance: artifact.entities[0].provenance });
    const relation = parseAnalysisArtifact(serializeAnalysisArtifact(artifact)).relations.find(edge => edge.id === 'read');
    expect(relation?.view === 'dependencies' && relation.propertyPath).toEqual(['z', 'a']);
  });
  it('represents a shared entity as two occurrences without merging their parents', () => {
    const artifact = contractFixture();
    artifact.derived.trees.push({ id: 'tree:test', rootOccurrenceId: 'root', occurrences: [
      { id: 'root', entityId: 'module:source', parentOccurrenceId: null },
      { id: 'a', entityId: 'binding:x', parentOccurrenceId: 'root' },
      { id: 'b', entityId: 'binding:x', parentOccurrenceId: 'root', referenceToOccurrenceId: 'a' },
    ], liftedEdges: [] });
    expect(parseAnalysisArtifact(serializeAnalysisArtifact(artifact)).derived.trees[0].occurrences).toHaveLength(3);
    artifact.derived.trees[0].occurrences[2].entityId = 'module:source';
    expect(() => validateAnalysisArtifact(artifact)).toThrow('shared identity');
  });
  it('allows cycles in the source call graph but rejects cycles in its condensation', () => {
    const artifact = contractFixture(), provenance = artifact.entities[0].provenance;
    artifact.layers.push({ id: 'layer:call', view: 'calls', relationKinds: ['calls'], statuses: ['resolved'], weighting: 'unit-per-relation', excludeSelfEdges: false });
    artifact.relations.push({ id: 'call:a', view: 'calls', kind: 'calls', dispatch: 'direct', from: 'module:source', to: 'binding:x', provenance, weight: 1 },
      { id: 'call:b', view: 'calls', kind: 'calls', dispatch: 'direct', from: 'binding:x', to: 'module:source', provenance, weight: 1 });
    artifact.derived.sccs.push({ id: 'scc:test', layerId: 'layer:call', universeEntityIds: ['module:source', 'binding:x'],
      components: [{ id: 'component:both', entityIds: ['module:source', 'binding:x'] }], edges: [] });
    expect(() => validateAnalysisArtifact(artifact)).not.toThrow();
    artifact.derived.sccs[0].components = [{ id: 'a', entityIds: ['module:source'] }, { id: 'b', entityIds: ['binding:x'] }];
    artifact.derived.sccs[0].edges = [{ from: 'a', to: 'b', relationIds: ['call:a'] }, { from: 'b', to: 'a', relationIds: ['call:b'] }];
    expect(() => validateAnalysisArtifact(artifact)).toThrow('condensation cycle');
  });
  it('does not turn an old diagram mapping into a current entity match', () => {
    const artifact = contractFixture();
    artifact.derived.sourceJoins.push({ id: 'join:test', diagramRevisionId: 'diagram:1', leafId: 'leaf:1',
      range: { ...artifact.entities[0].provenance.locations[0], snapshotId: 'old-snapshot' }, entityIds: [], policy: 'fully-contained', status: 'stale' });
    expect(() => validateAnalysisArtifact(artifact)).not.toThrow();
    artifact.derived.sourceJoins[0].entityIds.push('binding:x');
    expect(() => validateAnalysisArtifact(artifact)).toThrow('stale source join');
  });
  it('preserves CRLF and counts surrogate pairs as two UTF-16 units', () => {
    const text = '\u{1f642}\r\nx';
    const artifact = structuredClone(contractFixture());
    artifact.snapshot.files[0].utf16Length = text.length; artifact.snapshot.files[0].lineCount = 2;
    for (const fact of [...artifact.entities, ...artifact.relations]) fact.provenance.locations = [{ ...fact.provenance.locations[0],
      start: { offset: 4, line: 2, column: 1 }, end: { offset: 5, line: 2, column: 2 } }];
    expect(() => validateAnalysisArtifact(artifact, new Map([['source.ts', text]]))).not.toThrow();
    artifact.entities[0].provenance.locations[0].start.offset = 3;
    expect(() => validateAnalysisArtifact(artifact, new Map([['source.ts', text]]))).toThrow('coordinates disagree');
  });
  it('rejects runtime identities without their run and source identity', () => {
    const artifact = contractFixture(); artifact.entities[2].kind = 'runtime-instance';
    expect(() => validateAnalysisArtifact(artifact)).toThrow('runtime entity requires');
    artifact.entities[2].identity = { key: 'runtime:test', origin: 'runtime', stability: 'runtime' };
    artifact.entities[2].metadata = { runId: 'run:test', sourceEntityId: 'module:source' };
    artifact.entities[2].provenance = { ...artifact.entities[2].provenance, status: 'observed', method: 'runtime-probe' };
    expect(() => validateAnalysisArtifact(artifact)).not.toThrow();
  });
  it('rejects a layer that mixes runtime frequencies with inferred static edges', () => {
    const artifact = contractFixture(); artifact.layers[0].weighting = 'runtime-frequency';
    expect(() => validateAnalysisArtifact(artifact)).toThrow('observed-only');
  });
  it('validates persisted coverage, edge mass and N/A arithmetic independently of the metric implementation', () => {
    const artifact = contractFixture(), na = { status: 'na' as const, reason: 'not-requested' as const };
    const report: AnalysisMetricReport = {
      id: 'metric:test', layerId: 'layer:data', partitionId: 'partition:one',
      coverage: { totalLines: 1, coveredLines: 1, overlappingLines: 0, fraction: { status: 'ok', value: 1 }, overlapFraction: { status: 'ok', value: 0 } },
      edgeMass: { internal: 0, between: 0, boundary: 0, uncovered: 0, total: 0 },
      internalFraction: { status: 'na', reason: 'zero-denominator' }, coveredCohesion: { status: 'na', reason: 'zero-denominator' },
      variationOfInformation: na,
      baseline: { seed: 1729, samples: 0, preserves: 'primary-group-sizes-and-covered-set', mean: na, standardDeviation: na, excessCohesion: na },
    };
    artifact.derived.metrics.push(report);
    expect(() => validateAnalysisArtifact(artifact)).not.toThrow();
    report.coveredCohesion = { status: 'ok', value: 1 };
    expect(() => validateAnalysisArtifact(artifact)).toThrow('covered cohesion');
    report.coveredCohesion = { status: 'na', reason: 'zero-denominator' };
    report.edgeMass.total = 5;
    expect(() => validateAnalysisArtifact(artifact)).toThrow('mass not conserved');
  });
});
