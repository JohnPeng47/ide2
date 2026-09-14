# Mapping file compaction

`POST /api/mapping/compactions` runs the `single-file-compaction` workflow:

```text
frozen source -> compact -> validate/save -> refine -> validate/save -> result
```

The workflow object is in `server/mapping/fileCompactionWorkflow.ts` and executes
through Core's `runAgentWorkflow`. Each run uses one Pi session with only
`submit_file_compaction`. Both prompts execute in that same chat. The submission
collector is reset between turns; the conversation history is retained. The
session closes after completion, failure, or cancellation. Authentication uses
the same Core runtime as Studio. Each request can select `modelId` and
`thinkingLevel`; omitted values use `NEW_DIAGRAM_MODEL` (or the default diagram
model) and `medium` reasoning.
`NEW_DIAGRAM_AGENT=fake` exercises the same workflow and persistence without an
LLM request.

## Request and response

Use the project ID returned by `GET /api/core/workspace`. The path is relative
to that project's corpus root, regardless of the server checkout directory.

```sh
curl -N http://127.0.0.1:5188/api/mapping/compactions \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"project-cfaed6871720","sourceFile":"src/vs/editor/browser/view.ts"}'
```

Optional agent settings are supplied in the same request body:

```json
{
  "projectId": "project-cfaed6871720",
  "sourceFile": "src/vs/editor/browser/view.ts",
  "modelId": "gpt-6-astra",
  "thinkingLevel": "high",
  "systemPrompt": "Custom base instructions for this run"
}
```

`modelId` supports the Studio model IDs plus `gpt-6-astra`. Reasoning accepts
`low`, `medium`, `high`, `xhigh`, or `max`. `systemPrompt` accepts 1–64,000
characters of literal text. It replaces the base instructions for that request;
it is not a path to a file. Omit it to use the copied Codex base prompt in
`server/mapping/prompts/system/codex.md`.

The Codex prompt was copied without edits from
`/home/john/codex/codex-rs/models-manager/prompt.md`, which Codex includes as
`BASE_INSTRUCTIONS` in `models-manager/src/model_info.rs`. Its source commit and
hash are recorded in `prompts/system/codex-source.json`. This is Codex's base
prompt, not the complete dynamically composed CLI context with permissions,
user instructions, or tool definitions.

The same compaction submission contract is appended to either base prompt. It
requires complete ASCII and source mappings via `submit_file_compaction`; the
server continues to own file writes. `run.json` captures `agent.modelId`,
`agent.thinkingLevel`, and both base/effective system prompt texts and SHA-256
hashes. Overrides do not change another request's settings.

The request requires a source-code project and an existing UTF-8 text file of
1–262,144 bytes. Absolute paths, parent traversal, and symlink paths are rejected.
The source path must be printable ASCII because it becomes the diagram root.
The complete source is read once; oversized files are rejected, never truncated.

The response is newline-delimited JSON (`application/x-ndjson`):

```json
{"type":"started","runId":"compaction-<uuid>","sourceSha256":"..."}
{"type":"progress","runId":"compaction-<uuid>","stage":"compact","message":"Compacting the source snapshot"}
{"type":"progress","runId":"compaction-<uuid>","stage":"refine","message":"Refining the accepted first pass"}
{"type":"result","result":{"runId":"compaction-<uuid>","sourceStale":false,"snapshot":{"sourceFile":"...","sourceSha256":"...","ascii":"...","asciiSha256":"...","mappings":[]},"artifacts":{"compact":{"text":"...","mappings":"..."},"refine":{"text":"...","mappings":"..."}}}}
```

The final snapshot has Core's `CompactionSnapshot` shape and can be supplied to
existing compaction projections. Artifact paths are relative to the configured
diagrams store. The workflow saves its outputs; it does not insert a canvas pane,
change a diagram revision, or activate an entry in the separate corpus-fold catalog.

Request validation returns JSON errors before streaming (400, or 409 for a
foreign/uninitialized project). Once streaming starts, failures produce an
`error` event with `runId`, `stage`, and `error`, and no successful result event.
Refinement failure retains the accepted draft. Disconnecting cancels execution;
server shutdown also aborts active runs. A run has a thirty-minute execution limit to accommodate two high-reasoning passes.

`GET /api/mapping/compactions/:runId` returns saved metadata and accepted
snapshots, including failed/cancelled runs. It returns 404 for an unknown ID.
An unfinished run left by a terminated server is reported as `interrupted`;
there is no automatic resume or retry. Submit another POST to start a new run.

## Prompt and artifact provenance

The canonical prompts are:

- `server/mapping/prompts/compaction/single-file-compact.md`
- `server/mapping/prompts/compaction/single-file-compact2.md`

Both are captured, with SHA-256 hashes, before execution. The runtime enforces structured
submissions and server-managed output files, including when a template names an
output path. The full frozen source is appended only to the first prompt. The
second prompt is sent as a follow-up in the same conversation, which retains the
source, first response, and tool submission history.

Each request gets a distinct directory under
`<diagrams-store>/mapping/compactions/compaction-<uuid>/`:

```text
source.txt       exact original bytes
run.json         status, prompt templates/hashes, rendered prompts, models, session IDs, snapshots
compact.txt      first-pass ASCII
compact.json     first-pass row mappings and original source hash
refine.txt       refined ASCII
refine.json      refined row mappings and original source hash
```

Both JSON mapping files preserve the original file schema (`sourceFile`,
`sourceSha256`, `treeFile`, `mappings`). Source and ASCII hashes are computed by
the server. CRLF and the final newline remain part of the exact-byte source hash;
line coordinates count the final newline as a terminator, not another source line.
At completion, `sourceStale` indicates that the live file changed or became
unreadable since capture. All output mappings still refer to the saved snapshot.

## Validation boundaries

Each submission must contain printable ASCII, a source-file root covering the
whole file, and exactly one mapping for every semantic row recognized by the
shared representation index. Duplicate rows, connector-only mappings, missing
coverage, and invalid/out-of-bounds ranges are rejected. The agent can correct a
rejected submission within the same step; only an accepted pass can advance.

Behavioral accuracy and presentation style depend on the agent following the
canonical prompts. The current row-mapping schema does not encode explicit block
identities or presentation-order constraints, so these are not mechanically
verified. The current first-pass prompt permits reordering to group related code.

## Verification

```sh
npx vitest run server/mapping/fileCompaction.test.ts server/mapping/fileCompactionRuntime.test.ts server/core/agentWorkflow.test.ts
npm run build
```
