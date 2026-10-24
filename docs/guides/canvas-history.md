# Diagram content and canvas histories

Use **Ctrl+Z** to undo and **Ctrl+Y** to redo on the active canvas. These use the
same canvas-wide history as the toolbar buttons, including workspace transfers.
Inside inputs, textareas, and editable text, the shortcuts keep native text undo/redo.

An editing `contextId` identifies a working history. It is independent of the
MCP workspace `canvasId`, attachment `sessionId`, catalog representation ID, and
ChangeSession ID. A proposal forks each captured document into its own context;
unchanged diagram revisions are shared by identity, while subsequent edits remain
isolated.

## Boundaries

- `domain/core/diagrams/diagramRevision.ts`: immutable content operations with
  explicit revision inputs. `diagramRevisionStore.ts` retains and retrieves them;
  generation orchestration lives in application/browser workflows. See the
  [Node/Diagram boundaries](../architecture/diagram-service.md).
- `domain/core/diagrams/canvasHistoryService.ts`: `CanvasHistoryService` owns editing
  contexts, checkpoints, undo/redo/reset, fork/adopt, and transfer coordination.
  `openContext` returns an opaque runtime handle. Handles isolate viewers even
  when they restore the same persisted context.
- `domain/core/diagrams/canvasHistory.ts`: history implementation used behind the
  service boundary. Canonical `CanvasDocument` contains layout, diagram instances,
  connections, and sections. Content-node edges use logical node references.
  `diagramRevisionEditor.ts` implements revision-local preparation and conservative
  merge checks; it is not the page's injected service.
- `domain/mapping/workspace/mappingDocumentController.ts`: `applyUpdate` stages
  commands, prepares diagram edits, reconciles anchors and sections, runs layout
  and validation, and appends one coordinated checkpoint before notifying readers.
  Prompt edits, generation, paste and grouping also enter through `applyUpdate`.
  `commitDocument` is the compatibility entry point for remaining layout document
  producers and uses the same checkpoint path. `transact` remains a compatibility alias for `applyUpdate`. Consecutive MCP `exec` mutations batch into a single checkpoint; reads flush pending edits.

`getCanvasSnapshot()` and `resolveDiagram()` expose canvas bindings and derived views.
Rendering, source-selection and MCP consumers can also read the full diagram through
`getSnapshot().document` / `nodes()`. Layout edits use canvas commands; changing
content requires an issued immutable revision. A modified clone is rejected at commit.

## Checkpoints and persistence

A diagram edit allocates an immutable UUID revision with its previous diagram
revision as parent. Layout/edge-only edits reuse diagram bindings. Canvas checkpoints
have separate IDs and parents. Undo/redo moves the context head; editing after undo
retains the abandoned snapshots and diagram revisions. Reset appends a checkpoint
referencing the captured baseline bindings rather than synthesizing new diagrams.
Camera, selection and measured geometry updates do not create content revisions.
Personal view state is stored separately from each checkpoint's canvas document.

The portable read model remains an expanded checkpoint. Persistence encodes it as
record diffs using `canvasCheckpointRecords.ts`: grid boxes, edges, sections,
bindings, display panels, selection items, controls surfaces, and folding state
are separate records. A panel movement changes that panel's record without
serializing every other panel's content into the new checkpoint.

Each delta contains added records, updated `[before, after]` references, and
removed records. References address immutable values by SHA-256. Large strings
and captured `sourceAscii` are separate shared text values, so stale selections
keep their exact captured text without duplicating it in every panel/checkpoint.
This encoding does not change node IDs or infer node correspondence.

There are at most 31 delta dependencies before a complete record map. The history
header also carries the current head's materialized record map, so publication
and current-only reads do not require historical checkpoints. Full readers verify
this index against replayed history. Undo/redo, reset, abandoned branches, and
cross-canvas transaction IDs retain their existing meanings. View state remains
undoable; this change does not discard saved selection panes or alter personal
state restoration policies.

The live page queues automatic workspace saves after checkpoint changes (150 ms
coalescing). Writes remain asynchronous, and failures appear in the page error
display. The controller coordinates composition and diagram edits; no separate
CanvasService is introduced.

Controllers use explicit revision operations and storage. The generation UI receives
a generator. Each controller owns a context through `CanvasHistoryService`.
Read-only proposal previews and searches use display projections without opening an
editing context or loading undo history.

### Disk layout and publication

- `canvases/catalog.json`: canvas catalog, composition checkpoints, and opaque
  diagram-history references. `CanvasCatalogStore` owns this file. The old
  `ProjectCatalogStore` is a compatibility facade that also retains compaction APIs.
- `diagrams/diagram/<sha256>.json`: immutable diagram content, source context, and jumps.
- `diagrams/revision/<sha256>.json`: immutable revision metadata, logical node
  identities, and a reference to its diagram record.
- `diagrams/history/<sha256>.json`: history indexes and immutable checkpoint value/text
  records. New history indexes have `format: 2` and reference the items used by
  record-diff checkpoints; old binding-table indexes remain readable.
