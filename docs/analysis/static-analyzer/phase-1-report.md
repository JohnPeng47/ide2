# Phase 1 checkpoint — 2026-10-31

The persistence contract and test corpus are ready for implementation. No extractor
logic was added. The analyzer and metric entry points intentionally throw explicit
not-implemented errors. This is **not** a completed architectural analysis of the
repository; that is Phase 2's deliverable.

## Delivered

- Version 1 TypeScript/Zod types plus a generated, checked-in JSON Schema for all
  five views, evidence and uncertainty, source snapshots, static/dynamic identity
  categories, SCC condensation, tree occurrences, partitions, metrics, source joins
  and cross-view findings.
- Pure validation and canonical serialization. Validators reject dangling relations,
  stale hashes, inconsistent positions, cycles/multiple parents in containment,
  invalid SCC/tree references, false coverage accounting and invalid metric arithmetic.
- A pipeline port, an implementation seam and a numerical metric seam. Neither seam
  contains fixture-dependent behavior or extractor logic.
- 15 micro fixtures, four real-source clusters and a seven-file subsystem corpus.
  The whole-repo tier discovers its source set from tsconfig. A 25-line fixture has
  twenty independent branches (over a million potential paths) to discourage path
  enumeration in the data-flow pass.
- Positive and negative independently source-reasoned facts, five semantic golden
  files, and a machine-checked 30-cell view/feature matrix. Expectations are authored
  before extraction and explicitly labeled as agent-verified, not human-reviewed.
- Eleven independent numerical integration cases, including a weighted four-node
  graph with hand-calculated cohesion, VI, and enumerated shuffle expectation.
- Commands, extension instructions, format semantics, edge directions, identity
  limitations, range conventions and diagram-leaf join policy.

## Validation

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run analysis:schema:check` | Pass |
| `npm run test:analysis:contract` | 29 tests pass in 2 files; latest standalone run 1.61 s |
| `npm run test:analysis:integration -- --reporter=dot` | 33 tests fail at explicit analyzer/metric not-implemented seams, as required before Phase 2; no skip/todo/expected-failure masking |
| Initial `npm test -- --reporter=dot` | 15 failures, 1,112 passes; 11 failed files; collected before the analyzer changes |
| Final full suite with `--maxWorkers=2` | 8 failures, 1,148 passes; 7 failed files; all remaining failing test names were present in the initial baseline |

The full existing suite is **not green**. Lower concurrency removed several timing
failures; this is not claimed as an analyzer improvement. Remaining failures concern
existing persisted workspace/projection expectations and two language-server startup
cases failing with `EMFILE` in the file watcher. See [validation.json](validation.json)
for exact test names and command results. No unrelated expectations or application
code were changed to hide these failures. Phase 2 must account for these baseline
failures when checking the brief's global-green requirement.

The intentionally red integration suite is opt-in through its own Vitest config;
normal `npm test` includes the new passing contract/corpus checks. This distinction
is necessary to satisfy test-first development without disguising unimplemented
behavior as a passing test.

## What remains

Implement containment, scopes/captures, call resolution, ownership and data-flow /
framework summaries in that order, using `ANALYSIS_VIEWS` for staged tests. Implement
the metric numerical contract, run all tiers, then persist the actual source graph
and architectural report. Benchmark timings and unresolved rates do not exist yet:
the integration tests only specify their acceptance criteria.

The Phase 1 stop/report boundary is explicit in [the task brief](task.md):
“Stop and report before Phase 2.” This checkpoint honors that boundary. Phase 2 has
not started. The next goal retains its three-hour limit and the total weekly usage
ceiling of 50%; the percentage cannot be translated into an exact token allowance.
