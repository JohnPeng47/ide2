# Live canvas selection API (v2)

External clients bind to a live canvas, receive its selected diagram IDs and active regions once, and
then receive only additions, updates, and removals. The API reads an ephemeral
in-memory mirror; it does not load workspace documents, export history, or save
workspace state. No selection content is resent while regions remain unchanged.

## Diagrams, regions, and identity

The active set is derived exclusively from `canvas.selection.items`: whole-diagram
items become `diagramIds`, and items with a region become `regions`. Region IDs are
the selection item IDs, independent of panels and focus. Each diagram ID is
the exact display-node ID returned by `nodes.list()`, for example `grid:overview`.
Diagram selections contain no ASCII, source mappings, or diagram objects.
Whole-diagram selection replaces all selected regions belonging to that instance.
Their existing panels keep their context, but those regions no longer belong to
the selection collection and do not reappear on diagram deselection.
An explicit region action can activate a region again. Pointer drag previews are excluded.
Collapsing, hiding through diagram folding, or unfocusing a retained region does
not deselect it. Removing a retained region removes it from the set. Clearing a
non-retained selection removes that region; clearing focus leaves active retained
regions. Blank-canvas and outside clicks preserve selection membership. Explicit
deselection clears membership while preserving existing panels. Pointer previews do not change selection membership.

Each region has an opaque `id`, `sourceBoxId`, `sourceContentId`, a 1-based inclusive
`rect` (`startLine`, `endLine`, `startColumn`, `endColumn`), `text`, and `stale`.
IDs are stable within a canvas epoch, including when a draft becomes retained.
Treat IDs as scoped to the workspace, document, and epoch. Array order has no meaning.

`text` preserves the Copy ASCII + code refs format, rectangular padding, blank
lines, and deduplicated references. If a retained region's source ASCII changes or
its source disappears, `stale: true` identifies its saved selection: text uses the
captured ASCII, without code references that can no longer be verified. Every region captures its source at selection time, including regions without panels. Changes to region content or
staleness produce an update under the same ID.

## Discover and attach

Reuse `GET /api/mapping/agent/canvases` (or MCP `canvas.list()`). Each `canvasId`
identifies a running browser workspace instance; its `documents` list identifies canvases there.
Discovery also includes `projectId` and, when browser storage and exclusive Web Locks
are available, `stableWorkspaceId`. The stable ID belongs to the browser tab, survives
reloads and React remounts, and is independently assigned to duplicated tabs. It is
scoped to the origin and app base path. Browsers that block session storage or lack
Web Locks omit it and support only the ephemeral instance identity.

Clients can remember the server URL, project ID, stable workspace ID, and document
ID. After a server/publisher disconnect, rediscover a descriptor matching all three
IDs, then attach to its current `canvasId` with a fresh snapshot. Require exactly one
match: old registrations can briefly overlap after reload; never pick an arbitrary
tab or fall back to another workspace with the same document. `canvasId` remains
ephemeral for registration deletion and command ownership; `canvasEpoch` remains
ephemeral for selection replacement. Stable identity does not replace either.
Open a WebSocket at `/api/mapping/live` and send:

```json
{"type":"attach","protocolVersion":2,"workspaceInstanceId":"<canvasId>","documentId":"<documentId>"}
```

The response is an authoritative snapshot. Replace your entire local region set:

```json
{
  "type": "attached",
  "protocolVersion": 2,
  "connectionId": "<connectionId>",
  "workspaceInstanceId": "<canvasId>",
  "documentId": "<documentId>",
  "canvasEpoch": "<canvas-instance-id>",
  "sequence": 0,
  "documentVersion": 1,
  "receivedAt": "2026-09-30T12:00:00.000Z",
  "regions": [],
  "diagramIds": []
}
```

One socket binds once. Switching tabs does not change the binding. Use another
socket for another canvas. Send attach within ten seconds. `CANVAS_NOT_READY`
means the browser has not published its initial snapshot; retry attach on that
socket within the handshake deadline.

## Incremental updates

Subsequent messages carry complete records only for new or changed regions, plus
IDs of removed regions. `diagramIds`, when present in a delta, replaces the entire
selected-diagram ID set; `[]` clears it. When omitted, retain the previous set.
For compatibility, an omitted snapshot `diagramIds` means `[]`. Removing a region
does not resend its text. Promotion sends diagram IDs and region removals together:

