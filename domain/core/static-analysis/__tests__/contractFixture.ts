import type { AnalysisArtifact, AnalysisEntity, AnalysisProvenance } from '../schema';

/** Authored by inspection: "export const x = 1;\n" is 20 UTF-16 code units, one source line. */
export const contractText = 'export const x = 1;\n';
export const contractHash = 'a'.repeat(64);
export function contractFixture(): AnalysisArtifact {
  const provenance: AnalysisProvenance = { status: 'resolved', method: 'syntax', rule: 'test:declaration',
    locations: [{ snapshotId: 'snapshot:test', path: 'source.ts', fileHash: contractHash,
      start: { offset: 0, line: 1, column: 1 }, end: { offset: 19, line: 1, column: 20 } }],
    supportingRelationIds: [], explanation: 'Hand-authored persistence example; no extractor was run.' };
  const entity = (id: string, kind: AnalysisEntity['kind']): AnalysisEntity => ({ id, kind, name: id,
    identity: { key: id, stability: 'named', origin: kind === 'repository' ? 'synthetic' : 'source' }, provenance, metadata: {} });
  return {
    schemaVersion: 1,
    snapshot: { id: 'snapshot:test', repositoryId: 'repository:test', commit: null, dirtyFiles: [],
      files: [{ path: 'source.ts', contentHash: contractHash, utf16Length: contractText.length, lineCount: 1, role: 'analyzed', language: 'ts' }],
      analyzer: { version: 'phase1', compilerVersion: '5.9.3', identityVersion: 1, configurationHash: contractHash }, tsconfigs: [],
      scope: { roots: ['source.ts'], excludedPatterns: [], externalPolicy: 'summarize', followImports: false } },
    entities: [entity('repository:test', 'repository'), entity('module:source', 'module'), entity('binding:x', 'binding')],
    relations: [
      { id: 'relation:root', view: 'containment', kind: 'contains', from: 'repository:test', to: 'module:source', provenance, weight: 1 },
      { id: 'relation:x', view: 'containment', kind: 'contains', from: 'module:source', to: 'binding:x', provenance, weight: 1 },
    ],
    uncertainties: [], layers: [{ id: 'layer:data', view: 'dependencies', relationKinds: ['value-flow', 'reads', 'writes'],
      statuses: ['resolved', 'inferred'], weighting: 'unit-per-relation', excludeSelfEdges: true }],
    derived: { sccs: [], trees: [], partitions: [{ id: 'partition:one', basis: 'custom', universeEntityIds: ['binding:x'],
      groups: [{ id: 'group:one', label: 'All' }], memberships: [{ entityId: 'binding:x', groupIds: ['group:one'], primaryGroupId: 'group:one' }] }],
      metrics: [], sourceJoins: [], findings: [] },
    coverage: { analyzedFiles: 1, resolutionOnlyFiles: 0, unresolvedCount: 0,
      views: (['containment', 'lexical', 'calls', 'ownership', 'dependencies'] as const).map(view => ({ view,
        status: view === 'containment' ? 'complete' : 'not-run', candidateSites: view === 'containment' ? 2 : 0,
        resolvedSites: view === 'containment' ? 2 : 0, unresolvedSites: 0 })) },
  };
}
