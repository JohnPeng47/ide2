# New Diagram

A repo-local workspace for collecting source-backed code entities and generating
ASCII diagrams with parallel Pi agents.

## Install the agent skill

The canonical skill source lives at `skills/new-diagram/`. Install or update its
global Codex mirror with:

```bash
./scripts/new-diagram/install-skill
```

The destination is `$CODEX_HOME/skills/new-diagram`, defaulting to
`~/.codex/skills/new-diagram`. Update the canonical source and run the installer
after every skill change; do not edit only one copy.

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
`--prompt-template` is optional and defaults to `default`. Each CLI-created
candidate runs the selected profile's Diagram reference prompt as a follow-up
turn by default; `--reference-prompt <prompt>` supplies its optional runtime
instruction, while `--no-reference-prompt` keeps one-turn generation. The final
CLI event reports the exact template revision and immutable generation
prompt-config id used for the initial diagrams, plus the CodeEntity template
revision and immutable collection prompt-config id.

Query every Diagram across all Diagram Sets as one JSON event:

```bash
npm --prefix scripts/new-diagram run diagram -- list-diagrams \
  --server http://127.0.0.1:5173
```

The event includes `count` and a flat `diagrams` array. Each item is the complete
Diagram record, including its ASCII and stable handle, with `diagramSetName`
and a `status` of `starred`, `unstarred`, or `archived` added for filtering.

The studio supports the waiting state, immutable collected CodeEntitiesSets,
typed `@entity/`, `@diagram/`, and `@component/` references, N parallel agents,
shared Terra/Sol model selection for generation and LLM editing, persisted and
versioned generation system-prompt templates, and a resizable workspace. The
header's Settings menu opens a template editor with Diagram, Call Graph,
Directory View, and DiagramComponent variants, resolved previews,
custom-template creation, and built-in reset. Template edits are atomically persisted in
`.diagrams/system-prompt-templates.json` and loaded again after restart.
Each generation template is a dictionary of named prompt bodies; workflows bind their
system, reference, and mapping turns to those names. Submission-tool and output-kind
requirements, reference instructions and context, and mapping artifact and CodeEntity
context are appended by the application. They remain read-only and appear in the
resolved Settings preview; editable prompt bodies do not use template variables.
Prompt templates, including built-ins, can be deleted as long as at least one
template remains; generation falls back to the first remaining template when
the default has been removed.
CodeEntity collection uses the same versioned prompt-template shape, with
separate identification and compaction criteria. The rendered criteria and
action-oriented collection prompt are snapshotted in an immutable config under
the DiagramSet and linked from its CodeEntitiesSet. The prompt settings dialog
switches between Diagram Generation and Code Entities, exposing Identification
and Compaction criteria through the same versioned editor interactions. The
built-in CodeEntity template is currently selected automatically for collection.
Every generation persists one immutable prompt-config record containing the exact instruction,
reference representations, selected entities, model, style, and rendered
context/system prompts. The batch and all parallel outputs reference that one
record; batches do not duplicate prompt fields. Each generation agent follows
its initial submission and optional reference follow-up with a mandatory hidden
mapping follow-up from the same selected template. That final turn calls the
same artifact submission tool with an unchanged artifact plus its mappings.
Mapping follow-ups are versioned and persisted with generation templates but
are intentionally absent from the Settings editor.
Compacted source ranges render omitted implementation as expandable, source-style
comments containing concise 7-bit ASCII call graphs of the actual calls, loops,
branches, and results in those lines. Every semantic graph node maps to an exact
source subrange and can reveal or re-collapse that block independently without
expanding its sibling nodes; the fold gutter still expands the complete omitted
range at once.
The left-hand `Diagram Sets` ASCII-tree tab selects sets and their diagrams and
exposes an `[x]` action for each set. Starred diagrams carry a visible `★`.
After confirmation,
deletion removes the set from the project index and moves its complete directory
to `.diagrams/trash/diagram-sets/` for manual recovery; active agent runs block
the operation.
Diagram View keeps Code Entities and an ASCII artifact lineage in right-pane
tabs. Full ASCII artifacts are grouped as `[DIAGRAM]`, `[CALL-GRAPH]`, and
`[DIR-VIEW]` candidates. Selecting a lineage node opens that candidate, and its
display name can be edited without changing its stable `@diagram/` handle.
The standalone left-hand `Diagram Files` tab is a read-only tree of paths
referenced by the active artifact's resolved, active-project CodeEntities.
Foreign-project dependencies and paths absent from
the current checkout are reported as unavailable rather than being mistaken
for local files. Associated files carry a clickable `[n]` CodeEntity count;
expanding it shows the entity handles, while clicking either a filename or an
entity opens the corresponding source context in the right-hand Code Entities
panel.
The center-pane Diagram, Call Graph, and Dir View tabs open the starred candidate
for their category. Each category has one independent star; a category with no
star renders an explicit empty state instead of silently selecting a candidate.
Generation nodes retain execution status and contain a DiagramCandidateBatch
for each successful diagram-producing batch. Candidate batches retain their
original membership even when a diagram is archived. Their hover-visible
`feedback` action opens a modal for assigning positive integer ranks to every
candidate; lower is better and ties are allowed. The latest rankings replace
the batch's prior rankings, persist under `diagram-candidate-batches/`, and
render as `[R1]`, `[R2]`, and similar markers in the tree. Nested derivative
generations retain the same generation -> candidate batch -> diagram structure.
Lineage branches can be collapsed with their hidden-diagram count retained in
the toggle. Generated artifact rows expose a `prompt` action for inspecting the
immutable generation inputs. `generate` opens one shared interface for Diagram,
Call Graph, Directory View, and DiagramComponent candidates. A Call Graph can
be generated only after a main Diagram is starred. A Directory View additionally
requires a starred Call Graph. The server injects the starred Diagram into Call
Graph context, and injects both starred artifacts into Directory View context.
Their attached CodeEntities are immutable inputs; Directory View also receives
their sorted source-path inventory. The generation pane exposes these locked
inputs and removes the CodeEntity inclusion checkbox for auxiliary targets.
Call Graph and Directory View start from short, target-specific
instructions without inheriting previous prompts or the DiagramSet's original
request. Auxiliary candidates record the main Diagram separately as their
foundation.
Archiving through `[x]` removes a variant from active UI and prompt references,
clears its category star, and preserves its timestamped JSON for future learning.

