# Studio, Mapping, and Core

Ownership follows the operation, not the screen that currently calls it.
Studio collects evidence and produces candidates. Mapping edits canvases. Core
owns project resources and reusable behavior shared by both features.

```text
       App / HTTP composition
          /           \
       Studio        Mapping
          \           /
               Core
```

## Source boundaries

| Layer | Core | Studio | Mapping |
| --- | --- | --- | --- |
| HTTP handlers | `src/server/routes/core/` | `src/server/routes/studio/` | `src/server/routes/mapping/` |
| Browser clients | `src/shared/http/api.ts` | `src/features/studio/api.ts` | `src/features/mapping/api.ts`, `mappingProjectApi.ts` |
| Application operations | `application/core/` | `application/studio/` | `application/mapping/` |
| External integrations | `infrastructure/core/` | `infrastructure/studio/` | `infrastructure/mapping/` |
| Browser UI | `src/shared/` | `src/features/studio/` | `src/features/mapping/` |
| Models and pure rules | `domain/core/` | `domain/studio/` | `domain/mapping/` |

Features may import Core and their own modules. Browser code imports domain code,
never backend implementations. Application services import domain models and
receive integration interfaces; they do not import filesystem, HTTP, or agent SDK
implementations. Infrastructure implements those interfaces. Runtime construction
lives in `src/server/app/bootstrap.ts`; Vite middleware lives in `src/server/app/vitePlugin.ts`.
`tests/architecture/dependencies.test.ts` enforces these rules.

Routes decode HTTP requests, invoke operations, and encode responses/events.
Project initialization, source evidence resolution, generation sequencing, dataset
assembly, chat preparation, and compaction execution live in application services.
Catalog revision transitions and mapping validation belong to domain code. Their
filesystem adapter preserves serialized revision checks and writes.

Core retains shared persisted schemas, aggregate workspace assembly, and legacy
record normalization, including records originally produced by Studio. Studio owns
generation and code-entity mapping workflows; these are separate from Mapping's
canvas editing and selection prompting. Studio and Mapping have separate agent
session lifecycles and share Core provider/session helpers.

See [file layout](file-layout.md) for the full dependency structure.

## API inventory

The paths in each table are relative to the indicated namespace. `{set}` denotes
a DiagramSet ID. Request bodies and response conventions remain unchanged except
for the consolidated catalog read described below.

### Studio — `/api/studio`

| Methods | Path | Operation |
| --- | --- | --- |
| POST | `/diagram-sets` | Create generated or materialized sets; NDJSON |
| DELETE | `/diagram-sets/{set}` | Move a set to trash |
| POST | `/diagram-sets/{set}/generate` | Generate candidates; NDJSON |
| PATCH | `/diagram-sets/{set}/diagrams/{id}` | Rename a candidate |
| POST | `/diagram-sets/{set}/diagrams/{id}/archive` | Archive a candidate |
| POST | `/diagram-sets/{set}/diagrams/{id}/star` | Select/promote or unstar a candidate |
| POST | `/project/representations/promote` | Promote a candidate into Core's catalog |
| PUT | `/diagram-sets/{set}/candidate-batches/{id}/feedback` | Rank candidates |
| POST | `/diagram-sets/{set}/diagrams/{id}/components` | Capture a component |
| POST | `/diagram-sets/{set}/components/{id}/components` | Capture a nested component |
| POST | `/diagram-sets/{set}/components/{id}/archive` | Archive a component |
| POST | `/diagram-sets/{set}/{diagrams\|components}/{id}/code-entity-map` | Map evidence onto one artifact; NDJSON |
| POST | `/diagram-sets/{set}/code-entity-maps` | Batch evidence mapping; NDJSON |
| POST | `/diagram-sets/{set}/edit-sessions` | Create an artifact edit session |
| POST | `/diagram-sets/{set}/edit-sessions/{id}/{action}` | `manual`, `marker`, `undo`, `redo`, `finish`, `discard`, or streaming `llm` |
| GET, PUT | `/diagram-sets/{set}/representation-graph` | Read/save generation graph |
| POST | `/diagram-sets/{set}/representation-graph/feedback` | Add graph feedback |
| PUT | `/diagram-sets/{set}/agent-runs/{id}/spatial-progress` | Save agent progress |
| GET, POST | `/system-prompt-templates`, `/code-entity-prompt-templates` | List/create templates |
| PUT, DELETE | `/{template-family}/{id}` | Update/delete templates |
| POST | `/{template-family}/{id}/reset` | Restore a built-in template |
| GET | `/experiments` | List experiments |
| GET | `/experiments/{id}/artifact` | Read output selected by `axis`, `iteration`, `value`, `replicate` |
| GET, POST | `/diagram-datasets` | List/create evaluation datasets |
| POST | `/diagram-datasets/{id}/items` | Add an experiment output |
| GET, PATCH, DELETE | `/diagram-datasets/{id}/items/{item}` | Read/relabel/remove an example |

