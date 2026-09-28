# VS Code persistence and worker design

Read-only implementation study, 2026-09-26. VS Code checkout:
`/home/john/code/vscode`, commit `a0a429cd4ac624c0add568597f00b052c225ae56`.
No VS Code performance benchmark was run. Findings below come from tracing its
storage, editor restoration, file save, recovery, history, and worker implementations.
Our timings come from the separate [CodePanel opening measurement](code-panel-opening-performance.md).

## Conclusion

The strongest lesson is to reduce the scope of a persistence operation before
moving it to another thread. VS Code does not serialize a single graph containing
all editors, file contents, backups, and undo history whenever an editor opens.
Those systems have different owners, representations, and write schedules.

The hypothesis about validation is partly right: the editor serialization path
does not deserialize its output and reconstruct every document to validate a save.
The hypothesis that everything runs in workers is wrong: editor JSON conversion
and storage value stringification can run in the renderer. Browser storage uses
asynchronous IndexedDB; desktop storage uses IPC to a main-process SQLite service.
Neither means all preparatory JavaScript runs off the UI thread.

## 1. Persist descriptors and component state separately from content

`FileEditorInputSerializer` saves the resource URI, preferred URI/name/description,
encoding, and language mode. It does not embed file contents or undo stacks.
[fileEditorHandler.ts](/home/john/code/vscode/src/vs/workbench/contrib/files/browser/editors/fileEditorHandler.ts:19)

Editor groups serialize editor descriptors and group ordering/selection metadata;
the editor part saves the grid, active group, and MRU order. Component mementos
write scoped storage keys. Deserialization restores through the registered editor
serializers and can skip unavailable editor types.
[editorGroupModel.ts](/home/john/code/vscode/src/vs/workbench/common/editor/editorGroupModel.ts:1163),
[editorPart.ts](/home/john/code/vscode/src/vs/workbench/browser/parts/editor/editorPart.ts:1477),
[memento.ts](/home/john/code/vscode/src/vs/workbench/common/memento.ts:128).

**Borrow:** CodePanel restoration should persist a small descriptor: identity,
mapped resource references, geometry, and view preferences. Loaded source text,
tokens, indexes, and rendered output belong to disposable caches. Canvas documents,
history, and workspace layout should have independent persistence records.

## 2. A cached key/value layer batches only changed keys

`Storage` maintains an in-memory cache, pending inserts, and pending deletes.
`set()` stringifies its value, compares against the cached string, and skips an
unchanged value. Changed keys accumulate behind a 100 ms flush delay. Flush swaps
out the pending maps and submits just that batch; later changes accumulate in new
maps while the write is in progress.
[storage.ts](/home/john/code/vscode/src/vs/base/parts/storage/common/storage.ts:264),
[flushPending](/home/john/code/vscode/src/vs/base/parts/storage/common/storage.ts:363).

Important limit: comparison happens **after** stringification. This is per-key
batching, not automatic field-level diffing, and it would not fix our problem if
we stored the entire workspace under one giant key.

Browser storage applies the insert/delete batch in an IndexedDB transaction and
broadcasts changed keys. Desktop storage sends changes over IPC to a storage
service in the main process, backed by transactional SQLite writes. SQLite's
upsert also avoids rewriting an equal value.
[browser storage](/home/john/code/vscode/src/vs/workbench/services/storage/browser/storageService.ts:480),
[desktop entry point](/home/john/code/vscode/src/vs/workbench/services/storage/electron-browser/storageService.ts:16),
[IPC client](/home/john/code/vscode/src/vs/platform/storage/common/storageIpc.ts:92),
[IPC receiver](/home/john/code/vscode/src/vs/platform/storage/electron-main/storageIpc.ts:136),
[SQLite](/home/john/code/vscode/src/vs/base/parts/storage/node/storage.ts:83).

**Borrow:** explicit dirty record IDs and versions, coalesced updates, and a storage
adapter receiving a bounded batch. A change in one canvas must not request exports
from every controller. Moving writes outside React is insufficient if the capture
and encoding stages still traverse everything on the UI thread.

## 3. State collection, database flushing, and recovery use different schedules

The abstract storage service schedules periodic state collection through an idle
callback. The default interval is 60 seconds; browser workbench storage overrides
it to 5 seconds because shutdown cannot reliably finish asynchronous operations.
These intervals are distinct from the 100 ms changed-key database flush delay.
Shutdown explicitly requests a flush.
[storage lifecycle](/home/john/code/vscode/src/vs/platform/storage/common/storage.ts:330),
[flush](/home/john/code/vscode/src/vs/platform/storage/common/storage.ts:614),
[browser interval](/home/john/code/vscode/src/vs/workbench/services/storage/browser/storageService.ts:24).

