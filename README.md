# New Diagram

A repo-local workspace for collecting source-backed code entities and generating
ASCII diagrams with parallel Pi agents.

See [file layout](docs/architecture/file-layout.md) for source ownership, test
locations, and tool entry points.

## UI test framework

`packages/ui-test-framework` contains the repo-local
`@new-diagram/ui-test-framework` package. It provides a development control dial
for comparing UI variants with toggle, select, range, and color controls. Values
can be persisted locally across reloads.

Keep the framework at the development composition boundary: product components
should receive plain values and should not import the framework directly.

## Install the agent skill

The canonical skill source lives at `skills/new-diagram/`. Install or update its
global Codex mirror with:

```bash
./install-skill
```

The destination is `$CODEX_HOME/skills/new-diagram`, defaulting to
`~/.codex/skills/new-diagram`. Update the canonical source and run the installer
after every skill change; do not edit only one copy.

## Start the studio

The server is the only process that writes DiagramSet records. From this app's
checkout, start it for the target corpus:

```bash
NEW_DIAGRAM_PROJECT_ROOT=/path/to/repository \
NEW_DIAGRAMS_DIR=.diagrams \
npm run dev -- --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`. `NEW_DIAGRAMS_DIR` accepts an absolute path or a
path relative to the corpus and defaults to `.diagrams`. Set
`NEW_DIAGRAM_DOMAIN=document` for a document corpus; the default domain is
`source-code`. Use a separate port and store for another studio instance.

## HTTP namespaces

The app has three ownership boundaries, reflected in its HTTP routes, browser
clients, services, and component directories:

| Area | Namespace | Ownership |
| --- | --- | --- |
| Studio | `/api/studio/*` | Collection, generation, candidates, promotion, artifact edit sessions, templates, experiments, datasets |
| Mapping | `/api/mapping/*` | Canvas saves, selection prompts, file compaction, local chat, workspace persistence |
| Core | `/api/core/*` | Workspace, corpus, representations, projections, imports, plans, highlights, shared rendering |

Both features depend on Core; neither imports the other. `src/app/App.tsx` and
`src/server/app/vitePlugin.ts` compose them. The shared representation catalog is read through
`GET /api/core/project/representations`, returning `{ project, catalog }` (both
null before initialization). There is no second Mapping catalog endpoint.

Old shared `/api/studio/*` URLs, `/internal/mapping/*`, and unnamespaced API
URLs return 404. See [API ownership and migration](docs/architecture/api-ownership.md) for
the route inventory, dependency rules, and client migration details.

## Agent workflows

Sequential agent workflows use `AgentWorkflow<T>` and `runAgentWorkflow` in
`application/core/agents/agentWorkflow.ts`. A workflow defines ordered, named steps with
prompt builders, optional preparation hooks, and output validation. Each step
receives the previous accepted output; missing submissions and failed validation
stop the sequence. The executor owns sessions and tools, returns only the current
turn's accepted submission, and must honor the supplied abort signal to cancel
in-flight work. It can reuse a session or create one per step.

Studio defines its generation -> optional reference -> mapping sequence in
`application/studio/generation/generationWorkflow.ts`. Feature-specific prompts, submission-tool
validation, and persistence remain with their owning feature. Mapping workflows
can use the same Core runner without importing Studio.

Mapping defines `single-file-compaction` as two sequential steps: `compact`, then
`refine`. See [the compaction API](docs/guides/mapping-file-compaction.md) for requests,
stream events, saved artifacts, and validation boundaries.

## Mapping project diagrams

Mapping shares Studio's project and representation catalog. The Mapping submenu
creates diagrams from ASCII or a copy of the current canvas, renames the open
diagram, and saves changes as immutable project revisions. Existing Studio ASCII
diagrams can be opened in Mapping; their first canvas save preserves the diagram
identity and previous revisions. Studio's project representation list can reopen
these canvases.

The floating explorer lists settled diagrams in the current project. Children
under the open diagram are its canvas boxes and groups; selecting a child expands
its ancestors and brings it into view. Switching diagrams retains each open
diagram's unsaved edits, undo history, and pending prompt. Streamed results stay
with the diagram that started the request.

Saved revisions include canvas content, placement, groups, collapsed state, and
source evidence snapshots. They also retain composed ASCII for existing consumers.
Select mapped text and press `N` to preview its saved source, or `P` to prompt an edit.
Save checks the expected revision and rejects stale writes; reload the page to
refresh the catalog after a conflict. **Save workspace** separately persists open
documents, unsaved scenes, retained panes, chat context/history, drafts, and pan/zoom
through `GET/PUT /api/mapping/workspace`. Reload restores that workspace before
falling back to the diagram URL. Undo history remains temporary editor state. Read the catalog through Core and save
canvases with `POST /api/mapping/diagrams`. Selection edits stream from
`POST /api/mapping/prompt`; chat answers stream from `POST /api/mapping/chat`.

