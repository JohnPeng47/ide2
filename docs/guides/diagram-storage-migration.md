# Diagram identity storage migration

The DiagramService identity refactor requires storage format 2. Existing Diagram
payloads did not contain their service identity or immutable revision ID. Normal
application loading does not convert these payloads.

Run from the repository with an explicit project data directory:

```sh
node --import tsx scripts/migrations/migrate-diagram-identities.ts prepare /path/to/store /path/to/stage
node --import tsx scripts/migrations/migrate-diagram-identities.ts verify /path/to/stage
# Stop the app and its workers before publication. Keep it stopped until publish finishes.
node --import tsx scripts/migrations/migrate-diagram-identities.ts publish /path/to/stage
# Restart the app; reload browser tabs before editing.
```

Use a stage on the same filesystem as the source. Preparation copies the complete
store and never writes the source. If source JSON changes during or after copying,
publication refuses to proceed; prepare a new stage with writes paused. Verification
uses the production loaders, including all ChangeSession previews, and records the
verified stage fingerprint. Any subsequent stage JSON change requires verification
again. Publishing renames the original directory to a timestamped backup and puts
the stage in its place; a failed second rename restores the original directory.
The app must be stopped throughout these two renames. If the migration process is
interrupted between them, restore the timestamped backup before restarting.

The converter handles canvas-history and mapping-canvas catalog entries, both
workspace stores, and monolithic and manifest-based ChangeSessions. Existing
revision UUIDs, ancestry, node references, checkpoint IDs, undo/redo stacks, and
acceptance references are preserved. Each existing revision lineage receives a
deterministic diagram identity derived from its root revision. Unversioned diagram
snapshots receive identities scoped to their owning document, without merging
unrelated diagrams with identical text. Older proposal undo/redo states become
explicit checkpoints. Unknown shapes, conflicting revisions, and missing ancestry
fail conversion instead of guessing.

New immutable blobs are written under new content hashes; old blobs remain in the
copy and backup. The migration rewrites the manifests that reference them and adds
`diagram-storage-format.json` with version 2. The workspace manifest revision is
advanced so an already-open client cannot save against its old version. Session
versions and acceptance receipts retain their meaning; clients must reload after
the offline migration. A second preparation of a format-2 store is a no-op.

The adjacent `<stage>.migration.json` records source and stage fingerprints and
verification counts. Keep it with the backup as an audit record. To roll back, stop
the app, retain the migrated directory, and restore the backup directory to the
original path. Roll back the application code too, since the strict loader requires
the converted format.
