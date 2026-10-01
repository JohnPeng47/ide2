# Canvas session isolation

Follow-up to the [CodePanel performance investigation](code-panel-performance.md).
The implementation replaces the controller → Canvas callback → page draft feedback loop
with per-document `CanvasSession` subscriptions using Zustand. State ownership and the
new event paths are documented in [Mapping workspace state](../architecture/mapping-workspace.md#state-ownership).

## Measurements

Production build, same disposable copy of the live Canvas domain model workspace, same
2300 × 1400 headless Chromium configuration and pointer paths as the baseline. Each
gesture sends 40 pointer moves targeting 0.67 seconds. Numbers are medians of three
unprofiled trials, with files and syntax highlighting loaded before measurement.

| Panels | Selection motion before → after | Selection frame p95 before → after | Pan frame p95 before → after |
| ---: | ---: | ---: | ---: |
| 0 | 3.86 s → 0.72 s | 116.7 ms → 16.7 ms | 16.8 ms → 16.8 ms |
| 5 | 3.78 s → 0.75 s | 116.6 ms → 16.8 ms | 50.0 ms → 50.0 ms |

Zero-panel selection main-thread work is now 108 ms. With five panels it is 471 ms.
Selection motion trials range from 0.72–0.74 seconds with zero panels and 0.74–0.99
seconds with five. The five-panel workload still contains 668 source rows, including
two stale mappings that display full files. No source-file requests occurred during
any measured gesture.

The follow-up zero-panel CPU profile no longer shows the previous `stateKey`/recursive
stringification hotspot. Cached status publication accounts for about 3 ms / 0.2% of
sampled elapsed time, including gesture start/release, compared with roughly 78% under
page dirty checks before this change. Unit tests separately verify zero fingerprint
calculations during 1,000 selection-preview updates.

The five-panel panning cost remains: median main-thread work is 783 ms, compared with
751 ms in the baseline. This change addresses state propagation; the previously measured
layer preparation/painting bottleneck still needs a separate rendering change. Source DOM
mutations during panning remain zero. Selection can update mapped-source hover decorations;
the five-panel runs record 24 source mutations across the entire gesture, including release.

The pre-existing non-ASCII evidence hashing error still prevents these overview nodes
from opening a panel on release. These measurements establish selection-motion performance,
not successful panel-opening latency. Successful CodePanel creation, mapping resolution,
and save/reload are verified separately with the browser fixture.

## Regression checks

- 83 test files / 476 tests pass, including eight session and persistence boundary tests.
- TypeScript check and production build pass.
- Real browser checks cover preview cancellation, direct and inherited mappings,
  multiple files, panel reuse, stale/unmapped sources, and save/reload.
- Diagram transfer browser checks cover selection, copy/move between canvases,
  paired undo/redo, reload, jumps, and deletion.
- Session tests enforce no controller, document, presentation, dirty-state, history export,
  persistence, or other-canvas notifications from pointer previews. They also verify
  presentation-only commits, undo to a clean baseline, edits during a save, session disposal,
  and coalesced writes.

The live workspace was read only. All benchmark and browser-test writes used disposable
stores and preview servers.

## Reproduce

```sh
npm run build -- --sourcemap
CODE_PERF_REPORT=artifacts/canvas-session-performance CODE_PERF_COUNTS=0,5 \
  CODE_PERF_TRIALS=3 node --import tsx tests/performance/browser-code-panel-performance.mjs
CODE_PERF_REPORT=artifacts/canvas-session-performance CODE_PERF_COUNTS=0 \
  CODE_PERF_TRIALS=1 CODE_PERF_PROFILE=1 \
  node --import tsx tests/performance/browser-code-panel-performance.mjs
node tests/performance/summarize-code-panel-profile.mjs artifacts/canvas-session-performance
```

Results, source-mapped CPU attribution, the pan trace, and screenshots are retained in
`artifacts/canvas-session-performance/`. The previous measurements remain in
`artifacts/code-panel-performance/`. Timings are observations on this machine, not fixed
pass/fail thresholds or a measurement of the user's GPU compositor frame rate.
