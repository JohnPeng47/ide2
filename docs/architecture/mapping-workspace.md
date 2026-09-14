# Mapping workspace state

Mapping uses Ctrl + left-drag to select a rectangle, including text or whitespace without code entities. Plain dragging pans the canvas. Unmapped regions support Copy and Ask; source-dependent generation and projection actions still require mappings.
A selection without a follow-up is temporary: Escape cancels it. Opening a projection,
prompt, or local question retains the selection. Its source rectangle and effects remain
until explicitly removed. More selections can be made without replacing retained groups.

Each retained selection has Actions, a Stacked/Chained selector, and a remove button.
Actions reopens its control surface, including its instruction/question draft. The join
on the source rectangle toggles all owned effects recursively without discarding data.
Pane headers also have collapse and close controls. Close removes that pane and its
owned descendants; removing a selection removes its whole effect tree.

Stacked mode shows the active projection path in one slot per selection. Back and Forward
navigate without deleting content. Chained mode displays the related panes beside their
parents with connectors on one horizontal axis. Ctrl-drag in a projected call tree selects
rendered rows; Project selected rows creates a compaction child using stable node IDs.
Compaction files offer Open source, which creates a source-code child rendered inside the same DisplayPane frame. Source file choice, Studio-style compaction mode, range navigation, and scroll position are retained with the child. Escape cancels that uncommitted row selection. Content collisions are intentionally not resolved.

Source movement updates selection anchors. Collapsing a source scene box hides its attached
effects. Changed/missing content is marked as a saved snapshot: the original rectangle is
not presented as a current mapping, and further projection is disabled until a new valid
selection is made. Existing captured projection content remains available.

## State ownership

- `LineGridScene` remains authoritative for diagram/group contents, geometry, and expansion.
  Generated sub-diagrams are ordinary scene boxes. There is no duplicate copy of their state
  in the display-node registry.
- `displayModel.ts` owns retained selection, projection, detail, and conversation nodes.
  Ordered child IDs define ownership; parent lookup and effective visibility are derived.
  Every node owns `position: {x, y}`, `bounds: {width, height}`, `coordinateSpace`, and
  `geometryPolicy: {placement: automatic | manual, sizing: content | fixed}`. Geometry uses
  unscaled CSS pixels, not grid cells or screen pixels after zoom. Selection `rect` remains
  the semantic grid-local source range; its resolved pixel allocation lives in the node.
- `MappingControls` is separate from DisplayNode. Each selection has its own control-surface
  state, plus a draft surface for the next selection. Conversation composer drafts live with
  their conversation. Pointer capture and placement previews remain temporary.
- `DisplayPane` and `EffectPaneHeader` provide shared pane chrome. Source rectangles,
  connectors, mapped-label highlights, and other annotations are derived views, not additional
  independently persisted nodes.
- `projectedPaneLayout.ts` lays out projections using measured outer pane bounds in canvas
  coordinates and writes automatic positions back into nodes. There is no separate size cache.
  Manual positions survive reflow; fixed allocations control the outer frame, with scrolling
  content. Content-sized frames report their measured border box through a ResizeObserver.
  Collapsing stores `expandedGeometry` so expanding restores a fixed allocation correctly.
  The viewport transform is applied once to the whole surface.
- Conversations keep a semantic `canvasAnchor` for their bubble. Expanded compact/floating
  panels render from node geometry in canvas space; docked panels use viewport space. A
  collapsed conversation's geometry is its 34px canvas bubble. Automatic docking responds
  to viewport resize. Thread messages no longer contain rendering coordinates. Submitting a question immediately opens a conversation attached to the selected region, with frozen source context, verbosity controls, and retry. There is no placement step.

`DisplayPane` is the shared React component for projected and detail panes; it consumes the
node rather than separate x/y props. Layout owns attachment and connector routing, the frame
owns measurement and expansion controls, and content renderers own tree/compaction/detail
bodies. Manual panes get routed connectors; automatically placed chains retain one horizontal
axis. This change adds geometry policies, not new drag/resize gestures.

## Save and reload

Save workspace writes a versioned snapshot of all opened documents, including unsaved scene
edits, retained effects, control drafts, and pan/zoom. Restore workspace replaces the current
workspace with the saved snapshot. The saved workspace is also restored on page reload.
These explicit commands are separate from Save, which creates a diagram representation revision.

Live source scroll offsets and camera transforms are kept in a workspace-scoped
`SourcePaneViewState`, outside React's display state. Source scroll events update only their
viewport entry; camera movements write the canvas transform without updating the page's
drafts. `capture()` samples mounted source viewers directly, retains the last position of
unmounted panes, and merges those positions and the camera into the workspace snapshot.
This also captures scrolling immediately before Save or Export, before a scroll event arrives.
Restore/Import replaces the runtime state; file switches and pane deletion discard obsolete
entries. Source rows are memoized independently of viewport callbacks, so scrolling and
panning cannot restart the full-file block measurements. The current renderer retains native
browser search and selection with measured offscreen chunks; it does not virtualize DOM rows.

