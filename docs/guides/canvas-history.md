# Diagram content and canvas histories

An editing `contextId` identifies a working history. It is independent of the
MCP workspace `canvasId`, attachment `sessionId`, catalog representation ID, and
ChangeSession ID. A proposal forks each captured document into its own context;
unchanged diagram revisions are shared by identity, while subsequent edits remain
isolated.

## Boundaries

- `domain/core/diagrams/diagramService.ts`: the injected `DiagramService` owns
  editing contexts, content preparation, history navigation, and calls to diagram
  persistence. `openContext` returns an opaque runtime handle. `resolve(handle,
  diagramId)` returns a detached view with logical node IDs. Handles isolate even
  two viewers restored from the same persisted context; local diagram IDs such as
  `overview` are scoped to a context rather than treated as global identities.
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
  producers and uses the same checkpoint path. `transact` remains an adapter for
  the existing atomic MCP batch contract.

`getCanvasSnapshot()` and `resolveDiagram()` expose the new read interfaces.
Existing rendering, source-selection and MCP consumers still use the materialized
`getSnapshot().document` / `nodes()` adapters. These legacy adapters retain embedded
content and revision-bearing endpoints. They are not the canonical persisted canvas
model. Prepared edits likewise carry a legacy diagram payload for the coordinator.
Do not add new consumers that depend on those legacy revision fields.

## Checkpoints and persistence

A diagram edit allocates an immutable UUID revision with its previous diagram
revision as parent. Layout/edge-only edits reuse diagram bindings. Canvas checkpoints
have separate IDs and parents. Undo/redo moves the context head; editing after undo
retains the abandoned snapshots and diagram revisions. Reset appends a checkpoint
referencing the captured baseline bindings rather than synthesizing new diagrams.
Camera, selection and measured geometry updates do not create content revisions.
Personal view state is stored separately from each checkpoint's canvas document.

The live page queues automatic workspace saves after checkpoint changes (150 ms
coalescing). Writes remain asynchronous, and failures appear in the page error
display. The controller coordinates composition and diagram edits; no separate
CanvasService is introduced.

The app creates one `RevisionedDiagramService` and an unconnected `CodeRepoService`
contract implementation and injects them into `MappingPocPage`. A React provider
passes them to nested consumers. All live canvas controllers and proposal preview
controllers use the injected diagram service. Each controller has its own context.
CodeRepoService reports `available: false` and its methods reject explicitly until
an implementation is wired. Existing source APIs are unchanged.

### Disk layout and publication

- `canvases/catalog.json`: canvas catalog, composition checkpoints, and opaque
  diagram-history references. `CanvasCatalogStore` owns this file. The old
  `ProjectCatalogStore` is a compatibility facade that also retains compaction APIs.
- `diagrams/diagram/<sha256>.json`: immutable diagram content, source context, and jumps.
- `diagrams/revision/<sha256>.json`: immutable revision metadata, logical node
  identities, and a reference to its diagram record.
- `diagrams/history/<sha256>.json`: revision-record references and bindings for
  diagram checkpoints. Canvas snapshots refer to checkpoint IDs rather than
  carrying diagram bindings or revision tables on disk.
- Workspace and change-session files use the same references through DiagramService.
  Their materialized diagram objects are also externalized. Derived catalog exports
  and legacy saved-scene strings remain compatibility data, not revision storage.

DiagramService calls `DiagramRevisionStore` through a storage port. All referenced
records are persisted before atomically replacing the parent canvas/workspace/session
file. An interrupted save may leave unreferenced immutable records, but cannot
publish a pointer before its dependency is written. Record hashes are verified on
read, and missing records are errors. Garbage collection is not implemented.

Loading falls back to `representations/catalog.json` if the new canvas catalog is
absent. Legacy embedded histories remain readable. The next save writes the new
format without deleting or modifying the legacy catalog. Consumers should back up
the entire diagram directory, not just its catalog file.

HTTP responses and explicit workspace exports remain portable expanded documents;
compatibility adapters hydrate references before existing rendering and MCP code
sees them. Export/import therefore does not depend on the original store directory.
History bundles remain subject to the existing HTTP request-size limit.

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
`DiagramService.adopt` appends one checkpoint to each existing canvas's history,
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
