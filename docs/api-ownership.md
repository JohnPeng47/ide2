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
| HTTP handlers | `server/core/routes.ts` | `server/studio/routes.ts` | `server/mapping/routes.ts` |
| Browser clients | `src/core/api.ts` | `src/studio/api.ts` | `src/mapping/api.ts`, `mappingProjectApi.ts` |
| Services | `server/core/application.ts`, persistence and corpus services | `server/studio/application.ts`, generation runtime and experiment services | Selection runtime, source-context and chat services |
| UI and models | `src/core/`, including shared components, panes, source rendering and reference tools | `src/studio/`, including `StudioPage.tsx` | `src/mapping/`, including the canvas editor |

Features may import Core and their own modules. Core must not import either
feature. Browser modules must not import server modules. Cross-feature navigation
uses callbacks provided by `src/App.tsx`; runtime construction and route dispatch
live in `server/http.ts`. `src/architecture.test.ts` enforces these import rules.

Core retains the shared persisted record schemas, aggregate workspace, and legacy
record normalization, including records originally produced by Studio. That does
not make generation a Core workflow. Generation prompt construction belongs to
Studio; shared template records and their persistence normalization belong to Core.

Studio and Mapping have separate agent runtimes and session lifecycles. They
reuse Core's model/provider setup and session disposal. Canvas geometry and
mapping validation are Core primitives; converting a scene into the editor's
view model belongs to Mapping.

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
| POST | `/chat` | Answer a question about selected content; NDJSON |

Saving a canvas writes Core's representation catalog. It returns
`{ project, catalog, representation }`; an existing diagram requires its current
`expectedRevisionId`. A stale write returns 409. Selection prompt results remain
editor proposals until the user saves. Pan/zoom, local undo history, and chat
history remain browser state.

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