Run `npm run check:source-performance` for the production-browser regression and benchmark.
The checked-in `tests/fixtures/source-pane-performance/workspace.json` opens five independent
3,000-line viewers in a visible 3-by-2 arrangement. The test materializes that snapshot and its
deterministic source in a disposable project, then uses actual UI controls to exercise one
through five expanded panes. Three trials per count measure 40 middle-button pan movements
and 40 wheel inputs directed at pane 1. Pan gestures return to their starting transform;
scroll gestures leave other panes unchanged. Measurements exclude file loading/tokenization,
but include the first gesture after expanding each additional pane.

Reports record overlapping CDP main-thread/script/layout/style durations, elapsed time,
requestAnimationFrame interval p95/max, intervals above 25 ms, and observed long tasks.
Input targets a 60 Hz cadence but awaits each CDP dispatch, so transport/browser backpressure
can extend the gesture. Frame intervals describe main-thread scheduling, not compositor
dropped-frame counts or input-to-display latency. Numeric timings are observations rather
than machine-dependent pass/fail limits. Regression assertions require zero full-source
block-size reads and zero source-content DOM mutations during each gesture.

The same integration test checks independent horizontal/vertical positions, immediate Save,
collapsed-pane and inactive-document persistence, Export without a preceding Save, Restore,
and reload. It writes
the metrics, a screenshot, and the final five-pane saved workspace under
`artifacts/source-pane-performance/`. Set `SOURCE_PERF_REPORT` to choose the JSON report path.
The canonical fixture uses a placeholder project ID which the runner rebinds to its isolated
project; generated saved snapshots belong to that disposable project. Regenerate the fixture
with `node scripts/fixtures/create-source-pane-performance-fixture.mjs` when its data/layout changes.
`SOURCE_PERF_BASELINE=1` disables only the new measurement/mutation assertions for profiling
an older build; persistence and real interaction checks remain enabled.
`SOURCE_PERF_TRIALS=0` runs only the persistence checks; the benchmark defaults to three
trials per gesture and pane count.

Export downloads the same snapshot as JSON. Import validates it and replaces the current
workspace; Save workspace makes an imported workspace the default on reload. Import requires
the same project ID. It is not a portable project/artifact export: projection content is
captured, but continuing a projection still requires the corresponding catalog/revisions.

`mappingWorkspaceCodec.ts` is the format/migration boundary. v3 retains the v2 geometry model and permits arbitrary repository-relative source files. v1/v2 snapshots migrate on read. The codec validates node ownership,
reference integrity, kind-specific payloads, document scenes, and viewport coordinates.
v1 files migrate detail x/y and conversation thread anchors into the new model, and initialize
previously unsaved selection/projection geometry for automatic resolution. v2 saves all node
geometry, including hidden panes. Restored content-sized panes remeasure with the current
font metrics; automatic children reflow from those measurements. Manual/fixed allocations
stay exact. Unknown schema versions are rejected. Restore normalizes unfinished requests to interrupted
state rather than automatically restarting them. Source context and verbosity are preserved with each conversation. Older transcripts without captured source context remain readable; start a new conversation to ask further questions. Interrupted replies remain retryable without inserting synthetic assistant messages. Chat replies and prompt updates target their
original owner, including when the active selection changes.

`mappingWorkspaceRepository.ts` provides the load/save interface. The current implementation
uses GET/PUT `/api/mapping/workspace`; `MappingWorkspaceStore` writes
`mapping-workspace.json` atomically in the project's diagram store. Invalid writes leave the
last saved snapshot intact. Saves replace the single workspace snapshot; concurrent writers
use last-write-wins semantics. There is no autosave, undo-history serialization, collision
avoidance, or bundled external artifact export in v2.

## Verification

```sh
npx vitest run domain/mapping/workspace/__tests__/displayModel.test.ts domain/mapping/workspace/__tests__/mappingWorkspaceCodec.test.ts infrastructure/mapping/persistence/workspace/__tests__/mappingWorkspaceStore.test.ts
npm run build
node tests/browser/mapping/browser-projection-check.mjs
node tests/browser/mapping/browser-local-chat-check.mjs
node tests/browser/mapping/browser-line-grid-check.mjs
```

Browser checks run against disposable fixture projects and exercise actual pointer/keyboard
input. Projection checks include retained selections, chained connector alignment, collapse,
form drafts, and a server-backed save/reload round trip.


## Repository files and definitions