```json
{
  "type": "selection.delta",
  "connectionId": "<connectionId>",
  "workspaceInstanceId": "<canvasId>",
  "documentId": "<documentId>",
  "canvasEpoch": "<canvas-instance-id>",
  "baseSequence": 0,
  "sequence": 1,
  "documentVersion": 1,
  "receivedAt": "2026-09-30T12:00:01.000Z",
  "upserted": [],
  "removed": ["<region-id>"],
  "diagramIds": ["grid:overview"]
}
```

Apply an event atomically to your local map: delete `removed` IDs, then replace or
insert every `upserted` region, replace `diagramIds` if present, then store `sequence`. First verify the connection
and epoch, and require `baseSequence` to equal your local sequence. Sequence numbers
may skip, so do not require `sequence === baseSequence + 1`. On any mismatch, close
and reattach for a new authoritative snapshot. These are current-state updates,
not an audit log: changes that occur between samples can be coalesced.

WebSocket provides ordered, reliable transport during a connection. No per-region
ACK, retry loop, or polling is needed. On disconnect, consider the local state
unavailable, reconnect, and replace it with the new attached snapshot (including
removing IDs absent from it). This recovers current state; it does not replay every
selection transition during the outage or guarantee exactly-once client processing.
Clients requiring a durable event history need a separate protocol.

Unrelated document edits and UI activity do not produce selection traffic.
`documentVersion` is the version at the last selection change, not a live document
version monitor. Pings/pongs still maintain connection liveness.

## Optional HTTP snapshot and conditional reads

While the reader socket remains open:

```sh
curl -i http://localhost:41431/api/mapping/live/connections/CONNECTION_ID/selection
# Reuse the ETag returned above:
curl -i -H 'If-None-Match: "ETAG_VALUE"' \
  http://localhost:41431/api/mapping/live/connections/CONNECTION_ID/selection
```

- `200 application/json`: full bound snapshot, including `regions: []` and `diagramIds: []` when empty.
- `304`: the supplied ETag still matches; no response body.
- `404`: connection does not exist or its socket has closed.
- `503`: the bound browser disconnected; cached selections are not served.
- `410`: the canvas closed or was replaced.

Responses use `Cache-Control: private, no-cache` and include `ETag`,
`X-Canvas-Epoch`, `X-Selection-Sequence`, `X-Document-Version`, and
`X-Selection-Received-At` on successful reads. Failures contain JSON `code` and
`error`. GET returns the latest server snapshot, without a browser round trip.
For a streaming client, use reattach for resynchronization instead of merging a
concurrent GET response with queued socket deltas.

This replaces v1's single `text` field, `selection.changed` full-text events,
plain-text GET, and `204` for empty selections. Both reader and publisher handshakes
must specify `protocolVersion: 2`; old handshakes receive `INVALID_MESSAGE`.

## Lifetime, bounds, and browser publishing

`canvas.disconnected`, `canvas.closed`, and `canvas.replaced` are terminal for that
binding. Close, rediscover, and reattach. Reloading never silently retargets an
existing client. Closing a reader socket releases its binding and GET access.
Slow readers are closed with code `1013` when the transport backlog exceeds 64 KiB;
reconnect for a snapshot. The server never drops individual deltas to catch up.
There are at most 100 published documents per workspace, 1,000 regions per document,
and 2,000,000 text characters in each document's active set.

The browser uses `publish` with `protocolVersion: 2` and `workspaceInstanceId` on the
same endpoint. After `publisher.ready`, it sends `selection.snapshot` once per
document and `selection.delta` thereafter, with the same metadata and region fields.
It keeps only the latest pending snapshot per document under backpressure, computing
a delta against the last snapshot actually sent. Reconnect publishes full snapshots.
Invalid delta bases are rejected without changing the server mirror. `remove`
messages contain `documentId` and `canvasEpoch` and close that document's bindings.

Idle sockets use ping/pong every fifteen seconds; abrupt disconnect detection can
take about thirty seconds. Browser WebSocket requests require a matching Origin
host; native clients may omit Origin. The API follows the existing trusted-client
model. Reverse proxies must forward WebSocket upgrades and preserve Host.
There is no new MCP tool, init POST, or close DELETE.


## Workspace agent indicator

