# Experiments and project instructions

Read this file before creating, running, evaluating, or modifying experiments.
It also contains the shared project instructions formerly kept in `AGENTS.md`;
those rules continue to apply to other project work.

## Running experiments

- When creating an experiment, register its ID in the experiment map and add it to a relevant existing Home view or to the main Home overview.
- Write experiment comments only when the user explicitly instructs you to do so.
- Agents create and launch experiments. In the overview, a prompt can be edited
  and saved to the prompt library. Confirming the optional rerun uses the source
  run’s arguments and groups its results under `[RERUN]` in Variants and prompts.
- Follow the user's requested model, reasoning effort, sample count, and scope.
  Pin inputs and prompt versions so results can be reproduced and compared.
- When comparing variants, reuse the same pinned source range and starting
  canvas state unless the user requests a different comparison.
- Keep outputs and their provenance immutable. A later attempt must retain its
  own inputs, prompt version, and output references.
- Prefer saved Markdown outputs (`format: "markdown"`) for plans, judge responses, and other prose; they open automatically as rendered Markdown.
- Distinguish model generations from deterministically materialized artifacts.
  A scaffold derived from an existing plan is not another LLM sample.
- Report actual execution state. A failure before a model call is an input or
  orchestration failure; downstream work that never ran must not be described
  as a failed model generation.
- Generation timeout is 60 minutes per call; aggregate AgentContexts may contain
  up to 16 MiB. Avoid expanding the same pinned source twice in a model input.
- Before paid generation, exercise the actual pinned inputs through restore,
  deterministic materialization, save, reopen-for-editing, and output loading in
  disposable storage. Preview checks alone do not validate the execution path.
- Stop on infrastructure or validation errors. Do not silently spend on model
  repair calls under an `n=1` label. Preserve raw responses and replay them locally
  after code fixes before considering any new generation.
- For diagram history, `node --import tsx scripts/evals/history/verify.ts <directory>`
  runs the preflight and replays saved responses with zero model calls. The runner
  also enforces preflight before generation and reuses an existing saved response.

## Layout-first outputs

Use workflow `canvas-layout` and its `layout` stage to generate a layout from a
pinned AgentContext and optional source canvases. The built-in prompt is
`builtin-canvas-layout`. The model returns the `layout` object below. To attach
an existing layout to a run cell, POST the full envelope to
`/api/mapping/evals/runs/:runId/output-result`.

```json
{
  "cellKey": "plan",
  "format": "canvas-layout",
  "layout": {
    "canvases": [{
      "id": "session", "title": "Terminal session",
      "diagrams": [
        {"id":"io","title":"PTY output","position":{"column":0,"row":0},"size":{"columns":32,"lines":12},"nodes":[{"id":"screen","line":7,"label":"Updated cells"}]},
        {"id":"render","title":"Frame","position":{"column":48,"row":2},"size":{"columns":28,"lines":9},"nodes":[{"id":"snapshot","line":3,"label":"Viewport snapshot"}]}
      ]
    }],
    "edges": [{"source":{"canvas":"session","diagram":"io","node":"screen"},"target":{"canvas":"session","diagram":"render","node":"snapshot"},"label":"feeds"}]
  }
}
```

Positions use zero-based columns and rows. The height includes the title on
line 1. Each subsequent named node reserves one 1-based line and participates
in at least one edge. Other lines reserve space for later writing. The output
viewer shows each canvas at its planned geometry and lists the directed
connections. Select an endpoint to see its canvas and highlight its node.
The experiment batch read returns the original layout for use in later stages.

## Experiment navigation

Alt + left-click goes back one visit. Alt + right-click goes forward. Alt + ← and
Alt + → use the same history, including inside output canvases and inspectors.
Plain ← and → follow the experiment tree. **Overview** opens the experiment
overview directly.

Following a canvas jump, choosing a canvas, switching between Result and
Changes, or opening an inspector records a visit. Returning to a canvas restores
its focused target and camera. Panning and zooming update the current visit.
Opening another destination after going back starts a new forward path.