Working-copy recovery backups normally wait 1 second, or 2 seconds under the
short-autosave condition. They track a version and cancel superseded scheduled
work per working copy. The backup service deduplicates by version/metadata and
orders writes/deletes with a per-resource queue.
[backup tracker](/home/john/code/vscode/src/vs/workbench/services/workingCopy/common/workingCopyBackupTracker.ts:91),
[backup service](/home/john/code/vscode/src/vs/workbench/services/workingCopy/common/workingCopyBackupService.ts:197).

**Borrow:** separate durability policies for content commits and personal layout.
Coalesce pan/resize state; never depend exclusively on idle time for important
content durability. A debounce only moves a long synchronous stall—it does not
make that stall cheap. Copying VS Code's exact delays is not an architecture fix.

## 4. Saves acknowledge a particular version

Text file saves deduplicate requests for a running version and allow only one
save at a time. A later save is queued. After save participants run, the model
captures a version and writes a text snapshot with mtime/etag conflict checks.
Completion clears dirty state only if the current model still has that version.
[save sequencing](/home/john/code/vscode/src/vs/workbench/services/textfile/common/textFileEditorModel.ts:764),
[snapshot and acknowledgement](/home/john/code/vscode/src/vs/workbench/services/textfile/common/textFileEditorModel.ts:922).

The piece-tree snapshot captures piece references and exposes a sequential
`read()`. It does not reconstruct an editor or parse its entire history. Snapshot
creation still traverses the pieces; it is not a universal constant-time operation.
[PieceTreeSnapshot](/home/john/code/vscode/src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase.ts:159).

**Borrow:** track `currentVersion` and `persistedVersion` for each durable owner.
A completed save of version N cannot mark version N+1 clean. Repeated requests
coalesce, but immutable history additions must not be dropped when mutable head
updates are coalesced. Failed writes must remain pending for retry.

## 5. Undo and durable local history are different systems

The undo service owns resource edit stacks in memory. Text edits are compressed
and can be serialized into compact ArrayBuffers for stack storage; this is not
evidence of a workspace-wide durable undo format. Closed-model undo retention
has a memory budget and content identity checks before reuse.
[undoRedoService.ts](/home/john/code/vscode/src/vs/platform/undoRedo/common/undoRedoService.ts:461),
[editStack.ts](/home/john/code/vscode/src/vs/editor/common/model/editStack.ts:26),
[closed-model retention](/home/john/code/vscode/src/vs/editor/common/services/modelService.ts:282).

Durable local history stores individual file snapshots plus a small entries index.
It merges nearby eligible saves, skips unchanged index versions, serializes index
writes, and prunes entries according to retention settings. Tracking also checks
file size and exclusions. It does not pack all previous file contents into each
new workspace save.
[history entries](/home/john/code/vscode/src/vs/workbench/services/workingCopy/common/workingCopyHistoryService.ts:122),
[history index](/home/john/code/vscode/src/vs/workbench/services/workingCopy/common/workingCopyHistoryService.ts:422),
[eligibility](/home/john/code/vscode/src/vs/workbench/services/workingCopy/common/workingCopyHistoryTracker.ts:191).

**Borrow with care:** retain our durable undo and cross-canvas transaction behavior.
Our `CanvasHistory` already separates diagram revisions from checkpoints. Persist
new revisions/checkpoints once, then update heads and navigation metadata. Do not
revalidate and rewrite every existing record. Retention must preserve records
reachable from undo/redo, transfer transactions, baselines, and review sessions;
copying a simple maximum-entry deletion rule would be unsafe for our graph.

## 6. Workers are typed, long-lived services with model synchronization

`IWebWorkerService` constructs a typed worker client. The implementation handles
module readiness, lifecycle, and message transport; the shared protocol supplies
request/reply and event channels. It is a worker-service factory, not a universal
pool that automatically makes arbitrary app functions asynchronous.
[service interface](/home/john/code/vscode/src/vs/platform/webWorker/browser/webWorkerService.ts:11),
[implementation](/home/john/code/vscode/src/vs/platform/webWorker/browser/webWorkerServiceImpl.ts:18),
[protocol](/home/john/code/vscode/src/vs/base/common/worker/webWorker.ts:104).

Text model synchronization sends initial lines/EOL/version once, forwards content
change events, removes disposed models, and expires unused mirrors after a minute.
Large models can be excluded. It does not resend every open model on every request.
[textModelSync.impl.ts](/home/john/code/vscode/src/vs/editor/common/services/textModelSync/textModelSync.impl.ts:62).

