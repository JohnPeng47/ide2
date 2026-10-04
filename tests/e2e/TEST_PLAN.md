# Core workflow performance test plan

This plan defines nine end-to-end user flows for establishing performance baselines.
It does not add another broad correctness suite. Each flow owns one principal cost;
shared navigation and fixture preparation happen outside its measured intervals.
Small outcome checks establish that the measured work actually happened.

The target is approximately 80% of everyday work in the repository/canvas application:
open, navigate, investigate source, author, find, request an update, automate an edit,
review a proposal, and inspect its code diff. This is a coverage hypothesis, not a
measured usage percentage. Confirm or revise the priority order with usage evidence.
The scenarios below are proposed benchmarks; existing scripts are references, not
proof that these scenarios already have a runner.

## Why browser testing appeared slow to start

The audit in Codex session `01a1049d-4983-7030-9f8e-4ba318ed988a` examined the repository
ownership implementation in session `01a103bf-4d62-7540-9aa5-66066c0aa1d7`.
Rechecking the underlying command events gives this timeline on October 4, 2026 UTC:

| Milestone | Time | Elapsed since implementation began |
|---|---|---|
| Implementation task starts | 01:34:11.387 | 0 |
| Production build starts | 01:47:04.496 | 12m53s |
| Production build finishes | 01:47:57.995 | 13m47s |
| Context compaction | 01:48:26.835–01:50:56.533 | 2m30s spent in compaction |
| First existing browser check launches | 01:51:51.956 | 17m41s |
| New repository-explorer browser check first launches | 01:53:41.634 | 19m30s |
| New check's successful attempt | 01:59:40.263–01:59:55.108 | 14.845s for the entire command |

Most time before launch was feature implementation, inspection, validation/fixture
repairs, documentation, compaction, and writing a new browser script. The initial
two standalone typecheck-containing commands took approximately 34s and 36s; the
production build command, which includes another typecheck, took 53.499s. These
are command lifetimes and overlap other work; do not add them as exclusive delay.
Across the whole task, seven targeted Vitest commands took 63s combined.

The new browser script then needed six attempts. Failures included JavaScript
quoting, incomplete keyboard events that did not reliably clear/select input,
and reload synchronization. One process lived for 223.528s before termination
while debugging a reload/dialog hang. The subsequent fix enabled Page events,
handled JavaScript dialogs, waited for persisted workspace state, and waited for
`performance.timeOrigin` to change before querying the reloaded page. Missing CDP
request deadlines in the personal helper allowed a blocked command to keep waiting.
The current repository benchmark helper has a 30-second CDP request deadline.

This evidence does **not** establish slow Chrome startup. The logs lack separate
browser-launch and application-ready timings. The successful new check took about
15s including its setup, browser interactions, and cleanup; existing migration and
acceptance checks completed in about 16s and 20s. Instrument those phases rather
than attributing the preceding 19m30s to launching Chrome or to accumulated tests.

## Measurement contract

- Freeze one app source snapshot and dependency lockfile. Build each compared
  revision once, then reuse its production output for all selected flows/trials.
  Do not run `npm run check:*` wrappers that rebuild before each scenario. The
  existing benchmark runner's source capture and manifest are a useful base.
- Use disposable Git repositories, stores, and browser profiles on a dedicated
  port. Seed data with current persistence APIs outside timing. Reset the relevant
  fixture between trials; no trial may silently accumulate edits, history, or panes.
  Never benchmark mutations against the user's running store.
- Run baseline and candidate sequentially on the same host with the same fixture,
  browser binary, viewport, device scale, graphics flags, and power/throttling settings.
  Record those settings, host load, source/fixture hashes, and execution order.
  Reverse variant order for a confirmation run when a difference is small.
- Start with one excluded warm-up and five measured trials per normal scenario.
  Report individual samples, median, and range. Five action samples do not justify
  a useful p95 latency claim. Reserve larger samples for dedicated tail-latency runs;
  gesture frame-interval distributions use the many frames collected within a run.
- Mark cache state explicitly: fresh browser profile, fresh app server, first source
  read/highlighting, and warm repeat are different conditions. A fresh process is
  not proof of a cold operating-system disk cache. Reset persistent fixture changes
  independently of cache state. Do not average cold and warm samples together.
