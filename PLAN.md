# Corpus-Aware Representation Refresh Redesign

## Objective

Redesign the Representation model and indexing system so the application can:

1. Detect changes to the underlying corpus.
2. Identify the affected source line ranges.
3. Find every linked Representation and decide whether it must change.
4. Persist updated Representations safely.

A Representation is defined as an immutable LLM artifact generated over a point-in-time snapshot of one or more corpus ranges. Every Representation must have complete, revision-specific evidence mapping. An unmapped generated output is a draft, not a Representation.

```text
live Corpus
    |
    +--> snapshot + diff
              |
              v
      Representation impact index
              | finds intersecting mapped ranges
              v
          LLM assessment
              |
              +--> unaffected -------> nothing
              +--> line shift only --> rebase evidence
              +--> semantic change --> regenerate artifact + remap
              `--> ambiguous -------> manual review
                                          |
                                          v
                             append immutable Representation
                             and atomically advance current pointer
```

## 1. Redefine Representation

The existing naming is backwards for the new definition:

- `ProjectRepresentationRecord` is currently a mutable logical identity.
- `ProjectRepresentationRevisionRecord` is the actual point-in-time artifact.

Replace them conceptually with a logical series and immutable Representations:

```ts
interface RepresentationSeriesRecord {
  id: string;
  projectId: string;
  handle: string;
  name: string;
  kind: RepresentationArtifact["kind"];

  currentRepresentationId: string;
  representationIds: string[];

  status: "settled" | "archived";
  refreshPolicy: "manual" | "review" | "automatic";

  createdAt: string;
  updatedAt: string;
}

interface RepresentationRecord {
  id: string;
  projectId: string;
  seriesId: string;
  revision: number;

  artifact: RepresentationArtifact;
  artifactSha256: string;

  // Mandatory and revision-specific.
  mapped: RepresentationEvidenceRecord["id"];

  derivedFromRepresentationIds?: string[];
  generation?: RepresentationGenerationProvenance;

  createdAt: string;
}
```

An unmapped LLM output remains a `GeneratedArtifactDraft`. It enters the Representation catalog only after its evidence record validates.

The mandatory `mapped` reference belongs to the immutable Representation, not the mutable series. This prevents an artifact from being paired with evidence from a different point in time.

## 2. Generalize Representation artifacts

Code compactions should stop living in a separate conceptual catalog:

```ts
type RepresentationArtifact =
  | {
      kind: "ascii-diagram";
      content: string;
    }
  | {
      kind: "ascii-tree";
      content: string;
    }
  | {
      kind: "code-compaction";
      language?: string;
      content: CompactedSource;
    };
```

Each file compaction becomes a Representation series, keyed by a stable identity such as:

```text
code-compaction:<path>:<profile-id>
```

Its current Representation is resolved in the same way as a current diagram. Once migration is complete, `ProjectCorpusCompactionCatalogRecord` and `activeByPath` can be removed.

## 3. Replace `DiagramCodeEntityMapRecord`

This must be a schema redesign rather than a mechanical rename. The existing record maps diagram coordinates indirectly to CodeEntities, whereas corpus change detection needs direct, immutable corpus dependencies.

```ts
interface RepresentationEvidenceRecord {
  schemaVersion: 2;
  id: string;
  projectId: string;
  representationId: string;
  artifactSha256: string;

  snapshotId: CorpusSnapshotRecord["id"];

  // Mandatory, nonempty authoritative dependency set.
  ranges: CorpusRangeSnapshotReference[];

  // Maps artifact elements back to one or more ranges.
  elements: RepresentationElementEvidenceLink[];

  coverage: "complete";
  createdAt: string;
}

interface CorpusRangeSnapshotReference {
  id: string;
  fileSnapshotId: string;
  path: string;
  startLine: number;
  endLine: number;
  contentSha256: string;
  symbol?: string;
}
```

Element locators must support all Representation types:

```ts
type RepresentationElementLocator =
  | { kind: "ascii-region"; line: number; startColumn: number; endColumn: number }
  | { kind: "tree-node"; elementId: string }
  | { kind: "compaction-section"; sectionId: string }
  | { kind: "compaction-node"; sectionId: string; nodeId: string };