## Experiment overview

Outputs may be saved as Markdown for plans, judge responses, or other prose.
To pin a new result on an existing run cell, POST to
`/api/mapping/evals/runs/:runId/output-result` with
`{ "cellKey": "...", "format": "markdown", "markdown": "# Plan\n\n..." }`.
The viewer opens that saved format automatically; no canvas is created. Markdown
outputs participate in output counts and navigation but have no canvas promotion
or canvas comparison controls. The text is immutable: identical retries succeed;
different content requires a new output. Existing canvas outputs retain their format.
Use `WindowPanel` for non-canvas output panels and the shared `TerminalMarkdownContent` renderer for Markdown.

Use an expandable ASCII tree as the main display:

```text
Experiment
+-- Inputs
|   +-- Pinned source and starting canvas state
|   +-- AgentContexts
|   `-- Conditions and generation settings
+-- Phase 1: <purpose>                              [live status]
|   +-- # Explanatory comment
|   +-- Inputs and dependencies
|   `-- Outputs
|       `-- <output or artifact>                   [live status]
|           [output] [prompt] [inputs]
`-- Phase 2: <purpose>                             [live status]
    +-- # Explanatory comment
    +-- Inputs and dependencies
    `-- Outputs
        `-- <output or artifact>                   [live status]
            [output] [prompt] [inputs]
```

- Keep the format reusable: inputs followed by the experiment's ordered phases.
  Workflows without explicit phases can use their ordered stages.
- When a phase compares variants, group its outputs under one expandable node
  per variant instead of rendering every output in a flat list. Show the variant
  name and output count on that node, followed by a short description child
  explaining what distinguishes the variant. Derive the description from its
  pinned prompt or condition; keep shared inputs and settings at the parent level.
  For example:

  ```text
  Phase 2 · Generate trees
  `-- [-] Outputs
      +-- [-] A1 · Minimal prompt · 11 outputs
      |   +-- # One ASCII tree per point using six shared examples.
      |   +-- Immutable Diagram Model     [finished] [output] [prompt] [inputs]
      |   `-- Canvas Commands and History [finished] [output] [prompt] [inputs]
      `-- [-] A2 · Explicit 3+1 model · 11 outputs
          +-- # Same inputs and examples, plus guidance on modular structure,
          |     calls, ownership, and data dependencies.
          +-- Immutable Diagram Model     [finished] [output] [prompt] [inputs]
          `-- Canvas Commands and History [finished] [output] [prompt] [inputs]
  ```

  The example abbreviates each output list. Actual counts and statuses must come
  from experiment records. Output rows should name only their subject; do not
  repeat the enclosing variant or stage. Put UUIDs in expanded details rather
  than visible row titles. Keep output, prompt, and input inspection actions on
  the relevant output rows.
- Put pinned prompt inspection on each variant branch, with output lists
  collapsed initially. When a variant uses several distinct stage prompts, show
  each under a Prompts branch. Resolve prompt text using the run cell's execution
  stage, which may differ from the experiment's workflow stage. Name variants
  descriptively and store concise explanations of their differences.
- Generate short, scannable titles for experiments, phases, batches, and outputs.
  Aim for 2–6 words and at most 50 characters, excluding IDs such as `B01`.
  Name the main topic; do not turn the title into a sentence or a list of changes.
  For example, use `B01 · Runtime foundations`, not
  `B01 · Establish the tldraw runtime and distinguish historical proposals`.
  Put scope, rationale, and secondary changes in the explanatory comment or
  expanded details. Do not repeat the phase, execution status, model, or canvas
  count in the title when the surrounding UI already shows them.
- When explicitly requested, generate explanatory comments and save them with
  the corresponding experiment, phase, or output. Use stored descriptions in
  the overview rather than generating new prose on every render.
