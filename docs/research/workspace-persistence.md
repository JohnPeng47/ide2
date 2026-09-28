# Incremental workspace persistence

Ordinary canvas edits submit changed records to a cached storage service. They no longer
export every open canvas history, serialize a whole workspace, or reinstall every session
when deleting a canvas. `store()` is synchronous and cheap; `flush()` returns a promise
that resolves after acknowledgement of all submissions preceding that call.

## Ownership and scheduling

```text
CanvasSession / CanvasWorkspace / SourcePaneViewState
  | committed canvas IDs, new history records, coalesced view changes
  v
WorkspacePersistence
  | metadata, baseline, history header, checkpoints, diagram revisions,
  | canvas presentation, viewport, workspace index
  v
RecordStorage (StorageService)
  | memory cache + latest change per key
  | 150 ms debounce, capped at 1 second from first pending submission
  | one captured batch in flight; newer edits accumulate separately
  v
WorkspaceStorage worker (one persistent browser worker)
  | normalize changed records, JSON encode, HTTP POST
  v
WorkspaceRecordStore
  | check expected revision + durable request receipt
  | validate changes/references, write new immutable record blobs
  `-- atomic manifest publication -> acknowledgement -> flush resolves
```

Submitting a value means giving storage an immutable snapshot owned by the caller. Submission
does no deep cloning, serialization, or I/O. Shallow comparisons suppress unchanged records.
History journals expose references to newly created revisions and checkpoints; undo/redo
usually changes the navigation header without resending diagram revisions. Scroll/camera
owners coalesce notifications for 250 ms. Unchanged captured source views retain their
identity, so a camera change need only write its viewport record.

Owners submit directly when committed state changes; this implementation does not require a
periodic `onWillSaveState` broadcast. The storage scheduler controls batching independently
of those submissions. Moving serialization to a worker alone would still clone and encode
an entire workspace; submitting smaller records removes that work from ordinary actions.
Worker messaging still structured-clones the changed batch on the main thread.

The worker uses async network I/O; the server uses async filesystem operations. This is a
browser Web Worker, not a Node worker-thread pool. Backend validation and hashing still run
on the server thread, scoped to changed records and affected current canvases. Import,
export, initial restoration, and explicit transfer preparation still materialize workspace
snapshots; transfer publication itself diffs records and writes one atomic batch.

## Durability and failures

The GET/POST endpoint is `/api/mapping/workspace/records`. Its batch contains `requestId`,
`expectedRevision`, and `{key,value}` / `{key,delete:true}` changes. Changed values are
written under `workspace-records/<sha256>.json`. File contents and directory entries are
synced before publication completes. `workspace-records.json` contains the current revision,
key-to-blob references, and request receipts; its atomic replacement publishes every record
in a batch together. A failed pre-publication write leaves the previous manifest readable.

A transport failure or server-side publication failure has an ambiguous outcome. Retry
preserves the original request ID and body; the durable receipt recognizes a write even
after server restart. Newer changes stay queued until that batch is acknowledged. Automatic
retries back off up to 30 seconds. Client rejections stop automatic retries, retain unsaved
ordinary edits, and surface an error. A stale expected revision requires reload/reconciliation;
the service does not silently overwrite another tab's changes. Explicit transfer transactions
leave the UI unchanged on a definitive rejection and install both canvases after acknowledgement.

History records are immutable except checkpoint transaction links. Retiring transfers updates
those links. Removing/replacing a history graph validates remaining references, and deleting
a canvas removes its records and index entry together. Transfer references are checked across
both canvases in the same batch.

The first records load imports the legacy `mapping-workspace.json` once, preserving that file.
The manifest becomes authoritative. Existing GET/PUT snapshot APIs and JSON import/export
remain compatible. Legacy PUT replaces the indexed workspace and increments its revision,
so an already-open incremental client detects the conflict.

Save workspace flushes pending work. Hiding the page attempts a flush, and pending storage or
viewport changes participate in the close warning. Abrupt tab/process termination can still
lose unacknowledged changes: a browser worker dies with its page. This implementation does
not include an IndexedDB recovery journal or promise reliable async writes during unload.
Unreferenced blobs and request receipts are retained; garbage collection is separate work.

## Create/delete benchmark

`tests/performance/browser-workspace-persistence.mjs` builds a disposable project with three
open canvases, 21 revisions each, and 64 KB source evidence per revision (4,793,695-byte
legacy workspace). It drives the production UI through CDP, creates/deletes a canvas three
times, reads persisted state through the public API, then reloads and verifies the remaining
canvases. No live workspace data is changed.

The baseline already had serialization in a short-lived worker. The improvement includes
incremental submission/storage and avoiding reconstruction of all sessions during deletion.
These are observations on the same machine, not machine-independent performance thresholds.

| Median of three trials | Before | After |
| --- | ---: | ---: |
| Create: UI complete | 72.9 ms | 62.9 ms |
| Create: persisted readback | 2,350.7 ms | 484.5 ms |
| Create: main-thread task time | 313.5 ms | 32.4 ms |
| Delete: UI complete | 668.4 ms | 70.4 ms |
| Delete: persisted readback | 943.9 ms | 108.8 ms |
| Delete: main-thread task time | 244.2 ms | 35.4 ms |

The six post-change actions produced no observed tasks over 50 ms, and their maximum frame
intervals were 16.8 ms or less. Persisted readback includes API reconstruction/polling overhead;
it is not a measurement of filesystem write time alone. Main-thread task time includes work
through that readback. Initial load/migration and large transfer preparation are outside this
benchmark's timing window. Raw results: [baseline](../../artifacts/workspace-persistence/baseline.json)
and [after](../../artifacts/workspace-persistence/after.json).

Reproduce after a production build:

```sh
npm run build
WORKSPACE_REPORT=artifacts/workspace-persistence/after.json \
  node --import tsx tests/performance/browser-workspace-persistence.mjs
```

Unit/integration checks cover batching during in-flight writes, bounded debounce, retries,
conflicts, rollback of rejected explicit transactions, migration, restart, failed publication,
record deletion, history replacement, and edits that never call full history export. The real
browser transfer test also interrupts a response after publication and verifies an identical
retry followed by exactly one installed transfer, plus paired undo/redo and reload.
