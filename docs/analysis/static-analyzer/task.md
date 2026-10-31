# Task: build the multi-view static analyzer test-first, using this repo as its corpus

## Context

We've agreed on a design for a TypeScript/React analyzer that extracts five structural views of this codebase (the "4+1" model):

1. **Ownership**: mutation authority (`creates`, `retains`, `can-mutate`, `exposes-read-api`) and lifecycle responsibility (`subscribes`, `disposes`).
2. **Lexical scope**: the scope tree plus capture edges (captured binding, declaring scope, read/reassigned/object-mutated, `this`, imports).
3. **Calls**: a static possibility graph with explicit uncertainty (dispatch, callbacks, props), plus `registers`/`schedules`/`resumes` edges. JSX composition is a separate relation, not a call.
4. **Data dependencies**: def-use flow, shared-state reads/writes, control dependence, and reactive edges for React, Zustand, tldraw atoms and the domain controller.
5. **Containment**: repo → package → directory → module → declaration → member, with domain/application/infrastructure/UI layers kept as metadata.

Every fact carries a source location, an extraction method, and an evidence status (`resolved | inferred | observed | unresolved`). Every fact is also pinned to a source snapshot (commit, dirty-file manifest, content hashes). The underlying graphs stay faithful (cycles, shared parents), and tree views are derived from them.

The consumers downstream are:
- the evaluation loop: `coverage`, `overlap`, `cohesion = W_internal / (W_internal + W_between)` per edge layer with a size-preserving shuffled baseline, and `VI(P, containment_partition)`;
- the graph-of-concept-trees canvas model: `NodeRevision { conceptTree, sourceMappings, ports, backingCanvasRevision? }`, occurrences, frontier projection, lifted edges.

Layering: pure graph rules go in `domain/core`, ports and orchestration in `application/core`, and compiler adapters in `infrastructure/core`. Reuse the classification rules in `tests/architecture/dependencies.test.ts` and link to the existing source-evidence records (`domain/core/records/domain.ts`) and projection links (`domain/core/diagrams/diagramProjection.ts`).

**Scope for this task: static analysis only.** Runtime tracing (step 4 of the earlier plan) is out of scope. The persistence schema should still reserve the `observed` evidence status and the runtime-instance/event/value-version entity kinds, so traces can be added later without a migration.

## Phase 1: schema and test corpus (time budget: 1 hour)

Do not write extractor logic in this phase.

### 1a. Define the persistence format

Write a versioned schema (TypeScript types plus a JSON serialization with `schemaVersion`) that covers every output the analyzer can produce:
- the snapshot header (commit, dirty manifest, per-file content hash, analyzer version, tsconfig used);
- entities (stable IDs that survive unrelated edits; specify the ID scheme);
- relations per view, with their typed edge kinds, evidence status, extraction method and source ranges;
- unresolved and escape records, which are first-class so that a gap is never a silent omission;
- derived artifacts: SCC condensation, tree projections with shared-identity references, partitions, and metric reports.

The output should be deterministic: sorted, stable, and diffable, so we can golden-test it. Document how a consumer joins this format to `π` (diagram leaf → source range → entities).

### 1b. Build the integration-test corpus from this repo

Pick real slices of this codebase and write tests that run the full pipeline (parse → each view → serialize → metrics) and assert on the serialized output. Requirements:

- **Tiered by difficulty.** Run time per tier should be roughly <1s, a few seconds, and full repo.
  - **Tier 0 (micro).** Small synthetic fixtures, each named after the pitfall it targets: shadowing, `var` hoisting vs. block scope, closure reassigning a captured `let`, `const` binding to a mutable object, aliasing, recursion and mutual recursion, interface/union dispatch, computed properties, re-exports and type-only imports, `this` capture.
  - **Tier 1 (real seeds).** Single real files or small clusters chosen so that each one exercises a different combination of views at once. Mandatory seeds:
    - `src/features/mapping/workspace/canvasSession.ts`: the `readable()` API restriction vs. deep mutability, and the subscription callback that reassigns `previous`.
    - `src/features/mapping/workspace/canvasWorkspace.ts`: `setDrafts()` creates sessions and disposes the ones it replaces.
    - `src/features/mapping/tldraw/CanvasRuntimeContext.tsx`: `connect()` across the controller → tldraw boundary.
    - At least one React component that uses an effect whose dependency array differs from its actual captures.
    - At least one Zustand store with selectors.
  - **Tier 2 (subsystem).** The workspace → session → controller → stores → React/tldraw consumer pipeline, end to end.
  - **Tier 3 (whole repo).** About 711 TS/TSX files. Assert invariants and performance only, not every fact.
- **Combinatorial coverage, cheaply.** Build a matrix with the five views on one axis and the hard features on the other (aliasing, async, callbacks-through-props, cycles, cross-layer edges, unresolved externals). Pick seeds so that every cell is covered by at least one fast test. Prefer one small file that hits several cells over many large files. Include the matrix in the deliverable.
- **Assertion types.** Use hand-verified expected facts for Tier 0/1 (both must-contain and must-not-contain). Use golden snapshots for Tier 1/2. Use invariants for every tier:
  - every relation endpoint resolves;
  - every fact has a valid snapshot-pinned range;
  - output is deterministic across two runs;
  - unresolved count is reported;
  - containment is a tree;
  - partition metrics are N/A on a zero denominator;
  - one giant group scores cohesion 1 (as a sanity check of the baseline).
- **Mark the expected results as hand-verified.** Do not generate expected results by running the analyzer. The tests must fail until the extractors are implemented.

### Phase 1 deliverables

The schema files, the test corpus wired into `vitest`, the coverage matrix, and a short `README` that explains the tiers and how to add a seed. **Stop and report before Phase 2.**

## Phase 2: implementation and architectural analysis (time budget: 3 hours, or until the usage limit)

1. Implement the extractors in this order, driving each with the Phase 1 tests: containment → lexical scope/captures → direct calls → ownership pilot → local def-use plus React/Zustand/tldraw summaries. Keep the Tier 0 and Tier 1 tests green before moving on.
2. Run the analyzer on the whole repo and produce **the final output: an architectural analysis of this codebase**. It should include:
   - per-view summaries;
   - cross-view mismatch reports (edges that are local in one view but cross-tree in another);
   - the top cross-boundary writes, mutable captures, and widely shared state;
   - cohesion/VI of the existing directory/layer partition against each dependency layer, compared to the shuffled baseline;
   - an explicit list of unresolved and low-confidence areas.

   Keep the evidence separate from your judgment: a mismatch is a finding to investigate, not automatically a defect.
3. **Optimization loop.** While budget remains, repeat: measure → improve the weakest point → re-run all tiers. Weak points, in priority order, are:
   1. precision/recall against the hand-verified facts;
   2. a lower unresolved rate;
   3. Tier 3 runtime and memory.

   Log each iteration (what changed, the metric before and after) so the run is reviewable.

## Working rules

- Follow the repo `AGENTS.md`, and `npm run typecheck` and `npm test` must pass.
- Commit at phase boundaries and after each extractor goes green.
- Don't mark the work complete until the deliverables exist and the tests pass. If you are blocked, record what is blocked and why, then continue with the next unblocked item.
- Write the analysis to a file in the repo, for example `docs/analysis/architecture-<date>.md`, with links to the persisted analysis JSON.
