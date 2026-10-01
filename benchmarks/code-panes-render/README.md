# Code pane rendering experiment

The initial replacement is a control copy of `src/shared/source/SourceCodeView.tsx`.
Edit `src/SourceCodeView.tsx` here, then run:

```sh
npm run benchmark -- code-panes-render --trials 3 --profile
```

This builds the full app twice and exercises its actual `SourceCodePane` / shared
`SourceCodeView` stack with deterministic source. The fixture has five independently
scrollable panes, each displaying the same 3,000-line TypeScript file. It tests the
shared renderer directly through full source panes; mapped-range code-panel opening
and gap-folding are separate scenarios to add later.

Correctness checks cover all 15,000 rows, colored syntax tokens, independent scrolling,
collapse/expand scroll retention, and save/reload scroll restoration. They run before
timing measurements for each variant.

Performance scenarios run with 1, 3, and 5 open panes:

- **render:** reopen a collapsed pane and wait for syntax-highlighted content; this
  measures warm reopening, with tokens and source already cached.
- **pan:** 60 middle-button pointer moves out and back over an open source pane;
  assert the canvas moves and source scroll positions remain unchanged.
- **scroll:** 60 wheel inputs over pane 1; assert the expected scroll distance and
  independent positions, then reset using real wheel input before the next trial.

Each scenario has an excluded warm-up, followed by measured trials. `--profile`
adds a separate V8 CPU sampling pass per scenario and pane count. Those samples are
excluded from comparison medians. Startup readiness is recorded separately and
includes browser launch; it is not presented as isolated rendering time. Screenshot
capture is outside timing intervals. There is no forced CPU throttling.

Change `baseRef` in `build.mjs` to pin an app revision, or use `--ref <sha>`. See the
parent README for snapshot, replacement, fixture, and result conventions.
