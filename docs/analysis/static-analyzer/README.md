# Five-view static analyzer

The TypeScript compiler adapter extracts containment, lexical captures, calls,
ownership capabilities and data dependencies. Pure domain code validates the graph,
computes SCCs, evaluates partitions and derives architectural findings. Runtime
tracing and canvas UI changes are outside this task.

The original brief is preserved in [task.md](task.md), and the test-first checkpoint
in [phase-1-report.md](phase-1-report.md). Implementation and measured optimization
iterations are recorded in [iterations.jsonl](iterations.jsonl). The generated
[whole-repository report](../architecture-whole-repository.md) links its persisted graph.
During implementation, consult the report's snapshot and run manifest: a generated
report describes that pinned run, not later working-tree edits.

## Run

```sh
npm run typecheck
npm run analysis:schema:check
npm run test:analysis:contract
npm run test:analysis:integration
npm run analysis:run
# Optional selected scope (the positional arguments are repository-relative prefixes):
npm run analysis:run -- src/features/mapping/workspace
```

The normal `npm test` includes contract, source-join and corpus-integrity tests.
The separate integration configuration runs the compiler pipeline and performance
checks. Integration loads the analyzer through the same Node/tsx loader as the CLI;
Vitest retains the assertions, independent wall-clock measurements and process RSS
checks. This avoids benchmarking Vitest SSR module rewriting as analyzer work.
On hosts with exhausted inotify watches, the full app suite can run with
`CHOKIDAR_USEPOLLING=1 npm test -- --maxWorkers=2`; this changes the watcher backend,
not assertions. Analyzer integration uses a 1728 MiB V8 heap cap to trigger garbage
collection before the unchanged 2 GiB process RSS ceiling.

Run an implementation stage without pretending later stages exist:

```sh
ANALYSIS_VIEWS=containment npm run test:analysis:integration -- --testNamePattern='Tier [01]'
ANALYSIS_VIEWS=containment,lexical,calls npm run test:analysis:integration -- --testNamePattern='Tier [01]'
npm run test:analysis:integration -- --testNamePattern='independent partition'
npm run test:analysis:integration -- --testNamePattern='Tier 3'
```

Every requested view must report its processing status and site counts. Unrequested
views are `not-run`. `complete` means processing completed for the declared scope,
not that JavaScript semantics have been proved completely. Unknown sites remain
explicit even in a completed pass. Metrics only use available layers.

## Deliverable map

| File | Responsibility |
| --- | --- |
| `domain/core/static-analysis/schema.ts` | Zod schemas and inferred TypeScript types; v1 wire format |
| `domain/core/static-analysis/analysis.schema.json` | Generated JSON Schema, committed for non-TypeScript consumers |
| `domain/core/static-analysis/persistence.ts` | Validation, canonical JSON serialization and parsing |
| `application/core/static-analysis/ports.ts` | Full-pipeline request/result boundary |
| `infrastructure/core/static-analysis/analyzer.ts` | Compiler-backed extraction and bounded compiler lifetime |
| `domain/core/static-analysis/sourceJoins.ts` | Pinned diagram range joins and overlap-preserving concept partitions |
| `domain/core/static-analysis/report.ts` | Deterministic Markdown report from persisted evidence |
| `domain/core/static-analysis/metrics.ts` | Weighted cohesion, coverage, overlap, VI and seeded shuffled baselines |
| `infrastructure/core/static-analysis/__tests__/fixtures` | Small source fixtures, stored as `.txt` to avoid polluting app compilation |
| `infrastructure/core/static-analysis/__tests__/oracle.ts` | Independently reasoned positive and negative micro expectations |
| `infrastructure/core/static-analysis/__tests__/goldens` | Hand-authored semantic golden projections for real seeds and subsystem |
| `infrastructure/core/static-analysis/__tests__/coverageMatrix.ts` | Machine-checked 5-view × 6-feature matrix |

JSON Schema checks shape. The TypeScript validator additionally checks referenced
IDs, snapshot-pinned ranges, containment and projection trees, acyclic SCC
condensations, memberships, count accounting, and metric arithmetic. When source
text is supplied, it checks UTF-16 positions too. The integration harness independently
hashes the source files. JSON Schema alone is not sufficient validation.

## Tiers and budgets

| Tier | Corpus | Assertions | Initial analyzer budget |
| --- | --- | --- | --- |
| 0 | 15 original micro fixtures plus targeted precision/framework regressions | Positive/negative facts, uncertainty, all invariants, repeatability, stable-ID metamorphic test | <1 second per fixture |
| 1 | Session, workspace+session, runtime+controller+session, clipboard+React overlay | Hand-authored serialized semantic goldens and all invariants | <5 seconds per cluster |
| 2 | Seven-file workspace/session/controller/React/tldraw pipeline | All Tier 1 goldens plus cross-file integration golden | <10 seconds |
| 3 | Root tsconfig's discovered TS/TSX corpus | Scope coverage, all invariants, repeatability, peak RSS and runtime | <60 seconds per run; <2 GiB process peak RSS |

