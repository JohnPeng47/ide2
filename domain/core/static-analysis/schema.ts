import { z } from 'zod';

/** Version 1 is a static-analysis contract, with reserved trace identities. */
export const ANALYSIS_SCHEMA_VERSION = 1 as const;
const id = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const relativePath = z.string().min(1).refine(value => !value.startsWith('/') && !value.includes('\\')
  && !value.includes('\0') && !value.split('/').some(part => !part || part === '.' || part === '..')
  && !/^[A-Za-z]:/.test(value), 'Expected a normalized repository-relative path');
const count = z.number().int().nonnegative();
const weight = z.number().finite().nonnegative();
export const analysisViewSchema = z.enum(['containment', 'lexical', 'calls', 'ownership', 'dependencies']);
export const evidenceStatusSchema = z.enum(['resolved', 'inferred', 'observed', 'unresolved']);
export const sourcePositionSchema = z.strictObject({ offset: count, line: z.number().int().positive(), column: z.number().int().positive() });
/** Offsets/columns are UTF-16; lines/columns one-based; end is exclusive. */
export const analysisRangeSchema = z.strictObject({
  snapshotId: id, path: relativePath, fileHash: hash, start: sourcePositionSchema, end: sourcePositionSchema,
}).refine(range => range.end.offset >= range.start.offset && (range.end.line > range.start.line
  || range.end.line === range.start.line && range.end.column >= range.start.column), 'Reversed range');
export const provenanceSchema = z.strictObject({
  status: evidenceStatusSchema,
  method: z.enum(['syntax', 'symbol-resolution', 'local-alias', 'interprocedural-summary', 'framework-summary',
    'control-flow', 'def-use', 'configuration', 'runtime-probe', 'derived']),
  rule: id,
  locations: z.array(analysisRangeSchema).min(1),
  supportingRelationIds: z.array(id),
  explanation: z.string(),
});
export const snapshotSchema = z.strictObject({
  id, repositoryId: id, commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).nullable(),
  dirtyFiles: z.array(z.strictObject({ path: relativePath, status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked']),
    previousPath: relativePath.optional(), contentHash: hash.nullable() })),
  files: z.array(z.strictObject({ path: relativePath, contentHash: hash, utf16Length: count, lineCount: count,
    role: z.enum(['analyzed', 'resolution-only', 'configuration']), language: z.enum(['ts', 'tsx', 'js', 'jsx', 'json', 'other']) })),
  analyzer: z.strictObject({ version: id, compilerVersion: id, identityVersion: z.literal(1), configurationHash: hash }),
  tsconfigs: z.array(z.strictObject({ path: relativePath, contentHash: hash, effectiveOptionsHash: hash })),
  scope: z.strictObject({ roots: z.array(relativePath), excludedPatterns: z.array(z.string()),
    externalPolicy: z.enum(['summarize', 'resolve-declarations']), followImports: z.boolean() }),
});

export const entityKindSchema = z.enum(['repository', 'package', 'directory', 'module', 'class', 'interface', 'type',
  'function', 'method', 'constructor', 'accessor', 'parameter', 'binding', 'field', 'scope', 'expression', 'statement',
  'definition', 'merge', 'allocation', 'state-resource', 'external', 'unknown-target', 'runtime-instance', 'execution-event', 'value-version']);
export const entitySchema = z.strictObject({
  id, kind: entityKindSchema, name: z.string(),
  identity: z.strictObject({ key: id, stability: z.enum(['named', 'structural', 'ambiguous', 'runtime']),
    origin: z.enum(['source', 'external', 'synthetic', 'runtime']) }),
  provenance: provenanceSchema,
  metadata: z.strictObject({
    layer: z.enum(['domain', 'application', 'infrastructure', 'ui', 'server', 'package', 'test', 'other']).optional(),
    feature: z.string().optional(), compositionRoot: z.boolean().optional(), exported: z.boolean().optional(),
    namespace: z.enum(['value', 'type', 'both']).optional(),
    bindingKind: z.enum(['var', 'let', 'const', 'parameter', 'import', 'this']).optional(),
    scopeKind: z.enum(['module', 'function', 'block', 'class', 'catch']).optional(),
    resourceKind: z.enum(['object', 'collection', 'zustand-store', 'react-state', 'react-ref', 'tldraw-atom',
      'tldraw-computed', 'subscription', 'timer', 'controller', 'other']).optional(),
    runId: id.optional(), sourceEntityId: id.optional(), sequence: count.optional(),
  }),
});