- Use real pointer/keyboard input for UI actions. API calls are legitimate inputs
  in the agent and proposal flows, and for untimed setup elsewhere. Do not simulate
  user behavior by directly calling React callbacks or changing component state.
- Record action dispatch, observed DOM completion, and the next two animation frames
  after the specific outcome. This is an observable rendering proxy, not a guarantee
  of compositor presentation. Install observers before input; avoid coarse polling
  as the sole timer. Background polling/WebSockets make generic network-idle waits
  unsuitable for readiness.
- Collect action-to-visible latency, browser main-thread task time, long tasks,
  request counts/bytes, and relevant server spans. For continuous gestures, collect
  rAF p50/p95/max intervals, time above the target frame budget, and input dispatch
  duration. Report rAF intervals as main-thread observations, not dropped GPU frames.
- Separate visible completion from durable acknowledgement for writes. Include the
  application's debounce/queue time in input-to-durable latency; report storage work
  separately when instrumented. Do not subtract it from the user's experience.
- Capture screenshots and CPU profiles outside ordinary timing runs. Profile only
  a selected slow flow in a separate pass. Do not sum overlapping CPU categories or
  sum independent stage medians into an end-to-end latency.
- A missing outcome, exception, unexpected dialog, or timeout invalidates the sample.
  Keep failures and their last completed phase in the report; never turn them into
  a successful maximum-latency sample or silently replace them with a retry.

## Separate setup from application work

Emit a timestamped event as each phase starts and finishes, even on failure:

| Phase | Boundary | Reporting |
|---|---|---|
| Source/install/build | Snapshot begins → production artifact available | Once per variant; development/runner overhead |
| Fixture preparation | Fixture creation/reset begins → fixture usable | Per fixture/trial; excluded from user-action metrics |
| Server startup | Spawn → HTTP readiness | Separate process startup measurement |
| Browser startup | Spawn on `about:blank` → CDP connected and observers installed | Separate harness measurement |
| Application startup | Navigate → active canvas and explorer usable | F01 product metric |
| Scenario preparation | Navigate/seed/select prerequisite → declared ready state | Excluded unless explicitly owned by that flow |
| Interaction | Input or API dispatch → named outcome | Per-flow product metric |
| Durable write | Input/API dispatch → persisted version acknowledged | Separate write metric where applicable |
| Cleanup | Cleanup begins → browser/server stopped and fixture removed | Separate runner overhead |

Do not claim HTTP 200 means the application is usable. Do not label an application
navigation timer as browser startup. Record the browser executable explicitly;
these audited attempts used Linux Chromium, so a Windows/WSL browser mismatch is
not an evidenced explanation for that incident.

Use the in-repository [CDP helper](../../benchmarks/lib/browser.mjs) and
[fixture lifecycle](../../benchmarks/lib/fixture.mjs) as starting points. Adapt their
fixture schemas to the current app before use. Share click/fill/key/reload helpers
rather than regenerating inline JavaScript and keyboard implementations in every
flow. Give every phase and cleanup a bounded deadline with last-phase diagnostics.
For expected reloads, wait for durable state, observe document replacement, then
wait for app readiness. Handle expected unload dialogs explicitly; fail on others.
A process supervisor must be able to terminate a hung browser/server if CDP fails.

## Workloads

Create deterministic generated fixtures with pinned Git commits and source text.
Use one normal profile initially. Add the larger profile only to the flow being
investigated, rather than taking a Cartesian product of all dimensions.
These are initial workload definitions, not claims about current users' data sizes.

| Dimension | Normal profile | Larger profile |
|---|---:|---:|
| Repositories / canvases | 2 / 8 | 2 / 40 |
| Diagrams per canvas / structural nodes per diagram | 6 / 80 | 24 / 150 |
| Edges on active canvas | 20 | 100 |
| Existing checkpoints on edited canvas | 20 | 100 |
| Source files opened in investigation | 3 files × 3,000 lines | 5 files × 10,000 lines |
| Selected nodes / mapped ranges | 8 / 24, including overlap and gaps | 40 / 120 |
| Proposal capture / changed documents | 8 / 2 | 40 / 8 |
| DiffTree nodes / captured hunks | 150 / 200 | 600 / 1,500 |

