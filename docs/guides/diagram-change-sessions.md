# Diagram change sessions

The originating agent creates and edits a persisted proposal; no second agent is involved.
Original documents and their saved catalog revisions remain independent. In Mapping,
open **Changes**, expand a session and canvas, and select a change to preview it.
The unified preview shows proposed content with deleted text inserted in place.
The **Diagrams** explorer tab restores the working view, including its unsaved draft. Preview supports pan, zoom, local subtree
folding, label outlines and measured connections. It has no catalog Save or editing
controls. A ready proposal can be accepted as a whole; its review snapshots and migration annotations remain available afterward.

Preview highlights text only in diagrams classified as Modify (type 1), showing the
cumulative difference between the captured baseline and the current proposal.
Added nodes within a modified diagram are green, edited labels amber (previous/current
rows), removed node labels red in the same view, and moved/reparented nodes outlined
blue. Deleted rows preserve indentation and branches without highlighting them. They
have no live anchors or links and fold with their surviving ancestors. Unchanged ancestors get a dotted
underline when they contain changes, including when collapsed. Highlights are always shown.
Backgrounds and outlines preserve character positions and connection geometry.

The diff is derived and cached by the current document snapshot; it is not saved in
the diagram or session. Exact patch provenance, subtree shapes, parent context and
sibling order identify corresponding nodes despite revision-dependent IDs. Ambiguous
replacements appear as additions/removals; these visual matches never reattach edges.
Undo, redo and subsequent patches recompute against the same baseline. Reverting to
baseline clears the highlight. Add diagram (type 2), New canvas (type 3), and Major
update (type 4) render without automatic text-diff highlighting, even alongside modified diagrams. Explicit migration annotations apply independently of those classifications.

## Shared MCP editing API

1. Call `create_diagram_change_session({title, requestId, canvasId?})`. It returns
   `changeSessionId`, a session canvas descriptor ID, document IDs and version.
   All settled representations owned by the selected repository are pinned. An open workspace's drafts
   override their saved versions. Specify `canvasId` when multiple project workspaces
   are open; ambiguous capture is rejected. Unopened canvases use saved revisions.
2. Pass `changeSessionId` on every session-targeted `exec`, `diagram-search`, and
   `draw_diagram` call. Use `canvas.list()` then `canvas.attach()` as usual. The returned
   attachment `sessionId` is different from `changeSessionId`; the latter scopes all
   operations, the former selects one document. Attachments expire on server restart;
   reattach to the persisted session. Omitting or mismatching scope is an error.
3. Edit through the same `nodes` and `edges` APIs. `canvas.createDocument()` creates
   a session-local canvas; it creates no normal catalog representation. Backend
   session documents do not require an open browser.
4. Read generated change records and the session version through `diagram-search`
   with `changeSessionId`. Session-specific `update_diagram_change_session` annotates
   those records, manages status/history, and never accepts or saves originals.

Example `exec` code (with its attachment, changeSessionId, expectedVersion and requestId):

