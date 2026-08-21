# New Diagram

A repo-local workspace for collecting source-backed code entities and generating
ASCII diagrams with parallel Pi agents.

## Start the studio

The server is the only process that writes DiagramSet records. Start it for the
target checkout before invoking the agent-facing CLI:

```bash
npm --prefix scripts/new-diagram run diagram -- serve \
  --path /path/to/repository \
  --diagrams-dir .diagrams
```

Open `http://127.0.0.1:5173`. The dashboard can remain open while the CLI starts
a collection. `--diagrams-dir` accepts an absolute path or a path relative to
the repository and defaults to `.diagrams`; use `--port` to run another studio
alongside an existing server.

## Start a DiagramSet

Authenticate Pi's `openai-codex` provider, then run from this repository in a
second terminal. List persisted system-prompt templates when you need a
non-default generation style:

```bash
npm --prefix scripts/new-diagram run diagram -- prompt-templates \
  --server http://127.0.0.1:5173
```

Then create the Diagram Set:

```bash
npm --prefix scripts/new-diagram run diagram -- create \
  --path /path/to/repository \
  --name "Feature name" \
  --prompt "Map the feature boundary" \
  --prompt-template flow-first \
  --server http://127.0.0.1:5173
```

The CLI asks the server to create the DiagramSet and streams collection and
generation progress. Successful collection finalizes the immutable
CodeEntitiesSet, then immediately launches three Sol diagram agents with all
collected entities selected. The CLI path must resolve to the same checkout
passed to the server's `--path`. `--server` defaults to
`http://127.0.0.1:5173` and can also be set with `NEW_DIAGRAM_SERVER_URL`.
`--prompt-template` is optional and defaults to `default`. The final CLI event
reports the exact template revision and immutable generation prompt-config id
used for the initial diagrams.

The studio supports the waiting state, immutable collected CodeEntitiesSets,
typed `@entity/`, `@diagram/`, and `@component/` references, N parallel agents,
shared Terra/Sol model selection for generation and LLM editing, persisted and
versioned generation system-prompt templates, and a resizable workspace. The
header's Settings menu opens a template editor with Diagram and
DiagramComponent variants, resolved previews, custom-template creation, and
built-in reset. Template edits are atomically persisted in
`.diagrams/system-prompt-templates.json` and loaded again after restart. Every generation
persists one immutable prompt-config record containing the exact instruction,
reference representations, selected entities, model, style, and rendered
context/system prompts. The batch and all parallel outputs reference that one
record; batches do not duplicate prompt fields.
The Diagram Set picker exposes an `[x]` action for each set. After confirmation,
deletion removes the set from the project index and moves its complete directory
to `.diagrams/trash/diagram-sets/` for manual recovery; active agent runs block
the operation.
Diagram View keeps Code Entities and an ASCII
artifact lineage in right-pane tabs; selecting a lineage node opens that
diagram, and its display name can be edited without changing its stable
`@diagram/` handle.
Root generation nodes group diagrams without ancestors, while derivative
diagrams attach directly to their parent without intermediary generation nodes.
Lineage branches can be collapsed with their hidden-diagram count retained in
the toggle. Generated artifact rows expose a `prompt` action for inspecting the
immutable generation inputs. `create derivative` restores the source prompt's
selected entities, output kind, model, and system style, prepends the current
artifact reference, and leaves unavailable historical references visible for
resolution. Archiving through `[x]` removes a variant from active UI and prompt
references while preserving its timestamped diagram JSON for future learning.

`map code entities` runs an LLM over the active artifact and its declared
CodeEntities, then persists exact character-span-to-source-range associations
in a sidecar record. Mapped ASCII text is visually marked without changing the
underlying text. Hovering shows the entity summary; clicking switches the right
pane to Code Entities, opens the mapped source range, scrolls it into view, and
highlights its rendered lines. Running the action again replaces that artifact's
mapping with a newly validated result.

`capture component` enables a character-aligned rectangle selector over the
active Diagram. Releasing the pointer sends the bounds to the server, which
crops and persists a distinct DiagramComponent under the lineage tree's
Components section. Generation can switch between Diagram and DiagramComponent
outputs; generated components remain source-backed, can derive from existing
components, and are available to later prompts through `@component/<handle>`.
Selecting any component opens its ASCII in the main DiagramComponent view,
where another rectangle can be captured recursively as a direct child.
Component `[x]` controls archive variants out of the UI and prompt context while
retaining their timestamped JSON artifacts on disk.
Component handles stay out of the compact lineage label; hovering or focusing a
row reveals `copy`, which writes its full `@component/<handle>` reference.

`edit mode` is available for both Diagrams and DiagramComponents. It creates a
persisted working-copy session without modifying the source artifact. The main
pane becomes a cursor-editable ASCII textarea, while the right-pane Operations
tab records reversible manual, marker, and LLM changes. `Ctrl-Z` and `Ctrl-Y`
move through that operation buffer; undoing and then making a new change drops
the redo branch.

The Single Marker tool replaces one clicked character with an unused rare
7-bit marker and inserts its short reference, such as `@^`, into the LLM edit
instruction. The edit menu can run each LLM operation with GPT-5.6 Terra or
GPT-5.6 Sol, and records the selected model with that operation. Every submitted
LLM edit automatically includes the complete current Diagram or DiagramComponent
plus its active marker guide. Saving
publishes a new `EDITED` lineage child and retains the session history; discard
keeps the session record for learning without publishing a variant. Existing
component capture and derivative generation remain unchanged outside edit mode.

The project header's `IMPORT` action adds an existing Diagram or
DiagramComponent to any DiagramSet in the current Project. Paste 7-bit ASCII
directly or load a plain-text or stored artifact JSON file; JSON imports extract
the artifact name, ASCII, and type when it can be identified. Imported artifacts
receive fresh ids and collision-safe handles. Imported Diagrams appear together
under the lineage tree's `IMPORTS` branch, while every imported artifact keeps an
`IMPORTED` marker and participates in capture, derivative generation, prompt
references, archival, and reload persistence through the same records as
generated artifacts.

For an offline deterministic fixture, set `NEW_DIAGRAM_AGENT=fake`.
