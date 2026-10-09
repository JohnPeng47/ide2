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