Keep generated diagram ASCII below its 20,000-character limit. Diff fixtures must
stay within capture limits (2,000 hunks, 8 MiB total patch text, 2 million characters
per patch). Record actual store bytes, history bytes, mapping counts, ASCII lines,
source bytes, patch bytes, and mounted pane counts; counts alone do not explain cost.
Include a pinned text modification, addition, deletion, binary change, and migration
in the review fixture. Use supported schemas for the baseline revision under test;
legacy-data migration is a separate benchmark, not incidental setup in every trial.

## Flows and ownership

| ID | User goal | Performance area owned exclusively by this flow |
|---|---|---|
| F01 | Open a project and change canvases | Startup, restoration, explorer navigation |
| F02 | Navigate and arrange a diagram canvas | Camera, layout gestures, folding, edge geometry |
| F03 | Investigate mapped source | Selection resolution, code loading/highlighting, source scrolling |
| F04 | Author a canvas and revise local work | Creation/paste/delete, history, workspace persistence |
| F05 | Find a diagram and reveal a match | Search worker/index, query latency, cross-canvas reveal |
| F06 | Request an AI diagram update | Prompt/job UI, streamed progress, application of generated content |
| F07 | Have an external agent inspect and edit a live canvas | MCP/context projection, bridge round trip, API mutation visibility |
| F08 | Review and accept a ChangeSession | Proposal capture, diagram review, migration navigation, publication |
| F09 | Review code changes through a DiffTree | Hunk mapping/read/render, paging, WindowPanel transitions |

### F01 — Open a project and change canvases

**Start:** Saved workspace with one active canvas, two previously opened canvases,
a saved camera position, and normal catalog/history volume; source panes closed.

**Actions:** Navigate to the production app. Once usable, expand a repository,
filter the explorer by canvas name, open a previously unopened canvas, then switch
back to the original canvas.

**Measure separately:** Navigation → explorer ready; navigation → active canvas
usable at its restored camera; final filter input → matching explorer entries;
canvas click → target canvas usable, for first opening and warm switching.
Track startup requests/bytes and long tasks. Server/browser startup remains separate.

**Outcome gates:** The expected canvas identity and visible labels are present,
the restored camera is applied, and pointer hit-testing reaches the canvas.
Do not benchmark an empty placeholder that merely looks loaded.

**Reuse:** [Startup browser measurement](../performance/browser-startup-performance.mjs),
[startup phase breakdown](../performance/startup-phases.mjs),
[repository explorer workflow](../browser/mapping/browser-repository-explorer-check.mjs).

### F02 — Navigate and arrange a diagram canvas

**Start:** Active, fully loaded canvas with connected diagrams; no source panels,
proposal, or search UI. Startup and canvas selection are untimed setup.

**Actions:** Perform a fixed pan gesture, a fixed zoom sequence, drag one diagram
to a new position, then collapse and expand a populated subtree.

**Measure separately:** Pan/zoom frame intervals and main-thread time; drag
input → displayed position and settled edge geometry; fold/unfold input → changed
visible rows and settled layout. Use a fixed path and input cadence; record dispatch
lag rather than letting a slower target silently receive fewer input events.

**Outcome gates:** Camera/diagram bounds actually change, incident edges follow,
and the intended subtree disappears/reappears. Persistence/history timing belongs
to F04; source-panel scrolling belongs to F03.

**Reuse:** [tldraw pan measurement](../performance/browser-tldraw-pan-performance.mjs),
[tldraw interaction workflow](../browser/mapping/browser-tldraw-check.mjs),
[subtree workflow](../browser/mapping/browser-subtree-collapse-check.mjs).

### F03 — Investigate mapped source

**Start:** Active canvas with deterministic source mappings to three local files,
including overlapping ranges, a gap, and an inherited mapping. Files remain unchanged.

**Actions:** Ctrl-drag to select a fixed group of nodes, use Actions → open mapped
source, expand one source gap, scroll one file, and browse its full source view.
Close and reopen the same panel once for the warm case.

**Measure separately:** Selection completion; open input → readable mapped code;
open input → syntax-highlighted code; gap expansion; source-scroll frame intervals;
browse-source input → readable full file; warm panel reopening. Record source
requests/bytes and actual rendered line counts. Keep canvas-camera gestures out.

**Outcome gates:** The expected ranges/files appear, highlighting is ready for the
highlight metric, the gap expands, and scrolling changes only the intended pane.
Do not equate a panel shell with ready source content.

