# Node, Diagram, and presentation boundaries

The old combined `DiagramService` has been removed. The filename of this guide is
retained for existing links.

## Contracts

- `domain/core/nodes/node.ts`: `Node<Kind, ContentRef>`, `NodeRelationship`,
  `NodePresentation<ViewState>`, and `DisplayGeometry`. A Node is a content
  container (a diagram, eventually a document or spreadsheet), not an ASCII tree
  subnode. These contracts contain no tldraw dependency or generic expansion flag.
- `domain/core/diagrams/diagramNode.ts`: `DiagramNode` pins a diagram revision;
  `DiagramPresentation` owns geometry and its specialized display/folding state.
- `domain/core/diagrams/diagramRevision.ts`: `createDiagram`, `reviseDiagram`, and
  `deriveDiagram` take explicit immutable inputs and return frozen revisions.
  They do not read a store, call an LLM, or publish a canvas.
- `domain/core/diagrams/diagramRevisionStore.ts`: runtime retention and lookup.
  Convenience commands explicitly compose a domain operation with retention.
  Existing disk adapters flush referenced records before publishing bindings.
- `application/core/diagrams/generateDiagram.ts`: asynchronous generator
  orchestration and validated submission. The browser has its HTTP workflow in
  `src/features/mapping/services/diagramGenerator.ts`. Controllers no longer
  receive a DiagramService instance.
- `domain/mapping/workspace/canvasNodeGraph.ts`: adapts canvas diagram containers
  and connections to the common graph without exposing geometry or internal
  diagram nodes.

`Diagram.diagramId` identifies the logical diagram; `Diagram.id` is a local
content key. A `DiagramRevision.id` is globally unique. Parsed node IDs belong to
one content version; `nodeRefs` carry proven logical continuity between versions.
Canvas commits still reject altered copies of issued revisions.

## Revisions, selections, and review

`DiagramRevisionSelection` pins a revision for the diagram root or a logical
subtree. Nested selections are scoped by their enclosing revision ID. Displaying
an alternative requires no variant object, mutable branch head, or review record.
`nodes.selectRevision` selects or clears a retained revision through the Canvas API.

`DiagramRevisionReview` holds optional naming, generation provenance, decisions,
and three-way application metadata over revisions. It is independent of content
and selection. Existing `variant` API operation names remain compatibility entry
points to this review workflow. Removing a review does not erase a revision or an
independent selection. Old checkpoint `variants` and `variantSelections` fields
are decoded into review metadata and pinned selections on read. The old records
are not rewritten in place.

Canvas history retains selected, comparison, context, and reviewed revisions as
well as ordinary content bindings. Undo/redo and CanvasView recording operate on
the complete document checkpoint.

## Syntax and highlights

`diagramSyntaxAnalysis.ts` classifies tokens, source-backed symbols, and paired
markers. It caches classifications for immutable diagram inputs and marker rules;
colors, layout, and React are excluded. `diagramMarkers.ts` implements literal,
same-line pairs such as `!! someFunction() !!`: whitespace is required inside the
pair, escapes are respected, longest markers win, and pairs do not nest. The raw
ASCII and source coordinates are unchanged.

`domain/core/presentation/diagramPresentation.ts` owns explicit highlights and
marker styles. `document.diagramPresentations[contentId]` persists these settings
in canvas checkpoints. Updating them issues no Diagram content revision. Legacy
revision highlights remain readable until that presentation's highlights are edited.

Highlights can target the whole diagram, logical nodes, or a revision-pinned text
range. Node highlights follow supplied/proven identities, including composed
revisions; missing identities stay stale. Text ranges remain pinned and are not
silently transferred to changed text. Copy/save adapters rebase proven targets
when creating an independent diagram. Project Highlights reads presentation data.

Example Canvas API call (inside `exec`, with the current `expectedVersion`):

```js
return nodes.setPresentation({
  nodeId: "grid:overview",
  settings: {
    markerRules: [{ id: "review", marker: "!!" }],
    markerStyles: { review: { color: "blue", underline: true } }
  }
});
```

Supplied settings fields replace those fields; omitted fields are retained.
`highlights` uses the existing IDs/colors/targets, or `revisionId` (the immutable Diagram
revision UUID) plus `textRange: {startLine, endLine, startColumn, endColumn}`. Coordinates
are 1-based and inclusive. Passing `highlights: []` clears annotations.

## Projection and diff

```text
Immutable DiagramRevision(s)
  + syntax classifications and evidence
  + revision selections and folding state
  + presentation highlights and marker styles
  |
  v
Shared text projection (domain/core/presentation)
  + source revision, logical nodeRef, line and column provenance
  + regular rows or deterministic before/after diff rows
  |
  v
Canvas/React adapter: placement, endpoints, controls, and themed spans
```

`diagramContentSnapshot` borrows immutable content and nodeRefs. Selection
projection composes source rows without issuing content revisions. Folding can
refer to logical nodes introduced by selected revisions. Syntax foreground,
marker overrides, and explicit highlight backgrounds coexist in text runs.

`compareDiagramRevisions` is a domain comparison; heuristic visual matches do not
establish node continuity. `domain/core/presentation/diagramDiffProjection.ts`
produces reusable diff rows without a canvas or store. Baseline text retains its
source styling and provenance but never registers a live connection endpoint.

CanvasView and ChangeSession use that projection through the canvas adapter.
Each diagram has Regular/Diff controls. The fully expanded comparison is measured
and laid out before freezing the preview; toggling and folding retain its prepared
bounds. Mode changes are local preview state and do not mutate the recorded view.

Caches and existing render selectors keep syntax work out of camera pan/zoom.
Composition/diff projection runs when its document or display inputs change;
this separation does not imply that generating a new diff has zero cost.

`CanvasHistoryService` continues to own canvas checkpoints, navigation,
fork/adopt, and transfer coordination. Historical pre-identity stores still need
the [offline storage migration](../guides/diagram-storage-migration.md).
