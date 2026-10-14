# Current work

Before starting, read `SUMMARY.md` at the repository root. It covers the in-progress change-treemap
redesign (designs in `docs/designs/treemap-alternatives/`), the chosen direction, and the open
box-alignment issue.

# Canvas API

Connect to the running application's MCP server:

```sh
node --import tsx scripts/mapping/mcp.ts http://IP:PORT
```

Inspect MCP tool schemas for parameters.
Use `canvas-api-search({query: ""})` to discover canvas methods.
Search specific methods for parameters and examples.

## Usage rules

- Use live canvases unless the user explicitly requests a ChangeSession.
- Methods inside `exec.code` are synchronous. Use `return`, not `await`.
- Each document change saves immediately. There is no batch rollback.
- Start document changes with the current document `expectedVersion`.
  `exec` advances the version for subsequent changes.
- Use the session version for ChangeSession metadata updates and acceptance.
- Use a unique `requestId` for each new request.
  After a transport failure, retry the identical request with the same ID.
  Retry state does not survive a backend restart.
- After a script or validation error, reread the document.
  Submit corrected work with its current version and a new request ID.
- Preserve actual newline characters in diagram text.
- Patch ranges use 1-based, inclusive lines in current raw `content.ascii`.
  Apply ranges from one snapshot from bottom to top, or recalculate after each change.
- Read current anchors before creating edges.
  Content changes can invalidate anchors; backend restarts invalidate short handles.
- Include `changeSessionId` on every proposal call.
  `sessionId` identifies an attached document, not a ChangeSession.
- Proposal changes save automatically. Do not call `save_diagram` for proposals.

## ChangeSession DiffTree flow

Discover these top-level tools and their request schemas through MCP `tools/list`.
Call them directly through MCP, outside `exec.code`.

1. **Discover hunks:** call `get_repository_diff_hunks` with `repositoryId` and
   `commits`. Collect hunk IDs and the returned pinned commit/head SHAs. Follow
   `nextOffset` until null, reusing those pinned SHAs on subsequent pages.
2. **Create the session:** call `create_diagram_change_session` with the pinned
   repository/commits/head, a title, a unique `requestId`, and `diffTree`. Supply
   its ASCII tree and mappings from `source: {line: 2}` (1-based raw ASCII line)
   to `targets: [{kind: "diff-hunk", hunkId: "..."}]`.
3. **Read and verify:** call `read_change_session_diff_tree` with the returned
   `changeSessionId`. To revise the tree or mappings, call
   `update_diagram_change_session` with `expectedVersion` from the read's session
   `version`, a new `requestId`, and `diffTree: {expectedRevisionId, ascii?, mappings}`.
   Use the read's `diffTree.revisionId` and supply the complete mapping list.
