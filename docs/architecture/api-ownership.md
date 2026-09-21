# Mapping and Core API ownership

Mapping owns editor operations; Core owns project catalogs and source access. Browser code imports domain modules, application services depend on ports, and infrastructure implements filesystem, language-service, and agent integrations. `src/server/app/bootstrap.ts` composes the backend; `vitePlugin.ts` mounts HTTP middleware. `tests/architecture/dependencies.test.ts` enforces layer boundaries.

| Namespace | Methods and paths | Responsibility |
| --- | --- | --- |
| `/api/mapping` | `POST /diagrams`, `DELETE /diagrams/:id` | Save immutable canvas revisions and archive diagrams |
| `/api/mapping` | `GET/PUT /workspace` | Open documents, unsaved scenes, panes, drafts, chat, and viewport |
| `/api/mapping` | `POST /prompt`, `POST /chat` | Selection edits/generation and chat; NDJSON |
| `/api/mapping` | `POST /compactions`, `GET /compactions/:runId` | Compact/refine a file and inspect persisted results |
| `/api/mapping/agent` | See `agentRoutes.ts` and MCP tool schemas | Live canvases, sandboxed execution, search, saving, isolated change proposals |
| `/api/core/project` | `GET /representations` | `{ project, catalog }`, both null before initialization |
| `/api/core/project` | `GET/POST /corpus-compactions` | Read catalog; write returns `{ catalog, compaction }` |
| `/api/core/project` | `POST /projections` | Persist derived trees and evidence links |
| `/api/core/project` | `GET /files`, `GET /source` | Bound corpus directory/source access using `projectId`, `sourceId`, and `path` |
| `/api/core/project` | `POST /definitions` | Optional LSP navigation, source-hash validated |

Canvas writes return `{ project, catalog, representation }`. Updates require `expectedRevisionId`; stale writes return 409. NDJSON clients must consume the final result rather than interpreting HTTP 200 as completed work.

Studio, Experiments, DiagramSet lifecycle, candidate promotion, template management, import-library, artifact focus, highlights, and plans have no active routes. Their old URLs return 404. Unsupported methods on surviving resources return 405.

Source resolution uses diagram bindings from saved catalog revisions and project source registrations. Legacy set bindings are migrated into project metadata by the filesystem project adapter. It does not load generation artifacts or delete legacy data. Existing catalog provenance and active preferences are retained for compatibility, but new Mapping saves do not perform Studio promotion.
