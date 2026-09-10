---
name: new-diagram
description: Create one source-backed ASCII diagram workspace for a repository. Use when the user asks an agent to start, bootstrap, or collect code entities for a single DiagramSet from a repo path, diagram name, and prompt.
---

# New Diagram

Use the running studio HTTP API; only the server writes DiagramSet records.

## Invocation boundary

Create exactly one logical diagram per skill invocation:

- Resolve one diagram brief, one DiagramSet name, and one concise collection prompt.
- Send one creation request to `POST /api/studio/diagram-sets`.
- Do not add another requested diagram, component, or view to that DiagramSet.
- Do not call a generation endpoint or use the studio to generate more artifacts.
- If the user requests multiple diagrams, use a separate skill invocation and
  DiagramSet for each one.
- Stop after returning the first DiagramSet; never continue with another brief
  during the same invocation.

The studio may generate multiple candidate artifacts for the single brief.
Treat those as variants of that one diagram, never as capacity for additional
briefs.

## Workflow

1. Resolve the repository path, DiagramSet name, concise collection prompt, and
   optional system-prompt template id from the request.
2. Ensure the studio server is running for that repository.
3. When the user requests a particular prompt style or template but does not
   provide its exact id, list the available templates:

```bash
curl --fail-with-body http://127.0.0.1:5173/api/studio/system-prompt-templates
```

Use an exact returned `id`; do not guess an id from the display label. If the
user does not request a template, omit `promptTemplateId` and use `default`.

4. Write a JSON request file with `path`, `name`, `prompt`, and
   `runReferencePrompt: true`. Include `promptTemplateId` and `referencePrompt`
   when requested. Then submit it once:

```bash
curl --fail-with-body --no-buffer http://127.0.0.1:5173/api/studio/diagram-sets \
  -H 'Content-Type: application/json' \
  --data-binary @request.json
```

The `path` must resolve to the server's configured corpus. The response is
newline-delimited JSON (`application/x-ndjson`). Watch for `type: "error"`, even
with HTTP 200, and require a final `type: "result"` before reporting success.
If the connection ends after creation, inspect `GET /api/core/workspace` before
retrying to avoid creating a duplicate DiagramSet.

5. Return the result's `diagramSetId`, the server address, `promptTemplateId`,
   `promptTemplateVersion`, and `generationPromptConfigId`. Say the initial
   diagrams are ready at that address.

`promptTemplateId` selects the latest persisted revision of a system-prompt
template. It does not accept a historical `GenerationPromptConfigRecord` id;
that immutable record is created by the server when generation begins.

Set `runReferencePrompt: true` to run the selected template's Diagram reference
follow-up. Supply `referencePrompt` for its runtime instruction, or omit it for
an empty instruction. If the user asks to skip the reference turn, set
`runReferencePrompt: false`. The mandatory final mapping turn still runs.

The server creates one DiagramSet and one CodeEntitiesSet, uses one read-only Pi
agent to collect source-backed entities, then generates the initial candidates.
If the server is unavailable, start it from the app checkout:

```bash
NEW_DIAGRAM_PROJECT_ROOT=/path/to/repository \
NEW_DIAGRAMS_DIR=.diagrams \
npm run dev -- --port 5173 --strictPort
```

Use `NEW_DIAGRAMS_DIR` when the user requests an isolated DiagramSet store;
relative directories resolve from the corpus path. Set `NEW_DIAGRAM_DOMAIN` to
`document` for document corpora. Use the configured server address in requests
when a different host or port is in use.

Do not generate diagrams from the external agent. Do not mutate a finalized
CodeEntitiesSet; bootstrap a new DiagramSet if different context is required.

## Maintenance

Treat `scripts/new-diagram/skills/new-diagram/` in the repository as the
canonical skill source. After changing this skill or its installed mirror,
update the repository copy and run `scripts/new-diagram/install-skill`. Never
leave the repository and installed copies different.
