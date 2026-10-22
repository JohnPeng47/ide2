# Canvas API

Connect to the running application's MCP server:

```sh
node --import tsx scripts/mapping/mcp.ts http://IP:PORT
```

Use the host's persistent Mapping MCP connection directly. Common canvas methods
and result contracts are preloaded; use `canvas-api-search` only for additional methods.
For standalone hosts, append `--canvas <canvasId> --document <documentId>` to bind
once at startup, then omit `sessionId`. Agent Chat binds the active document automatically.

## Usage rules

- Use live canvases unless the user explicitly requests a ChangeSession.
- Methods inside `exec.code` are synchronous. Use `return`, not `await`.
- Consecutive `exec` mutations batch by default: one commit, version increment,
  and undo entry. Reads and state-dependent setters (`nodes.setSourceMappings`,
  `nodes.setJumps`) flush preceding edits; successful script completion flushes the rest.
- Uncaught script errors discard pending edits. Invalid batches apply nothing;
  earlier flushed batches remain committed.
- Start document changes with the current document `expectedVersion`.
  `exec` advances the version after each batch.
- Mutation calls return queued ID handles. The tool returns compact
  `transaction.receipts`, including saved highlight IDs and `markdownUrl` links.
  Use `mode: "immediate"` only when full per-edit results are required.
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