```

CodeEntity metadata may remain as a semantic annotation, but it should no longer be the authoritative route from a Representation to the corpus.

For complete accountability, every semantic artifact element must either map to at least one corpus range or be explicitly classified as generated/decorative. There must be no silent unmapped elements.

## 4. Capture sufficient corpus snapshots

Range text alone cannot reliably detect line shifts caused by edits earlier in a file. Capture an immutable, content-addressed snapshot of every referenced file:

```ts
interface CorpusFileSnapshotRecord {
  id: string;
  projectId: string;
  path: string;
  contentSha256: string;
  lineCount: number;
  blobPath: string;
  providerRevision?: string;
  capturedAt: string;
}

interface CorpusSnapshotRecord {
  id: string;
  projectId: string;
  fileSnapshotIds: string[];
  providerRevision?: string;
  capturedAt: string;
}
```

Store blobs under:

```text
.diagrams/corpus/snapshots/<sha256>
```

This works for committed Git revisions, dirty working copies, and ordinary filesystem documents.

## 5. Split `representationIndex.ts`

The current file mixes structural parsing with evidence resolution and explicitly allows missing maps. Its tests currently treat unmapped trees as valid. That invariant must be reversed.

Split the responsibilities:

```text
src/representationElementIndex.ts
    Artifact-local structural indexing for ASCII trees, diagrams,
    and compaction sections. Requires RepresentationEvidenceRecord.

src/representationIndex.ts
    Project-wide reverse dependency index from corpus ranges to
    current Representations and from upstream to downstream Representations.

src/representationEvidence.ts
    Evidence validation, coverage validation, and element resolution.
```

The new project-wide index should resemble:

```ts
interface RepresentationIndexRecord {
  projectId: string;

  byCorpusPath: Record<string, IndexedRepresentationRange[]>;
  byRepresentationId: Record<string, IndexedRepresentationDependencies>;
  byUpstreamRepresentationId: Record<string, string[]>;
}
```

The index is derived and rebuildable from the Representation catalog. It is not the source of truth.

`buildRepresentationElementIndex()` must require `mapped` and reject:

- Missing or empty evidence records.
- Artifact-hash mismatches.
- Evidence belonging to another Representation.
- Undeclared semantic elements.
- Stale or invalid corpus snapshot references.

## 6. Detect and classify corpus changes

For each distinct old file snapshot referenced by a current Representation:

1. Read the live file through its `CorpusProvider`.
2. Compare its hash with the stored file snapshot.
3. Diff the old full-file snapshot against the live file.
4. Generate old-to-new line mappings.
5. Intersect each diff hunk with indexed evidence ranges.

Classify each mapped range as:

```ts
type CorpusRangeImpact =
  | "unchanged"
  | "shifted"
  | "modified"
  | "deleted"
  | "renamed"
  | "ambiguous";
```

An insertion above a range normally produces `shifted`; an edit inside the range produces `modified`.

Every Representation must be compared against its own snapshot, not merely the last global scan. Otherwise a skipped refresh could lose cumulative changes.

Persist the scan result as a `CorpusChangeSetRecord` containing old and new file snapshot IDs and normalized line hunks. Cache diffs by the pair of file snapshot IDs so Representations sharing a baseline do not repeat work.

## 7. Assess and refresh Representations

Apply deterministic filtering before invoking an LLM:

- No intersecting changes: do nothing.
- Coordinates shifted but source content remains identical: create an evidence-only Representation using the same artifact.
- Mapped content changed: ask the LLM whether the artifact is semantically stale.
- Deleted or ambiguously relocated evidence: require manual review.

Use a structured assessment result:

```ts
interface RepresentationRefreshDecision {
  verdict: "unchanged" | "update-required" | "manual-review";
  affectedElementIds: string[];
  rationale: string;
}
```

When an update is required:

1. Supply the current artifact, generation recipe, old evidence, exact before/after hunks, and new corpus ranges.
2. Generate a candidate artifact.
3. Generate its complete `RepresentationEvidenceRecord`.
4. Validate artifact structure, evidence coverage, hashes, and snapshot identity.
5. Confirm that the corpus has not changed again since scanning.
6. Persist a new immutable Representation.
7. Atomically advance the series' `currentRepresentationId`.

Never overwrite an old Representation or mutate its evidence in place.

Code-compaction Representations should update first. Representations derived from them should then be assessed in dependency order. The dependency graph must remain acyclic.

## 8. Redesign persistence

Move large immutable revision data out of the monolithic catalog:

```text
.diagrams/
  corpus/
    snapshots/
      <content-sha256>
    changes/
      <change-set-id>.json

  representations/
    catalog.json
    evidence/
      <evidence-id>.json
    series/
      <series-id>/
        series.json
        revisions/
          <representation-id>/
            representation.json

  refresh-runs/
    <refresh-run-id>.json
