# Scoped change-session storage

The Changes explorer reads small summaries. Opening a preview reads only the selected
canvas's baseline and proposed view checkpoints, and their diagram dependencies. It does
not reconstruct other canvases, undo/redo history, or request receipts.

## Records and publication

Each project keeps these files beneath its diagram store:

```text
mapping-change-sessions/<project>/
  <session>.manifest.json     format 2: summary, canvas-record references, receipt-index reference
  <session>.json              preserved legacy input, if one existed
  <session>.summary.json      generation-stamped summary cache for unmigrated legacy input

change-session-records/<sha256>.json
  canvas record              metadata and baseline/proposed/history references
  view checkpoint            composition + presentation + immutable diagram references
  history header             navigation and diagram-history reference
  history checkpoint         one immutable canonical canvas snapshot
  request receipt            one replay signature/result
  receipt index              request IDs -> immutable receipt references

diagrams/{diagram,revision,history}/<sha256>.json
  shared immutable diagram records (existing storage)
```

Baseline/proposed view checkpoints with identical content share a hash. Retained undo
checkpoints and diagram revisions remain shared when a canvas changes. View checkpoints
preserve the exact review presentation; canonical history checkpoints additionally carry
editing identities and navigation relationships. They share the underlying diagram records.

The manifest embeds the explorer summary so the summary and canvas heads publish together.
It points to the receipt index rather than embedding replay payloads. New blobs are written
first, then the manifest is replaced atomically. Immutable records and manifest publication
use file/directory syncing. The existing diagram store continues to supply referenced diagram
records. An interrupted pre-publication write exposes the previous complete manifest; orphan
blobs can remain and are not currently garbage-collected.

Repository writes accept an explicit scope of changed canvas IDs and receipt keys. Editing
one canvas sends only that canvas to the storage worker. Title/status updates and request
receipts do not serialize any canvases. The service also recomputes generated change
annotations only for the edited canvas. A manifest token from the preceding read rejects
stale publishers within the server's serialized publication path. This is not a cross-process
filesystem lock; run one server writer for a store.

## Reads and workers

`DiagramChangeSessionStore` exposes summary, preview, and compatibility full-session reads.
Production composition enables one Node worker per project store for migration, validation,
record serialization, and full hydration. Small manifest/summary reads remain independent
of that worker, so an expensive full read cannot block a cached explorer listing. Validated
immutable canvas/preview records have bounded entry caches; raw immutable records also have
a 32 MB serialized-size cache budget.

`GET /api/mapping/agent/change-sessions/:id/preview?documentId=...` returns the session summary
and one `document`, excluding history and receipts. Adding `version=...` returns JSON `null`
when unchanged, before any preview hydration. Acceptance receipts in the project catalog
remain authoritative after interrupted session publication; summary/preview reads report that
accepted state without rebuilding the proposal. Full get/accept retains the existing repair path.

The browser fetches/parses changed preview content and computes its diff in a Web Worker.
Draft/ready previews check the version two seconds after each completed request. Accepted or
archived previews stop polling. Explorer refreshes continue using summaries. Selecting a
different canvas starts a new scoped request and terminates the previous preview worker.

The original full-session GET remains for compatibility and explicit acceptance/open-canvas
flows that need all participating baselines. MCP editing currently obtains a full session
through the worker before applying a mutation; scoped publication avoids resaving unchanged
canvases, but this does not make every MCP operation a scoped read.

## Legacy migration

Listing legacy proposals creates small summary caches, tagged with the opened source file's
inode, size, and modification/change timestamps. It does not hydrate diagrams or histories.
On first detailed access, a worker splits that session into immutable records and atomically
publishes its manifest. Already-externalized diagram references pass through; embedded legacy
diagrams are externalized. Selected preview states are validated when loaded, and full reads
validate the complete canvas histories. Migration preserves legacy files and replay receipts.
After publication the manifest is authoritative; older writers that only update legacy files
must not keep writing to that store.

## Verification and measurements

The reproducible benchmark copies legacy sessions and diagram dependencies into a temporary
store. It compares a full legacy read to scoped reads, checks equality of selected preview
state and full histories/receipts, and removes the copy. It never benchmarks mutations against
the active workspace. See [raw results](../../artifacts/change-session-performance/latest.json).
Timings are storage-service measurements, excluding browser rendering and network transfer;
worker startup and migration are included where stated. The list includes archived sessions
before the application filters them.

On the copied five-canvas proposal (2026-09-28), the recorded run measured:

| Read | Time | Returned JSON |
| --- | ---: | ---: |
| Legacy full preview | 10,546 ms | 9,099,616 bytes |
| Scoped preview including first migration | 685 ms | 320,367 bytes |
| Scoped preview with a fresh reader after migration | 69 ms | 320,367 bytes |
| Scoped preview cached | 6 ms | 320,367 bytes |
| Cached explorer summaries (11 sessions) | 25 ms | 47,184 bytes |
| Explorer summaries during full-history hydration | 40 ms | 47,184 bytes |

The first legacy summary indexing pass took 1,938 ms, including worker startup and durable
summary-cache creation for about 70 MB of legacy input. Subsequent listings use the small
cache files/manifests. These are single-run observations, not latency guarantees.

```sh
CHANGE_BENCH_STORE=/path/to/diagram/store \
CHANGE_BENCH_PROJECT=project-id CHANGE_BENCH_SESSION=change-id \
  node --import tsx tests/performance/change-session-records.mjs
```

Tests cover scoped reads with unrelated/history blobs unavailable, immutable reuse, receipt
round trips, stale writes, failed manifest replacement/retry, embedded legacy migration, and
unchanged-version checks that perform no preview read. Production-browser validation checks
the scoped endpoint, version polling, accepted-preview polling stopping, acceptance, reload,
retained review diffs, undo, and preservation of later local edits.
