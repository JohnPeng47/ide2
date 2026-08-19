# New Diagram

A repo-local workspace for collecting source-backed code entities and generating
ASCII diagrams with parallel Pi agents.

## Start the studio

The server is the only process that writes `.diagrams/`. Start it for the target
checkout before invoking the agent-facing CLI:

```bash
NEW_DIAGRAM_PROJECT_ROOT=/path/to/repository npm --prefix scripts/new-diagram run dev
```

Open `http://127.0.0.1:5173`. The dashboard can remain open while the CLI starts
a collection.

## Start a DiagramSet

Authenticate Pi's `openai-codex` provider, then run from this repository in a
second terminal:

```bash
npm --prefix scripts/new-diagram run diagram -- create \
  --path /path/to/repository \
  --name "Feature name" \
  --prompt "Map the feature boundary" \
  --server http://127.0.0.1:5173
```

The CLI asks the server to create the DiagramSet, streams collection progress,
and stops at the human finalization gate. The CLI path must resolve to the same
checkout as `NEW_DIAGRAM_PROJECT_ROOT`. `--server` defaults to
`http://127.0.0.1:5173` and can also be set with `NEW_DIAGRAM_SERVER_URL`.

The studio supports the waiting state, immutable CodeEntitiesSet finalization,
typed `@entity/` and `@diagram/` references, N parallel diagram agents, and a
resizable workspace. Diagram View keeps Code Entities and an ASCII generation
lineage in right-pane tabs; selecting a lineage node opens that diagram, and
its display name can be edited without changing its stable `@diagram/` handle.
Root generation nodes group diagrams without ancestors, while derivative
diagrams attach directly to their parent without intermediary generation nodes.
Lineage branches can be collapsed with their hidden-diagram count retained in
the toggle. Archiving through `[x]` removes a variant from active UI and prompt
references while preserving its timestamped diagram JSON for future learning.

For an offline deterministic fixture, set `NEW_DIAGRAM_AGENT=fake`.