- Fill statuses, counts, dependencies, and links from experiment records. Do not
  invent them in generated comments or count every workflow stage against an
  artifact that belongs to only one phase.
- Each phase has an output section with live statuses. The output action opens
  the saved artifact; the prompt action opens the relevant pinned stage prompt,
  as raw text, without Markdown rendering or a duplicate source expansion.
  Clearly identify saved template text when expanded
  runtime text was not retained.
- Deterministic artifacts link to their generation source. Do not imply that a
  scaffold or a step that failed before generation made its own model call.
- Provide inspection of pinned inputs, failures, and prior attempts where
  available. Keep prompt ancestry secondary to the workflow tree.
- Background status refreshes and camera gestures must not rebuild an unchanged
  canvas or reroute its edges. Retain stable endpoint references and invalidate
  geometry only when relevant preview state changes.

## Ground truth

Ground truth samples are known-good answers for judging, listed under the
overview's Inputs. They are judge-side only: never cite them in generation
prompts, AgentContexts, or `{{ref:...}}` references (those are prompt inputs).

```http
POST /api/mapping/evals/experiments/:experimentId/ground-truth
{ "requestId": "<uuid>", "name": "...", "format": "ascii-tree", "ascii": "...",
  "caseIds": [], "source": { "commit": "<sha>" },
  "provenance": { "kind": "human" | "model" | "model-reviewed", "model": "..." } }
```

- For a reference exchange use `format: "markdown"`, with `query` containing the original user request and `markdown` the verbatim answer. Supply the same case IDs, source snapshot and provenance fields as for ASCII trees. Inspect under Inputs → Ground truth shows the query and rendered answer. Keep the answer out of the generation context.
- Samples are append-only and immutable; the request ID becomes the sample ID
  and identical retries succeed. Submit a corrected answer as a new sample.
- `ascii` is stored exactly, with its SHA-256. Empty `caseIds` applies to every case.
- `source.commit` records the snapshot the answer describes. When it differs
  from an input case's pinned commit, say so in `description`; judges must not
  penalize outputs for differences that come from the snapshot gap.
- Design saves preserve ground truth; they cannot add, change or remove it.

## Experiment tags

Experiment tags are separate from comment tags. Add a new tag or choose an existing
one in the experiment header; remove a tag with its × button. Tags also appear in
the experiment sidebar.

`GET /api/mapping/evals/experiments` and `GET /api/mapping/evals/experiments/:id`
return a `tags` array on every experiment (empty for untagged records). The Overview
API includes the same array in `experiment.tags`.

```http
PATCH /api/mapping/evals/experiments/:id/tags
{ "expectedRevision": 35, "tags": ["core-discovery", "review"] }
```

This replaces the tags and returns the updated experiment. Names are trimmed and
deduplicated; each experiment supports up to 20 tags of 1–50 characters. Pass `[]`
to clear them. Stale changes are rejected; read the current revision before retrying.
Design creation and saves also accept `tags`; omitting it on an update preserves
existing tags. Tag edits do not launch generation.

## Reading experiments from agents

Use the Overview read followed by a batch read; agents do not need to join run
and cell records themselves:

```http
GET /api/mapping/evals/experiments/:experimentId/overview
```

The response is an `ExperimentOverview`: experiment identity/revision, a
presentation tree under `root`, and `read: {method, url, maxRefs}`. Tree nodes have
stable IDs, labels, optional source IDs, statuses/counts, children, and actions.
The tree is an independent view: sections, comments, and summary nodes can group
multiple records. It is not a persisted domain ownership hierarchy. The UI and
API use the same projection. Prompt text, input details, and output payloads are
excluded from the overview.
Long generated explanations and failures appear as short previews with detail
read actions; the saved full text is retained.

When a case consumes a saved output, record its source in the experiment design.
Each `inputLineage` entry pins a `caseId` and its `agentContextId`. Its ordered
`sources` array contains the producing `experimentId`, `runId`, `cellKey`, a
human-readable `label`, and optionally the source `checkpointId`. For judge pairs,
preserve A/B order, including both entries when the same output fills both roles.
For older cases, add sources only when the original receipts identify them.

