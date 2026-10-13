# Agent diagramming

Start Mapping normally and open its Mapping page. Start the stdio MCP adapter with the running app's URL:

```sh
npm run mcp:mapping -- http://127.0.0.1:5173
```

For an agent host that launches MCP servers directly, use `node`, arguments `--import`, `tsx`, `scripts/mapping/mcp.ts`, and the backend URL, with this repository as the working directory. The adapter writes only MCP messages to stdout. It forwards calls to the existing backend, so catalog writes and live canvas sessions share one backend instance.

## Tools

- `diagram-search`: `operation: "search"` accepts `mode: "text" | "node" | "code-reference"`, `query`, `offset`, and `limit`. `operation: "read"` returns full content using a saved `representationId` (optionally `revisionId`) or a live `sessionId` and `nodeId`.
- `canvas-api-search`: returns matching API descriptions, JSON schemas, and examples. It searches documentation, not drawn objects.
- `exec`: runs JavaScript with only `canvas` and `nodes` APIs. Calls are synchronous; use `return`, not `await`. No DOM, filesystem, network, Node globals, or module loader is exposed. Execution has memory, instruction, result-size, and API-call limits.
- `draw_diagram`: takes completed printable ASCII, optional mappings/evidence, a `sessionId`, `requestId`, and `expectedVersion`. Omit `nodeId` to insert; provide it to replace a diagram. Content determines size and the existing grid algorithm resolves collisions.
- `edit-diagram`: takes a prompt and a live diagram base revision; returns an asynchronous generation run. Poll `edit-diagram-status`, or cancel before application with `cancel-diagram-edit`. See [Prompt-driven diagram edits](#prompt-driven-diagram-edits).
- `save_diagram`: publishes a confirmed (`settled`) representation. Omit `nodeId` to save the document; provide it to save one diagram independently. Supply `representationId` and `expectedRevisionId` when updating a previously saved independent diagram.

## Workflow

Each `exec` call needs a unique `requestId`. First discover a live page:

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

Each node or edge mutation commits immediately, advances the document version, and creates its own undo entry. Later calls see earlier committed edits. If execution or validation fails, earlier successful edits remain; only the failing operation is rejected. Supply the initial document version as `expectedVersion`; the service advances its expected version after each successful edit. A concurrent edit causes the next mutation to fail with a version conflict. The response retains `transaction`, which now describes the last individual edit rather than an atomic script-wide batch. Bootstrap operations (`canvas.attach`, `canvas.createDocument`, and `canvas.copyDocument`) establish sessions/documents separately; create or copy one document per unbound call.

Retries with the same request ID and arguments return the same backend result. After a canvas transport timeout, the backend replays completed API-call results and resends the unacknowledged operation with its original ID and version, avoiding duplicate edits. Retry scripts must reproduce the same API-call sequence; changed calls are rejected. A normal script error is retained for that request ID; read the current canvas and use a new ID for revised work. Reusing an ID with different arguments is rejected; on a version conflict, read again and submit revised work with a new request ID. Backend restart ends sessions and clears request history. The backend currently bounds session/request history; a capacity error explicitly requires a restart rather than silently forgetting duplicate protection.

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

Projection happens before each `exec` method result enters the script, so reads,
mutations, and subsequent reads use the same format within one script. Mutation
`transaction.nodes`, top-level draw/mapping responses, and search DisplayNodes use
the same projection. Stored documents and controller APIs retain their canonical
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

DiagramService issues one child revision with the same diagram identity. The
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
