Completed 45 pan drags over **canvas-domain-model**, using the requested running URL. Each sweep visited 15 overlapping positions in a three-column, five-row serpentine route. Rectangle-union checks confirm **100% of every diagram's bounds was exposed outside the sidebar in each sweep** (8/8 diagrams).

| Sweep | Drags | Frame gap p95 | Worst gap | Gaps >25 ms | Long tasks >50 ms |
|---|---:|---:|---:|---:|---:|
| Saved zoom, 70.9%, CPU + rendering trace | 15 | 16.8 ms | 116.8 ms | 18 / 954 | 2 |
| 100% zoom, CPU + rendering trace | 15 | 16.7 ms | 33.3 ms | 4 / 961 | 0 |
| Saved zoom, no CPU/rendering trace | 15 | 16.7 ms | 33.3 ms | 2 / 928 | 0 |

The large spike was **saved-zoom-06**, moving left across the second row. It contained 103 ms and 86 ms long tasks, and its CPU profile includes `importUpdatedModule`, `queueUpdate`, `performReactRefresh`, `scheduleRefresh`, and React rendering. This establishes hot-reload contamination; it does not establish a pan-handler defect. No other captured CPU profile contains these refresh functions. Excluding that drag, no measured gesture had a frame gap above 50 ms.

There is a separate rendering lead: the traces contain **49 renderer DroppedFrame markers at saved zoom (21 during the contaminated drag), and 32 at 100%**. These include partial-update markers and are not interchangeable with requestAnimationFrame gaps. For example, full-zoom-02 has a 16.8 ms maximum JavaScript frame gap but seven renderer dropped-frame markers. Main-thread frame callbacks alone would miss this signal.

The canvas surface is repainted repeatedly during the gestures. At 100%, each measured interval contains about 124 Paint events, including document and surface events that can overlap. RasterTask durations summed across renderer worker threads range from **462 to 1,548 ms per roughly one-second drag**; these are parallel task durations, not a single main-thread stall. This points to painting/rasterization as a useful next investigation, without proving the cause of desktop hitches. LayoutDuration deltas were zero throughout all 45 gestures. Typical scripting cost was about 15–18 ms total per drag.

Measurements used headless Chromium 149 at 1920×1080, DPR 1, the live Vite development app, software graphics (ANGLE/SwiftShader), no CPU throttling, eight visible diagram boxes, 378 content-node elements, and no code panels. Other processes were active; host load was elevated during part of the run. The production build attempt failed with an existing TS2339 error (`MappingGridDocument.body` in MappingCanvas.tsx). Therefore these results should not be treated as hardware-accelerated production-browser timings. The control sweep retains lightweight rAF and long-task observation; it disables CPU profiling, rendering tracing, and waypoint screenshots. Its lower overhead is also confounded with its later execution and warmed caches.

Each measured drag used 60 real CDP pointer moves paced toward 60 Hz, with at least 600 ms between gestures. Both left-button and middle-button panning were exercised. Starts over interactive controls fall back to middle-button panning. Camera displacement and unchanged zoom were asserted after every drag. Startup, repositioning, zoom changes, screenshots, and gaps between gestures are excluded from the reported measurement intervals. The full traces contain screenshots/gaps as well; use the `saved-zoom-NN:start/end` and `full-zoom-NN:start/end` User Timing marks to isolate gestures. Frame gaps are requestAnimationFrame intervals, not measured display presentation latency.

The starting camera was restored within 0.002 screen pixels, there were no captured runtime exceptions, and the persisted diagram document SHA-256 and saved viewport match the pre-test snapshot exactly.

[Interactive coverage map and all 45 results](coverage.html) · [Raw measurements](results.json) · [Analyzed profiles and traces](summary.json) · [Persistence check](persistence-check.json)

Thirty individual `*.cpuprofile` files can be loaded into Chrome DevTools. The two complete rendering traces are `saved-zoom.trace.json` and `full-zoom.trace.json`; load them in the Performance panel. Screenshots at all 30 profiled waypoints are named after their drag IDs. The notable contaminated profile is [saved-zoom-06.cpuprofile](saved-zoom-06.cpuprofile).

Reproduce from the repository root with `node tests/performance/browser-panning-performance.mjs`. Set `PAN_REPORT` to a fresh output directory. The reusable harness now also records incoming Vite hot-reload messages for subsequent runs. Recompute analysis with `node artifacts/panning-performance-20260926/summarize.mjs artifacts/panning-performance-20260926`.
