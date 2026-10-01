# Startup profiling and deferred history validation

The saved workspace took 33–40 seconds to display its canvas. Most of that time
was spent repeatedly parsing diagrams and validating historical checkpoints, not
starting Vite or rendering React. The same workspace now displays in 4.2–4.9 seconds.

## Measurements

Measured on 2026-09-29 with a production build and headless Chromium at 2300 × 1400,
using disposable copies of the store used by the running app on port 5190. The
original store was not opened by the benchmark server. Browser cache was disabled.
Trial 1 used a fresh backend; trials 2–3 reused that backend and its persisted state.
These are local observations, not latency guarantees or cold operating-system cache tests.

| Milestone | Before, trials 1 / 2 / 3 | After, trials 1 / 2 / 3 |
| --- | --- | --- |
| Canvas DOM appears | 39.81 / 33.35 / 32.86 s | 4.88 / 4.34 / 4.24 s |
| Editing history saved | 43.25 / 33.65 / 33.21 s | 8.05 / 4.73 / 4.65 s |
| Longest main-thread task | 8.53 / 8.28 / 9.04 s | 1.08 / 1.26 / 0.97 s |

Median time to the canvas fell **87%**, from 33.35 to 4.34 seconds. “Canvas” is a
MutationObserver milestone for rendered content nodes, not a measured time-to-interactive
score. Separate browser tests exercise the resulting editing behavior.

The shell appeared within 127–227 ms before the change. Backend readiness was
2.82 s before and 1.27 s in the after run; the server launch code was not changed,
so that difference is not attributed to this fix.

## Why it was slow

The fixture contains eight saved representations, 23 saved representation revisions,
and seven open workspace documents with 336 canvas checkpoints and 223 per-document
diagram revision entries. Startup fetched a 25.72 MB catalog, then loaded 17.79 MB
of workspace records. It restored every canvas and mounted their components even
when hidden.

`validateCanvasHistory` called `validateDiagram` for each revision, then called
`projectCanvasSnapshot` for every checkpoint. That export function reparsed the
same diagrams, hashed their ASCII, composed an export, and copied captured source
evidence. Startup did not use those exports. The server, storage worker and page
controllers repeated much of this work.

In the baseline catalog CPU profile, `validateCanvasHistory` accounted for 76.6%
of sampled elapsed time; `projectCanvasSnapshot` accounted for 62.4% inclusively.
The tree parser's `recognize` function alone accounted for 25.1% self time.

Isolated Node phase measurements with CPU profiling enabled:

| Phase | Before | After |
| --- | ---: | ---: |
| Restore catalog, first read | 14.59 s | 1.10 s |
| Restore catalog, repeat read | 12.86 s | 0.75 s |
| Read and validate workspace records | 6.87 s | 0.55 s |
| Worker workspace deserialization | 6.67 s | 0.67 s |
| Create page canvas sessions | 12.52 s | 0.52 s |

These isolate the production functions in Node; they are not browser stage timings
and should not be added to the browser measurements. Profiler overhead and JIT state
affect their absolute values. JSON encoding and decoding took tens to hundreds of
milliseconds, much less than the original validation work.

## Changes

- Composition validation no longer generates ASCII/evidence exports. A full history
  check parses each unique revision once and reuses that result across checkpoints.
- Startup requests use `history=current`, meaning **validate the current checkpoint**,
  not discard other history. They still read complete records, verify content-addressed
  file hashes, and retain all history, transfer references and immutable identities.
- Restored editing contexts validate older checkpoints when they are accessed, undone
  or reset to. Validation happens before changing history navigation, so a rejected
  checkpoint leaves the undo stack intact. Deferred revisions remain discoverable;
  `DiagramService.getRevision` validates them before exposing their content.
- Full reads/imports keep exhaustive validation. Incoming write batches keep validation
  of changed records and references. A cached startup read cannot satisfy a later full
  read without upgrading its validation.
- Catalog and workspace loading run concurrently, and React StrictMode effect replay
  shares the initialization request. Inactive canvas components mount on first visit;
  visited canvases remain mounted to preserve their UI state.

The remaining startup cost includes transferring and cloning the complete catalog
and workspace histories, validating current scenes, reconciling saved state, and
creating session objects. Storage is **not yet fetched per canvas on demand**.
The first “Editing history saved” acknowledgement also remains slower than later
loads. An index/current-document transport with lazy history and inactive-document
fetching would address those remaining costs; this change does not silently replace
or truncate saved history to achieve the measured improvement.

## Verification

- Production typecheck and build pass.
- The full suite passes with two workers: 92 files / 528 tests at that run, followed
  by focused tests covering an additional deferred-revision regression case.
- New tests cover parsing each revision once, deferred checkpoint validation,
  failed undo leaving history unchanged, editing after restore, full import validation,
  cached-read validation upgrades, unchanged file integrity checks, and deferred
  revision access through DiagramService.
- The real-browser transfer suite passes: switching canvases, copy/move, linked
  undo/redo, save/reload, durable undo, jumps, deletion, and existing-canvas layout.
- All measured browser loads reported zero uncaught JavaScript exceptions.

The first unrestricted full-suite run hit an existing 5-second test timeout in the
large projection fixture under concurrent load. That test passed in isolation, and
the full suite passed with `--maxWorkers=2`; no test timeout was increased.

## Reproduce and inspect

```sh
npm run build -- --sourcemap
STARTUP_STORE=/absolute/path/to/store \
  STARTUP_REPORT=artifacts/startup-performance/after \
  node tests/performance/browser-startup-performance.mjs

STARTUP_STORE=/absolute/path/to/store STARTUP_HISTORY=current STARTUP_PROFILE=1 \
  STARTUP_REPORT=artifacts/startup-performance/after \
  node --import tsx tests/performance/startup-phases.mjs

STARTUP_STORE=/absolute/path/to/store STARTUP_PROFILE=1 STARTUP_TRIALS=1 \
  STARTUP_REPORT=artifacts/startup-performance/after \
  node tests/performance/browser-startup-performance.mjs
node tests/performance/summarize-code-panel-profile.mjs artifacts/startup-performance/after
```

`STARTUP_MODE=dev` profiles the development server instead of preview. CPU-profiled
runs are kept separately from the three unprofiled timing runs. The harness requires
the local front-end skill's CDP helper; use `CHROME_PATH` to override Chromium.
Both harnesses delete disposable stores and stop their processes in `finally`.

Baseline browser timings, phase CPU profiles and summaries are in
`artifacts/startup-performance/`; corresponding results and a source-mapped browser
CPU summary are in its `after/` directory. The original baseline cannot be recreated
merely by requesting full validation on the changed code: the redundant export work
has also been removed.
