For canvas editing, connect to the running app's MCP server and inspect its tools:

```sh
node --import tsx scripts/mapping/mcp.ts http://IP:PORT
```

## Diagram Upload
When uploading diagrams don't omit newlines

## Modifying the Canvas
Unless explicitly instructed by the user, do not use the ChangeSession to create changes
to the diagram.

### `exec` behavior

These rules apply to both live canvases and ChangeSession proposals:

- Methods inside `exec.code` are synchronous JS; use `return`, not `await`.
- Each document mutation commits immediately through the existing persistence
  path, with its own document version and undo step. Later calls see earlier edits.
  There is no final batch commit or rollback if a later operation or the script fails.
- Supply the current document `expectedVersion` when starting a mutating script.
  `exec` advances the version for subsequent edits automatically. A successful
  mutating response's `transaction.version` is the version after its last edit;
  `transaction` describes that edit, not an atomic batch. Attached read-only
  responses return `version` instead.
- Use a unique `requestId` for each new request. After a transport failure, retry
  the identical request with the same ID. Timeout retries replay completed API
  results and retry the unacknowledged step without duplicating edits; the script
  must reproduce the same API calls and arguments. Retry state is held in memory
  and does not survive a backend restart.
- After a script or validation error, reread the document to see which edits
  succeeded, then submit corrected work with its current version and a new
  `requestId`.

## Repository ownership

A project registers repositories, and each canvas has a `repositoryId`. Diagrams
inside a canvas inherit that ownership; their source mappings may still reference
other repositories. Git worktrees sharing a common Git directory use one repository ID.

- `list_repositories({})` lists IDs, names, identities, and checkout roots.
- `register_repository({path, name?, requestId})` registers a local Git repository or
  another worktree. Registration is idempotent by Git identity; it does not move
  canvases or change Git history.
- Live `canvas.createDocument({canvasId, name, repositoryId?})` accepts the owner.
  With one repository it can be omitted; with several, supply it explicitly.
- `canvas.copyDocument({... , repositoryId?})` inherits the source owner unless a
  destination repository is explicitly selected. `save_diagram` also accepts
  `repositoryId`; an already-owned saved canvas cannot change owners during save.
- Saved canvases and drafts retain ownership across reload, copy, transfer, and
  acceptance. A newly created transfer canvas inherits its source canvas's owner.
  Existing transfer destinations retain their own owner.
- Legacy canvases are assigned only when ownership is unambiguous; others appear
  under **Unassigned**. Supply an owner when saving an unassigned canvas.

## Diagram change sessions

Session edits persist
automatically and appear in the explorer's **Changes** tab. They do not modify the
original canvases. Do not call `save_diagram` for a proposal. To accept a ready
proposal, call `accept_diagram_change_session`
with its `changeSessionId`, session `expectedVersion`, and a unique `requestId`.
Acceptance publishes all changed canvases together and freezes the proposal while
preserving its review diff and before/after revision references. Retry the identical
acceptance request with the same ID after a transport failure.

### APIs to call

Top-level MCP tools:

1. `canvas-api-search({query})`: discover method parameters and examples. Use an empty
   query to list all canvas methods. Inspect top-level tool schemas through MCP.
2. `exec({code: "return canvas.list();", requestId})`: discover live workspaces.
   An optional smaller HTTP overview is available at `GET /api/mapping/live/context/short` with
   `workspaceInstanceId=<canvasId>` and `documentId` query parameters. It returns
   exact diagram ASCII, connections, source file/range references, and selection
   references. Choose short or detailed reads according to the task; neither is a
   required default. `detailsDeferred` identifies omitted detail categories. Use detailed
   node reads when you need the complete anchor index, captured source/selection text,
   or other omitted metadata. This endpoint reads live canvases only and does not
   support ChangeSessions; use the session-scoped APIs below for proposal state.
