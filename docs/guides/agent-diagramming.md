# Agent diagramming

Start Mapping normally and open its Mapping page. Start the stdio MCP adapter with the running app's URL:

```sh
npm run mcp:mapping -- http://127.0.0.1:5173
```

For an agent host that launches MCP servers directly, use `node`, arguments `--import`, `tsx`, `scripts/mapping/mcp.ts`, and the backend URL, with this repository as the working directory. The adapter writes only MCP messages to stdout. It forwards calls to the existing backend, so catalog writes and live canvas sessions share one backend instance.

Keep that MCP connection open for the conversation. To bind a standalone host to one live document, append `--canvas <canvasId> --document <documentId>` (or set `MAPPING_CANVAS_ID` and `MAPPING_DOCUMENT_ID`). The adapter attaches once on the first scoped call and reuses the session, so subsequent calls omit `sessionId`. Agent Chat already provides a persistent connection bound to the canvas captured for each turn.

Common read and edit method schemas are supplied upfront. Agent Chat selects read or edit capabilities from its access setting; standalone hosts receive them in the `exec` tool description. Use `canvas-api-search` for additional methods rather than rediscovering common operations.

## Tools

- `diagram-search`: `operation: "search"` accepts `mode: "text" | "node" | "code-reference"`, `query`, `offset`, and `limit`. `operation: "read"` returns full content using a saved `representationId` (optionally `revisionId`) or a live `sessionId` and `nodeId`.
- `canvas-api-search`: returns matching API descriptions, JSON schemas, and examples. It searches documentation, not drawn objects.
- `exec`: runs JavaScript with only `canvas`, `nodes`, and `edges` APIs. Calls are synchronous; use `return`, not `await`. No DOM, filesystem, network, Node globals, or module loader is exposed. Execution has memory, instruction, result-size, and API-call limits.
- `draw_diagram`: takes completed printable ASCII, optional mappings/evidence, a `sessionId`, `requestId`, and `expectedVersion`. Omit `nodeId` to insert; provide it to replace a diagram. Content determines size and the existing grid algorithm resolves collisions.
- `edit-diagram`: takes a prompt and a live diagram base revision; returns an asynchronous generation run. Poll `edit-diagram-status`, or cancel before application with `cancel-diagram-edit`. See [Prompt-driven diagram edits](#prompt-driven-diagram-edits).
- `save_diagram`: publishes a confirmed (`settled`) representation. Omit `nodeId` to save the document; provide it to save one diagram independently. Supply `representationId` and `expectedRevisionId` when updating a previously saved independent diagram.

## Workflow

Each `exec` call needs a unique `requestId`. On an already bound connection, start with `return canvas.read({projectionType:"graph"});` and omit `sessionId`. On an unbound connection, first discover a live page:

```js
return canvas.list();
```

Attach to one of its documents, or create an unsaved document:

```js
return canvas.attach({ canvasId: "...", documentId: "..." });
// Alternatively:
return canvas.createDocument({ canvasId: "...", name: "Proposed design" });
```

The result supplies a `sessionId`. Pass it on subsequent tool calls. A new document starts with an editable `grid:overview` placeholder; replace it with the initial diagram.

To copy an existing live document, use a separate `exec` without `sessionId` or `changeSessionId`:

```js
return canvas.copyDocument({
  canvasId: "...", documentId: "...", name: "Design copy",
  expectedVersion: 12
});
```

The optional `expectedVersion` checks the source document when the browser creates the copy. This operation uses the normal command bridge and workspace/controller history machinery. It copies the current state, including unsaved ASCII (and blank lines), source mappings, connections, layout, folds, panes, and camera. Transient controls and pending conversation requests are reset. The result attaches to a new unsaved draft at version `0`, with a fresh undo baseline and no saved-representation identity. Editing, undoing, or saving the copy leaves the source unchanged. Workspace persistence retains the draft; `save_diagram` publishes it separately. Copies currently support live documents only.

Read current state:

```js
return nodes.list();
```

Use its document `version` as `expectedVersion` for mutations. For example, an `exec` can stage multiple changes:

```js
const diagram = nodes.draw({
  ascii: "Service\n+-- Read\n`-- Write",
  structureKind: "tree",
  position: { column: 0, row: 0 }
});
nodes.move({ nodeId: diagram.id, position: { column: 20, row: 5 } });
return diagram.id;
```

By default, consecutive node and edge mutations form an atomic batch with one version increment and one undo entry. Reads flush pending mutations before fetching committed state. `nodes.setSourceMappings` and `nodes.setJumps` also flush preceding mutations because they resolve current metadata. Successful script completion commits the final batch. An uncaught script error discards pending mutations; a validation or version conflict rejects an entire batch. Previously flushed batches remain committed.

Supply the initial document version as `expectedVersion`; the service advances its expected version after each successful batch. In-script mutations return queued handles `{id, nodeId}` or `{id, edgeId}` for dependent edits, rather than full nodes. Read a node when later code needs its committed content. The tool returns `{value, transaction: {version, receipts}}`. Receipts contain operation names and affected IDs; highlights also include their actual saved `highlightId`, color, status and `markdownUrl`. They describe the state at each batch commit, which later batches can supersede. Reuse the returned URL verbatim in Markdown links.

Use `nodes.highlight({nodeId, contentNodeIds: [firstId, secondId], color: "blue"})` to save one highlight spanning multiple nodes within a diagram. It has one ID, color and Markdown link; clicking the link focuses the group, and removing its ID removes every member. `contentNodeId` remains supported for one node; omit both fields for the whole diagram. Empty or duplicate target lists and supplying both fields are rejected. Repeating the same target set in any order recolors the existing highlight without changing its ID. Unchanged anchors rebase through edits; if any member becomes stale, the saved group is stale and is not rendered until refreshed. Agent Chat's `highlight-node` accepts the same target fields, and a selected-nodes reference produces one group.

Set `mode: "immediate"` on `exec` to retain individual commits, full node mutation results, and the legacy `transaction.nodes` response. Bootstrap operations (`canvas.attach`, `canvas.createDocument`, and `canvas.copyDocument`) establish sessions/documents separately; create or copy one document per unbound call. A configured bound adapter stays on its selected document; use an unbound connection for bootstrap operations.

Retries with the same request ID and arguments return the same backend result. After a canvas transport timeout, the backend replays completed API-call results and resends the unacknowledged batch with its original operations, request ID and version, avoiding duplicate edits. Retry scripts must reproduce the same API-call sequence; changed calls are rejected. A normal script error is retained for that request ID; read the current canvas and use a new ID for revised work. Reusing an ID with different arguments is rejected; on a version conflict, read again and submit revised work with a new request ID. Backend restart ends sessions and clears request history. The backend currently bounds session/request history; a capacity error explicitly requires a restart rather than silently forgetting duplicate protection.

## Compact node responses

Agent API nodes use `apiFormatVersion: 1`. `node.content` is the canonical diagram
content; `node.diagram` retains service identity, source context, and jumps, but
omits its duplicate `content`. The top-level `contentNodes` array is removed.
Use `Object.values(node.content.structure.nodes)` for anchors in both trees and
unstructured diagrams. Unstructured nodes come from the same derived interpreter
index as before. ASCII, whitespace, labels, spans, hierarchy, fold ranges, source
evidence, revision IDs, hashes, and geometry are preserved.

Content-node IDs are opaque short handles. The backend shares their registry
between MCP/HTTP operations and live WebSocket context, including attach and
refresh. Pass them unchanged into edges, subtree collapse, and diagram jumps.
Their scope includes the original full revision/hash identity; handles are never
reassigned. Existing full IDs remain valid inputs. Backend restart invalidates
short handles: reread before submitting new edits. Unknown handles fail with
`STALE_CONTENT_NODE`, and normal document-version and anchor validation still apply.
The bounded registry reports `ANCHOR_CAPACITY` rather than evicting/reusing IDs.

Read projections happen before results enter the script. Immediate-mode mutation
`transaction.nodes`, top-level draw/mapping responses, and search DisplayNodes use
the same projection. Default batched mutations return compact receipts instead. Stored documents and controller APIs retain their canonical
full IDs. A previously completed proposal request can replay its persisted receipt
after restart; its old handles are still expired and require a fresh read for edits.

## Prompt-driven diagram edits

Ctrl-click a node to toggle its subtree, including descendants. Clicking a selected
node removes that branch while preserving other selected branches, the selection
rectangle, and its position in selection order. Explicit node IDs determine highlights,
references, and copied content; the rectangle is a visual envelope. Ctrl-drag selects
rectangular regions. Whole diagrams and node
references can coexist in the same selection. Open **Actions → LLM [L]** (or press
**L**) to open the shared Search/LLM window on the right, aligned with Explorer. The **LLMs** Explorer
tab creates, switches, and dismisses independent prompt sessions. With no selection,
**L** reopens the active LLM session or starts a new Create diagram prompt. The shortcut
also works from Explorer and action menus, and leaves text entry alone. Closing the window
preserves drafts. Each automatic reference follows its selection: changing membership
updates the existing chip, and clearing the selection removes it. Manually inserted
references stay pinned. References freeze with the request during generation.

The LLM panel offers three modes:

- **Create diagram** generates one new diagram without requiring a selection.
- **Update subtree** targets the selected node and its descendants. The application
  rejects changes outside that raw line range and preserves unaffected mappings.
  Other selected nodes remain prompt references, without expanding the edit scope.
- **Extend diagram** requires selected nodes. Click the small green circle on the
  selection, move the cursor with the preview edge following it, then click empty
  canvas to place the origin. Escape cancels placement; the source selection stays
  visible. Generation adds one diagram and connects the selected nodes to it in a
  single undoable transaction.

Source mappings are optional. The current document/base versions are read on
submission. Selection changes do not redirect an in-flight request. A stale subtree
or extension source requires selecting a current node again. Cancellation is
available during generation; a retry after an ambiguous response reuses the original
request. Successful operations acknowledge workspace persistence.

`PromptComposerCoordinator` owns transient UI run state outside canvas history and
selection state. It does not set the document's legacy generation busy flag, so the
existing browser bridge can apply the issued revision. Runs are tracked in the UI
until page reload; installed revisions and undo history survive reload.


`edit-diagram` is a top-level MCP tool, also available as
`POST /api/mapping/agent/tools/edit-diagram`. It edits one diagram in an open live
canvas; it does not create a ChangeSession or publish a saved representation.

First attach using `canvas.attach`, then read the target with
`nodes.get({nodeId: "grid:overview"})` or `diagram-search` operation `read`.
Use the document version and **`node.diagram.revisionId`** from that read:
this is the immutable service revision ID, distinct from `node.content.revisionId`.

```json
{
  "sessionId": "<attachment sessionId>",
  "nodeId": "grid:overview",
  "expectedVersion": 12,
  "baseRevisionId": "diagram-revision-<uuid>",
  "prompt": "Add the persistence service beneath its owning controller",
  "requestId": "<unique request ID>"
}
```

The response contains `runId` and `status`. Poll `edit-diagram-status` with
`{"runId":"..."}` (HTTP: `POST /api/mapping/agent/tools/edit-diagram-status`).
`cancel-diagram-edit` accepts the same body.

The backend captures the base diagram, source evidence, mappings, and canvas
connections, renders the checked-in
[`edit-diagram.md`](../../infrastructure/mapping/agents/diagram-edit/prompts/edit-diagram.md)
template, and invokes the existing internal agent runtime. The agent submits the
complete ASCII and mappings through a validation tool; rejected candidates can be
corrected in the same run. No canvas edits occur during generation. Model/auth
configuration is shared with the existing runtime (`NEW_DIAGRAM_MODEL`);
`NEW_DIAGRAM_AGENT=fake` selects the deterministic test generator.

The Diagram domain operation issues one child revision with the same diagram identity. The
browser validates and installs that exact revision into its canvas history,
checks both the document version and base revision again, and acknowledges
workspace persistence. Installation creates one undo step. Undo, redo, and
workspace reload preserve the issued revision IDs. `save_diagram` remains the
separate operation for publishing the workspace to the saved catalog.

| Status | Meaning / next action |
| --- | --- |
| `generating` | Capturing context or running the agent; cancellation is available. |
| `applying` | Installing/persisting the issued revision; cancellation cannot undo it. |
| `completed` | Workspace persistence acknowledged. `result` includes `diagramId`, `previousRevisionId`, `revisionId`, `documentVersion`, and `unresolvedEdgeIds`. |
| `conflict` | The base/document changed. The canvas edit was rejected; reread and use a new request ID. A generated candidate, if any, remains in `generated`. |
| `failed` | Capture, generation, validation, or application failed; inspect `error`. |
| `cancelled` | Cancelled before application; no canvas edit. |
| `awaiting-acknowledgement` | Application may have happened, but persistence or transport acknowledgement failed. Resubmit the identical `edit-diagram` request to retry installation/flush without regenerating or duplicating the edit. |

Repeat the same request ID and arguments after a transport failure; changing the
arguments under that ID is rejected. Status reads return current state, not a
cached initial response. An edit can leave connections with stale content-node
anchors; `unresolvedEdgeIds` identifies those requiring repair with the existing
edge APIs. Box anchors and provably unchanged endpoints follow normal reconciliation.

Runs, unapplied/conflicted candidates, and retry receipts are in memory. Backend
restart ends these runs; browser reload ends its application receipts. After either,
reread the diagram before starting new work. Installed revisions are durable in
workspace history. This API requires an open browser canvas and updates one diagram per run.

## Object and layout contract

The public `DisplayNode` registry is derived from authoritative stores:

```text
DisplayNode
+-- layout: grid
|   +-- diagram/group
|   +-- grid:<boxId>
|   `-- cell geometry; participates in push-right layout
`-- layout: floating
    +-- selection/projection/conversation/detail
    +-- floating:<nodeId>
    `-- pixel geometry; never a grid obstacle
```