**Reuse:** [Code panel opening measurement](../performance/browser-code-panel-opening-performance.mjs),
[source pane measurements](../performance/browser-source-pane-performance.mjs),
[code pane rendering experiment](../../benchmarks/code-panes-render/README.md).
Definition navigation with `--lsp` is an optional isolated variant; measure first
language-server lookup and warm lookup separately rather than adding LSP startup
to every source-viewing trial.

### F04 — Author a canvas and revise local work

**Start:** Repository registered, explorer usable, deterministic history-bearing
workspace restored. No external agent or proposal participates.

**Actions:** Create a canvas with initial ASCII in the chosen repository; paste
another diagram; undo and redo the paste; delete the added diagram and undo that
deletion. Let automatic persistence acknowledge each measured operation. Reload
once afterward to establish that the final state was durable.

**Measure separately:** Create/paste/delete/undo/redo input → visible result, and
input → durable acknowledgement. Record request/write bytes and the history/store
size before and after. Run a fixed-length burst variant only when investigating
save coalescing; do not mix it with isolated-operation latency.

**Outcome gates:** Expected content count/history head changes and the final state
survives reload. Reload is a durability gate here, not another startup score.
Keep model generation in F06 and multi-canvas transfers out of the initial profile.

**Reuse:** [Workspace persistence measurement](../performance/browser-workspace-persistence.mjs),
[paste workflow](../browser/mapping/browser-canvas-paste-check.mjs),
[deletion workflow](../browser/mapping/browser-diagram-delete-check.mjs).

### F05 — Find a diagram and reveal a match

**Start:** Open workspace with the normal catalog; a distinctive match is in a
folded subtree on an unopened canvas. No source or proposal panels are open.

**Actions:** Open project-wide diagram search, enter the query, refine it with a
fixed short typing sequence, and activate the result. Repeat a query after the
index is warm.

**Measure separately:** Initial index readiness if exposed; final input event →
results for that exact query; result activation → target canvas, expanded subtree,
and visible match. Separate first-query and warm-query latency. Record worker
messages/bytes, main-thread time, and obsolete-query work when observable.

**Outcome gates:** Results belong to the latest query and the expected result is
visible after navigation. Explorer filtering belongs to F01; source search is not
part of the diagram search feature.

**Reuse:** [Diagram search workflow](../browser/mapping/browser-diagram-search-check.mjs)
and [search architecture](../../docs/guides/diagram-search.md).

### F06 — Request an AI diagram update

**Start:** One selected diagram, no request in flight. Use a deterministic fake
agent with a fixed output size and declared response schedule; record that schedule.

**Actions:** Open Update diagram with AI, enter a fixed prompt, submit it, observe
progress, and wait for the generated diagram to be displayed and persisted.

**Measure separately:** Prompt opening; submission → visible running/progress state;
submission → generated diagram visible; generated result receipt → visible update;
submission → persistence acknowledgement. Keep the full perceived duration and
provider/application spans separate; do not hide the provider wait by subtraction.

**Outcome gates:** The expected generated marker reaches the selected diagram and
the operation reports completion. Other edit/history cases are owned by F04.
Real model/network latency is a separate observational run, unsuitable as the main
application regression baseline. Chat and compaction variants are deferred.

**Reuse:** [Diagram edit UI workflow](../browser/mapping/browser-diagram-edit-ui-check.mjs).

### F07 — Have an external agent inspect and edit a live canvas

**Start:** Browser attached to a stable live workspace; deterministic MCP client
already connected. Record MCP connection startup separately from method latency.

**Actions:** Discover tools/methods, list canvases, attach the target document, and
read its context. Submit a small diagram patch, then a source-mapping/edge update
using current document versions and unique request IDs; observe the live browser.

**Measure separately:** Tool discovery, attachment, compact context response,
detailed node response, and each mutation's response/visible/durable latencies.
Treat short HTTP context and detailed MCP reads as labeled alternatives with
recorded payload bytes, not one combined score. Each mutating `exec` method commits
separately; count and time the actual operations instead of inventing a batch commit.

**Outcome gates:** Expected versions and visible ASCII/edge/mapping changes arrive
on the intended document. No model call or UI authoring is included. F04 owns undo
and reload; F08 owns isolated proposals rather than live edits.

**Reuse:** [Live canvas workflow](../browser/mapping/browser-live-canvas-check.mjs),
[agent diagramming workflow](../browser/mapping/browser-agent-diagramming-check.mjs).

### F08 — Review and accept a ChangeSession

