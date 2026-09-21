# New Diagram

A repository-local Mapping workspace for source-backed ASCII diagrams, connected canvases, saved revisions, and agent-assisted editing.

## Run

```sh
npm ci
NEW_DIAGRAM_PROJECT_ROOT=/path/to/repository NEW_DIAGRAMS_DIR=.diagrams npm run dev -- --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/` or `/mapping`. All entry paths open Mapping.
`NEW_DIAGRAMS_DIR` can be absolute or relative to the project root. Set
`NEW_DIAGRAM_DOMAIN=document` for a document corpus. Add `--lsp` to enable source definitions.
Use a separate port and store for independent instances. `NEW_DIAGRAM_AGENT=fake` enables deterministic test runtimes.

## Workspaces and revisions

Create diagrams from ASCII or a copy of the current canvas. The explorer lists saved diagrams and their boxes and groups. Switching documents retains unsaved edits and pending prompts. Save appends an immutable revision and checks the expected revision; stale writes return a conflict.

Saved revisions include source evidence, connections, placement, groups, and collapsed state. **Save workspace** separately persists open documents, unsaved scenes, panes, chat history, drafts, and camera state. Undo history is temporary editor state.

Select mapped content and press `N` to open a linked call tree or `P` to prompt an edit. Compaction views can open the corresponding source pane. Source bindings belong to diagrams, allowing several repositories in one project. Selection, chat, projections, compaction, source browsing, and optional language services use these bindings.

## Agent access

```sh
npm run mcp:mapping -- http://127.0.0.1:5173
```

Inspect the MCP tools and `canvas-api-search` before editing. Proposal edits use isolated change sessions as described in [AGENTS.md](AGENTS.md). Proposals persist in the Changes tab; acceptance is not implemented.

## APIs and storage

Mapping owns `/api/mapping/*`: canvas saves, archiving, workspace persistence, selection prompting, chat, compaction, and agent sessions. Core owns `/api/core/project/*`: catalogs, projections, source files, directory browsing, definitions, and corpus compactions. See [API ownership](docs/architecture/api-ownership.md) and [file layout](docs/architecture/file-layout.md).

Studio/Experiments and their endpoints have been removed. Existing representation catalogs, revisions, provenance, projections, and compactions remain readable. On first project load, source bindings registered only by legacy DiagramSets are copied into project source metadata. Original set records and saved catalogs are preserved. Retired generation, dataset, import-library, highlight, and plan endpoints return 404.

Saved data under `.diagrams*`, `.datasets`, and `.materialized-parent-manifests` is not deleted by the source cleanup. Historical catalog fixtures and Mapping's older example diagrams may still describe removed code; they are snapshots, not live architecture documentation. The old Studio bootstrap skill and its installer were removed from this repository.

## Verification

```sh
npm test
npm run build
npm run check:mapping
npm run check:canvas
npm run check:domain-profiles
npm run check:markdown
npm run check:agent-diagramming
```

Browser checks use disposable stores and the local front-end CDP harness. `npm test` covers unit and integration tests; browser checks run separately. Source navigation and performance checks have dedicated `check:source-navigation` and `check:source-performance` scripts.

`packages/ui-test-framework` provides development UI controls. Keep it at the composition boundary; product components receive plain values.

Mapping's compaction workflow runs compact and refine steps through shared agent runtime helpers. See [the compaction guide](docs/guides/mapping-file-compaction.md).