Generated artifacts arrive with exact character-span-to-source-range
associations persisted in a sidecar record. `map code entities` remains a
manual retry/remap action and uses the same locked full-artifact submission
shape as automatic generation. Mapped ASCII text is visually marked without changing the
underlying text. Hovering shows the entity summary; clicking switches the right
pane to Code Entities, opens the mapped source range, scrolls it into view, and
highlights its rendered lines. Running the action again replaces that artifact's
mapping with a newly validated result. `map all unmapped` maps the other
candidates from the active generation batch through a bounded parallel worker
pool. Progress and failures remain scoped to each artifact, so one failed map
does not discard successful siblings or block mapping an unrelated artifact.

`select refs` enables a character-aligned rectangle over mapped ASCII. During
the drag, intersecting mappings highlight and their `SelectableText` paths
appear beside the rectangle and as pending entries in the reference tray.
Releasing commits range-qualified CodeEntity IDs to a
DiagramSet-scoped in-memory reference buffer; it does not write to an output
channel. The buffer tray can independently copy exact `path:start-end` source
locations, insert deduplicated `@entity/` tokens into the generation prompt,
dispatch a versioned `new-diagram:reference-buffer` browser event for internal
consumers, remove individual entries, or clear the buffer. `Ctrl`/`Cmd`-drag
provides the same selection interaction without entering the explicit mode.
`Escape` cancels an active rectangle, or exits explicit selection mode when no
rectangle is active.

`capture component` enables a character-aligned rectangle selector over the
active Diagram. Releasing the pointer sends the bounds to the server, which
crops and persists a distinct DiagramComponent under the lineage tree's
Components section. Generation can also switch to DiagramComponent outputs;
generated components remain source-backed, can derive from existing
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
DiagramComponent to the global import library for the current persistence root.
Paste 7-bit ASCII directly or load a plain-text or stored artifact JSON file;
JSON imports extract the artifact name, ASCII, and type when it can be
identified. New durable artifacts, CodeEntities, and source ranges use
UUID-backed ids and carry explicit project, DiagramSet, and CodeEntitiesSet
provenance. `export mapped` downloads a self-contained JSON bundle containing
the artifact, its mapping, and exact CodeEntity/source snapshots. Importing that
bundle preserves its global identity and provenance, so foreign mappings remain
resolvable without access to the source project. Imported dependencies are
read-only in the receiving project. Plain-text and legacy artifact imports still
receive fresh ids and collision-safe handles. Global imports are available to
every DiagramSet in the persistence root. Their index is stored at
`.diagrams/imports/library.json`, with artifact records under
`.diagrams/imports/diagrams/` and `.diagrams/imports/diagram-components/`.
Imported Diagrams appear under the lineage tree's `GLOBAL IMPORTS` branch and
participate in capture, editing, derivative generation, prompt references,
archival, and reload persistence. Captures, edits, and generated derivatives
remain local to the active DiagramSet. Legacy set-scoped imports migrate into
the library on workspace load.

Relabel a legacy active store once before exchanging mapped bundles. Both
commands dry-run and validate by default; add `--apply` only after reviewing the
summary. Run the entity migration first:

```sh
node scripts/relabel-code-entity-identities.mjs /path/to/.diagrams
node scripts/relabel-code-entity-identities.mjs /path/to/.diagrams --apply
node scripts/relabel-artifact-ids.mjs --store /path/to/.diagrams --exclude-trash
node scripts/relabel-artifact-ids.mjs --store /path/to/.diagrams --exclude-trash --apply
```

Apply mode retains a timestamped backup. Recoverable deleted DiagramSets under
`trash/` remain legacy when `--exclude-trash` is used.

For an offline deterministic fixture, set `NEW_DIAGRAM_AGENT=fake`.

Run `npm test`, `npm run check:browser`, and `npm run check:aux-views` to cover
the domain/API behavior, the existing studio workflow, and the focused
empty-generate-star-toggle-reload flow for auxiliary views.