const relationBase = { id, from: id, to: id, provenance: provenanceSchema, weight };
export const relationSchema = z.discriminatedUnion('view', [
  z.strictObject({ ...relationBase, view: z.literal('containment'),
    kind: z.enum(['contains', 'imports', 'reexports', 'jsx-child']),
    typeOnly: z.boolean().optional(), specifier: z.string().optional() }),
  z.strictObject({ ...relationBase, view: z.literal('lexical'),
    kind: z.enum(['scope-parent', 'declares', 'references', 'captures', 'captures-this']),
    access: z.array(z.enum(['read', 'reassign', 'object-mutate'])), declaringScopeId: id.optional(),
    captureChannel: z.enum(['lexical', 'import', 'this']).optional(), reach: z.enum(['direct', 'transitive']).optional() }),
  z.strictObject({ ...relationBase, view: z.literal('calls'),
    kind: z.enum(['calls', 'constructs', 'registers', 'schedules', 'resumes', 'returns-to']),
    dispatch: z.enum(['direct', 'virtual', 'union', 'callback', 'computed', 'external', 'unknown']),
    callSiteId: id.optional(), candidateSetId: id.optional() }),
  z.strictObject({ ...relationBase, view: z.literal('ownership'),
    kind: z.enum(['creates', 'retains', 'aliases', 'can-mutate', 'exposes-read-api', 'subscribes', 'unsubscribes', 'disposes', 'escapes']),
    capability: z.enum(['read', 'write', 'subscribe', 'dispose', 'unknown']).optional(),
    depth: z.enum(['binding', 'shallow', 'deep', 'unknown']).optional() }),
  z.strictObject({ ...relationBase, view: z.literal('dependencies'),
    kind: z.enum(['value-flow', 'argument', 'return', 'reads', 'writes', 'control', 'reactive', 'selects', 'prop-flow',
      'context-read', 'effect-dependency', 'awaits']),
    propertyPath: z.array(z.string()).optional(), argumentIndex: count.optional(),
    mechanism: z.enum(['language', 'react', 'zustand', 'tldraw', 'controller', 'transport']).optional() }),
]);

