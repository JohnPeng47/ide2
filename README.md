# Start the diagram server

From the project root, install dependencies once:

```sh
npm ci
```

Build and start the server:

```sh
npm run build:local
```

Open http://localhost:5191/.

The server uses this checkout as its project root and
`.diagrams-local/canvas-domain-model/` for diagram and workspace data.
The eight current canvases are included in the repository; generated workspace
records stay local.

Open **Menu → Evals** (or `/evals`) to create a comparison session from saved
CanvasViews or current saved canvases. Add one or more pairs, then create the
session. Each side opens with its saved/default Mapping camera; pan and zoom
independently, resize the divider, or reset the camera. Previous/Next traverses
the pairs, and the sidebar switches sessions. Sessions retain private checkpoint
copies in `compare-sessions/` under the diagram store, so later source edits or
deletion do not change an existing comparison. This initial version does not
generate comparisons with an agent.

Run `npm run check:compare-sessions` for the browser lifecycle check (requires
Playwright Chromium and its system libraries).


The app works without flags: loading, editing, saving, autosave/history snapshots,
deleting diagrams, accepting changes, and live canvas synchronization remain available.
These server startup flags control agent access and real AI execution independently:

| Flags | Browser app and persistence | Agent API mutations/context uploads | Real AI execution |
| --- | --- | --- | --- |
| none | Enabled | Disabled (403) | Disabled |
| `--http` | Enabled | Enabled | Disabled |
| `--pi` | Enabled | Disabled (403) | Enabled for browser AI actions |
| `--http --pi` | Enabled | Enabled | Enabled |

`--http` gates mutating `/api/mapping/agent/tools/*` requests (including programmable
`exec`) and WebSocket `agent-context.upload`. Read-only tool queries remain available.
Browser persistence, canvas registration/replies, and selection publishing are outside
this flag. Browser attachment, diagram-edit and change-acceptance routes use fixed
operation contracts instead of the programmable tool endpoint.

This is a capability switch, not client authentication: ordinary app endpoints remain
HTTP-accessible. `--pi` is the independent guard against paid AI execution through any
route, including diagram edits, selection prompts, compaction, and Codex-backed chat.
Fake test agents do not call an AI provider and do not need `--pi`.

For normal local use without paid AI:

```sh
npm run build:local
```

For browser AI, add `--pi` to the server command; for external agent mutation tools,
add `--http`. Development examples: `npm run dev -- --pi` or
`npm run dev -- --http --pi`. The independent `--lsp` switch enables source navigation.
Restart the server to change capabilities.

Open **Search**, then the **Agent Chat** tab beside **Search** and **LLM**, to use Codex beside the canvas. In chat mode, the **<** handle opens the side menu with conversations, model/effort/access settings, and the other tool tabs. The composer scales with the panel size and grows with its text, keeping at least two lines visible. Workspace actions (New, Save, Treemaps, save/restore, export/import) are available from the floating **Menu** button; there are no fixed top or bottom bars. Install
the Codex CLI, sign in with `codex login` on the server, and start this app with
`npm run dev -- --pi`. The panel uses the configured project source directory and
your existing Codex account. New chats default to **Full access (YOLO)**: no Codex sandbox or approval prompts. The Access selector also offers Workspace and Read only; existing chats retain their saved access setting. It offers model/effort selection, streaming Markdown,
tool output, approvals, questions, and Stop. Workspace access permits project edits;
Read only restricts file writes. Closing the panel leaves an active turn running.
Conversations are saved under the diagram store's `agent-chat/` directory and can
be reopened from the conversation selector after reload or server restart.
Model selections are saved immediately in this browser and reused across reloads
and conversations, including an explicit choice of Codex default.

**Read Canvas** sends the active live canvas's short-context JSON to the conversation
as `read_canvas` tool output and starts an agent response. It preserves your message
draft and includes diagram ASCII, source references, hierarchy, and edges. The button
is available when chat is idle and a live canvas is open, including in Read only
mode. Each click reads fresh state; it does not change the canvas. This requires a
Codex CLI with app-server `turn/start.toolOutput` support.