Background TextMate tokenization lazily initializes a worker and maintains
controllers for attached models. Worker file requests call back into the host's
resource loading service. Tokens and grammar-state changes return with model
versions. The controller accounts for edits since that version. Tokenization
publishes batches of roughly 200 lines and yields after a roughly 20 ms budget.
This asynchronous path is conditional, with a fallback; VS Code does not always
run every tokenizer in a worker.
[tokenizer factory](/home/john/code/vscode/src/vs/workbench/services/textMate/browser/backgroundTokenization/threadedBackgroundTokenizerFactory.ts:62),
[version handling](/home/john/code/vscode/src/vs/workbench/services/textMate/browser/backgroundTokenization/textMateWorkerTokenizerController.ts:143),
[bounded batches](/home/john/code/vscode/src/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateWorkerTokenizer.ts:117).

**Borrow:** a small shared WorkerService underneath domain-specific persistence
and source-preparation APIs. Initialize once, cache by revision/content identity,
send changes, and reject obsolete responses. Keep CodeRepoService as the source
loading authority. For read-only source views, a new file version can replace the
mirror; we do not need VS Code's editable-text synchronization complexity.

Keep source caches bounded and invalidate on file version changes. Loading every
repository file at Mapping initialization is unnecessary. Load mapped/visible
files on demand and optionally prefetch likely next files within a budget. Cache
source separately from theme/language-dependent token results. DOM creation,
layout, and paint remain on the main thread even with worker tokenization.

## Our specific mismatch

Current persistence follows:

```text
open CodePanel
  -> controller commit
  -> debounce
  -> capture every open document and export histories
  -> serializeWorkspace
     -> deserializeWorkspace
        -> clone, migrate/normalize, validate documents
        -> construct CanvasHistory for each saved history
           -> validate historical revisions and checkpoints
     -> JSON.stringify entire workspace
  -> HTTP write
```

The measured fixture is 7.76 MB with 5.60 MB of active-document history. Opening
produced about 1.34 seconds in persistence flush, including about 1.12 seconds in
history validation; these are nested sampled times. Source requests took 63–81 ms.
The first target is therefore persistence scope, not file-read latency.

Relevant app locations:
[capture](/home/john/.herdr/worktrees/new-diagram/worktree-perf-debug/src/features/mapping/MappingPage.tsx:310),
[save codec](/home/john/.herdr/worktrees/new-diagram/worktree-perf-debug/domain/mapping/workspace/mappingWorkspaceCodec.ts:280),
[history export](/home/john/.herdr/worktrees/new-diagram/worktree-perf-debug/domain/core/diagrams/canvasHistory.ts:77),
[history validation](/home/john/.herdr/worktrees/new-diagram/worktree-perf-debug/domain/core/diagrams/canvasHistory.ts:165).

## Recommended architecture and order

```text
validated domain commit
  +-> focused UI subscriptions -> render affected UI
  +-> durable change batch
       +-> small layout / CodePanel descriptor updates
       +-> new canvas checkpoints / diagram revisions, when applicable
       +-> head / undo / redo / transaction metadata
            -> persistence service: coalesce + version + retry
                 -> worker: remaining substantial encoding/index work
                 -> storage: atomic batch, acknowledge committed version

CodePanel content request
  -> CodeRepoService: deduplicated, versioned source cache
  -> source worker: line index / hashing / tokenization as needed
  -> versioned result -> CodePanel rendering
```

1. Separate decoding/migration/full import validation from encoding trusted
   committed state. Preserve the current normalization of non-resumable operations
   through an explicit persistence projection; simply deleting the deserialize
   call would otherwise change behavior. Validate new domain changes at commit and
   external data at ingestion. Avoid a public unchecked path for arbitrary objects.
2. Add a durable change contract to the owning services. Persistence consumes
   changed records; it cannot ask React or every controller for a global export.
   Keep full export as an explicit portable export/checkpoint operation.
3. Extend storage to accept atomic batches of new records plus head metadata.
   Preserve atomic publication of both sides of cross-canvas moves and their
   transaction record. A crash must expose either the old or the new complete
   transaction. If storage cannot atomically update records, publish a manifest
   only after all referenced immutable records are durable.
4. Move substantial remaining encoding/import validation and source preparation
   to typed workers. Avoid cloning the entire workspace through `postMessage` on
   each change. Seed a worker once and update its owned state incrementally if it
   needs a replica. One initial large seed still needs measurement.
5. Remeasure closed/opening/settled/reopening pan latency, main-thread capture and
   message-copy time, encoding time, bytes written, and source preparation. Also
   verify reloadable undo/redo, cross-canvas atomicity, save failures, and edits
   arriving during an in-flight save.

Opening a panel should write its descriptor and, if opening remains undoable, a
new lightweight checkpoint referencing existing content revisions. Whether panel
opening belongs in undo history is a separate product decision; improving
persistence must not silently remove that behavior.

The desired contract is that routine save work scales with changed records and
required metadata, rather than all accumulated workspace content and history.
Worker execution is a second boundary, not a substitute for that contract.
