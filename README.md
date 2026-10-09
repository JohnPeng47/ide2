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


The API and real AI execution are **disabled by default**. These are server startup
flags, not frontend build flags; the same build supports each mode:

| Flags | HTTP API / WebSocket / MCP access | Real AI execution |
| --- | --- | --- |
| none | Disabled (403) | Disabled |
| `--http` | Enabled | Disabled |
| `--pi` | Disabled (403) | Enabled internally, inaccessible through HTTP |
| `--http --pi` | Enabled | Enabled |

Static frontend assets are served in every mode. Loading and saving server-backed
canvases requires `--http`. WebSocket access, including Vite's development HMR
socket, is disabled without it. `--pi` covers selection prompts, diagram edits, file compaction, and
Codex-backed selection chat. Disabled AI operations return an error before any
agent session or child process starts. Explicit `NEW_DIAGRAM_AGENT=fake` test
runtimes remain usable without `--pi` and do not call an AI provider.

For normal local canvas use without paid agents, build once and start:

```sh
npm run build
NEW_DIAGRAM_PROJECT_ROOT=. NEW_DIAGRAMS_DIR=.diagrams-local/canvas-domain-model npm run preview -- --port 5191 --strictPort --http
```

Add `--pi` to enable AI as well. Development uses the same switches:
`npm run dev -- --http --pi`. The independent `--lsp` switch enables source
navigation. Restart the server to change these capabilities; browser requests,
saved workspace data, and inherited environment variables cannot enable them.
`npm run build:local` keeps both HTTP and AI disabled by default.
