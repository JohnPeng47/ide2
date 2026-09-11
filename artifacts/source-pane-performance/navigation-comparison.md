# Source explorer and definition navigation validation

Production build with 3,000 source lines in each pane; 40 real browser inputs per gesture; three trials for each pane count. Values below are median main-thread TaskDuration in milliseconds per gesture.

| Panes | Drag, explorer collapsed | Drag, explorer open | Scroll, explorer collapsed | Scroll, explorer open |
| --- | ---: | ---: | ---: | ---: |
| 1 | 143.8 | 133.6 | 230.8 | 188.8 |
| 2 | 134.8 | 164.1 | 222.2 | 200.4 |
| 3 | 183.5 | 166.4 | 220.1 | 224.8 |
| 4 | 262.2 | 198.4 | 328.8 | 215.9 |
| 5 | 285.6 | 215.7 | 360.4 | 248.8 |

All 60 measured gestures passed the hard regression checks: zero source-chunk measurement reads and zero source-content DOM mutations. Both runs passed all five-pane persistence checks.

These are observations, not fixed timing thresholds. The expanded variant shifts selection controls left to expose the first pane’s explorer button; source pane positions and allocations are unchanged. Opening the explorer narrows the code viewport, so its paint cost differs. CPU metrics overlap. requestAnimationFrame intervals measure main-thread scheduling, not compositor FPS or input latency.

The real language-server browser integration passed Ctrl+click across imports, UTF-16 source coordinates, F12 same-file lookup, folded destinations, Back/Forward (including a nonzero viewport), and v3 Save/reload of an unmapped repository file. Existing 3,000-line projection browser checks also passed. Forty focused tests cover the source viewer/model, migration, persistence, directory API, and real language server.

Reproduce:

```sh
npm run check:source-navigation
npm run check:source-performance
SOURCE_PERF_EXPLORERS=1 npm run check:source-performance
```

Raw metrics: [collapsed](navigation-collapsed.json), [expanded](navigation-expanded.json). The reusable workspace fixture is in `tests/fixtures/source-pane-performance/workspace.json`; the TS/JS navigation corpus is in `tests/fixtures/source-navigation/source.mjs`.