```

Write updates to a staging location, validate them, and atomically rename them into place before advancing the series pointer.

Revision identity must include the artifact digest and evidence/snapshot identity. The current behavior that deduplicates revisions using only `asciiSha256` is insufficient: the same artifact rebased onto a new corpus snapshot is a distinct Representation.

The existing `activeByKind` model should also be removed. It permits only one active Representation per diagram kind and does not model multiple settled/starred Representations or file compactions correctly. Each logical series owns its current pointer independently.

## 9. API and execution model

Begin with an explicit reconciliation workflow:

```text
POST /api/project/corpus/scan
POST /api/project/representations/refresh?dryRun=true
POST /api/project/representations/refresh
GET  /api/project/representation-refresh-runs/:id
```

The corresponding CLI should support:

```text
npm run diagram -- representations scan
npm run diagram -- representations refresh --dry-run
npm run diagram -- representations refresh
```

Do not initially invoke LLM refreshes automatically on every file save. First make explicit scan and refresh reliable. A later phase can add a debounced watcher that batches corpus changes into one project-scoped refresh run.

The UI should expose:

- Corpus changed.
- Representation current.
- Evidence rebased.
- Update recommended.
- Refresh running.
- Manual review required.
- Refresh failed.

## 10. Migration

Use a one-off migration script:

1. Snapshot every file referenced by current settled Representations.
2. Convert each project representation revision into an immutable `RepresentationRecord`.
3. Convert its copied evidence and mappings into a `RepresentationEvidenceRecord`.
4. Set the mandatory `mapped` field.
5. Convert every active code compaction into a `code-compaction` Representation.
6. Build and validate the reverse dependency index.
7. Confirm counts, artifact hashes, source ranges, and UI rendering.
8. Back up and retire the legacy representation and compaction catalogs.
9. Rename generation-session `code-entity-maps` only after candidate-generation workflows adopt the new invariant.

Legacy records that cannot be tied to their original corpus snapshot must be marked for manual review. They must not be silently considered current.

## 11. Implementation sequence

1. Add v2 Representation, snapshot, and evidence schemas with strict validators.
2. Split artifact-local spatial indexing from the new project dependency index.
3. Implement content-addressed corpus snapshots and old-to-new line mapping.
4. Implement deterministic impact classification without LLM calls.
5. Convert code compactions into Representations.
6. Add assessment, regeneration, and remapping agent operations.
7. Add atomic refresh-run persistence and APIs.
8. Add UI state and explicit scan/refresh controls.
9. Run the migration only after end-to-end fixture tests pass.
10. Add the optional debounced corpus watcher after explicit refresh is proven stable.

## 12. Acceptance tests

The implementation is complete when automated tests prove:

- Editing outside every mapped range leaves Representations current.
- Inserting lines above a mapped range rebases its coordinates without regenerating the artifact.
- Editing inside a mapped range creates an impact record and assessment.
- Deleting or ambiguously moving mapped source requires manual review.
- A semantic update creates a new immutable Representation and mandatory evidence record.
- The prior Representation and its corpus snapshot remain readable.
- A corpus change between assessment and commit aborts or requeues the update.
- Code compactions participate in the same impact and refresh pipeline.
- Compactions refresh before their dependent Representations.
- Unmapped artifacts never enter the Representation catalog or impact index.
- Migration preserves every valid settled artifact, mapping, and compaction.
- A failed refresh cannot partially advance the current Representation pointer.
