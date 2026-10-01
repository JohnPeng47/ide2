# Diagram and canvas ownership

`DiagramService` is the content boundary. Its public API has five methods:

- `create(input)` creates a diagram and issues its first immutable revision.
- `getRevision(revisionId)` returns a frozen revision, including the complete `Diagram`.
- `listRevisions(diagramId)` returns revision identities and parent relationships.
- `revise(baseRevisionId, edit)` issues a revision from an explicit base. Supported edits are replacement, line patches, source mappings, and jumps.
- `generate(request, options)` calls the configured agent, validates its output, and issues a revision. Progress and cancellation pass through to the agent adapter.

`Diagram.diagramId` identifies a diagram across revisions; `Diagram.id` remains its local canvas content key. Independent canvases can both use `overview` without mixing their revision lists.

Local revision creation is synchronous so canvas commands remain synchronous. Agent generation is asynchronous. The existing workspace/catalog persistence adapters flush the immutable diagram records before publishing their owning document. Creating an in-memory revision alone does not write a catalog or publish a canvas.

Canvas code reads the complete `Diagram`, including parsed nodes, subtrees, mappings, and evidence. These types are deeply readonly and published objects are recursively frozen. A service-issued revision identity connects the diagram to its immutable record. Canvas commits reject an altered copy of that record; casting away readonly or cloning a snapshot does not provide a content-edit path.

`CanvasHistoryService` owns editing contexts, canvas checkpoints, navigation, reset, fork/adopt, and transfer coordination. Its checkpoints bind local diagram IDs to service-issued revisions and retain the records needed for portable persistence. It does not create diagram content revisions. Rendering, geometry, folding, and placement remain canvas concerns. Read-only previews and searches use the display model directly and do not open editing contexts.

The generation UI inserts the revision returned by `generate` into the canvas with its original identity. Normal edits, collapsed summaries, copied diagrams, and independent MCP saves also use `DiagramService`. The raw diagram factory is internal.

Saving a canvas requires supplied history matching its scene and edges. There is no history-construction fallback at save time. Retired ASCII, single-diagram, and mapping-canvas catalog payloads are rejected by runtime loading. Current diagram records require service-issued revision identities; old stored data requires an explicit offline conversion. The app does not migrate or overwrite it on load.

The [offline storage migration](../guides/diagram-storage-migration.md) upgrades catalogs, retained workspaces, and ChangeSessions together, preserving existing revision and checkpoint references. It stages and verifies a complete copy before replacing a stopped app's store and retaining the original as a backup.