The toolbar displays the number of live reader connections across this browser
workspace. Each successful `attach` counts as one connection (a client with multiple
sockets counts more than once); stateless MCP/HTTP calls are not counted. Closing a
reader or invalidating its canvas removes it from the count. The browser publisher
receives small `agents.changed` events with `count` when this changes, without
polling or resending selection content. If its publisher socket disconnects, the
indicator reports that agent status is unavailable until it reconnects.


## Short canvas context over HTTP

For a diagram overview with source file references, discover `canvasId` and
`documentId` using `GET /api/mapping/agent/canvases`, then read:

```sh
curl --get http://localhost:41431/api/mapping/live/context/short \
  --data-urlencode 'workspaceInstanceId=CANVAS_ID' \
  --data-urlencode 'documentId=DOCUMENT_ID'
```

This stateless GET requires a running browser publisher, but no reader WebSocket,
agent session, or request ID. It does not change the connected-agent count.
The response has `view: "short"`, `shortFormatVersion: 1`, `apiFormatVersion: 1`,
`workspaceInstanceId`, `documentId`, `canvasEpoch`, the current context `version`,
and `name`. `X-Canvas-Epoch` and `X-Document-Version` mirror that snapshot's identity.
Reads are `Cache-Control: no-store`; each request loads fresh browser context.

- `diagrams`: complete raw ASCII (including newlines and spacing), content revision
  and hash, structure kind, exact geometry, hierarchy, and collapsed anchor IDs.
  Cross-canvas `jumps` remain present, with `sourceStatus: "current" | "stale"`.
- `sourceReferences` on each diagram: repository/corpus `binding`, diagram
  `mappings`, and `entities` with IDs, labels, handles, source IDs, and
  `sourceRanges` containing range IDs, file paths, line numbers, and optional symbols.
  Mappings identify these entities/ranges exactly as in detailed reads. They are
  anchored to the diagram's `asciiSha256`; paths/ranges describe captured references,
  not a claim that today's files still contain the same text. Captured `originalLines`
  and compaction content are deferred. No source files are read by this endpoint.
- `edges`: all connections, preserving appearance, labels, endpoints, and revision
  guards. Each endpoint has `status: "resolved" | "stale" | "missing"`.
  Resolved content endpoints include 1-based inclusive `line`, `startColumn`, and
  `endColumn`. Stale endpoints retain their original IDs without borrowing current
  locations. `renderStatus`, when available, retains the renderer's separate
  resolved/proxy/stale/pending/blocked status; routing paths are omitted.
- `groups`: IDs, children, geometry, and expansion state.
- `selections`: references for all floating selection panes (not the active selection
  set), including source diagram/content IDs, captured revision when available,
  captured ASCII hash, rectangle, selected entity IDs, hierarchy, and display state.
  `matchesCurrentSource: false` includes historical snapshots and missing sources.
  Their text must be read from the detailed node's `value.sourceAscii`, never
  reconstructed from the current diagram. Revision IDs may be absent on legacy panes.
- `otherNodes`: IDs, kinds, optional titles, hierarchy, expansion, and geometry for
  other floating panes. Their content is deferred, not silently treated as absent.
- `detailsDeferred`: identifies omitted detail categories.

The short view does not include the complete anchor index, captured source text,
selection source ASCII, rendered arrow nodes, or other pane contents. For those,
use the existing agent `canvas.attach(...)` and `nodes.get({nodeId})`, or request
the full WebSocket context below. Short anchor handles match those detailed reads
on the same backend. Fetch a detailed node to choose a new anchor; do not infer an
anchor ID from a line number. Use this response's `version` for subsequent edits.

Missing/duplicate identity parameters return `400`; unsupported methods return
`405`. An unavailable publisher/document returns `503`, a vanished workspace
instance returns `410`, and replacement while loading returns `409`. Rediscover
and reread after replacement. Existing detailed API and WebSocket formats are unchanged.

## Canvas context on connection

Selection-only v2 readers remain compatible. Agents that need the complete current
canvas can opt in when attaching:

```json
{"type":"attach","protocolVersion":2,"workspaceInstanceId":"…","documentId":"…","includeContext":true}
```