Insertion positions are parent-relative cells; `nodes.move` uses absolute canvas cells for GridBoxes. FloatingBox moves use pixels in the node's declared canvas/viewport coordinate space. Resolved bounds are returned by reads and transactions; no requested-size fit check is added.

FloatingBox placement preserves existing behavior: retained selections resolve against source GridBoxes; automatic projections follow their owner; conversations retain their existing canvas anchor/docking; details retain stored placement. Semantic source references do not imply new follow behavior. Stale selections retain their saved snapshot behavior.

Diagram content carries source, hash, revision, mappings, and optional parsed tree structure. Structured content is rebuilt on edits/saves and reused by tree rendering and indexing. Old workspace v1/v2/v3 records remain readable; the added draft identity and content metadata are optional v3 fields. Tree structure does not infer arbitrary graph nodes from unstructured ASCII.

## Subtree expansion

Diagram DisplayNodes expose `collapsible.subtrees`: each target includes its revision-scoped `contentNodeId`, label, source line, current expansion, and zero-based `visibleRow` (omitted when hidden by an ancestor).

```js
const diagram = nodes.get({ nodeId: "grid:overview" });
const target = diagram.collapsible.subtrees.find(target => target.label === "structure");
return nodes.collapse({ nodeId: diagram.id, contentNodeId: target.contentNodeId, collapsed: true });
```

