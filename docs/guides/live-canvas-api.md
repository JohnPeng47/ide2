# Live canvas selection API

External clients can bind to one live canvas and receive its current selection as
the exact text produced by **Copy ASCII + code refs**. The API reads an ephemeral
in-memory mirror; it does not load workspace documents, export history, or save
workspace state.

## Discover and attach

Reuse `GET /api/mapping/agent/canvases` (or MCP `canvas.list()`). Each returned
`canvasId` identifies a browser workspace; its `documents` list identifies the
canvases available there. Open a WebSocket at `/api/mapping/live` and send:

```json
{"type":"attach","workspaceInstanceId":"<canvasId>","documentId":"<documentId>"}
```

The first response is an `attached` event:

```json
{
  "type": "attached",
  "connectionId": "<connectionId>",
  "workspaceInstanceId": "<canvasId>",
  "documentId": "<documentId>",
  "canvasEpoch": "<canvas-instance-id>",
  "sequence": 0,
  "documentVersion": 1,
  "receivedAt": "2026-09-29T12:00:00.000Z",
  "text": null
}
```

`selection.changed` events carry the same fields and the latest complete `text`.
Sequence numbers increase within a canvas epoch; they can skip because updates
are coalesced. `documentVersion` also changes when document edits affect the
snapshot. These are snapshots, not a replayable event log.

One socket binds once. Switching tabs in the app does not change the binding.
Use another socket for another canvas. Send the first attach within ten seconds.
If the browser has registered but has not published its initial snapshot, an
`error` event with `code: "CANVAS_NOT_READY"` allows retrying attach on that socket
within the handshake deadline.

## Read the selection

While the socket remains open:

```sh
curl http://localhost:41431/api/mapping/live/connections/CONNECTION_ID/selection
```

- `200 text/plain; charset=utf-8`: exact copy payload, including rectangular
  padding, blank lines, and the `Associated Code Entities:` section. No trimming.
- `204`: no current selection.
- `404`: connection does not exist or its socket has closed.
- `503`: the bound browser disconnected; its cached text is no longer served.
- `410`: the bound canvas closed or was replaced.

Responses use `Cache-Control: no-store`. Successful responses include
`X-Canvas-Epoch`, `X-Selection-Sequence`, `X-Document-Version`, and
`X-Selection-Received-At` headers. Failures contain JSON `code` and `error`.

This read returns the whole current copy payload. The selection operator currently
provides one completed active rectangle; it does not expose intermediate drag
previews or all retained code panels as separate selections. Code references are
deduplicated using the same formatter as the UI. Selection changes propagate
asynchronously, so GET returns the latest snapshot received by the server rather
than performing a synchronous browser round trip.

## Lifetime and responsiveness

The socket receives `canvas.disconnected`, `canvas.closed`, or `canvas.replaced`
when its binding becomes unavailable. These are terminal for that binding. Close
the socket, rediscover the canvas, and attach on a new socket to reconnect. A
browser reload or replacement never silently retargets an existing client.
Closing the external socket releases its connection and GET access.

The browser uses an internal `publish` handshake on the same WebSocket endpoint,
then publishes `selection` and `remove` messages. External readers use `attach`.
The publisher samples completed selections after synchronous controller updates
settle, shares the clipboard formatter, and keeps only the latest pending state
per document. The server also coalesces updates for slow readers. Temporary
pointer previews do not generate selection updates. Idle sockets use ping/pong
every fifteen seconds; abrupt disconnect detection can take about thirty seconds.

The local API follows the existing agent API's trusted-client model. Browser
WebSocket requests require a matching Origin host; native clients may omit Origin.
Reverse proxies must forward WebSocket upgrades for `/api/mapping/live` and
preserve the external Host. There is no new MCP tool, init POST, or close DELETE.
