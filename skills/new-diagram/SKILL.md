---
name: new-diagram
description: Create one source-backed ASCII diagram workspace for a repository. Use when the user asks an agent to start, bootstrap, or collect code entities for a single DiagramSet from a repo path, diagram name, and prompt.
---

# New Diagram

Use the repository CLI as an HTTP client; only the running studio server writes
DiagramSet records.

## Invocation boundary

Create exactly one logical diagram per skill invocation:

- Resolve one diagram brief, one DiagramSet name, and one concise collection prompt.
- Run the `create` command exactly once.
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
npm --prefix /home/john/drone-interception/scripts/new-diagram run diagram -- prompt-templates \
  --server http://127.0.0.1:5173
```

Use an exact returned `id`; do not guess an id from the display label. If the
user does not request a template, omit the option and use `default`.

4. Run:

```bash
npm --prefix /home/john/drone-interception/scripts/new-diagram run diagram -- create \
  --path <repo-path> \
  --name <diagram-set-name> \
  --prompt <prompt> \
  [--prompt-template <template-id>] \
  [--reference-prompt <reference-instruction> | --no-reference-prompt] \
  --server http://127.0.0.1:5173
```

5. Return the emitted DiagramSet id, `serverUrl`, prompt-template id and
   revision, and immutable generation prompt-config id. Say the initial
   diagrams are ready at that address.

`--prompt-template` selects the latest persisted revision of a system-prompt
template. It does not accept a historical `GenerationPromptConfigRecord` id;
that immutable record is created by the server when generation begins.

CLI-created candidates run the selected template's Diagram reference prompt in
a follow-up turn by default. Omit `--reference-prompt` to run that template with
an empty runtime instruction, provide the option to populate
`{{referenceInstruction}}`, or use `--no-reference-prompt` for one-turn
generation.

The server creates one DiagramSet and one CodeEntitiesSet, uses one read-only Pi
agent to collect source-backed entities, then runs three Sol diagram agents in
parallel. If the CLI cannot connect, report this start command:

```bash
npm --prefix /home/john/drone-interception/scripts/new-diagram run diagram -- serve \
  --path <repo-path> \
  --diagrams-dir .diagrams
```

Use `--diagrams-dir <dir>` when the user requests an isolated DiagramSet store;
relative directories resolve from `<repo-path>`.

Do not generate diagrams from the external agent. Do not mutate a finalized
CodeEntitiesSet; bootstrap a new DiagramSet if different context is required.

## Maintenance

Treat `scripts/new-diagram/skills/new-diagram/` in the repository as the
canonical skill source. After changing this skill or its installed mirror,
update the repository copy and run `scripts/new-diagram/install-skill`. Never
leave the repository and installed copies different.
