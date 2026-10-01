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


## Canvas context on connection

Selection-only v2 readers remain compatible. Agents that need the complete current
canvas can opt in when attaching:

```json
{"type":"attach","protocolVersion":2,"workspaceInstanceId":"…","documentId":"…","includeContext":true}
```

The `attached` response includes `context: {version, name, nodes, edges}`. `nodes`
is the complete DisplayNode registry returned by `nodes.list()`, including diagram
ASCII, structural node IDs, source mappings, layout hierarchy, and floating nodes.
`edges` is the document connection list. All three values come from one synchronous
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
