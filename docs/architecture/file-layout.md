# File layout

This repository is one Vite application with a React browser UI, a Node API
mounted by a Vite plugin, runtime-neutral domain code, and separate development
and evaluation tools.

| Directory | Ownership |
| --- | --- |
| `src/app/` | App navigation and global styles; `src/main.tsx` mounts React and providers. |
| `src/features/studio/` | Generation, editing, candidates, prompt settings, and the experiment viewer. |
| `src/features/mapping/` | Canvas interaction, workspace save/load, source panes, and chat UI. |
| `src/shared/` | Reusable browser capabilities: diagrams, source rendering, references, Markdown, panes, and Core HTTP clients. |
| `domain/core/` | Shared records, geometry, projections, references, plans, profiles, prompts, highlights, and agent-work models. |
| `domain/studio/`, `domain/mapping/` | Feature-owned models, contracts, validation, and pure algorithms used by browser and server. |
| `src/server/app/` | Vite middleware and startup wiring; `bootstrap.ts` selects and constructs integrations. |
| `src/server/routes/{core,studio,mapping}/` | HTTP input decoding, route dispatch, response formatting, and connection lifecycle. |
| `src/server/http/` | HTTP body, JSON, and NDJSON helpers. |
| `application/core/` | Workspace assembly, source access, imports, plans, highlights, representation operations, and dependency interfaces. |
| `application/studio/` | Collection, generation, editing, candidates, evidence mapping, prompt settings, datasets, and run recovery. |
| `application/mapping/` | Diagram saves, workspace persistence, selection prompting, chat, and compaction workflows. |
| `infrastructure/core/` | Filesystem repositories, corpus discovery/access, LSP clients, and shared provider/session machinery. |
| `infrastructure/studio/`, `infrastructure/mapping/` | Feature-specific agent implementations and persistence adapters. |
| `tests/browser/` | Browser checks grouped by Core, Studio, Mapping, and support helpers. |
| `tests/performance/` | Performance and source-navigation browser runner. |
| `tests/architecture/` | Import boundary checks. |
| `tests/fixtures/` | Cross-cutting browser/performance fixtures. |
| `scripts/` | Development launchers, migrations, fixture builders, and diagram tooling. |
| `tools/experiments/` | Internal Node evaluation runner. Its shared records live in `domain/studio/experiments/types.ts`. |
| `tools/diagram-parser/diagram_parser/` | Intact Python package and its frozen evaluation bundles. |
| `examples/mapping-screen/` | Mapping-screen preparation/import scripts and their associated evidence. |
| `packages/ui-test-framework/` | Existing npm workspace for development UI controls. |

Unit and module integration tests live in `__tests__/` under their owning
capability. The UI test framework retains its own existing package layout.
`npm test` discovers application, server, domain, experiment, package, and
architecture tests. `npm run build` checks TypeScript and builds the browser app.
Existing `npm run check:*` commands point to the relocated browser checks.

## Dependencies

Studio and Mapping depend on their own capabilities and Core, never on each other.
Core does not depend on either feature. The layer dependencies are:

```text
src (browser)   -> domain
src/server/routes   -> application, domain, src/server/http
application     -> application, domain
infrastructure  -> application interfaces, domain, infrastructure
src/server/app/bootstrap.ts -> all backend layers (composition only)
```

The browser portion of `src/` excludes `src/server/`; browser modules cannot
import that backend subtree. Domain code has no Node, React, or HTTP dependency. Application code has no
filesystem, subprocess, HTTP, or provider SDK dependency; it receives repository,
corpus, language-service, and agent interfaces. Small backend computations may use
Node crypto/path utilities. Only the bootstrap module selects concrete adapters.
`tests/architecture/dependencies.test.ts` enforces layer and feature ownership.

The Core and Studio application classes are compatibility facades over capability
services. Studio uses explicit Core composition rather than inheritance. Shared
record persistence retains an aggregate `DiagramRepository` contract; focused
services accept the subset of operations they use. `DiagramStore` is a facade over
filesystem modules grouped by records, templates, runs, imports, plans, and paths.
Workspace assembly lives in `application/core/workspace/loadWorkspace.ts`.

Catalog transitions and editing/compaction validation live in `domain/`. The
catalog adapter keeps its serialization queue around the complete read, transition,
and atomic write, preserving optimistic revision checks and immutable history.
Application workflows publish events; routes serialize those events as NDJSON and
own HTTP disconnect handling. Prompt files remain with the agent integration that
loads them, alongside their license and provenance.

The aggregate schema module `domain/core/records/domain.ts`, large React components,
and global CSS retain their existing structure. No API URL, storage layout, or UI
behavior changes are part of the backend separation.

## Source evidence and tools

Live module references and executable source lookups follow the new paths.
Historical files under `docs/compactions/`, `docs/projections/`, example evidence,
parser evaluation bundles, and committed benchmarks retain their recorded source
addresses, row coordinates, and hashes. Regenerate evidence before claiming it
describes the current source tree. Do not bulk-relabel historical snapshots.

The `.diagrams*` stores and `softwarez/` external repositories remain at their
existing locations. The canonical agent skill remains `skills/new-diagram/` and
is installed through the unchanged `install-skill` launcher.

Run Python checks from the repository root with:

```sh
PYTHONPATH=tools/diagram-parser python3 -m unittest discover -s tools/diagram-parser/diagram_parser -p 'test_*.py'
```

Or change into `tools/diagram-parser/` and use the commands in the parser README.
