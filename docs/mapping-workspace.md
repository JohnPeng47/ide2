# Mapping workspace state

Mapping uses Ctrl + left-drag to select a rectangle. Plain dragging pans the canvas.
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
unmounted panes, and merges those positions and the camera into the existing v2 snapshot.
This also captures scrolling immediately before Save or Export, before a scroll event arrives.
Restore/Import replaces the runtime state; file switches and pane deletion discard obsolete
entries. Source rows are memoized independently of viewport callbacks, so scrolling and
panning cannot restart the full-file block measurements. The current renderer retains native
browser search and selection with measured offscreen chunks; it does not virtualize DOM rows.


Export downloads the same snapshot as JSON. Import validates it and replaces the current
workspace; Save workspace makes an imported workspace the default on reload. Import requires
the same project ID. It is not a portable project/artifact export: projection content is
captured, but continuing a projection still requires the corresponding catalog/revisions.

`mappingWorkspaceCodec.ts` is the format/migration boundary. v2 validates node ownership,
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
npx vitest run src/mapping/displayModel.test.ts src/mapping/mappingWorkspaceCodec.test.ts server/mapping/mappingWorkspaceStore.test.ts
npm run build
node browser-projection-check.mjs
node browser-local-chat-check.mjs
node browser-line-grid-check.mjs
```

Browser checks run against disposable fixture projects and exercise actual pointer/keyboard
input. Projection checks include retained selections, chained connector alignment, collapse,
form drafts, and a server-backed save/reload round trip.
