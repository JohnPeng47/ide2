# Generate a ChangeSession with AI

`diff-session-create` sends two sequential user messages to one agent session. The first inspects captured diagrams, pinned source and commit hunks, then proposes diagram changes. The second uses the internal canvas tools to implement that response in a new ChangeSession. Its default preset is **astra-high** (`gpt-6-astra`, high reasoning).

The analysis prompt requires the agent to generate missing diagrams and major replacements itself. It distinguishes migrations between diagrams from added-diagram storage records, and requires explicit owner nodes before connecting detailed diagrams.

## Run

Start the application with AI enabled (`--pi`). In the Changes tab, expand **Generate ChangeSession with AI**, enter a title, and choose either a repository and commits or an existing ChangeSession baseline. Generate, monitor the stage, cancel if needed, and open the resulting proposal.

An existing baseline reuses its original canvases, pinned commits/head and captured hunks. It does not reuse that session's proposed edits. Selected commits capture the current saved/live diagrams once at the beginning.

The same workflow is available without a browser:

```sh
npm run diff-session-create -- --pi \
  --baseline change-EXISTING-ID \
  --title 'Regenerated proposal'

npm run diff-session-create -- --pi \
  --repository repo-ID --commit SHA --commit SHA \
  --title 'Changes across selected commits'
```

Use `--diagrams-dir` and `--project-root` for a different store or checkout. The default store is `.diagrams-local/canvas-domain-model`. Pass `--request-id` to replay a start request without duplicating a generation; a changed request needs a new ID.

## API and records

- `POST /api/mapping/workflows/diff-session-create`: `{requestId, title, baselineChangeSessionId}` or `{requestId, title, repositoryId, commits, head?, canvasId?}`. Returns a run immediately.
- `GET /api/mapping/workflows/diff-session-create/:runId`: status, stage, model, agent session ID and proposal ID when available.
- `POST /api/mapping/workflows/diff-session-create/:runId/cancel`: cancel the active run.

Run records live under `<store>/diff-session-workflows/<runId>/`. They retain the frozen context, prompt templates, each user request/response and conversation. A process restart marks unfinished runs interrupted; it does not silently spend tokens restarting them. Failures preserve any partial proposal for inspection. Cancellation does not roll back completed proposal edits.

The analysis stage exposes only read tools. Materialization binds all write tools to the run's isolated ChangeSession. Completion requires a ready, nonempty proposal and DiffTree coverage of every captured hunk. The workflow never accepts a proposal or publishes the original canvases.

## Performance diagnostics

`performance.json` records each step's wall time, individual tool latency and response bytes, assistant-response latency/token usage, and any context compaction. Step durations include their model/tool intervals; do not add these overlapping totals together. The conversation artifact retains the full session message log even when the model's active context is compacted.

Workflow mutation replies return versions and node summaries. Diagram reads retain full ASCII, current anchor IDs, source bindings and mapping ranges, but omit rendering indexes and captured source lines. Explicit source-evidence selections through `exec` remain available. During materialization, hunk and DiffTree reads default to metadata; use `includePatches: true` to reread patches. After the completion tool validates the ready proposal, automatic compaction is disabled for the finished session.