- `workspace-records.json`: the atomic live-workspace manifest and retry receipts.
  Its document keys include `history`, `checkpoint/<id>`, `revision/<id>`,
  `item/<sha256>`, and the current `canvas` record map. Values are immutable files
  under `workspace-records/`. Current view updates reuse the same value/text pool
  as checkpoint history. Autosave sends previously unseen items and changed
  checkpoints/header/view records, not all shared items again.
- Workspace and change-session files use the same references through the diagram persistence adapter.
  Their materialized diagram objects are also externalized. Derived catalog exports
  and legacy saved-scene strings remain compatibility data, not revision storage.

The diagram persistence adapter calls `DiagramRevisionStore` through a storage port. All referenced
records are persisted before atomically replacing the parent canvas/workspace/session
file. An interrupted save may leave unreferenced immutable records, but cannot
publish a pointer before its dependency is written. Record hashes are verified on
read, and missing records are errors. Garbage collection is not implemented.

Loading falls back to `representations/catalog.json` if the new canvas catalog is
absent. Only current canvas-history payloads with service-issued diagram identities are accepted. Retired ASCII, diagram, and mapping-canvas payloads are rejected. Saving requires supplied history matching the document. Consumers should back up
the entire diagram directory, not just its catalog file.

HTTP responses and explicit workspace exports remain portable expanded documents;
compatibility adapters hydrate references before existing rendering and MCP code
sees them. Export/import therefore does not depend on the original store directory.
History bundles remain subject to the existing HTTP request-size limit.

Old expanded checkpoints and current-view records remain readable. Attaching a
live workspace upgrades its checkpoint encoding in an atomic autosave; the server
compares decoded checkpoints before allowing this migration. Re-encoding cannot
change an existing checkpoint's semantic content. Existing immutable files are
not deleted by migration: other saved catalogs or proposals may still reference
them. Reclaiming those files requires a separate reachability-aware collector.

The new storage format reduces persisted/transported history. Portable exports
and the controller's compatibility history are still materialized objects; fully
lazy in-memory history and a history-retention policy are separate changes.

## ChangeSessions and merge

`ChangeSessionService` captures saved documents plus live drafts, then forks their
histories. Proposal edits, undo, redo, and reset use the same controller/history
implementation and persist automatically in the session store. Older proposal
histories are migrated on mutation, preserving available undo and redo states.
Preview correspondence remains separate from exact patch provenance used for
logical anchors and proposal readiness.

`DiagramRevisionEditor.merge(baselineBindings, currentBindings, proposedBindings)` is a
conservative stub: any advanced/added/removed current diagram binding throws
`MERGE_REQUIRED`; unchanged targets return the proposed bindings without publishing.
Catalog saves invoke it when the expected saved canvas revision has advanced.
Concurrent composition changes also fail with `CANVAS_CONFLICT`. Automatic
three-way merge and alternative-generation UI are not implemented.

## Accepting a proposal

The preview's **Accept all changes** button and the MCP/HTTP tool
`accept_diagram_change_session({changeSessionId, expectedVersion, requestId})`
accept an entire ready session. Acceptance revalidates readiness, checks saved
canvas revisions and available live documents against the captured originals,
and rejects stale originals with `VERSION_CONFLICT` rather than merging them.
Agents must have an explicit user instruction to accept; marking ready is not acceptance.

`CanvasCatalogStore.acceptCanvasChanges` serializes publication with ordinary
catalog saves. It stages all affected canvases, then atomically writes their new
catalog revisions and a `changeSessionAcceptances[changeSessionId]` receipt.
`CanvasHistoryService.adopt` appends one checkpoint to each existing canvas's history,
preserving the proposal's exact diagram revision IDs, layout, edges and sections.
An entirely new canvas receives a saved representation ID.

The receipt records the accepted session version, request ID, timestamp, change
IDs, and for each document: saved representation ID, proposed checkpoint ID,
before `{revisionId, checkpointId}` (null for new canvases), and after
`{revisionId, checkpointId}`. Both before and after checkpoints can be resolved
from the after catalog revision's retained history, including legacy originals
that did not previously have a checkpoint. The before catalog revision describes
the saved original; the session baseline can also contain captured unsaved drafts.

After publication, the session becomes `accepted` and cannot be edited. Its
baseline, proposed state, annotations and history remain available for reviewing
the original diff. A failed final session write is recovered from the atomic
catalog receipt on the next read/retry; the same acceptance request never publishes
twice. The UI opens the published canvas without diff overlays, preserves newer
local edits, and keeps the accepted session in Changes. Other open browser
workspaces retain their drafts and ordinary saved-revision conflict protection.

The data needed for a future revert is persisted; a dedicated revert command/UI
is not implemented. Reverting after subsequent edits will need its own conflict
check. There is still no command-replay engine or partial acceptance.

## Generated variants and node continuity

The prompt composer can generate 1–4 independently retained alternatives for a
selected subtree or the complete diagram. Generation stores candidates without
changing live content. The Variants section supports naming, preview, refinement,
per-node accept/reject, application, and removal. Refinement advances just that
variant's head and resets its review decisions. Previous generated revisions
remain retained.