Supply the current document `expectedVersion` to this `exec` mutation. Omitting `contentNodeId` keeps the existing whole-object collapse behavior. Branch buttons in Mapping use the same controller operation. Nested expansion choices survive ancestor collapse, undo/redo, and workspace save/restore. Fold state belongs to `canvas.diagramViews[displayNodeId]`; it does not modify saved diagram source or grid allocation. Content edits reset incompatible revision-scoped state.

Visible rows map back to source lines for selection and evidence. A selection spanning hidden lines must be expanded before editing/copying that region. Source-attached selection panes disappear while their source region is folded; they return when expanded. Existing parser limitations remain: only recognized non-leaf nodes get buttons, and folding uses the existing parsed ranges.

## Persistence and availability

An open Mapping page is required for live reads and edits. Each page registers separately; switching selection does not redirect a session. Disconnects produce explicit errors. Saved representation search/read does not require a page. Diagram save is separate from workspace save (open documents, placement, and camera state).

The custom local-agent header/token scheme is not used. This is a local stdio tool surface; MCP does not automatically authenticate unrelated application HTTP routes.

## Verification

```sh
npm run build
node tests/browser/mapping/browser-agent-diagramming-check.mjs
node tests/browser/mapping/browser-subtree-collapse-check.mjs
npx vitest run domain/mapping/workspace/__tests__/mappingDocumentController.test.ts domain/core/diagrams/__tests__/diagramContent.test.ts infrastructure/mapping/agent/__tests__
```