Time budgets apply to the analyzer call (parse through metrics), excluding fixture staging
and test assertions. Tier 3 also checks peak RSS after persistence verification. The harness independently measures wall time and Linux process
peak RSS rather than trusting only analyzer-reported timing. Tier 3 owns a fresh test worker and repeats the run, so both cold/repeat timings
and process peak RSS describe that benchmark instead of earlier fixtures. Its
test timeout remains 180 seconds.
Cold/warm measurements should be logged separately in Phase 2; thresholds must not
be silently relaxed to make a test pass. Micro corpus integrity also typechecks a
staged multi-file import seed. The historical estimate of 711 files is not a golden:
the current corpus is discovered from tsconfig and its emitted file list must match.

All tiers call the same pipeline. Small/real seeds assert against a fully
serialized/deserialized artifact. The whole graph exceeds V8's single-string limit,
so Tier 3 parses, schema-checks and canonically re-encodes every record in the first
stream, checks all graph and source invariants on both runs, and compares SHA-256
fingerprints of both complete streams. The repeat reuses the first wire-validation
result only if every emitted byte has the same fingerprint. It does not retain duplicate giant JSON strings. No compiler
nodes are used as golden evidence. Goldens compare a bounded semantic projection
(named facts present, forbidden facts absent, required uncertainty present), allowing
legitimate extra facts and coordinate changes. They are not whole-output snapshots
that could be blessed from a broken extractor. Independent contract tests exercise
deterministic serialization and malformed artifacts independently of the compiler adapter.

## Oracle provenance and honest limits

“Hand-verified” here means Codex inspected the source and reasoned about each
expectation before any analyzer was implemented. It does **not** mean a human
reviewed the facts. Every oracle records this distinction and its rationale.
The corpus-integrity suite verifies source anchors and matrix references. No script
updates expectations from analyzer output. Read the source and revise the oracle
explicitly when semantics change.

Finite positive/negative facts measure correctness on the annotated cases. They
do not establish whole-program precision or recall. Validation reports should state required
facts found / required facts, forbidden facts emitted / forbidden facts, and
unresolved sites / candidate sites separately, with a breakdown by rule and view.
Do not improve an unresolved rate by deleting candidate sites, downgrading coverage,
or relabeling inferred edges as resolved.

## Add a seed

1. Choose a small counterexample or real source cluster that distinguishes two
   plausible implementations; include at least one forbidden fact.
2. Write micro source under `fixtures/<pitfall>/*.ts.txt` (or `.tsx.txt`). Multi-file
   fixtures preserve repository-relative paths. `frameworks.d.ts.txt` provides tiny
   library contracts; real seeds use installed packages.
3. Inspect source manually and add expected facts to `oracle.ts`, or a real-seed
   `.golden.json` and `seeds.ts`. Use declaration names, kinds, file paths and unique
   source anchors. Avoid line numbers as identity. If an anonymous closure uses a
   name inferred from its variable, the analyzer must preserve that name.
4. Link the new assertion in `coverageMatrix.ts` if it strengthens a matrix cell.
5. Run contract tests and the intentionally failing integration test. When implemented,
   verify the new test fails under the specific regression it is designed to catch.

See [format.md](format.md) for identity, edge directions and the diagram mapping join,
and [coverage-matrix.md](coverage-matrix.md) for the combinatorial coverage rationale.

## Persistence and diagram scoring

`analysisArtifactChunks()` emits valid JSON with one canonical record per line
inside each array. Use streaming consumers for the whole graph; `JSON.parse` of a
single giant string can exceed the engine's string limit. `verifyCanonicalAnalysisStream`
checks wire structure, record schemas and canonical parse/re-encoding; cross-record
invariants are checked by `validateAnalysisArtifact` before emission. Timing and RSS
stay in the adjacent `.run.json` manifest.

`joinSourceRange()` checks the snapshot and file hash before matching entities.
`partitionFromSourceJoins()` retains overlapping memberships and uncovered entities;
lexicographic group ID chooses the primary membership used by cohesion and VI.
Pass the resulting partition to `evaluatePartition()` with the desired edge layer.
See [format.md](format.md) for the contract and caveats.

Whole-repository analysis includes tests and the analyzer's own implementation.
Directory and layer comparisons therefore describe that corpus. Source declaration
slots abstract multiple runtime instances; a shared-state finding does not prove
that those instances alias. Ownership facts never prove exclusive ownership or
complete disposal. Callback may-target propagation is capped at 16 candidates per
value, with explicit uncertainty when saturation affects a call.

Compiler resolution inputs are pinned too: local ambient declarations and in-root
library files have hashes and `resolution-only` roles, without retaining their ASTs
through graph derivation. Out-of-root compiler inputs contribute sorted name/hash
pairs to the configuration fingerprint. Neither category enters analyzed-line
coverage. The relocation regression checks byte-identical output from two temporary
checkouts, including external declaration identities.