Source panes have a **Files** disclosure, collapsed on initial load and after workspace restore.
Expand directories on demand, then click a file or press Enter to open it in the same pane.
Arrow keys move between visible entries; Right expands a directory and Left collapses it or
moves to its parent. Refresh files reloads directory listings. The mapped-file selector remains
available to return to files from the original projection. Unmapped files display complete source
without projection highlights or compaction controls. Binary files show an unsupported-file message.

`SourceCodePaneContent.sourceFile` is the selected repository-relative path. `files` remains the
original projection metadata, not a repository index. File navigation retains node ID, geometry,
and ownership. Workspace v3 persists the selected file and current scroll position. Explorer
expansion and Back/Forward history are local to the mounted pane and are not serialized.

LSP is **off by default**. Start explicitly with `npm run dev -- --lsp` (or
`npm run preview -- --lsp` after building). `npm start -- --lsp` is also supported.
Without the flag, the server does not construct a language service, rejects definition
requests with `503 LSP_DISABLED`, and hides definition gestures/hints in source panes.
Repository browsing, highlighting, folding and file history still work. No workspace or
environment variable can enable LSP; the launcher passes a process-local opt-in.

With LSP enabled, for TS/JS, **Ctrl/Cmd+click** a symbol, or place the text selection/caret on it and press **F12**.
A single definition opens in the same pane, expands an enclosing compaction if needed, and
selects the target text. Multiple results offer a destination picker. Back/Forward restores
previous files and scroll offsets. Reload source refreshes the current file after changes on disk.
Definitions outside the project root are reported rather than opened.

The project API exposes `GET /api/core/project/files?projectId=...&path=...` for one directory
and `POST /api/core/project/definitions` for `{ projectId, path, position, sourceSha256 }`.
Positions are zero-based UTF-16. Both APIs resolve the server-owned project corpus root.
Definition requests verify the displayed source hash against disk. `ProjectLanguageService`
starts one shared `typescript-language-server`/`tsserver` session per checkout on first definition lookup when enabled,
with the app's installed TypeScript version and the checkout's project configuration. It uses
semantic analysis (syntax-only startup results can stop at import aliases), supports cancellation
and bounded requests, closes read-only documents after lookup, and stops idle sessions after five
minutes. Subsequent requests restart failed or idle sessions. Other languages currently support
browsing and syntax highlighting only.

Source hit testing counts original code text, excluding gutters and generated fold labels.
Navigation and language-service requests never run on the scroll path. Directory state remains
inside the explorer; shared directory request caching is bounded to 256 entries. The existing
memoized source rows and offscreen chunks continue to handle rendering.

Run `npm run check:source-navigation` for a production browser check using the disposable
five-pane fixture and an explicitly enabled real language server. Performance checks start with LSP disabled. It checks lazy directories, unmapped files,
Ctrl+click/F12 definitions, UTF-16 positions, folded targets, history, and save/reload. Server tests
also cover multiple/no definitions, outside-root targets, stale source, and path restrictions.
Run `SOURCE_PERF_EXPLORERS=1 npm run check:source-performance` to benchmark 1–5 panes with
their repository explorers open. This variant shifts selection controls left so they do not
cover the first pane's explorer button; source pane positions and sizes remain unchanged.

`infrastructure/core/language-services/__tests__/lspStartup.test.ts` launches the actual CLI in both modes. It checks that
inherited environment flags cannot enable LSP, disabled definition requests stay blocked,
enabled sessions start only on the first lookup and are shared, and stopping the server
terminates its language-server processes (process checks use `/proc` on Linux).

Run `npm run check:unmapped-selection` to check unmapped text and whitespace selection, Copy/Ask, cancellation, and conversation save/reload in a disposable browser fixture. Server validation cases live in `infrastructure/mapping/agents/chat/__tests__/localChat.test.ts`.

Right-click the diagram canvas and choose **Paste sub-diagram here** to insert clipboard ASCII at that grid cell, including on blank canvas space. The click location is captured before reading the clipboard and accounts for pan/zoom; positions before the grid origin clamp to zero. Paste inserts into the root container through the same `insertGridDiagram` / `layoutScene` path as generation: the new box stays anchored and overlapping siblings move right. It creates no source mappings. Undo/redo and diagram/workspace saves include the insertion.

Clipboard paste preserves indentation, normalizes CRLF/CR newlines, and accepts one enclosing Markdown code fence. Empty/whitespace-only content, tabs, non-ASCII characters, and more than 20,000 characters are rejected. Clipboard failures or invalid text open a manual paste field. Escape, outside click, pan/zoom, and switching diagrams dismiss the menu and cancel pending clipboard reads. Right-click inside code panes and editable fields keeps native behavior.

Run `npm run check:canvas-paste` for the disposable production-browser regression (placement after pan/zoom, collisions, undo/redo, clipboard fallback, stale reads, and save/reload). Parsing and atomic insertion tests are in `src/features/mapping/canvas/__tests__/pasteDiagram.test.ts`.
