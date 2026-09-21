# File layout

| Directory | Responsibility |
| --- | --- |
| `src/app/`, `src/main.tsx` | Mapping application entry and global styling |
| `src/features/mapping/` | Canvas, explorer, changes, source panes, chat, workspace UI and HTTP clients |
| `src/shared/` | Diagram text, camera/connectors, source rendering, markdown, and HTTP primitives |
| `src/server/app/` | Backend composition and Vite adapter |
| `src/server/routes/{core,mapping}/` | Transport adapters |
| `application/core/` | Project catalogs, source resolution, corpus and agent ports |
| `application/mapping/` | Agent sessions, changes, selection, chat, compaction, diagrams, workspaces |
| `domain/core/` | Diagram content, parser, grid, connections, catalogs, projections, source contracts |
| `domain/mapping/` | Editor transactions, selections, changes, workspace, chat and compaction rules |
| `infrastructure/core/` | Project/catalog persistence, corpus access, LSP and shared agent adapters |
| `infrastructure/mapping/` | Mapping agents, sandbox/bridge, change and workspace stores |
| `tests/browser/`, `tests/performance/` | Disposable browser and performance workflows |
| `tests/support/` | Mapping-based integration fixtures |
| `scripts/` | Server startup, MCP transport, parser and source migration tools |
| `tools/diagram-parser/`, `projection-3d/` | Independent research and visualization tools |
| `packages/ui-test-framework/` | Development UI controls |

Unit/integration tests live beside their capability. `npm test` discovers first-party tests; vendored repositories use their own runners. `npm run build` checks types and compiles the app.

Browser -> domain. Application -> domain and ports. Infrastructure -> application ports and domain. Only the server composition root constructs concrete integrations. Core does not import Mapping. Architecture tests enforce these boundaries.

Studio/Experiment modules and their exclusive helpers, tests, scripts, and skill installer are removed. Saved catalogs and historical fixtures remain compatible. No blanket deletion of persisted data, research, or vendored source is part of this operation.
