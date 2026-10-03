# Mapping workspace state

Mapping uses one Ctrl + left-drag marquee for diagram-local regions and whole diagrams, including text or whitespace without code entities. Shift-drag does not select. A diagram is promoted when fully enclosed; promotion stays in effect until the drag completes. A marquee can select regions in multiple diagrams, and whole diagrams replace their selected regions. Plain dragging pans the canvas. Unmapped regions support Copy and Ask; source-dependent generation and projection actions still require mappings.
Completed gestures update `canvas.selection.items`, the only source of selection membership.
Each item has an ID and display-node ID; an optional `region` captures a rectangle,
source content/revision/ASCII, and mapped node IDs. Absence of `region` selects the
whole diagram. `selectionCommand` implements replacement, addition, diagram toggling,
removal, and clearing. Selecting a whole diagram removes its regions; selecting a
region removes its whole-diagram item. Repeated region gestures reuse item identity.
Plain double-click on diagram background replaces the entire selection. Ctrl/Meta
double-click toggles a diagram while preserving unrelated items; a plain double-click
on a node label remains a region selection. Deselected regions never reappear merely
because a whole diagram is deselected.

Opening a projection, prompt, code panel, or local question attaches effects to a
captured region context in the display tree. Those contexts have no membership flag:
panels can survive selection removal, and creating a panel does not select its source.
`controls.selectionFocusId` identifies the item whose actions are focused; changing
focus does not add or remove items. Rectangle and mapped-node action inputs are derived
from that item. Pointer previews remain separate and never enter the selection queue.

The publisher reads this same collection and derives the compatible `diagramIds` and
`regions` payload. It does not synthesize IDs or merge display/focus state. Region text
uses captured ASCII when stale. The server only validates and mirrors snapshots/deltas.
Old workspace fields and checkpoint views migrate through `importLegacySelection` at
load/undo boundaries; runtime consumers never fall back to legacy membership.
Escape during a drag cancels its preview without changing the prior selection.
More Ctrl-drags add to the current selection; outside clicks preserve it. Escape
or the remove control deselects it. Existing code-panel Escape behavior still closes the focused pane first.

Each retained selection has Actions (A), a Stacked/Chained selector, and a remove button.
Selection initially shows only its outline and controls, with hover-style outlines on
selected node labels. Actions (or A) opens its control surface, including its instruction/question draft. The join
on the source rectangle toggles all owned effects recursively without discarding data.
Pane headers also have collapse and close controls. Close removes that pane and its
owned descendants; removing a selection removes its whole effect tree.

Stacked mode shows the active projection path in one slot per selection. Back and Forward
navigate without deleting content. Chained mode displays the related panes beside their
parents with connectors on one horizontal axis. **Actions (A) → open mapped source**
opens [CodePanel](../guides/code-panel.md), which resolves direct or nearest-ancestor mapped
resources independently of projections. One panel combines source ranges across files;
the existing pane frame, connectors, folding renderer, and navigation remain shared.
Saved compaction panes retain their presentation, but the old runtime compaction mapping
chain and its Open compaction/Open source actions have been removed.


Source movement updates selection anchors. Collapsing a source scene box hides its attached
effects. Changed/missing content is marked as a saved snapshot: the original rectangle is
not presented as a current mapping, and further projection is disabled until a new valid
selection is made. Existing captured projection content remains available.

## State ownership

`CanvasWorkspace` owns one `CanvasSession` per open document. The page's draft registry
contains metadata and stable session handles; it does not mirror documents, canvas state,
or exported history. A session owns the existing `MappingDocumentController` and exposes
read-only Zustand stores for document, presentation, selection, controls, geometry, saved status,
and temporary interaction. Commands still go through the controller; subscriptions publish
its immutable references rather than creating another editable model.

The interaction boundary is deliberately separate from controller commits:

```text
Ctrl-drag pointer movement
  -> CanvasSelectionLayer local preview
     -> selectCanvasMarquee hit testing (no controller writes)
        -> one marquee plus whole-diagram outlines

Pan pointer movement
  -> imperative canvas transform + SourcePaneViewState

Completed selection / document command
  -> MappingDocumentController
     -> changed session stores -> subscribed UI
        -> CodePanel content subscribes by panel ID
     -> document change -> cached saved-status comparison + search/explorer update
     -> history commit -> debounced workspace persistence
        -> capture current documents, views, and history once per write
```

Dirty comparisons use canonical scene/edge keys computed only when those references or
the saved baseline change. Rendering, selection previews, and presentation-only commits
never serialize the document to determine dirty status. Save acknowledgements update the
captured baseline, so edits made while Save is in flight remain dirty. Undo/redo compare
against that same baseline. Persistence subscribes outside React and coalesces commits;
history is exported when capturing a snapshot, not on every controller notification.