**Start:** Repository with pinned commits/head and the normal workspace. Prepare
repeatable edits covering modification, added diagram, new canvas, and migration
between documents; do not depend on a real coding agent during measurement.

**Actions:** Create a session through MCP and time its snapshot capture. Apply the
prepared edits/annotations and mark ready as untimed setup. In Changes, open a
modified diagram, an added diagram, and a migration source/destination. Accept the
ready session and wait for its published canvas to become usable.

**Measure separately:** Create request → session returned; explorer opening →
summary ready; change selection → review text/borders usable; migration link →
endpoint visible; accept input → publication acknowledged and accepted/live canvas
visible. Record snapshot/publication bytes, server work, and preview-worker latency
when available. Code-hunk review is exclusively F09.

**Outcome gates:** Review shows the intended baseline/proposal pair, new diagrams
have green borders, migration endpoints are reachable, and accepted revisions are
published. A reload may verify the accepted state outside the timed sample. Reset
from the same fixture before each acceptance trial; never reuse an accepted session.

**Reuse:** [Migration workflow](../browser/mapping/browser-change-migrations-check.mjs),
[acceptance workflow](../browser/mapping/browser-change-acceptance-check.mjs),
[record persistence measurement](../performance/change-session-records.mjs).

### F09 — Review code changes through a DiffTree

**Start:** Precreated ChangeSession with a persisted ASCII DiffTree, explicit
node-to-hunk mappings, and captured commit patches. Include ancestor fallback and
more than 100 hunks so pagination is exercised. Capture/generation is untimed setup.

**Actions:** Open Diff tree for a canvas, select a mapped branch and then an
inheriting child, return to All changes and load the next page, scroll/wrap hunks,
then switch among full split, full single, and beside-canvas single layouts.
Navigate away and reopen for the warm retained-state case.

**Measure separately:** Open → tree and first readable hunk; mapped selection →
matching readable hunks; selection → highlighting complete for the visible hunks;
Load more → next page displayed; scroll frame intervals; layout switch → usable
panes/canvas; warm reopening. Capture request sizes and rendered/mounted hunk counts.
Cold first read/highlighting and repeated selection must remain separate samples.

**Outcome gates:** Selected hunk IDs match the fixture, pagination advances, the
active layout is visible, and reopening restores the intended selection/scroll.
Use captured patches even if the worktree differs. Do not time Git capture, source
file fetching, or proposal acceptance as hunk-rendering costs.

**Reuse:** [DiffTree WindowPanel workflow](../browser/mapping/browser-diff-tree-panel-check.mjs).

## Coverage boundary and rollout

The flows deliberately share prerequisites but not primary scores. For example,
F03/F06/F07 all result in UI changes, but respectively own source rendering,
generated-result handling, and external-agent round trips. F08/F09 use the same
ChangeSession fixture family but measure diagram publication and code review
separately. A reload used as an outcome gate is not another F01 measurement.

Defer exhaustive error/retry matrices, legacy migrations, multi-client races,
cross-canvas copy/move, all connection styles, document/Markdown presentations,
chat variants, compaction generation, and model-provider comparisons. Keep existing
correctness coverage for those areas. Promote a deferred flow when usage or a
performance incident makes it more valuable than an existing baseline.

1. First establish a reusable lifecycle/input harness and phase events. Verify one
   small fixture can reach app readiness and clean up without rebuilding per run.
2. Establish F01–F05 normal baselines. Reuse existing performance collectors after
   checking compatibility with current persistence/API schemas.
3. Add F06–F09 with fixed fake-agent output and captured Git fixtures. These do not
   require a real model or external network. Include source hashes for dirty builds.
4. Run only affected flows during iteration. Run the complete normal set at a
   deliberate benchmark checkpoint, not after every edit. Run larger fixtures and
   profiling only for the affected area.
5. Retain raw samples, failures, phase timings, environment/fixture manifests, and
   per-flow baseline/candidate comparisons. Report absolute and percentage changes
   without an invented overall performance score. Establish regression thresholds
   only after repeated baselines reveal noise; initially report, do not gate CI on
   arbitrary millisecond targets.

Extend the current benchmark report schema for `flow`, `stage`, `cacheState`, and
`fixtureProfile`; its existing pane-count/gesture grouping is not sufficient for
all nine flows. Preserve links to the exact captured inputs and separate profile
runs from ordinary measurements.