## Start a DiagramSet through HTTP

Authenticate Pi's `openai-codex` provider, then list persisted system-prompt
templates when you need a non-default generation style:

```bash
curl --fail-with-body http://127.0.0.1:5173/api/studio/system-prompt-templates
```

Create the DiagramSet:

```bash
curl --fail-with-body --no-buffer http://127.0.0.1:5173/api/studio/diagram-sets \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "path": "/path/to/repository",
  "name": "Feature name",
  "prompt": "Map the feature boundary",
  "promptTemplateId": "flow-first",
  "runReferencePrompt": true
}
JSON
```

The corpus `path` must resolve to the same checkout configured on the server.
`promptTemplateId` is optional and defaults to `default`. Set
`runReferencePrompt` to `true` to run the selected template's reference follow-up;
`referencePrompt` supplies its optional runtime instruction. Omitting
`runReferencePrompt` skips that optional turn. The final mapping turn still runs.

Creation streams newline-delimited JSON (`application/x-ndjson`), including
`created`, progress, and `result` events. Successful collection finalizes the
immutable CodeEntitiesSet, then generates the initial diagrams. The final result
includes the workspace, DiagramSet id, exact template revisions, and immutable
prompt-config ids. Check for `type: "error"` events even after an HTTP 200, and
require a final `result` before treating the operation as complete. The open
studio picks up collection and generation progress automatically.

To submit existing entities and diagrams, send a `MaterializedDiagramSetInput`
manifest with `creationMode: "materialized"` to the same endpoint:

```bash
curl --fail-with-body --no-buffer http://127.0.0.1:5173/api/studio/diagram-sets \
  -H 'Content-Type: application/json' \
  --data-binary @manifest.json
```

Read all DiagramSets and their artifacts from the workspace endpoint:

```bash
curl --fail-with-body http://127.0.0.1:5173/api/core/workspace
```

The response includes `diagramSets` and a `diagrams` dictionary keyed by id.
Each set's `diagramIds` identifies its diagrams; `featuredViewIds` identifies
starred views, and each diagram's `archivedAt` records its archive status.
Backend workflows live in `application/{core,studio,mapping}/`; filesystem,
language-service, and agent integrations live in `infrastructure/`. Only
`src/server/app/bootstrap.ts` wires concrete integrations into the application.
Route handlers live in `src/server/routes/core/routes.ts` and
`src/server/routes/{studio,mapping}/routes.ts`. Shared persisted record types live
in `domain/core/records/domain.ts`; browser clients live in `src/shared/http/api.ts`
and `src/features/{studio,mapping}/api.ts` (canvas saves in
`src/features/mapping/workspace/mappingProjectApi.ts`).

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
node scripts/migrations/relabel-code-entity-identities.mjs /path/to/.diagrams
node scripts/migrations/relabel-code-entity-identities.mjs /path/to/.diagrams --apply
node scripts/migrations/relabel-artifact-ids.mjs --store /path/to/.diagrams --exclude-trash
node scripts/migrations/relabel-artifact-ids.mjs --store /path/to/.diagrams --exclude-trash --apply
```

Apply mode retains a timestamped backup. Recoverable deleted DiagramSets under
`trash/` remain legacy when `--exclude-trash` is used.

For an offline deterministic fixture, set `NEW_DIAGRAM_AGENT=fake`.

Run `npm test`, `npm run check:browser`, and `npm run check:aux-views` to cover
the domain/API behavior, the existing studio workflow, and the focused
empty-generate-star-toggle-reload flow for auxiliary views.

Mapping's **Ask about selection** starts Codex with `gpt-6-astra`, using the
selected box's ASCII diagram, diagram-local rectangle, and mapped file excerpts.
Codex runs in the project's source root with a read-only sandbox and can search
files for additional context. The server needs an authenticated `codex` CLI on
PATH; `NEW_DIAGRAM_CODEX_BIN` can select another executable. On Linux, Codex also
requires `bwrap` (the `bubblewrap` package) on PATH.

Submitting places the conversation marker at the selection's top-right corner.
Low verbosity defaults to the four-sentence brevity prefix; High adds no verbosity
conditioning. Each follow-up sends the original diagram/source snapshot and prior
messages, with conditioning applied only to the latest query. Failed requests have
a Retry action and are excluded from assistant history. Threads last for the open
page; they are not saved with the diagram or restored after reload.

`npm run check:local-chat` exercises the production HTTP path using the explicit
`NEW_DIAGRAM_AGENT=fake` server mode, including marker placement and follow-ups.