To trace a result, follow its overview row’s `source.caseId` to the matching case
under Inputs → AgentContexts. Each child’s `upstreamOutput` links to the producing
run cell. These references are available in the overview response itself. Read
an input when you need its contents, or an output when you need to evaluate it.

Select the desired phase/variant/output nodes and collect their action `refs`.
Phase and variant prompt actions include all distinct pinned prompts in scope.
Send any mix of references to the returned read URL in one request:

```http
POST /api/mapping/evals/experiments/:experimentId/read
Content-Type: application/json

{"refs":["<prompt reference>","<output reference>","<inputs reference>"]}
```

- This POST only reads data; it never launches generation or modifies records.
- Batch 1–100 references per request. Independent reads run concurrently with
  bounded concurrency; repeated references share work. Results preserve request
  order, including duplicates, and each has its own success or error.
- References are opaque and scoped to the experiment. Use those returned by the
  overview; do not construct them from titles or sidebar positions. If a reference
  is no longer present, read the current overview.
- Prompt results contain exact raw pinned template text, the execution stage,
  pinned references, and all contributing run/cell/prompt versions. Matching stage text, template references, and pinned excerpts share one read; provenance is retained for every use.
  A saved template is not claimed to be the fully expanded runtime prompt.
- For inspection, comparison, and explanation, send only `refs`. Canvas outputs default to `graph`, with diagram IDs, ASCII text, and labeled edges in `proposed` and any non-null `baseline`.
- Request a richer projection only when preparing a user-requested modification. Add `"projectionType": "layout"` alongside `refs` if the edit needs positions or bounds, or `"projectionType": "detail"` if it needs exact anchors, revisions, or source evidence. Run output and generated checkpoint GETs accept the same selector as a query parameter.
- Markdown outputs return the saved text.
  Inputs return pinned context/checkpoint references and hashes rather than
  expanding the source corpus. Details, settings, cases, and attached judgements
  are also readable through their tree actions.
- Experiment `revision` identifies the experiment definition. Live execution
  statuses can advance independently between reads.
- Experiment identifiers currently remain UUIDs; no stable experiment numbering
  is implied by the sidebar order.

## Progressive diagram history experiments

These requirements apply to the progressive history experiments, not to every
experiment workflow.

- Use two phases: generate the complete plan up front, then execute it serially.
- Batch each DiffSession over multiple consecutive commits, in codebase history
  order. Do not assume one DiffSession per commit.
- Phase 1 produces ordered AgentContexts containing the batches' diffs and source
  code. Consider later commits during context preparation and planning, and label
  future evidence distinctly from changes implemented in the current batch.
- Decisions to create diagrams or canvases must consider later commits. Planning
  batches in isolation biases the result toward modifying existing diagrams and
  misses boundaries that become useful later.
- Phase 2 starts each batch from the preceding completed canvas state. Save a
  complete, pinned set of CanvasViews at each step, producing a history that can
  be walked from early changes to later changes.
- Use efficient immutable persistence with shared unchanged records rather than
  duplicating every full canvas at every step. Preserve starting geometry and
  connections; do not replace them with arbitrary stacked positions.
- Keep each step's predecessor state pinned so it can later be tuned in an
  independent eval, assuming the preceding updates are accepted.

### Structure-first variant

- Keep this as a separate experiment with the same two-phase structure and
  comparable inputs.
- In Phase 1, also decide new diagrams' positions, edges to other diagrams, and
  sizes in number of tree nodes, accounting for later commits.
- Emit viewable blank rectangles with their attached edges as Phase 1 artifacts,
  using the same efficient persistence representation as the completed states.
- Phase 2 fills the planned structure serially. Validate the starting geometry
  before freezing it into the plan.

### Phase 2 conceptual model

Ask for **ASCII tree diagrams** using the user's “3+1” model:

