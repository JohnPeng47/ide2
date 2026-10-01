# Canvas / CodePanel performance investigation

Measured September 25, 2026, using a production build of the working tree and a disposable copy of the running `Canvas domain model` workspace. Application code was not changed by this investigation.

## Findings

Median of three unprofiled trials; smaller is better. Each gesture sends the same 40 pointer moves, targeting about 0.67 seconds before browser/input overhead.

| Open panels | Source rows in DOM | Pan frame interval, p95 | Pan main-thread work | Selection motion time | Selection frame interval, p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 16.8 ms | 126 ms | 3.86 s | 116.7 ms |
| 1 | 14 | 16.8 ms | 114 ms | 3.09 s | 83.4 ms |
| 3 | 169 | 33.3 ms | 269 ms | 3.12 s | 100.0 ms |
| 5 | 668 | 50.0 ms | 751 ms | 3.78 s | 116.6 ms |

Selection is severely slow at every panel count; the between-run variation does not establish a monotonic panel-count effect on selection. Panning shows a clear increase in rendering work with larger panel workloads. Three panels include one stale file; five include two. Stale files render in full, so panel count and rendered source size vary together. The five-panel DOM contains 14,588 elements versus 2,133 at baseline. The rightmost panel is partially clipped by the viewport.

Selection already stalls with zero CodePanels. The final zero-panel CPU profile attributes approximately 78% of its sampled elapsed time to dirty-state checks in `MappingPage`: 46% under `dirty(active)` and 33% under the `dirtyRepresentationIds` calculation (rounded separately). `stateKey` and its stringify replacer account for approximately 67% self time. These checks parse saved scenes and recursively sort/stringify full current and saved scenes on every selection update. An earlier independent profile attributed 81% to the same dirty checks.

The separate rendering traces identify **layer preparation**, rather than source fetching or React source-row reconstruction, as the largest extra panning cost. Chrome's main-thread `Layerize` events total 9.5 ms with zero panels and 495.2 ms with five; `Paint` totals rise from 50.8 ms to 128.1 ms. Background panning changes no source DOM nodes. Panning across node labels produces a similar five-panel frame p95 (50.1 ms), with only eight source DOM mutations and 37 ms total script time. Thus hover work is not the dominant panning cost in these runs.

The current source UI has a sticky gutter for each row (`globals.css:62`), sticky file headers (`:466`), and an outer CodePanel scroller around source viewers with `overflow: visible` (`:465`, `:469`). The older source-pane viewer uses `contain: strict` (`:423`, `:429`). These are concrete candidates for the next containment/compositing experiment; the traces establish the expensive browser phase but do not by themselves prove which CSS rule causes it.

The hot path is:

```text
pointermove
  setSelectionRect
    MappingDocumentController.updateCanvas
      onCanvasStateChange -> setDrafts
        MappingPage / UiTestFramework render callback
          dirty(active) for status and canSave
          dirtyRepresentationIds for each mounted canvas
            JSON.parse(savedScene)
            stateKey(scene) / stateKey(saved scene)
              JSON.stringify with recursive sorted-key reconstruction
```

Relevant locations: `MappingCanvas.tsx` selection pointer handler; `MappingPage.tsx:72`, `:549`, `:550`, `:574`, `:580`; `canvasHistory.ts:46`. Hidden open documents also participate in the repeated checks. Large history was an initial suspicion, but history export is not the dominant work in this selection-motion profile.

No source-file HTTP requests occur during the measured warmed gestures. Adding a source cache will not remove this selection bottleneck. Source file loading and asynchronous syntax highlighting are separate warm-up stages; the final panel measurements wait for both.

An additional correctness bug prevents the selected overview nodes from opening a panel on release: `sourceRangeIndex` hashes captured source ranges with `asciiSha256`, which throws on non-ASCII source text. This was reproduced both in the domain resolver and as a browser exception in `onPointerUp`. The overview and the controller/agent diagram are affected in this snapshot. Because indexing processes all mappings, even a selected node with an ASCII-only range can be blocked by another range in that diagram. Successful panel creation / history-save latency is therefore **not** established by these selection-release measurements.

## Method

- Read-only snapshot from `http://localhost:5190`; all interactions and persistence used temporary stores on separate preview servers. The live workspace was not edited.
- Workspace approximately 7.4 MB; active document history approximately 5.2 MB. Both saved open documents and their histories were retained.
- Headless Linux Chromium, 2300 × 1400 window, software rendering (`--disable-gpu`), no CPU throttling. Timings are a controlled comparison, not a claim about the exact frame rate of the user's GPU/browser.
- Same canvas, viewport (65% zoom), pointer paths and 40 input steps targeting 60 Hz. Pan is an 80 × 30 pixel round trip using the middle button; selection is a Control-drag of 180 × 60 pixels over the overview's Draft nodes.
- Three unprofiled trials per panel count. Selection motion is reported separately from release. Panel count is unchanged during motion. The release error described above is retained in the report.
- Panels are seeded in the disposable fixture from actual mapped nodes in distinct diagrams, placed visibly in a consistent grid. Each panel uses a real `CodeRepoService` source read. Stale mappings retain the current application's behavior of displaying the full source file.
- Recorded animation-frame intervals, input dispatch latency, browser main-thread/script/layout/style time, long tasks, source DOM mutations, requests, source row counts, and errors. Separate CPU profiles are mapped through the production source maps.

## Reproduce

```sh
npm run build -- --sourcemap
node --import tsx tests/performance/browser-code-panel-performance.mjs
CODE_PERF_COUNTS=0,5 CODE_PERF_TRIALS=1 CODE_PERF_PROFILE=1 CODE_PERF_NODE_DRAG=1 \
  node --import tsx tests/performance/browser-code-panel-performance.mjs
node tests/performance/summarize-code-panel-profile.mjs
```

`CODE_PERF_ORIGIN` chooses the read-only source app; `CODE_PERF_REPORT` chooses the output directory; `CHROME_PATH` overrides the browser executable. The benchmark uses the front-end skill's browser helper and the installed `ws` package for CDP transport. The default browser path is this workspace's Playwright Chromium installation. All preview servers, browser profiles and temporary stores are removed on completion/failure. Reports and explicitly retained screenshots/profiles are written to `artifacts/code-panel-performance`.

Results: `comparison.json` contains the table; `zero-panel-results.json` and `results.json` contain the unprofiled trials; `profile-summary.json` contains source-mapped profile attribution; `trace-summary.json` contains the rendering trace totals. Trace event durations can be nested, so totals for different event names should not be added together. `file-loaded-results.json` is the earlier exploratory run that waited for file loads but not completed highlighting, and is excluded from the table.

## Fix order

1. Compute dirty state once per document change, keyed by document/scene and saved-baseline identity; reuse it for status, Save availability, and all canvas props. Pointer-only control updates must not trigger whole-scene comparisons.
2. Keep transient selection updates from causing unnecessary page-wide work. Preserve persistence and history at their intended boundaries.
3. Use a source-text hash that supports UTF-8 for mapped ranges, and test a diagram containing mixed ASCII/non-ASCII source evidence.
4. Address the measured panel rendering cost, especially full files shown for stale mappings. Retest the same panel workloads and a GPU-enabled browser before choosing a rendering optimization.
5. Treat eager source initialization / caching as a separate startup and panel-opening optimization; it is not the cause of the measured warmed selection stalls.