3. `create_diagram_change_session({title, description?, repositoryId?, commits?, head?, canvasId?, requestId})`:
   capture saved canvases plus live drafts owned by the selected repository. Specify the live `canvasId` if multiple
   workspaces are open. Returns `changeSessionId`, a session-scoped `canvasId`, and
   document IDs, `repositoryId`, `commits`, and `head`. Use the returned canvas ID for subsequent proposal calls.
   Specify `repositoryId` when multiple repositories are registered. `commits` is an
   explicit set of Git commit refs (default `[]`); noncontiguous selections are valid.
   `head` defaults to HEAD in the repository's first available registered checkout.
   Refs must resolve to commits in that repository; they are resolved to full SHAs,
   deduplicated, and pinned at creation. An unborn repository needs a commit first.
   Context is immutable even if checkout HEAD later advances. Existing sessions
   lacking this context remain readable and display it as unknown.
4. `exec({changeSessionId, requestId, code})`: call `canvas.list()` or
   `canvas.attach({canvasId, documentId})` within the proposal. Attach returns a
   `sessionId` and the document's current `version`.
5. `exec({changeSessionId, sessionId, expectedVersion, requestId, code})`:
   read/edit that document using the methods below and the `exec` behavior above.
6. `diagram-search({operation: "search", changeSessionId})`: omit `sessionId` to
   retrieve `changeSession.changes` and `changeSession.version` alongside search hits.
7. `update_diagram_change_session({changeSessionId, expectedVersion, requestId,
   changes, status: "ready"})`: annotate and validate the proposal. Submit the complete
   generated change list, preserving IDs and targets; set meaningful titles, reasons,
   and optional `dependsOn` change IDs. Type 1 can be reclassified as type 4.

Methods inside `exec.code`:

- `nodes.setSourceMappings({nodeId, expectedContentHash, mappings, evidence, source?})`:
  replace a diagram's complete mappings and captured evidence without changing its
  ASCII or anchors. Read `expectedContentHash` from `content.asciiSha256`. Omitted
  `source` preserves the binding. Also available as top-level MCP tool
  `set_diagram_source_mappings` with `sessionId`, `expectedVersion`, `requestId`,
  and `changeSessionId` for proposals. Empty mappings/evidence clears mappings.
- `nodes.list()` / `nodes.get({nodeId})`: read diagrams, raw `content.ascii`, and
  `content.structure.nodes` for edge anchors (use `Object.values(...)`). API nodes omit
  `diagram.content` and top-level `contentNodes`. Short anchor IDs are opaque,
  revision-scoped handles shared with live WebSocket context; reread after backend restart.
- `nodes.patchDiagram({nodeId, start, end, patch})`: modify existing ASCII lines.
- `nodes.draw({ascii, structureKind: "tree", parentId?, position?})`: add a diagram
  to the attached canvas. `nodes.replace({nodeId, ascii, structureKind?})` replaces one.
- `edges.create({source, target, appearance})` / `edges.list()` / `edges.update(...)`:
  connect diagrams. Source uses `kind: "content-node"`, `displayNodeId`,
  `contentNodeId`, and `revisionId` from current node reads. Target can be a content
  node or `{kind: "box", displayNodeId}`. Inspect schemas for appearance/side options.
- `canvas.createDocument({canvasId, name})`: create a new canvas in the proposal, inheriting its
  repository ownership, and return its attachment. Call from a separate `exec` with `changeSessionId` but no
  `sessionId`; then edit the returned document with its attachment.

Pass `changeSessionId` on every proposal-targeted call. `sessionId` identifies an
attached document; it is not interchangeable with `changeSessionId`. Edit calls use
the **document version**; `update_diagram_change_session` uses the **session version**.
Use a unique `requestId` per request; after a transport failure, retry the identical
request with the same ID.
Session history is available through `update_diagram_change_session` with
`action: "undo" | "redo" | "reset"` and `documentId`.

### Migration annotations

Migrations are session-level review metadata, separate from change types 1–4.
Do not reclassify type 2 (Add diagram) as a migration, put migration markers into
ASCII, or infer feature ownership from similar labels.

Read `changeSession.migrations` alongside `changes` and `version` through
`diagram-search({operation: "search", changeSessionId})` without `sessionId`.
For an original source removed by edits, read its captured baseline:

```js
diagram-search({
  operation: "read", changeSessionId, representationId: sourceDocumentId,
  snapshot: "baseline"
});
```

`snapshot` accepts `baseline` or `proposed` (default). It requires
`changeSessionId` without `sessionId`, supports both search and read, and does not
select catalog revisions. New canvases have no baseline. Read current destination
anchors with `snapshot: "proposed"` or attached `nodes.get`.

