# Source pane performance comparison

Production Chrome, five independently scrollable viewers of the same 3,000-line TypeScript file. All expanded panes are onscreen at 100% zoom. Each cell is the median of three trials of 40 real CDP inputs. Times below are cumulative main-thread task duration, not time per frame.

| Open panes | Drag before (ms) | Drag after (ms) | Scroll before (ms) | Scroll after (ms) | Scroll frame p95 before (ms) | Scroll frame p95 after (ms) |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 306.1 | 156.5 | 5185.7 | 322.9 | 116.7 | 16.8 |
| 2 | 257.5 | 185.2 | 5671.2 | 282.8 | 133.4 | 16.8 |
| 3 | 331.9 | 263.0 | 5928.1 | 337.8 | 149.9 | 16.8 |
| 4 | 315.0 | 267.2 | 6339.3 | 330.9 | 166.6 | 16.8 |
| 5 | 358.1 | 365.6 | 6616.2 | 317.4 | 166.5 | 16.8 |

All 15 after-change scrolling trials recorded zero full-file chunk-size reads, zero source DOM mutations, zero observed long tasks, and zero requestAnimationFrame intervals above 25 ms. Each baseline scrolling trial re-read 1,520 chunk sizes (38 chunks × 40 events).

Dragging still has occasional frame-time outliers, including the first gesture after opening additional panes. The change removes source/canvas React invalidation; it does not eliminate browser painting and compositing costs.

Frame intervals are main-thread requestAnimationFrame observations, not compositor dropped-frame counts or input-to-display latency. The runner targets 60 Hz input but awaits each CDP dispatch, so observed elapsed time includes transport/browser backpressure. CDP CPU metrics overlap and must not be summed. Baseline and after used the same fixture and three trials per count; baseline timing was captured before the runtime-state change, and its persistence sequence predates the additional inactive-document/export checks.

The after run also passed independent horizontal/vertical scrolling, save while a pane is collapsed and its document is inactive, background-document reload/activation, export without a preceding save, restore of older saved offsets, reload, and collapse/reopen.

Run `npm run check:source-performance` to build and repeat. The canonical state is `tests/fixtures/source-pane-performance/workspace.json`; the final saved five-pane state and screenshot are `after.workspace.json` and `after.png`. The saved artifact uses the disposable project ID; the canonical fixture is rebound by the runner.

Raw measurements and browser metadata: [before.json](before.json), [after.json](after.json).