1. **Modular structure:** combine containment and lexical scope. Abstract away
   source-file organization while retaining component boundaries and visibility
   (what is exposed versus internal), the dependency graph, and higher-level
   logical and semantic groupings.
2. **Call (dynamic):** which activation invoked which.
3. **Ownership:** responsibility for state, storage, resources, and lifetimes;
   who creates, retains, changes, or releases them.
4. **Data dependency (special):** the underlying graph of what needs what to
   compute a result. This exists before organizational choices and is not another
   organizational category.

---

# Shared project rules and prompt requirements

# Development server

- Only for agent-started tasks that change application code or runtime/build configuration: after completing the coding changes and their checks, run `npm run dev:reload` from the project working directory to refresh running Vite dev-server instances started from that directory. Do not reload for documentation-only edits (including `AGENTS.md` and `docs/EXPERIMENTS.md`), read-only investigations, or experiment runs that do not change code. Do not reload during intermediate edits or refresh instances from other worktrees.

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

- For canvas reads use `canvas.read({projectionType:"graph"})`. Use `layout` only for a requested write that needs geometry, and `detail` on specific diagrams for anchors or evidence.
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

## Eval prompts

### Reusable prompt templates

When creating a prompt in the editor or through `POST /api/mapping/evals/prompts`, insert a reference at the point where the instructions belong. Use the template's global ID from **Prompts → Prompt snippets**. For example, a stage can contain the following section:

```text
<canvas-style>
<canvas-guidelines>
{{template:prompt-snippets/canvas-style-guidance.txt}}
</canvas-guidelines>
</canvas-style>
```

The editor’s **Prompt snippets** buttons insert references at the cursor. **Show full prompt preview** displays the expanded instructions. The copy icon in the Prompts menu copies the global ID for use inside `{{template:…}}`. Available template files live in `public/prompt-snippets/`.

Saving pins the expanded stage text in `versions[].stages` and retains the authored text of stages containing references in `versions[].templateSources`. When editing through the API, overlay `templateSources` on `stages` before making your change. An unchanged stage keeps its pinned expansion when revised or forked. A new or edited stage resolves its references against the current template files. Runs use the saved version’s expansion.

Open a template in **Prompts → Prompt snippets** to see **Used in prompts**, which links to each referencing prompt version and stage in the project. Experiments Overview shows the template names beside each [prompt] action. The prompt inspector displays each included template as an inline tag at its authored position. Batch reads provide the authored form in `templateSource` alongside the expanded stage in `text`. Only explicit references are tracked. Use `{{ref:…}}` for saved reference excerpts.

- Write eval-specific instructions directly in the versioned prompt; do not use a generic `{{task}}` variable.
- State template usage, input files, and generation constraints explicitly in the visible prompt; do not inject hidden instructions at runtime.
- Create prompt variations with `derivation: {parent: {promptId, version}, kind: "variation", dimension?: {id, name, value}}`; pin the exact parent version and use a stable dimension ID across its poles.
- Revisions and edited relaunches record their parent versions automatically. Runs retain the exact prompt text, version, content hash, and derivation they used.
- Prompt ancestry is derived from these relationships and output references; do not construct `promptTree` metadata for new experiments. Legacy lineage is backfilled explicitly with verified content hashes, never guessed from names. The overview uses the workflow tree described above, with prompt ancestry available separately.

## AgentContext forms

AgentContexts support different forms of input, which can be combined within one context:

| Form | Purpose |
|---|---|
| `repository` | Discover code incrementally in an isolated checkout at a pinned commit, with exclusions and recorded file inspections |
| `text` | Plain reference text |
| `sourceFile` → `sourceRange` | Pinned source files or line ranges |
| `section` | Named groups of context blocks |
| Conversation history | User, assistant, and tool messages |

The saved context’s `group` label organizes contexts; it does not determine their content or execution behavior.

