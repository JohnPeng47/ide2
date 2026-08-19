---
name: new-diagram
description: Create a new source-backed ASCII diagram workspace for a repository. Use when the user asks an agent to start, bootstrap, or collect code entities for a new DiagramSet from a repo path, diagram name, and prompt.
---

# New Diagram

Use the repository CLI as an HTTP client; only the running studio server writes
`.diagrams` records.

1. Resolve the repository path, DiagramSet name, and concise collection prompt from the request.
2. Ensure the studio server is running for that repository, then run:

```bash
npm --prefix /home/john/drone-interception/scripts/new-diagram run diagram -- create \
  --path <repo-path> \
  --name <diagram-set-name> \
  --prompt <prompt> \
  --server http://127.0.0.1:5173
```

3. Return the emitted DiagramSet id and `serverUrl` to the user, and say the set
   is awaiting approval at that address.

The server creates one DiagramSet and one CodeEntitiesSet, then uses one
read-only Pi agent to collect source-backed entities. If the CLI cannot connect,
report this start command:

```bash
NEW_DIAGRAM_PROJECT_ROOT=<repo-path> npm --prefix /home/john/drone-interception/scripts/new-diagram run dev
```

Do not generate diagrams from the external agent. Do not mutate a
CodeEntitiesSet after the human finalizes it; bootstrap a new DiagramSet if
different context is required.