export const uncertaintySchema = z.strictObject({
  id, kind: z.enum(['unresolved', 'escape', 'unsupported', 'ambiguous-identity', 'diagnostic']),
  view: analysisViewSchema, reason: z.enum(['dynamic-dispatch', 'computed-key', 'external-body', 'unknown-alias',
    'escaped-reference', 'unsupported-syntax', 'parse-error', 'type-error', 'identity-collision', 'scope-exclusion', 'other']),
  entityIds: z.array(id), relationIds: z.array(id), candidateEntityIds: z.array(id), provenance: provenanceSchema,
});
export const dependencyLayerSchema = z.strictObject({
  id, view: analysisViewSchema, relationKinds: z.array(id).min(1), statuses: z.array(evidenceStatusSchema).min(1),
  weighting: z.enum(['unit-per-relation', 'static-strength', 'runtime-frequency']),
  excludeSelfEdges: z.boolean(),
});
export const sccSchema = z.strictObject({
  id, layerId: id, universeEntityIds: z.array(id),
  components: z.array(z.strictObject({ id, entityIds: z.array(id).min(1) })),
  edges: z.array(z.strictObject({ from: id, to: id, relationIds: z.array(id).min(1) })),
});
export const treeProjectionSchema = z.strictObject({
  id, layerId: id.optional(), rootOccurrenceId: id,
  occurrences: z.array(z.strictObject({ id, entityId: id, parentOccurrenceId: id.nullable(),
    referenceToOccurrenceId: id.optional() })),
  liftedEdges: z.array(z.strictObject({ relationId: id, fromOccurrenceId: id, toOccurrenceId: id })),
});
export const partitionSchema = z.strictObject({
  id, basis: z.enum(['directory', 'layer', 'concept', 'custom']), universeEntityIds: z.array(id),
  groups: z.array(z.strictObject({ id, label: z.string() })),
  memberships: z.array(z.strictObject({ entityId: id, groupIds: z.array(id), primaryGroupId: id.nullable() })),
});
export const metricValueSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok'), value: z.number().finite() }),
  z.strictObject({ status: z.literal('na'), reason: z.enum(['zero-denominator', 'empty-universe', 'incompatible-universe',
    'missing-primary-membership', 'not-requested', 'insufficient-baseline']) }),
]);
export const metricReportSchema = z.strictObject({
  id, partitionId: id, layerId: id, comparisonPartitionId: id.optional(),
  coverage: z.strictObject({ totalLines: count, coveredLines: count, overlappingLines: count, fraction: metricValueSchema,
    overlapFraction: metricValueSchema }),
  edgeMass: z.strictObject({ internal: weight, between: weight, boundary: weight, uncovered: weight, total: weight }),
  internalFraction: metricValueSchema, coveredCohesion: metricValueSchema,
  variationOfInformation: metricValueSchema,
  baseline: z.strictObject({ seed: z.number().int(), samples: count, preserves: z.literal('primary-group-sizes-and-covered-set'),
    mean: metricValueSchema, standardDeviation: metricValueSchema, excessCohesion: metricValueSchema }),
});
export const sourceJoinSchema = z.strictObject({
  id, diagramRevisionId: id, leafId: id, range: analysisRangeSchema,
  entityIds: z.array(id), policy: z.enum(['fully-contained', 'intersects']),
  evidenceId: id.optional(), sourceRangeId: id.optional(),
  status: z.enum(['matched', 'unmapped', 'stale', 'ambiguous']),
});
export const findingSchema = z.strictObject({
  id, kind: z.enum(['cross-view-boundary', 'cross-boundary-write', 'mutable-capture', 'shared-state']),
  entityIds: z.array(id).min(1), relationIds: z.array(id).min(1), partitionIds: z.array(id),
  provenance: provenanceSchema,
  summary: z.string(),
  assessment: z.literal('investigate'),
});

export const analysisArtifactSchema = z.strictObject({
  schemaVersion: z.literal(ANALYSIS_SCHEMA_VERSION), snapshot: snapshotSchema,
  entities: z.array(entitySchema), relations: z.array(relationSchema), uncertainties: z.array(uncertaintySchema),
  layers: z.array(dependencyLayerSchema),
  derived: z.strictObject({ sccs: z.array(sccSchema), trees: z.array(treeProjectionSchema),
    partitions: z.array(partitionSchema), metrics: z.array(metricReportSchema), sourceJoins: z.array(sourceJoinSchema), findings: z.array(findingSchema) }),
  coverage: z.strictObject({ analyzedFiles: count, resolutionOnlyFiles: count, unresolvedCount: count,
    views: z.array(z.strictObject({ view: analysisViewSchema, status: z.enum(['complete', 'partial', 'not-run']),
      candidateSites: count, resolvedSites: count, unresolvedSites: count })) }),
});

export type AnalysisView = z.infer<typeof analysisViewSchema>;
export type AnalysisRange = z.infer<typeof analysisRangeSchema>;
export type AnalysisSnapshot = z.infer<typeof snapshotSchema>;
export type AnalysisEntity = z.infer<typeof entitySchema>;
export type AnalysisRelation = z.infer<typeof relationSchema>;
export type AnalysisProvenance = z.infer<typeof provenanceSchema>;
export type AnalysisPartition = z.infer<typeof partitionSchema>;
export type AnalysisArtifact = z.infer<typeof analysisArtifactSchema>;
export type AnalysisMetricValue = z.infer<typeof metricValueSchema>;
export type AnalysisMetricReport = z.infer<typeof metricReportSchema>;