Canvas MCP uses the same tools inside and outside Agent Chat. Agent Chat supplies a
host-owned binding to the browser instance and document captured when a turn starts;
reads and mutations use that target automatically. A selected reference targets its
captured canvas. Reloading requires a fresh turn; a disconnected browser is never
replaced with a headless instance. Standalone clients still use `canvas.list()` and
`canvas.attach(...)`. Read-only chat access also blocks canvas mutations.

For a bound `exec`, start with `return canvas.read({level: "small"});`. This returns
current ASCII, content anchors and ranges, complete source mappings/evidence for the
selected diagrams, mapped file ranges per node, highlight/jump status, and collapse
state. `nodeIds` restricts the read. `level: "full"` adds groups, layout, geometry,
floating objects, view state, and existing connections. Neither level exports undo
history. IDs such as `@r<generation>_<read>.node:1` are immutable aliases scoped to
that read's browser/document. Tables expire after 30 minutes or 128 retained reads;
a stale alias asks for a fresh read and is never reassigned. Pass the read's `version`
as `expectedVersion` when mutating. `nodes.setSourceMappings` and
`set_diagram_source_mappings` no longer accept `expectedContentHash`.

Ordinary attachment reads identity/version only. Generation requests exact base and
reference revisions, including logical node identities. Proposals start from a fresh
current-state baseline; undo/redo retain their internal checkpoint access. Explicit
whole-canvas Save flushes autosave, verifies the captured version/checkpoint, and
publishes immutable record references. It returns a receipt rather than uploading or
downloading the history archive or expanded catalog; archived records remain intact.
Mutation replies contain the affected nodes, not the whole canvas.

Every browser command reply is measured as a complete UTF-8 JSON envelope. The limit
is 64 MiB. Oversized replies report the method, actual byte count, and limit; an HTTP
413 resolves the pending command immediately. After an uncertain mutation outcome,
retry the identical request and request ID. Browser reply diagnostics report bytes
and elapsed time without diagram content. Exec reads are excluded from mutation
receipt caches. The embedded JS runtime separately limits each API/result to 4 MiB.

Agent Chat uses a compact transcript adapted from Codex TUI (`cc7ba33601`): adjacent
reads/searches form an exploration group, commands show a three-line output tail,
and file changes show diff previews. Commentary streams in place; supplied reasoning
summaries drive the working indicator and are available in the expanded transcript.
Approvals and answered/interrupted questions retain a history entry. Markdown keeps
code highlighting, adaptive tables and copy actions; project-local file links open
a source excerpt when the source repository is available. Markdown mirrors Codex's
terminal typography and semantic colors, with adaptive Catppuccin code highlighting.
Ctrl/Cmd + scroll over the transcript zooms its text (75–200%); the percentage control
resets to 100%. Zoom is remembered locally. Ordinary scrolling still browses history.
Diagram and code blocks can be collapsed individually; the collapsed label counts hidden source lines, including blank lines. Copy actions still use the full content.
Tool previews truncate long lines; expanded details, markdown code and tables fit the
panel width. Drag the panel's left/bottom edges or bottom-left grip to resize it.
WindowPanel dimensions are remembered locally across reopening and browser reloads,
separately for workspace tools, each canvas's source/treemap panels, and each DiffTree.
Search, LLM and Agent Chat share one size. Smaller viewports constrain the displayed
size without overwriting the saved preference.

Text updates are coalesced (32 ms server / 50 ms visible client). Hidden tabs keep
receiving events without publishing transcript renders. Details mount only when
expanded (large exploration groups reveal 20 entries at a time), and the timeline initially mounts the latest 80 blocks with an option to
load earlier activity. Tool output retains its last 128,000 characters with an
explicit omission count; diff excerpts share the same limit per change item. Conversation
snapshots are transferred in parts and displayed atomically. Completed tool details
load on demand after reconnect; older message metadata still travels with the snapshot. Existing flat chat records remain readable; missing classifications
are not inferred from old command strings.