Code-entity mapping remains a Studio workflow: it annotates generated artifacts
with evidence. It is separate from operating the Mapping canvas editor.

### Mapping — `/api/mapping`

| Methods | Path | Operation |
| --- | --- | --- |
| POST | `/diagrams` | Create/save a canvas representation and immutable revision |
| POST | `/prompt` | Edit/generate from an editor selection; NDJSON |
| POST | `/compactions` | Compact then refine one project file; NDJSON |
| GET | `/compactions/:runId` | Read a saved compaction run, prompts, and outputs |
| POST | `/chat` | Answer a question about selected content; NDJSON |
| GET, PUT | `/workspace` | Load/save the editor workspace, including scenes, retained panes, drafts, and viewport |

Saving a canvas writes Core's representation catalog. It returns
`{ project, catalog, representation }`; an existing diagram requires its current
`expectedRevisionId`. A stale write returns 409. Selection prompt results remain
editor proposals until the user saves. Explicit workspace saves persist scenes, retained panes, chat context/history, drafts, and pan/zoom separately from representation revisions. Local undo history remains browser state.

### Core — `/api/core`

| Methods | Path | Operation |
| --- | --- | --- |
| GET | `/workspace` | Aggregate project/workflow snapshot |
| GET | `/project/representations` | Shared `{ project, catalog }` snapshot |
| GET, POST | `/project/corpus-compactions` | Read/upsert file compactions |
| POST | `/project/projections` | Persist derived tree and evidence links |
| GET | `/diagram-sets/{set}/files?path=…` | Browse the associated corpus |
| GET | `/project/source?projectId=…&path=…` | Read a complete project source file with its SHA-256 |
| GET | `/source?setId=…&entityId=…&range=…` | Read source |
| POST | `/call-graph-focus` | Resolve a focused view of existing artifacts |
| POST | `/imports` | Import reusable artifacts and evidence |
| PATCH | `/imports/diagrams/{id}` | Rename an import |
| POST | `/imports/diagrams/{id}/archive` | Archive an imported diagram |
| POST | `/imports/diagram-components/{id}/archive` | Archive an imported component |
| GET | `/artifact-bundle?setId=…&artifactKind=…&artifactId=…` | Export an artifact with evidence |
| POST | `/highlights` | Create a highlight |
| DELETE | `/highlights/{id}` | Delete a highlight |
| GET, POST | `/plans` | List/create plans |
| GET, PATCH | `/plans/{id}` | Read/update a plan |

Catalog reads return `{ project: null, catalog: null }` before initialization.
The aggregate workspace still includes the same catalog as `representationCatalog`.

## Client migration

- Replace shared `/api/studio/…` endpoints with the corresponding `/api/core/…`
  path. Studio generation/editing endpoints retain their paths.
- Replace `GET /internal/mapping/diagrams` and
  `GET /api/studio/project/representations` with
  `GET /api/core/project/representations`. Consumers of the former bare catalog
  response must now read the `catalog` property.
- Replace `POST /internal/mapping/diagrams` with `POST /api/mapping/diagrams`.
- Replace `POST /internal/mapping/prompt` with `POST /api/mapping/prompt`.
- Replace `POST /internal/mapping/projections` with
  `POST /api/core/project/projections`.
- Import browser functions from the owning area's client module. The old
  `src/api.ts` umbrella module has been removed.

Moved URLs return 404; there are no compatibility aliases. A recognized resource
with an unsupported method returns 405. Streaming clients must consume NDJSON
and require the final result; HTTP 200 alone does not establish success.

The storage format and IDs are unchanged. Existing immutable evidence snapshots
and historical source compactions retain their original source addresses. Those
historical compactions must be regenerated before claiming to describe the
reorganized live source tree.

This separation preserves existing star/promotion behavior, edit-copy versus
revision semantics, and error/result conventions. Renaming the promotion route,
removing set-scoped corpus addressing, and redesigning those semantics are
separate API changes.

## Verification

`npm test` runs this application's tests, including the dependency boundary and
HTTP namespace tests; vendored repositories have their own test runners.
`npm run build` checks types and builds the frontend. The project-mapping and
Studio browser checks exercise creation, saved revisions, reload, and generation
against disposable stores.