The `attached` response includes `context: {apiFormatVersion: 1, version, name, nodes, edges}`. `nodes`
is the complete DisplayNode registry returned by `nodes.list()`, including diagram
ASCII, structural node IDs, source mappings, layout hierarchy, and floating nodes.
Diagram content appears once at `node.content`; `node.diagram.content` and the
top-level `contentNodes` array are omitted. Read anchors from
`Object.values(node.content.structure.nodes)`, including for non-tree diagrams.
Nodes carry `apiFormatVersion: 1`. Short content-node handles are identical to
those returned by the agent API on this backend, and can be used directly in
edge, collapse, and jump operations. They preserve revision identity and expire
on backend restart; reread before making new edits. Connection/selection IDs and
protocol version 2 are unchanged.

`edges` is the document connection list with the same short anchor handles. All three values come from one synchronous
controller read. Undo history is neither exported nor cached. The canvas context
version is independent of the selection's `documentVersion`, which can lag when
an edit leaves the selection unchanged.

This is an on-demand snapshot, not a continuous full-canvas feed. Refresh it on the
same reader socket with:

```json
{"type":"context.get","requestId":"unique-request-id"}
```

The response is `context.snapshot` with that `requestId`, `connectionId`,
`workspaceInstanceId`, `documentId`, `canvasEpoch`, and fresh `context`. Errors also
carry the request ID. Only one context request or context frame may be in flight;
concurrent requests return `CONTEXT_BUSY`. Normal selection deltas continue while
a refresh waits for the browser.

Initial context must complete before attachment is acknowledged; allow 30 seconds
for this handshake. A closed, disconnected, or replaced canvas invalidates an
outstanding read. No attachment is created when its initial context read fails.
The browser bridge and outgoing context have an explicit 64 MiB transport bound;
larger contexts fail visibly instead of returning partial contents. Initial
context traffic gets a temporary bounded backpressure allowance so its own large
frame does not cause otherwise healthy selection updates to be dropped.

## Copy a diagram for cursor placement

An attached reader can stage a diagram in its bound canvas document over the same
WebSocket. The backend must be started with `--http` to enable canvas writes.

The browser advertises `capabilities: ["diagram.copy"]` in its `publish` handshake.
This optional field keeps protocol v2 selection publishers compatible. If the
capability is absent, copying fails immediately with `COPY_UNSUPPORTED` and reload/
reconnect guidance; the server sends no staging command and keeps the reader attached.
Deploy the updated server before serving the updated browser build: earlier servers
reject unknown handshake fields. Already-open tabs need a reload to gain the capability.