The browser test uses a disposable project and actual stdio MCP calls. It checks discovery, live reads, drawing/layout, duplicate requests, conflicts, partial failures, per-edit pointer-driven undo/redo, standalone and whole-document saves, explorer/search visibility, and reload.

### AgentContext for prompt-driven edits

`edit-diagram` accepts optional `agentContextId`, returned by an
`agent-context.upload` frame on an attached `/api/mapping/live` reader socket.
The upload identifies the originating agent with required `agentType` (such as
`codex` or `claude`) and `sourceSessionId`. See [the connected-agent upload
contract](live-canvas-api.md#upload-coding-agent-context) for the message format,
slicing, limits and retry behavior.

`AgentContext` owns parsing, branch selection, tool-pair validation, immutable
snapshots and `toPiMessages()` conversion. `AgentContextService` retains uploads
under the live workspace/document scope. `DiagramEditService` captures a snapshot
before launching the run and passes it through `DiagramGenerationRequest` as
`agentContext`; this plain-data boundary survives `structuredClone()`.
`PiDiagramEditRuntime` restores the object and uses the shared
`PiAgentRuntime.createSession()` helper to seed Pi's `SessionManager` before
session creation and the current edit prompt. Revision issuance, application,
undo and persistence continue through the existing flow.


### Reusable saved AgentContexts

Use `create-agent-context` from AgentChat or Mapping MCP to save explicit background
text (or a validated `AgentContextSnapshot`) to disk:

```json
{
  "name": "Codebase baseline",
  "description": "Shared facts for prompt experiments",
  "context": "The API layer delegates to application services; storage adapters implement domain ports.",
  "requestId": "b2d5a0a8-83a4-4e37-bd8e-642799c951ea"
}
```

The receipt contains `agentContextId`, `contentHash`, and summary metadata.
`list-agent-contexts({query?, offset?, limit?})` returns summaries and `nextOffset`;
`read-agent-context({agentContextId})` returns the complete snapshot. Creation
requires Workspace access; listing and reading work with Read only access. None
requires an attached canvas. Repeat identical arguments and the UUID request ID
to recover the same receipt, including after a restart. Different content or
metadata with that request ID fails. Saved contexts are immutable; create a new ID
to change one. This does not implicitly capture the current chat.

IDs beginning `saved-agent-context-` work across chats and canvases sharing the
application store. Records live under `<storeRoot>/agent-contexts/` and survive
restart. Legacy `agent-context-` uploads remain transient and canvas scoped.

Both generation workflows accept an optional `agentContextId`:

- Prompt-driven `create-diagram`, `edit-diagram`, and `extend-diagram` accept it
  on the single request or each batch operation. The Pi worker receives the saved
  messages plus the new prompt, with its existing configured model and tools.
  AgentChat's direct content-submission diagram tools still submit content themselves.
- AgentChat `gen-alternatives` accepts it alongside `viewId`, shared `prompt`,
  `alternatives: [{name, prompt}]`, and `requestId`. Candidates run concurrently
  in fresh native threads using the saved snapshot as reference material instead
  of the parent's conversation, triggering text, or selected references. Each
  inherits the parent's model, reasoning effort, access settings, and exact tool
  definitions. Without the ID, native conversation forking stays unchanged.

For example, after creating a saved context, call `gen-alternatives`:

```json
{
  "viewId": "<saved canvas view ID>",
  "agentContextId": "saved-agent-context-b2d5a0a8-83a4-4e37-bd8e-642799c951ea",
  "prompt": "Depict this codebase using the supplied background.",
  "alternatives": [
    { "name": "Layers", "prompt": "Organize by architectural layer." },
    { "name": "Flow", "prompt": "Organize by request flow." }
  ],
  "requestId": "prompt-experiment-1"
}
```

Generation records include `agentContextId` and `agentContextHash`, keeping
background identity separate from task prompts. Saved contexts may contain past
prompts as ordinary captured messages; there is no separate execution prompt
field on AgentContext. Reuse the ID with new prompts/request IDs for subsequent
experiments. Alternative generation still needs a saved parent view, a source
AgentChat with a user message, and a live canvas. This enables repeatable
candidate generation; it does not add automated comparison generation or judging.


### Source files in saved AgentContexts

Use typed constituents to include source without embedding another copy of its
text in each saved context:

```json
{
  "requestId": "b2d5a0a8-83a4-4e37-bd8e-642799c951eb",
  "name": "Save implementation",
  "context": [
    { "type": "text", "text": "Use this implementation as background." },
    {
      "type": "sourceFile",
      "sourceId": "<registered source ID or repository ID>",
      "path": "src/save.ts",
      "startLine": 20,
      "endLine": 80
    }
  ]
}
```

`sourceId` resolves through the application's registered project sources or
repository registry. Paths are relative to that source; traversal and symbolic
link files are rejected. Lines are 1-based and inclusive. Omit the range for the
whole file, or supply `revision` to capture a particular Git commit/ref. A ref is
resolved to its full commit SHA at creation. Without `revision`, creation captures
the working file: if its text matches HEAD it stores a Git reference; otherwise
it stores a shared immutable source blob. Non-Git files use the same blob store.

The saved version-2 snapshot contains `sourceRange` blocks with the path, source
identity, range and pinned version. Git content is read from that commit when
needed, with no separate copied source file. Dirty/non-Git contents live once in
`<storeRoot>/agent-context-sources/`, shared across contexts and ranges. Files
are limited to 2 MiB; expanded contexts retain the existing 2 MiB context limit.
Missing Git objects or unavailable repositories fail retrieval rather than
silently reading a different version. Editing the working file does not change a
saved context. Retrying an identical creation request returns its original
receipt even if the working file has since changed or disappeared.

Listing contexts reads metadata without resolving sources. `read-agent-context`
returns the compact `snapshot` and, for source-bearing contexts, a separate
`resolvedSnapshot` containing the selected source text. `contentHash` identifies
the compact immutable snapshot; `resolvedSnapshot.contentHash` identifies the
materialized messages. Pi resolves ranges before constructing model input;
AgentChat injects the resolved snapshot while recording the saved context's
original ID/hash. Composer recapture preserves source references in an unchanged
imported prefix instead of saving the expanded source text again.

New diagram-owned contexts also separate captured evidence ranges into shared
source blobs. These preserve the diagram's original evidence, even when the
current working file differs. Workspace export includes the selected ranges as
`sourceFiles` attachments, deduplicated within each context; import publishes
those blobs before saving compact references. Converting a Git/file reference
to a portable range snapshot gives the exported context a new descriptor hash. Version-1 contexts and plain text
remain supported. Existing opaque text/tool transcripts are not automatically
rewritten into source references. Native model transcripts still retain the
expanded input for auditing; this change reduces AgentContext storage, not the
model's token usage or its own transcript files.
