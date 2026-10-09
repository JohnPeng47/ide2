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


API **writes** and real AI execution are **disabled by default**. Diagram loading,
workspace reads, source browsing, and Vite development HMR work without flags.
These are server startup flags, not frontend build flags:

| Flags | Reads | Writes | Real AI execution |
| --- | --- | --- | --- |
| none | Enabled | Disabled (403) | Disabled |
| `--http` | Enabled | Enabled | Disabled |
| `--pi` | Enabled | Disabled (403) | Enabled internally; AI submission routes blocked |
| `--http --pi` | Enabled | Enabled | Enabled |

`--http` enables saves, deletes, agent submissions, and other mutations. Read-only
POST endpoints (source definitions and agent search/status/diff queries) remain
available. Mixed read/write `exec` requests require `--http`. WebSocket readers
can connect; publishing selections and uploading agent context require `--http`.

`--pi` independently covers selection prompts, diagram edits, file compaction,
and Codex-backed selection chat. Disabled AI operations return an error before
any agent session or child process starts. Explicit `NEW_DIAGRAM_AGENT=fake` test
runtimes remain usable without `--pi` and do not call an AI provider.

For local canvas editing and saving without paid agents, build once and start:

```sh
npm run build
NEW_DIAGRAM_PROJECT_ROOT=. NEW_DIAGRAMS_DIR=.diagrams-local/canvas-domain-model npm run preview -- --port 5191 --strictPort --http
```

Add `--pi` to enable AI as well. Development uses the same switches:
`npm run dev -- --http --pi`. The independent `--lsp` switch enables source
navigation. Restart the server to change these capabilities; browser requests,
saved workspace data, and inherited environment variables cannot enable them.
`npm run build:local` allows viewing diagrams while keeping API writes and AI disabled.