```json
{"type":"diagram.copy","requestId":"unique-copy-id","text":"Root\n|-- Child\n`-- Tail"}
```

After the owning browser stages the text, the server replies with
`{type: "diagram.copied", requestId, connectionId, workspaceInstanceId, documentId, canvasEpoch}`.
Errors use `{type: "error", requestId, code, error}` and leave the reader attached.
No document version or position is needed for staging: it does not edit or save
the canvas. The browser displays a highlighted copy cursor, a small text preview,
and a placement hint. The preview truncates long text without altering the buffer. Ctrl+V
(or Cmd+V) over the canvas inserts at the pointer using the current camera and
document version. Each paste is undoable; the buffer stays available for repeated
pastes. Escape clears it without adding history. Text inputs retain normal paste.

The buffer belongs to the target document session. It is not persisted and clears
on browser publisher disconnect, document removal/replacement, or reload. Switching
documents never pastes another document's buffer.

Input is bounded to 41,000 JavaScript characters including an optional single
Markdown fence. CRLF becomes LF and the fence is removed; spaces and blank lines
inside the diagram are preserved. The resulting text must contain 1–20,000
printable ASCII/LF characters and some non-whitespace text.

The browser acknowledgement timeout is 25 seconds; clients should allow at least
30 seconds. After an ambiguous transport failure, retry identical arguments with
the same request ID. Receipt deduplication prevents a retry from re-arming a buffer
cleared with Escape or overwriting a newer copy. Changed arguments require a fresh
ID. Receipts are bounded to 2,000 per backend/browser publisher lifetime; exhaustion
fails explicitly. Backend restart ends retry guarantees, so rediscover and attach
before issuing a new operation.

## Upload coding-agent context

An attached reader can upload an immutable slice of its coding trajectory for
prompt-driven diagram editing. Uploads do not change the canvas or start an LLM
run. Browser publisher sockets and unattached sockets cannot upload.

Send `agent-context.upload` on the reader socket after `attached`:

```json
{
  "type": "agent-context.upload",
  "requestId": "context-upload-1",
  "agentType": "codex",
  "sourceSessionId": "original-coding-session",
  "format": "messages-v1",
  "fromEntryId": "user-1",
  "throughEntryId": "assistant-1",
  "entries": [
    {
      "id": "user-1",
      "parentId": null,
      "message": {
        "role": "user",
        "content": [{ "type": "text", "text": "Move cache ownership to Workspace." }]
      }
    },
    {
      "id": "assistant-1",
      "parentId": "user-1",
      "message": {
        "role": "assistant",
        "content": [{ "type": "text", "text": "Workspace now owns and initializes the cache." }]
      }
    }
  ]
}
```

`agentType` is required provenance, for example `codex`, `claude`, or `pi`.
It accepts a lowercase identifier matching `[a-z][a-z0-9_-]{0,63}` and does not
select the diagram model or grant tools. `sourceSessionId` identifies the original
coding session, independently of the reader connection and canvas attachment.

`messages-v1` is a shared upload format, **not native Codex/Claude/Pi JSONL**.
The uploading agent converts its chosen transcript to these explicit records.
Unknown fields, native compaction records, unsupported roles and content blocks
are rejected instead of silently discarded. This version supports text and
structured tool interactions:

- Every entry has a unique `id`, a `parentId` (or `null`), and a `message`.
- User messages contain text blocks.
- Assistant messages contain text and/or
  `{ "type": "toolCall", "id": "call-1", "name": "read", "arguments": { "path": "file.ts" } }` blocks.
- A tool-result message has `role: "toolResult"`, `toolCallId`, `toolName`, text
  `content`, and optional `isError` (default `false`).
- Messages may include a nonnegative integer `timestamp` in milliseconds;
  omitted timestamps are recorded as `0`, not the upload time.

The range is inclusive. `throughEntryId` selects the branch endpoint;
`fromEntryId` must be its ancestor or the same entry. Entries before the range
need not be uploaded. Sibling branches are excluded. Tool calls and results must
be complete within the selected slice, with unique call IDs and matching names;
a slice starting at an orphan result or ending at an unanswered call is rejected.
Summaries must be supplied explicitly as text by the uploader; the API does not
implicitly widen a range to import compaction history.

The acknowledgement identifies the captured context without echoing its contents:

```json
{
  "type": "agent-context.uploaded",
  "requestId": "context-upload-1",
  "connectionId": "<reader-connection-id>",
  "agentContextId": "agent-context-<uuid>",
  "contentHash": "<sha256>",
  "agentType": "codex",
  "sourceSessionId": "original-coding-session",
  "messageCount": 2
}
```

Reuse the upload request ID to recover a lost acknowledgement. The same selected
context returns the same receipt; different captured context returns
`REQUEST_ID_CONFLICT`. This also works after reconnecting to the same live
workspace instance and document. Validation errors carry the request ID when it
is a valid string. Closed, replaced and disconnected bindings cannot upload.

Use the resulting ID in the existing HTTP/MCP `edit-diagram` tool:

```json
{
  "sessionId": "<canvas.attach sessionId>",
  "nodeId": "grid:overview",
  "expectedVersion": 12,
  "baseRevisionId": "<current diagram.revisionId>",
  "prompt": "Update this diagram to reflect the ownership change.",
  "agentContextId": "agent-context-<uuid>",
  "requestId": "diagram-edit-1"
}
```

The canvas attachment must target the upload's workspace instance and document.
Read fresh document/base versions before editing; selection event versions can
lag. The edit captures the context and includes its hash in retry identity. Pi
starts a fresh in-memory session containing the imported messages, then receives
the current diagram-edit prompt with the workflow's configured model and tools.
Historical tool calls are not re-executed. Omitting `agentContextId` preserves the
existing empty-history behavior.

Contexts and upload receipts are held in backend memory, survive reader socket
closure, and are lost on backend restart. They are scoped to the live workspace
instance/document, so a replacement workspace instance requires a new upload.
Each upload is limited to 2 MiB and 2,000 entries; the backend retains at most 100
contexts and 32 MiB of snapshots. Capacity exhaustion returns
`AGENT_CONTEXT_CAPACITY`; existing contexts and retry receipts remain available.