After content edits, call the top-level metadata tool with the session version:

```js
update_diagram_change_session({
  changeSessionId, expectedVersion, requestId,
  migrations: [{
    id: "U", title: "Mounted live undo/redo",
    description: "Live undo/redo ownership moves to the Editor; domain checkpoints remain in the controller.",
    kind: "feature-ownership",
    source: {
      documentId: sourceDocumentId, displayNodeId: sourceNode.id,
      contentNodeId: sourceAnchor.id, revisionId: sourceNode.content.revisionId,
      snapshot: "baseline", scope: "node"
    },
    destination: {
      documentId: destinationDocumentId, displayNodeId: destinationNode.id,
      contentNodeId: destinationAnchor.id, revisionId: destinationNode.content.revisionId,
      snapshot: "proposed", scope: "node"
    }
  }],
  status: "ready"
});
```

- `migrations` replaces the complete list; omission preserves it; `[]` clears it.
  `changes` remains independently optional; if supplied, include every generated change.
- `kind` is `code-organization` or `feature-ownership`. IDs must be unique per session.
- Source `snapshot` may be `baseline` or `proposed`; destination must be `proposed`.
  Choose proposed for a surviving source whose revised label describes delegation.
- `scope` is `node` (default) or `subtree`. Endpoints use session document IDs,
  display-node IDs, and exact revision-bound content-node IDs. Short API handles
  and full IDs are accepted; handles expire on backend restart, so reread anchors.
- An unchanged destination needs no artificial text edit. Migration entries expose
  both canvases in the explorer even when only one has generated content changes.
- Endpoints are validated when annotations are supplied and again on ready/accept.
  Later content edits or undo can make proposed endpoints stale; the preview flags
  them. Reread and replace annotations with a new request ID/current session version.
  Document undo/redo/reset preserves migration metadata; it does not undo annotations.
- Migration sources use muted blue/dashed outlines; destinations use stronger
  blue/solid outlines. Original sources remain reviewable as baseline excerpts.
  Accepted sessions retain the annotations and original review snapshots.

### Four change types

These may coexist in one session; edits to the same canvas share one proposed copy.

1. **Modify existing diagram** (`type: 1`): `reasons: ["1a"]` when existing content
   becomes incorrect; `["1b"]` when extending its current scope; both when applicable.
2. **Add diagram to existing canvas** (`type: 2`): the addition fits the canvas scope
   but merits its own diagram. Connect it with an incoming edge from a content node
   that existed in that canvas's baseline. This is required for `ready` validation.
3. **Add new canvas** (`type: 3`): the change exceeds the scope of existing canvases.
   Create a session-local canvas and populate it with the required diagrams.
4. **Major update to existing diagram** (`type: 4`): a substantial structural rewrite
   is necessary and types 1–3 cannot adequately represent the change. Edit/replace
   the diagram and reclassify its generated modification record as type 4.

### `nodes.patchDiagram` format

- `start` and `end` are **1-based, inclusive lines in that diagram's current raw
  `content.ascii`**, not composed canvas rows or folded display rows.
- `patch` replaces that entire line range with plain ASCII text. Include indentation
  and branch characters (`|--`, `` `-- ``, etc.). Use spaces, not tabs; newline
  escapes in the JS/JSON request must decode to actual newlines in the string.
- Do not include Markdown fences, `**` markers, diff prefixes, or color instructions.
  The preview computes node highlighting from the baseline and proposed content.
- `patch: ""` deletes the range. A trailing newline adds a blank line. To append,
  replace the last line with that original line plus a newline and the added text.
- Later patches see earlier edits. For ranges calculated from one snapshot, apply
  them from bottom to top, or reread and recalculate after each edit.
- Patch only what needs changing. Untouched anchors/mappings can be rebased; edited
  anchors may become stale. Reread nodes and repair affected edges before marking ready.

Example inside `exec.code` (replaces lines 3–4 with two complete lines):

```js
return nodes.patchDiagram({
  nodeId: "grid:overview",
  start: 3,
  end: 4,
  patch: "|-- ChangeSessionService\n|   `-- proposed document controller"
});
```
