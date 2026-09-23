# Diagram content and canvas histories

An editing `contextId` identifies a working history. It is independent of the
MCP workspace `canvasId`, attachment `sessionId`, catalog representation ID, and
ChangeSession ID. A proposal forks each captured document into its own context;
unchanged diagram revisions are shared by identity, while subsequent edits remain
isolated.

## Boundaries

- `domain/core/diagrams/diagramService.ts`: `DiagramService.resolve(contextId,
  diagramId)` returns a detached view with logical node IDs and no diagram revision
  field. `prepareEdit` and `prepareCreate` validate proposed content without
  changing the context head. Content, source bindings, mappings, evidence, and
  jumps all belong to the diagram revision.
- `domain/core/diagrams/canvasHistory.ts`: canonical `CanvasDocument` contains
  layout, diagram instances, connections, and sections. `StoredCanvasSnapshot`
  keeps its private `diagramBindings` beside that document. Content-node edges use
  logical node references; the canvas document does not contain `DiagramContent`
  or endpoint revision IDs.
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
coalescing); each save includes all checkpoints created during that interval.
Writes remain asynchronous, and failures appear in the page error display.
The existing project workspace file is still the persistence scope; this is not
a multi-workspace synchronization protocol. Explicit catalog Save publishes a
`canvas-history` revision containing the canonical checkpoint and diagram tables.
The existing atomic catalog write persists both together. Old `ascii`, `diagram`,
and `mapping-canvas` revisions remain readable. History bundles currently grow
without compaction and remain subject to the existing HTTP request-size limit.

## ChangeSessions and merge

`ChangeSessionService` captures saved documents plus live drafts, then forks their
histories. Proposal edits, undo, redo, and reset use the same controller/history
implementation and persist automatically in the session store. Older proposal
histories are migrated on mutation, preserving available undo and redo states.
Preview correspondence remains separate from exact patch provenance used for
logical anchors and proposal readiness.

`DiagramService.merge(baselineBindings, currentBindings, proposedBindings)` is a
conservative stub: any advanced/added/removed current diagram binding throws
`MERGE_REQUIRED`; unchanged targets return the proposed bindings without publishing.
Catalog saves invoke it when the expected saved canvas revision has advanced.
Concurrent composition changes also fail with `CANVAS_CONFLICT`. No automatic
three-way merge, ChangeSession acceptance UI, or alternative-generation UI is
implemented here.
