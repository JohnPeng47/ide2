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

All node changes in one execution commit as one undoable transaction. If execution or validation fails, none of those staged changes commit. Bootstrap operations (`canvas.attach` and `canvas.createDocument`) establish sessions/documents separately; create documents in an unbound call.

Retries with the same request ID and arguments return the same backend result; reusing an ID with different arguments is rejected. On a version conflict, read again and submit revised work with a new request ID. Backend restart ends sessions and clears request history. The backend currently bounds session/request history; a capacity error explicitly requires a restart rather than silently forgetting duplicate protection.

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

The browser test uses a disposable project and actual stdio MCP calls. It checks discovery, live reads, drawing/layout, duplicate requests, conflicts, rollback, pointer-driven undo/redo, standalone and whole-document saves, explorer/search visibility, and reload.
