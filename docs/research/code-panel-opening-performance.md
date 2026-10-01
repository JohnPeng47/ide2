# CodePanel opening: gestures and pan latency

## Completed fixes

Plain double-clicks on content nodes no longer fall through to diagram selection when
camera pointer capture retargets the event to the viewport. Diagram selection now checks
the element under the pointer. Background double-click and Ctrl/Cmd-double-click retain
their diagram-selection behavior.

The MappingPocPage diagram also contained non-ASCII captured source evidence. Its index
and the loaded-source validator incorrectly used an ASCII-only hash, blocking panel opening.
Both now hash UTF-8 source text. Diagram artifact identity still rejects non-ASCII artifacts;
existing ASCII hashes are unchanged.

Escape closes the active CodePanel while retaining its source selection. A second Escape
removes that selection. Opening or interacting with another panel updates the dismissal
target; diagram selection no longer clears the range through a competing Escape handler.

Validation: production build and 83 test files / 477 tests pass. Browser checks cover Unicode
source, node double-clicks, Ctrl-double-click, Escape from within a panel, the retained range
after the first press, and its removal after the second. Existing CodePanel save/reload and
diagram transfer/undo/redo checks also pass.

## Opening-time measurements

Three unprofiled trials on a disposable copy of the live Canvas domain model workspace,
with one panel opened from the MappingPocPage diagram's `drafts[documentId]` node.
The fixture is 7.76 MB, with 5.60 MB of active-document history. Its mapped source is
`src/features/mapping/MappingPage.tsx`; the mapping is stale, so the panel displays the
full 613-line file. Timings are medians, measured in headless Linux Chromium at 2300 × 1400,
65% canvas zoom, software rendering, and no CPU throttling.

Each pan sends 40 middle-button moves targeting 0.67 seconds. Opening/reopening starts
the pan immediately after the node click, without waiting for file loading, highlighting,
or autosave. Settled measurements wait for these stages. Initial workspace autosave is
allowed to finish before the closed-panel baseline. Continuous agent command polling is
excluded from the readiness check.

| State | Pan elapsed | Worst frame gap | Main-thread work, including opening |
| --- | ---: | ---: | ---: |
| Panel closed | 0.71 s | 16.8 ms | 67 ms |
| Immediately after opening | 2.19 s | 1,417 ms | 2,000 ms |
| Panel loaded and save finished | 0.71 s | 16.8 ms | 187 ms |
| Immediately after reopening | 2.35 s | 1,383 ms | 2,037 ms |

The opening click itself takes a median 146 ms; reopening takes 139 ms. These precede
the pan elapsed column. Source requests take 63–81 ms across the six opening/reopening
gestures. No browser exceptions occurred. Pointer transform assertions verify real panning,
and panel-count assertions verify that each opening actually created the panel.

## Cause

A separate profiled trial shows this path on the browser main thread:

```text
openCodePanel
  -> controller history commit
     -> CanvasSession.onCommit
        -> WorkspacePersistence.schedule (150 ms debounce)
           -> flush
              -> capture workspace / export histories
              -> mappingWorkspaceRepository.save
                 -> serializeWorkspace
                    -> deserializeWorkspace
                       -> new CanvasHistory
                          -> validateCanvasHistory
                             -> reconstruct, parse, and hash historical diagrams
                    -> JSON.stringify
                 -> fetch PUT /api/mapping/workspace
```

On opening, the profile attributes 1,342 ms to persistence flush, including 1,314 ms to
serialization and 1,118 ms to history validation. Reopening attributes 1,260 ms to flush,
including 1,235 ms to serialization and 1,068 ms to history validation. These are nested
inclusive sampled times, not additive durations. The profiled largest long tasks are
1,474 ms and 1,389 ms respectively.

The dominant spike is synchronous revalidation of full editing history, not source fetching
or steady-state panning. Moving persistence outside React prevented pointer-driven renders
from repeating this work, but the save operation itself still runs on the main thread.

The spike should be substantially avoidable. A follow-up should retain full validation at
import/load boundaries while reusing validated immutable history during saves, and move
remaining substantial snapshot processing to a worker or an incremental persistence path.
Simply changing the debounce would move the stall; a source cache alone would not remove it.
Panel mounting/highlighting has smaller costs that should be remeasured after persistence
is addressed. No persistence, scheduling, caching, or rendering optimization was applied
in this change.

## Reproduce

```sh
npm run build -- --sourcemap
node --import tsx tests/performance/browser-code-panel-opening-performance.mjs
CODE_OPEN_TRIALS=1 CODE_OPEN_PROFILE=1 \
  node --import tsx tests/performance/browser-code-panel-opening-performance.mjs
node tests/performance/summarize-code-panel-profile.mjs artifacts/code-panel-opening-performance
```

`CODE_OPEN_REPORT` changes the artifact directory; `CODE_PERF_ORIGIN` chooses the source
app; `CHROME_PATH` overrides Chromium. Raw measurements, input timings, long tasks, network
events, CPU profiles, and source-mapped attribution are in `artifacts/code-panel-opening-performance/`.
All mutations use temporary stores on separate preview servers; the live workspace is read only.
