# Static analyzer: Phase 1 contract and corpus

This checkpoint defines the test-first contract for the five-view analyzer. **No
extractor has been implemented.** `staticAnalyzer.analyze` and `evaluatePartition`
throw explicit not-implemented errors. Integration tests are real failing tests,
not skipped tests or tests marked as expected failures.

The implementation brief is preserved in [task.md](task.md). Phase 1 stops after
this schema/corpus checkpoint. Phase 2 implements the pipeline and produces the
architectural report; the files here are not that report.

## Run

```sh
npm run typecheck
npm run analysis:schema:check
npm run test:analysis:contract
npm run test:analysis:integration
```

The normal `npm test` includes the contract and corpus-integrity tests. The separate
integration configuration includes `*.integration.ts`, deliberately red until Phase
2. This resolves the brief's requirement to have a passing normal suite while
shipping extractor expectations that fail before implementation. Existing unrelated
repository failures are recorded separately in [phase-1-report.md](phase-1-report.md).

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
| `infrastructure/core/static-analysis/analyzer.ts` | Explicit Phase 2 implementation seam |
| `domain/core/static-analysis/metrics.ts` | Explicit Phase 2 numerical implementation seam |
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
| 0 | 15 micro fixtures, mostly one tiny module | Positive/negative facts, uncertainty, all invariants, repeatability, stable-ID metamorphic test | <1 second per fixture |
| 1 | Session, workspace+session, runtime+controller+session, clipboard+React overlay | Hand-authored serialized semantic goldens and all invariants | <5 seconds per cluster |
| 2 | Seven-file workspace/session/controller/React/tldraw pipeline | All Tier 1 goldens plus cross-file integration golden | <10 seconds |
| 3 | Root tsconfig's discovered TS/TSX corpus | Scope coverage, all invariants, repeatability, peak RSS and runtime | <60 seconds per run; <2 GiB process peak RSS |

Budgets apply to the analyzer call (parse through metrics), excluding fixture staging
and test assertions. The harness independently measures wall time and Linux process
peak RSS rather than trusting only analyzer-reported timing. Tier 3 repeats the run,
so its test timeout is 180 seconds.
Cold/warm measurements should be logged separately in Phase 2; thresholds must not
be silently relaxed to make a test pass. Micro corpus integrity also typechecks a
staged multi-file import seed. The historical estimate of 711 files is not a golden:
the current corpus is discovered from tsconfig and its emitted file list must match.

All tiers call the same pipeline and assert against a serialized/deserialized
artifact, not transient compiler nodes. Goldens compare a bounded semantic projection
(named facts present, forbidden facts absent, required uncertainty present), allowing
legitimate extra facts and coordinate changes. They are not whole-output snapshots
that could be blessed from a broken extractor. Independent contract tests exercise
deterministic serialization and malformed artifacts before an analyzer exists.

## Oracle provenance and honest limits

“Hand-verified” here means Codex inspected the source and reasoned about each
expectation before any analyzer was implemented. It does **not** mean a human
reviewed the facts. Every oracle records this distinction and its rationale.
The corpus-integrity suite verifies source anchors and matrix references. No script
updates expectations from analyzer output. Read the source and revise the oracle
explicitly when semantics change.

Finite positive/negative facts measure correctness on the annotated cases. They
do not establish whole-program precision or recall. Phase 2 should report required
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