`DiagramRevisionReview` in `domain/core/diagrams/diagramRevisionReview.ts` stores optional review metadata:

- `diagramId`, `contentId`, and `ownerNodeId`: logical ownership; `root` denotes
  the complete diagram without requiring an extra visible ASCII node.
- `baseRevisionId`, `headRevisionId`, and `revisionIds`: immutable source,
  current candidate, and retained generated revisions.
- `decisions`: accept/reject keyed by stable logical node identity.
- `appliedRevisionId` and `appliedReview`: the last application and the exact
  candidate/decisions used, so later review changes can reverse prior changes.
- `id`, `name`, and `prompt`: the independently editable alternative's metadata.

Reviews live in `MappingGridDocument.revisionReviews`; independent presentation choices
live in `revisionSelections`. Both have per-entry checkpoint record boundaries.
`checkpointRevisionIds` includes selected/reviewed revisions as well as current placements, so detached candidates
survive workspace persistence, checkpoint publication, undo/redo, and ChangeSession
fork/acceptance. Variant-only proposal edits appear as document changes. Removing
a variant leaves ordinary retained history available; it does not erase history.

### Continuity protocol

`diagramEditRuntime.ts` supplies the generator with the base revision's `nodeRefs`
and requests `[[keep:logical-node-id]]` suffixes for retained nodes, including
renamed or moved nodes. `diagramNodeContinuity.ts` validates and strips these
annotations before source mapping validation and persistence. Unknown IDs,
duplicate claims, and claims that do not identify exactly one output node fail.
The selected subtree root must retain its logical ID. No label-matching heuristic
establishes identity.

`DiagramRevisionEditor` accepts the validated correspondence for both replacement
and patch operations. Unchanged lines outside a patch retain their existing
identities. `createDiagram`/`reviseDiagram` issue revisions and IDs; reviewed application
uses `deriveDiagram` to preserve proven identities from the base, candidate, and current
revision. Controller reconciliation uses that correspondence to retain connections,
highlights, selection identity, and folded branches during variant application.

### Selective application and rollback

`revisionChanges` compares labels, parents, and ordered children by stable node ID.
Pending and rejected changes retain the base state; accepted changes use the
candidate state. Additions, deletions, and moves can require matching parent/child
decisions. The review UI reports inconsistent structural decisions and blocks
application until they agree.

`applyRevisionReview` performs a three-way merge into the current subtree. Label, parent,
and child-list fields merge separately. Unrelated edits elsewhere, including
unrelated fields inside the subtree, are preserved. A competing edit to a field
being changed raises `VARIANT_CONFLICT`. No-content-conflict applications preserve
existing formatting when topology is unchanged; structural changes render the
reviewed subtree using canonical ASCII connectors and leave surrounding lines
untouched. After applying, change decisions and apply again to reverse selected
updates, subject to the same conflict checks. Undo/redo includes variant metadata
and applications.

The generation API's `variant: {name, count, variantId?}` option supports new
alternatives or refinement of one saved alternative. The canvas API provides
`nodes.variants({nodeId})` and `nodes.reviewVariant({nodeId, variantId, decisions?,
name?, remove?, apply?})`. Review mutations use the existing expected-version,
request deduplication, batching, and persistence mechanisms.

### Current boundaries

Candidates still hold complete diagram revisions with a validated subtree scope;
shared content is deduplicated by the persistence codec. Per-node review requires
a tree diagram. Unstructured diagrams support a whole-content review decision.
Formatting-only changes to a tree are not separate review hunks. Structural
application refuses layouts containing non-node prose that it cannot safely
reposition, rather than dropping that text.

Revision selections display retained alternatives directly, including nested subtree
choices, without applying a review. Current selections are scoped to the canvas
content key; separate placements sharing that key share the choice. Applying a
review to live content still performs three-way conflict checks. The existing
variant-named API commands remain compatibility entry points for review metadata;
`nodes.selectRevision` works without that metadata.

### Saved CanvasView diagram diffs

In **Canvas → Views**, select a saved view and enable **Show diagram diff**.
The preview compares the recording's start and final checkpoints, using the same
added/removed/modified/moved styling as ChangeSessions. It shows the net changes;
edits undone before the recording ends do not appear. Later live edits do not
change this comparison. The preview starts from the saved final positions
(deleted diagrams use their original positions), measures fully expanded diff
rows, and runs layout once before freezing the preview. This prevents overlaps;
folding, expanding, and each diagram’s **Regular / Diff** toggle keep those positions fixed. Opening the preview
preserves the live camera and does not alter the saved canvas layout.

Selected revisions (including nested subtree choices) are resolved at each
checkpoint. Preserved logical node references provide explicit correspondence,
including renamed nodes; nodes without that correspondence use the existing
rendering-only matcher. Deleted diagrams remain visible as removed preview boxes.
The result is computed locally and deterministically, without an LLM call.

Switching saved views updates the preview. Disable the toggle or choose **Close
diff** to return to the live canvas. Preview folds and navigation are local to the
viewer; opening a diff does not apply a view, issue diagram revisions, or create
an undo entry. **Apply view** retains its existing restore behavior.
