# Studio/Experiment removal validation

Implemented in `worktree/mapping-only` on 2026-09-21. The baseline deletion inventory is in [studio-removal-inventory.md](studio-removal-inventory.md).

The application now opens Mapping directly. Studio/Experiment routes, runtimes, persistence operations, models, UI, dedicated tests, scripts, and the repository's old bootstrap skill are removed. Shared files retain Mapping behavior; catalog promotion is replaced by Mapping saves in test setup. Project loading migrates legacy source registrations without changing the original DiagramSet files or catalogs. Persisted data and the pre-existing staged `softwarez/tldraw` addition are preserved.

Validation completed:

- `npm test -- --maxWorkers=4`: 338 tests passed across 65 files, including source migration, source isolation, blank-project initialization, retired endpoint rejection, revision conflicts, projections, compaction, chat, workspace persistence, and LSP startup.
- `npm run build`: TypeScript and production build passed. Existing Rollup dependency annotation and bundle-size notices remain.
- Real Linux Chromium: project creation/save/reload, grouped scenes, document switching, deletion cancellation/failure/retry, workspace restoration, and root/legacy entry paths passed.
- Real Linux Chromium: source-code and document corpus selection/HTTP access and markdown rendering passed.
- Real Linux Chromium: source panes, exact highlights, compaction folding, source switching/retry, scrolling, canvas pan/zoom, connections, recursive collapse, viewport/workspace reload, and projection validation passed. `check:canvas` now invokes this Mapping workflow instead of Studio setup.
- MCP/browser: tool discovery, search, draw, request retries, conflicts, rollback, undo/redo, standalone saves, new documents, and reload passed.
- Change-session browser: preview diffs, original/proposed views, folded indicators, multiple sessions, draft/camera retention, reload, and unchanged originals passed.
- `git diff --check` passed.

The browser harness was run with the installed Linux Chromium. Its default Windows Chrome selection failed during profile cleanup in this environment.

One broader pre-existing regression remains: undoing an asynchronously generated sub-diagram restores a `generating` control state and leaves Redo disabled. The same failure was reproduced against the original `worktree-perf-debug` production build using a disposable fixture. The older line-grid script also counts an invisible root anchor as a displayed box. This removal does not change editor undo semantics; the original line-grid test is retained. Basic transaction undo/redo passed in the MCP browser workflow.

Historical diagram examples and immutable source snapshots can still mention removed code. They remain data/fixtures, not active Studio implementations. No running user server or original workspace was changed during validation.
