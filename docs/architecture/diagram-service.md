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

`DiagramAlternative` (in `domain/core/presentation/diagramAlternative.ts`) promotes
one or more pinned revision scopes into a named presentation choice. Each part has
an explicit target scope, source revision/scope, and base revision. Parts target
disjoint subtrees of one base snapshot; sources may come from different revisions.
Immutable revisions retain their real ancestry. Grouping does not invent a shared
parent revision or rewrite history.

`document.alternatives` has its own `schemaVersion: 1`, item table, selected IDs per
Diagram placement, and attached SidePanel records. Choosing an alternative swaps
all parts atomically, without modifying the bound Diagram revision. Nested choices
are scoped to a parent alternative. Overlapping choices must be explicitly replaced.
Selections for two placements of the same Diagram are independent.

`DiagramRevisionSelection` remains an internal composition adapter and legacy API
contract. `nodes.selectRevision` promotes/selects a pinned revision for its target
placement. New clients can use `nodes.alternatives`, `nodes.promoteAlternative`,
`nodes.selectAlternative`, `nodes.removeAlternative`, and `nodes.sidePanel`.
These methods share the usual version checking, batched transactions and undo.

`DiagramRevisionReview` retains optional generation provenance, decisions, and
three-way application metadata. An alternative can reference a review; review and
selection remain separate. Ordinary content revisions are never automatically
promoted. `edit-diagram` accepts `"presentation-alternative": {"name": "Choice",
"select": false}` with `"edit-mode": "variant"`, for both direct AgentChat payloads
and delegated generation, including batches. Omit the parameter to retain the
existing review-only behavior. Only the first candidate is selected when generating
several alternatives with `select: true`.

On Diagram selection, each visible alternative target shows inline swap and
SidePanel icons. A panel pins a particular part and attaches to the target logical
nodeRef. Its first line follows the live attachment row. Missing/folded attachments
hide the panel without erasing it. Panel controls offer regular/diff display,
flow/overlay placement, automatic side selection, part switching, and close.
Opening compares overlap area, collision count and connector crossings; right wins
ties. The persisted side stays fixed until explicitly auto-placed or reopened.
Flow panels reserve layout space; overlays leave neighboring geometry unchanged.
Panel syntax, evidence and annotations use the shared Diagram presentation projection.

Canvas history pins alternative source/base revisions and persists items, choices
and panels in independently addressed records. Undo/redo and CanvasViews restore
that complete checkpoint. CanvasView diffs compose selections per placement.

### Migration

Legacy `variants` / `variantSelections` and `revisionReviews` / `revisionSelections`
are decoded on read. Named candidates become alternatives, anonymous selected
revisions get deterministic fallback records, and content-scoped choices expand
per placement. IDs are stable across checkpoints. Existing immutable records stay
readable and are never rewritten in place.

To materialize the migration across a complete on-disk store (including old undo
checkpoints and saved CanvasViews), use the offline command:

```sh
npx tsx scripts/migrations/migrate-diagram-alternatives.ts prepare /path/to/store /path/to/stage
npx tsx scripts/migrations/migrate-diagram-alternatives.ts verify /path/to/stage
# Stop the application before publishing. The command retains a backup directory.
npx tsx scripts/migrations/migrate-diagram-alternatives.ts publish /path/to/stage
```

Preparation writes new hash-addressed records and updates references only in the
staged copy. Verification reloads through persistence adapters and checks revision,
checkpoint and alternative references. Publication checks that both source and
verified stage are unchanged, then swaps directories with rollback on failure.

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

### Saved CanvasView ancestry

CanvasViews have stable IDs and immutable checkpoint references. `create` saves
the current canvas immediately; `save` advances the active view's saved endpoint
while retaining earlier checkpoint references. `fork` creates and opens a child
with `parentViewId` and a pinned `forkCheckpointId`. The explorer presents those
parent/child relationships as a collapsible tree; individual checkpoint history
is not exposed in the UI.

`gen-alternatives` is the AgentChat generation tool. It accepts `viewId`, a shared
`prompt`, `alternatives: [{name, prompt}]` (1–8), and a unique `requestId`.
The Canvas explorer's Generate alternatives form exposes the same operation,
with a source AgentChat selector. The older `canvas-view` operation
`alternatives` remains available for creating empty copies without generation.

Generation pins one saved parent checkpoint and runs managed child AgentChat
threads in parallel. Native thread forks inherit prior conversation context,
model, reasoning effort, and tools; each child receives its own canvas and MCP
binding. The calling agent only invokes `gen-alternatives`. Child goals are
cleared so each candidate ends with its managed turn. Nested generation is
blocked. Finished results become saved child views without changing the live
canvas. Generated chats remain available for review.

Each view records the source/child chats, triggering/shared/candidate prompts,
model, reasoning effort, status, elapsed duration, and attributed token usage.
Explorer badges distinguish queued, generating, finished, failed, and cancelled;
details link to chats and support cancellation. Results are retained server-side
if the source browser disconnects and published when it reconnects. Server
restarts mark interrupted work failed rather than silently spending more tokens.
Retrying the same request does not launch another group.

`open` retains the outgoing view's working checkpoint and resumes the incoming
view's unfinished edits while preserving the camera. Both working copies and
the active view survive workspace reloads. Generating views are locked against
manual edits and group removal until completion or cancellation.

`keep` saves the chosen candidate and archives its group siblings and their
descendants, preserving the parent and unrelated forks. `discard` archives a
view and its descendants. Archived views retain their checkpoint references
and ancestry but are omitted from the explorer. These metadata changes follow
the existing CanvasView persistence semantics outside canvas undo. The same
versioned, retry-safe operations are exposed through AgentChat and Mapping MCP.
Legacy recording and diagram-diff controls remain under “Record changes.”

### CanvasView diff alternatives

`canvas-view` with `operation: "promote-diffs"` pins each matching diagram placement's recorded baseline and final revisions as an unselected root alternative (`display: "diff"`). Inline swap and SidePanel use the same diff row projection; regular-view folds do not truncate the comparison. Unchanged diagrams get an empty comparison. Added/removed placements without a revision pair are not promoted.

Promotion updates the live document in one undoable checkpoint and appends a new saved CanvasView endpoint containing the alternatives. Original checkpoints and content revisions remain immutable. Applying the saved view or reloading retains the alternatives. Deterministic IDs make repeat promotion idempotent; existing content alternatives remain separate. CanvasView metadata follows its existing persistence semantics outside undo.