## AgentContext forks and comments
- use fork-agent-context to fork a context
  > if making changes, make them directly on disk
    > update the forked context with a comment using add-agent-context-comment describing the change
- there is a "group" argument in create-agent-context that lets you group different contexts together
  > this shud mostly be used to group heterogenous context types together


## Codex usage statistics

The **Cost statistics** button at the upper-right of Evals opens `/evals?cost-statistics`.
The metric is **tokens per one percentage point of weekly Codex allowance**, grouped
by `(model, thinking level)`, using an observed 28-day window. Token totals include
input (including cached input) plus output; reasoning and cache counters are also
retained, but never added twice. This is allowance consumption, not API dollar cost.

Run `npm run usage:install` on the authenticated host to install:

- A per-user `new-diagram-usage.service` that incrementally reads local Codex and
  Pi JSONL usage records every five seconds (new files discovered within 30 seconds).
- An idempotently managed crontab entry that calls the read-only Codex
  `account/rateLimits/read` endpoint every five minutes. It does not create an agent
  thread, turn, or model generation. A first poll runs immediately at installation.

The collector is bundled into `~/.local/share/new-diagram-usage/collector.mjs` so it
continues independently of the app and this worktree. Data lives in
`~/.local/share/new-diagram/codex-usage.sqlite` (override `NEW_DIAGRAM_USAGE_DB` for
isolated tests). Run the installer again after changing collector code. Existing
crontab jobs are preserved. The installed poll log contains only its latest result;
all samples, timestamped token events, incremental cursors, and health are in SQLite.

The app's ephemeral Codex runtimes record protocol usage directly in code because
those processes have no persistent rollout. Collection includes persistent local
Codex/Pi sessions and the instrumented ephemeral runtimes, not other hosts or
arbitrary external ephemeral clients. Imported Pi history, inherited fork history,
and repeated cumulative counters must not be charged again. Unknown thinking/speed
settings remain explicitly unknown. No prompts, outputs, or authentication tokens
are copied into the usage database.

Five-minute snapshots are combined into non-overlapping 30–60 minute windows.
Reset boundaries, account/plan changes, gaps over 15 minutes, and allowance movement
without tracked tokens are excluded. Nonnegative regression estimates rates only
when at least two percentage points and enough independent windows are available.
Collinear model activity is marked as needing independent activity. Leave-one-window-
out sensitivity and held-out chronological prediction error are shown when available;
these are evidence measures, not guarantees or formal confidence intervals. Rates
reflect the observed cache/speed mix and may be biased by untracked account usage.
No numeric estimate is fabricated while data is insufficient.

Inspect with `npm run usage:status`, `crontab -l`, or
`systemctl --user status new-diagram-usage.service`. To stop collection, disable that
service and remove only the crontab line ending in `# new-diagram-codex-usage`.
Stopping collection preserves the database. Collection requires this host to be on;
user-service startup follows the host's user-session/linger configuration.

## Comments on diagram nodes

In an experiment's canvas output, Ctrl-drag selects nodes using Mapping's normal
selection gesture. Releasing opens a comment box; Ctrl-click can also select a
node. Escape cancels the draft and clears the selection. Saving writes only to
the experiment; it does not edit the output canvas or its pinned revisions.

The experiment's **Comments** branch groups anchored comments by output set,
across all phases. Opening one restores the selected canvas and node highlights.
While reviewing a comment, previous/next and arrow keys follow a closed loop over
comments only. **Back to output** returns to output navigation. **Copy comments**
exports all experiment comments, grouped by output set, together with the captured
selected-node text. The captured excerpts remain available if an output is removed.

`POST /api/mapping/evals/experiments/:id/comments` accepts an optional `anchor`:
`{runId, cellKey, canvasId, checkpointId?, selections: [{diagramId, revisionId, nodeIds}]}`.
The server verifies experiment/output membership and exact node revisions, and
captures excerpts from the saved output. Reusing a request ID with different
text, tags, or anchors is rejected. Existing general comments remain supported.