Keep new pointer previews in the interaction store, and let each new content renderer
select its own presentation node. Do not restore Canvas-to-page callbacks that copy domain
state. The session/workspace tests enforce that 1,000 preview updates produce no controller,
document, history export, dirty calculation, persistence, or other-canvas notifications.

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

Workspace editing history is saved incrementally in the background. Save workspace samples
live views and waits for all submitted changes to become durable. Restore workspace flushes
pending changes and reloads the persisted workspace. The workspace also restores on page reload.
These explicit commands are separate from Save, which creates a diagram representation revision.

Live source scroll offsets and camera transforms are kept in a workspace-scoped
`SourcePaneViewState`, outside React's display state. Source scroll events update only their
viewport entry; camera movements write the canvas transform without updating the page's
drafts. `capture()` samples mounted source viewers directly, retains the last position of
unmounted panes, and merges those positions and the camera into the workspace snapshot.
This also captures scrolling immediately before Save or Export, before a scroll event arrives.
Viewport changes submit after a 250 ms coalescing interval; persistence then batches them with
other changed records. Camera-only changes use a separate viewport record.
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
workspace; background persistence makes it the default on reload. Import requires
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

`WorkspaceStorage` owns a persistent browser worker and a cached `StorageService` implementation.
`store`/`remove` submit synchronously; `flush()` is the asynchronous durability barrier.
`WorkspacePersistence` subscribes to committed canvas changes and submits metadata, history
headers, newly created checkpoints/revisions, presentation, and viewports by key. Ordinary
autosaves never export every canvas history. The worker normalizes and encodes changed records
and posts serialized batches to `/api/mapping/workspace/records`.

`WorkspaceRecordStore` writes immutable content-addressed record files and atomically replaces
`workspace-records.json`, the manifest linking a complete workspace. A batch carries its expected
workspace revision and a durable request ID; stale clients get a conflict and interrupted
responses can be retried without applying a transaction twice. Legacy GET/PUT snapshot APIs
remain available. The first records load migrates `mapping-workspace.json` without deleting it;
after migration the record manifest is authoritative. Export remains workspace JSON, including
undo/redo history but excluding external repository files. See
[incremental persistence and measurements](../research/workspace-persistence.md) for scheduling,
transaction boundaries, browser shutdown limits, and the create/delete benchmark.

Change sessions have their own record manifests and scoped preview API. The Changes explorer
reads summaries; previews load only the selected canvas's baseline/proposed state. Migration,
hydration, and validation run in a server worker, while preview diffing runs in a browser
worker. See [change-session storage](../research/change-session-storage.md) for record layout,
incremental writes, version checks, and acceptance compatibility.

## Verification

```sh
npx vitest run src/features/mapping/workspace/__tests__
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

## Selection responsibilities

- `CanvasSelectionLayer` owns Ctrl-drag, pointer capture, cancellation, and diagram
  double-clicks. It replaces both the old region handler in `MappingCanvas` and
  `DiagramSelectionLayer`; the old session preview store and overlay are removed.
- `canvasSelection.ts` resolves the marquee across diagrams and enforces whole-diagram
  precedence. `selectedDiagramIds` contains `nodes.list()` IDs. Region records live
  in the display tree; `selectionActive` separates selection membership from panel
  ownership. The rectangle and mapped IDs in controls describe the focused region
  used by the action menu, rather than a second multi-selection collection.
- A plain node click activates a retained region through the same model. Source
  panels open only through Actions → open mapped source. Structural node IDs identify diagram nodes;
  `selectedNodeIds`/`selectedIds` are source-mapping annotation IDs used for Copy.
- `diagramSelection.ts` and `selectionClipboard.ts` are shared geometry/text helpers,
  not competing gesture handlers. `SelectionService` runs prompted edits.
- `liveCanvasPublisher` observes completed selection state and serializes it; it
  does not own selection. Source-editor text selections and call-tree/source-pane
  navigation are local to their panes.

## Deleting selected diagrams

Selecting a whole diagram reveals **Delete diagram** in the selected-diagram toolbar;
multiple selected diagrams show **Delete diagrams**. Only the selected whole diagrams
are deleted, even when the selection also contains regions from other diagrams.
Deletion removes incident edges and owned selection panels, and preserves unrelated
regions. Undo restores all deleted diagrams, connections and panel context together;
Redo reapplies the deletion. Deleting every diagram leaves an empty canvas that still
supports paste and Undo. This removes placements from the current canvas, not saved
canvases in the explorer. The existing agent `nodes.remove` protections are unchanged.

Run `npm run check:diagram-delete` for the disposable browser regression, including
save/reload of an empty canvas and persisted Undo/Redo.