```js
return nodes.patchDiagram({
  nodeId: 'grid:overview', start: 2, end: 4,
  patch: '|-- Updated branch\n|   `-- Detail'
});
```

Line ranges are 1-based, inclusive, and refer to raw ASCII in the current
proposal. Each call commits and persists separately and sees previous calls, so use descending line ranges
when preparing several patches against one baseline. Empty text deletes the range;
a trailing newline in replacement text adds an empty line. Other whitespace is
preserved and CRLF is normalized. Empty/invalid diagrams and invalid ranges fail
without changing the document; earlier successful calls in the same script remain. Identical patches preserve the content revision. Shared content updates
all GridBox instances displaying it.

Mappings on untouched lines shift; mappings intersecting the replacement are removed.
Evidence and source binding remain. Untouched source jumps, folded node identities,
and edge anchors are rebound by exact positional correspondence. Edited edge anchors
remain stale and edited source jumps remain inactive until repaired. Incoming jump
targets from other canvases are not automatically rewritten. Section boundaries that
cannot be projected are removed. Undo restores the complete prior document and view.

## Session metadata and history

Generated changes identify modified diagrams (type 1), new diagrams on existing
canvases (2), and new canvases (3). A modification can be classified as a major update
(4) by annotation. Supply the complete generated list, preserving IDs and targets,
to annotate titles, reasons (`1a`, `1b`) and dependencies:

```js
// A top-level session-specific MCP tool, not a nodes/edges operation:
update_diagram_change_session({
  changeSessionId, requestId, expectedVersion,
  changes, status: 'ready'
});
```

Ready validation rejects stale edge anchors, missing/cyclic dependencies, and added
diagrams without an incoming edge from a node that existed in the baseline canvas.
Node provenance survives exact untouched-line patches; a new label on an existing
box is not sufficient. Source-jump problems remain visible as inactive jump metadata.
Drafts can be previewed before ready validation. Editing a ready session returns it
to draft. Status `archived` removes it from the active list and prohibits further edits.

The same session-specific tool accepts `action: 'undo' | 'redo' | 'reset'` and
`documentId`, guarded by the session's `expectedVersion`. History is per document
and persists up to 50 prior states. Reset returns an existing canvas to its captured
baseline; a newly created canvas has no original baseline. Individual edits are separate commits. `accept_diagram_change_session` publishes all changed canvases together and freezes the proposal.

Sessions use atomic manifests under
`.diagrams/mapping-change-sessions/<projectId>/<changeSessionId>.manifest.json`, with
immutable records for baselines, proposals, history and receipts. Older embedded JSON records remain readable.
Session edits persist automatically there; they do not save the catalog or workspace.
`save_diagram` explicitly rejects a change-session target. API documentation remains
unscoped through `canvas-api-search`. Display measurements are reconstructed in the
browser and never written to proposal documents.

## Paired migrations

`update_diagram_change_session` accepts an optional `migrations` array, independently
of `changes`. Supplying it replaces all migration annotations, omission preserves
them, and `[]` clears them. Existing sessions default to no migrations. A record has
`id`, `title`, `description`, `kind` (`code-organization` or `feature-ownership`),
`source`, and `destination`. Each endpoint contains `documentId`, `displayNodeId`,
`contentNodeId`, `revisionId`, `snapshot`, and optional `scope` (`node` or `subtree`).
Source snapshots can be `baseline` or `proposed`; destinations must be `proposed`.
Migration kinds do not change the meaning of numbered types 1–4.

Read baseline anchors with `diagram-search` using `changeSessionId`,
`representationId` (the session document ID), `operation: "read"`, and
`snapshot: "baseline"`, without `sessionId`. The same snapshot option supports
search; omitted snapshot means proposed. It is not supported on live/catalog reads.
Short anchor handles are accepted by annotation updates, resolved before persistence,
and returned by MCP reads. HTTP session/preview records retain full anchor IDs.
See [AGENTS.md](../../AGENTS.md#migration-annotations) for a complete request example.

Both endpoint references must resolve exactly when supplied and at ready/accept.
The preview flags stale references after subsequent edits; refresh annotations to
repair them. Document undo/redo/reset preserves annotations and may restore an
endpoint's original revision. Annotation edits return a ready proposal to draft
unless the same request successfully validates it as ready again.

The explorer displays a single migration with Source and Destination actions, even
when the destination has no text change. Navigation reveals and focuses the selected
node; removed sources remain available as original-text excerpts, including removed
diagrams. Source labels have muted blue fills and dashed borders; destinations have
stronger blue fills and solid borders. Explicit subtree scope includes descendants.
Added/modified text keeps its diff fill with blue migration borders, and the review
panel supplies role labels and counterpart links. Ordinary inferred within-diagram
moves keep their existing outline. These decorations never alter ASCII, mappings,
connections or saved content, and accepted reviews retain the pairings.

## Repository and commit context

Each new session belongs to one registered repository. Create it with optional
`repositoryId`, `commits` (an explicit array of Git commit refs), and `head`. A sole
registered repository can be selected implicitly; multiple repositories require an
ID. Omitted commits means an empty selection. Omitted head resolves HEAD from the
repository's first available registered checkout. Resolve a specific worktree's
commit explicitly when that differs from the desired head.

The server resolves refs to full commit SHAs, deduplicates the selection, and pins
all three fields at creation. Commits need not form a contiguous range. The context
is returned in create, summary, search, full-read, preview, and acceptance responses.
Changing the checkout or restarting the backend does not change an existing session.
Use a new session to review a different repository or commit context.

Capture filters both saved canvases and live drafts by ownership. New proposal
canvases inherit it, and acceptance retains ownership on published canvases. The
explorer groups Diagrams as repository → canvas → diagram, and Changes as repository
→ session → canvas → change. A session shows its pinned head and selected commits.

Legacy sessions remain readable without fabricated historical SHAs. They appear
under Unassigned with an unknown-context message. Legacy canvases are backfilled
when their repository can be identified; mixed or ambiguous ownership remains
unassigned. Source mappings are independent of canvas ownership.

Use `list_repositories` and `register_repository` to discover/register local Git
repositories. Linked worktrees share the canonical common-directory identity.
The repository records are persisted in the project's `repositories` collection;
canvas records store their `repositoryId`. See [AGENTS.md](../../AGENTS.md#repository-ownership)
for the creation/copy/save API rules.

## DiffTree backend API

A session owns its review tree as a normal `Diagram` revision, with typed
node-to-hunk mappings and immutable captured Git hunks. New repository-scoped
sessions initialize this data; legacy sessions remain readable without it.
`DiagramService` owns tree creation/replacement, logical node identities and
content validation. Source-code panels and DiffTree share node-selection and
ancestor-resolution logic.

Open **Changes → a session → Diff tree** to review captured hunks. The workspace
WindowPanel stays open over live and proposal canvases, independently of explorer
navigation. Layout, selection, folds, wrapping and scroll positions are remembered
per review in the current browser tab. Click or scroll focuses a pane (including
clicks handled by child controls); its border is highlighted. **Minimize** keeps
that pane in a window on the right, initially 40% wide; **Restore** restores the prior layout.
Drag the left edge, bottom edge or bottom-left corner to resize either view; the
compact width is remembered separately from the expanded width. Focus an edge
and use arrow keys to resize with the keyboard. Panel size and minimize/restore
never resize the underlying canvas viewport or change its camera.

The client prefetches all hunk pages, reading independent pages concurrently, and
shares the immutable patches across panes and canvas switches. Selecting a tree
node filters this cache, including the union of its descendants or a nearest
explicit ancestor mapping. **All changes** shows every captured hunk. Scroll
tracking uses an amber highlight, separate from the blue clicked tree selection.
Tree destination arrows and hunk clicks reveal the mapped proposal diagram through
the shared inter-node navigation. Unmapped hunks report that no destination exists.

Tree labels and diagram gutters show added + deleted application-code lines and
percentage of the review's application-code total. The numerator is a union of
hunk IDs through containment and explicitly linked detail, so overlapping parents
and children count once. Tests, tooling, dependency manifests and context lines
are excluded. Counts are per captured commit, not a net diff of the commit range.
Hunk highlighting uses the shared tokenizer with separate before/after streams;
content comes from the session snapshot, independent of current worktree files.

Discover hunk IDs using `get_repository_diff_hunks`, then supply
`diffTree: {ascii, structureKind: "tree", mappings}` to
`create_diagram_change_session`. Each mapping has
`{id, source: {line}, targets: [{kind: "diff-hunk", hunkId}]}`. Initialization
validates the complete tree and mapping list before publication. Optional
`diagramTargets: [{representationId, displayNodeId?, contentNodeId?}]` use the same
identities as diagram jumps to associate a tree region with proposal content.
Descendant hunk nodes inherit these destinations. A navigation-only mapping can
have `targets: []` when it supplies at least one diagram destination; empty
mappings with neither kind of target are rejected. No associations are guessed
from labels. Omission creates
a default commit tree; an empty commit selection yields no hunks.

`read_change_session_diff_tree` reads the Diagram, logical nodes, mappings and a
page of captured hunks without loading canvas histories or consulting Git.
`nodeIds` resolves selected nodes through their nearest mapped ancestor;
`hunkIds` selects hunks directly. These filters are mutually exclusive.
Pagination uses `offset`, `limit` (default 50, maximum 100), `total`, `nextOffset`;
`includePatches: false` omits patch text. Discovery uses the same pagination.
Reuse returned full SHAs between discovery pages and creation.

`update_diagram_change_session` accepts
`diffTree: {expectedRevisionId, ascii?, mappings}` and session `expectedVersion`.
The revision ID is the Diagram service revision, not its content revision.
Mappings replace the entire list, using either raw ASCII `{line}` or logical
`{nodeId}` from the scoped read. Omitted ASCII preserves the Diagram revision;
replacement uses the normal Diagram revision service and conservative identity
rules. Explicit line mappings identify the new nodes after replacement.
Omitted DiffTree data is preserved. Invalid mappings and failed writes publish
nothing; completed request receipts survive restart.

Persistence keeps an immutable DiffTree blob reference alongside the session's
document and receipt references. The Diagram payload uses the shared diagram
record store. The manifest publishes tree data and its small summary atomically.
Canvas edits and unrelated metadata writes retain the existing tree reference;
lists and canvas previews never hydrate tree/hunk content. Accepted sessions retain
the frozen review data. Document undo/redo/reset does not undo tree metadata.

Each selected commit compares with its first parent, including noncontiguous
selections; root commits compare with an empty tree. Rename detection is disabled
(renames become delete/add); binary and metadata-only changes are explicit.
Empty selected commits stay empty; `head` is context, not an implicit diff range.
Capture limits are 2000 hunks, 8 MiB total patch text and 2 million characters per
patch. Hunks cannot be supplied or modified by callers.

See [the agent flow](../../AGENTS.md#changesession-difftree-flow) for the complete
creation, read, mapping-update, validation and acceptance sequence.

## Changed-LOC treemaps

Open **Changes → a session → Diff tree → Treemaps**. The Treemaps tab
provides full-width Files and Diagrams groupings, drill-down breadcrumbs, and
navigation back to a mapped canvas region by clicking its rectangle. The panel
minimizes to reveal the destination. Use **Zoom into region** to drill into a
selected diagram subtree; file directories still zoom on click. Source diffs
remain in the Hunks tab.

The file map sizes rectangles by additions plus deletions in the captured commits.
The diagram map divides each hunk’s changed LOC equally across all distinct mapped
nodes, including nodes in different diagrams. Duplicate links to the same destination
count once. Fractional weights are retained internally and only labels are rounded.
An **Unmapped** rectangle includes changes with no resolved destination, so both
maps total the same actual changed LOC. Binary and metadata-only hunks have zero area.
Tests and documentation count; context lines do not. Repeated edits across selected
commits count as separate activity, using the same first-parent captures as the DiffTree.

The diagram hierarchy comes from captured diagram content. Direct hunk mappings
use their explicit diagram destinations, or the nearest destination-bearing
DiffTree ancestor. A parent with its own hunks and weighted children has a
**Directly mapped here** portion. Parent subtotals add their allocated shares;
they do not create additional contributions. Broad mappings are not guessed onto
leaves. Destinations only in the baseline appear under **Previous revision** and
cannot navigate to a live content anchor. Unresolved targets are reported; a hunk
with no resolved targets goes into Unmapped.

Tooltips distinguish allocated LOC from the full shared hunk LOC and show how
many destinations share each hunk (a range when the counts differ). This is an
equal allocation of hunk attribution, not a precise partition of source lines.
The totals show actual LOC, LOC allocated to diagrams, unmapped LOC, and duplicate
LOC discounted. The API retains `rawMapped` for attribution before allocation and
`extra = rawMapped − covered` for the discounted duplication; `mapped = covered`.

`GET /api/mapping/agent/change-sessions/:id/treemaps` derives the view from scoped
DiffTree and preview reads of one session version. An optional `version` query
returns `null` when unchanged. This operation never calls an LLM, captures live
Git changes, edits diagrams, or saves new session data, and works with HTTP
agent mutations and AI generation disabled.
