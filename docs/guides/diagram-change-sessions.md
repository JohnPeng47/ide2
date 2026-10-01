# Diagram change sessions

The originating agent creates and edits a persisted proposal; no second agent is involved.
Original documents and their saved catalog revisions remain independent. In Mapping,
open **Changes**, expand a session and canvas, and select a change to preview it.
The unified preview shows proposed content with deleted text inserted in place.
The **Diagrams** explorer tab restores the working view, including its unsaved draft. Preview supports pan, zoom, local subtree
folding, label outlines and measured connections. It has no catalog Save or editing
controls. Acceptance/merging is not implemented in this display-focused release.

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
update (type 4) render without text highlighting, even alongside modified diagrams.

## Shared MCP editing API

1. Call `create_diagram_change_session({title, requestId, canvasId?})`. It returns
   `changeSessionId`, a session canvas descriptor ID, document IDs and version.
   All settled project representations are pinned. An open workspace's drafts
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
baseline; a newly created canvas has no original baseline. There is no cross-canvas
atomic transaction or acceptance operation in this release.

Sessions are stored atomically under
`.diagrams/mapping-change-sessions/<projectId>/<changeSessionId>.json`, including
baselines, proposed documents, node provenance, history, metadata and retry receipts.
Session edits persist automatically there; they do not save the catalog or workspace.
`save_diagram` explicitly rejects a change-session target. API documentation remains
unscoped through `canvas-api-search`. Display measurements are reconstructed in the
browser and never written to proposal documents.
