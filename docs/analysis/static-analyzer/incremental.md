# Incremental analysis

`IncrementalAnalyzer` reuses unchanged dependency-connected groups of source files.
It uses the previous analyzer output to add cross-file dependency edges, and reads
current TypeScript module resolution before deciding what is safe to reuse. This
also discovers new imports and imports that previously failed to resolve.

```ts
import { IncrementalAnalyzer } from '../../../infrastructure/core/static-analysis/incremental';

const session = new IncrementalAnalyzer();
const first = await session.analyze(request);
// Edit source files, then pass the current selection again.
const next = await session.analyze(request);
console.log(next.update.analyzedFiles, next.update.reusedFiles);
// next.artifact has the same persistence format as staticAnalyzer.analyze().
```

The cache unit is an undirected connected component, including transitive local
imports outside the selected emission scope. This conservative boundary preserves
the existing extractor's shared alias and callback state. An edit to a dependency
can invalidate a selected consumer even when `changedFiles` is empty: that field
reports changes to selected files, while `analyzedFiles` reports extraction work.
`removedFiles` reports files removed from the selection, including deleted files.

A cache key includes source contents, resolution results, the selected paths,
compiler options/version, analyzer version, repository identity, enabled views,
framework adapters, ambient/external compiler inputs, and package configuration.
Configuration changes invalidate cached extraction. Global scripts, module/global
augmentations, selected declaration files, nonliteral dynamic module resolution,
ambient declarations importing local implementation files, and Node16/NodeNext
resolution conservatively combine all files into one group.
Previous dependency edges can retain an obsolete connection for one extra update.

Assembly rebuilds the snapshot and all derived SCCs, containment trees, partitions,
cohesion/VI metrics, and findings. Changing only metric settings reuses extraction
and recomputes those derived results. This is component-level extraction reuse;
it does not yet incrementally update individual functions or derived graph
algorithms. A densely connected repository may be one component.

External symbol summaries are scoped to their referencing module so that adding
an independent file cannot change another file's external-symbol identities.
Coverage is reconstructed from persisted relation and uncertainty source sites.

## Checkpoints

`session.exportCheckpoint()` returns a version-1 serializable checkpoint, and
`session.restoreCheckpoint(checkpoint)` restores it after validating graph
references and fragment scopes. Cache keys are checked against current inputs on
the next run. Restore and concurrent updates are rejected while a run is active;
a failed update leaves the previous checkpoint intact.

Checkpoints are trusted local cache data, not authenticated evidence. Export and
restore clone the in-memory graph. JSON serialization is suitable for bounded
scopes; there is no streaming, whole-repository checkpoint store or CLI cache
adapter yet. The ordinary artifact writer remains a separate streaming pipeline.

## Historical replay

```sh
npm run analysis:history
# Or reuse an isolated worktree and supply an explicit sequence:
npm run analysis:history -- /tmp/my-analysis-history COMMIT_A COMMIT_B COMMIT_A
```

The runner creates a detached Git worktree, refuses to discard tracked changes,
and checks out each pinned commit in sequence. Current installed dependencies
are shared through a `node_modules` symlink; this tests historical source changes,
not historical dependency installations. It leaves the worktree available for
inspection. Each step compares SHA-256 hashes of the entire validated canonical
artifact from incremental and fresh extraction, including metadata and derived
results. The evidence is written to `docs/analysis/artifacts/history-replay.json`.

The checked replay contains nine steps over five distinct commits, including
backward/forward source changes, package-configuration changes, and a final no-op.
All nine outputs match fresh extraction. The source-only transition reuses the
independent architecture-test file in both directions; the no-op reuses all four
selected files. These are deliberately bounded real-code samples, not a claim of
whole-repository historical coverage.

Small historical samples are currently slower incrementally because inventory
and snapshot assembly build compiler programs and global derivation still runs.
The evidence proves safe reuse in these cases, not a measured performance gain.
Focused integration tests additionally exercise deletion, rename, newly resolved
imports, unselected dependencies, shared external symbols and package containment,
checkpoint restoration/failure, metric/view changes, globals, and dynamic imports.

## Validation status

- Twelve focused incremental integration tests pass.
- The broader non-whole-repository integration run passed 55 tests before adding
  the final ambient-type regression; the focused run includes that regression.
- Thirty-four analyzer contract tests, TypeScript checking, and all 1,161
  application tests pass.
- Nine historical replay steps match fresh canonical output exactly.
- The whole-repository test still fails its unchanged 180-second timeout:
  extraction took about 51.0 and 58.7 seconds, both canonical streams matched,
  and memory checks passed, but extraction plus persistence verification took
  187.35 seconds. That performance gate remains open. The existing generated
  whole-repository architecture report has not been regenerated by this change.
