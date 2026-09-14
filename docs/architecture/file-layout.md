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
| `server/app/` | Vite plugin and API/runtime composition. |
| `server/core/` | Shared project resources, persistence, corpus access, and language services. |
| `server/features/` | Studio and Mapping routes, services, and feature-specific agent runtimes. |
| `server/infrastructure/` | HTTP helpers and shared agent/session/workflow machinery. |
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

Studio and Mapping depend on themselves and Core, never on each other. Core
does not depend on either feature. Browser and server modules import shared
contracts and algorithms from `domain/`; the domain layer imports neither
browser nor server implementations. Application composition roots connect the
features. `tests/architecture/dependencies.test.ts` enforces these boundaries.

The initial reorganization moves modules intact. In particular,
`domain/core/records/domain.ts` remains the aggregate schema module, and the
existing Mapping chat and workspace models retain their current contents.
Splitting these files, decomposing large React components, and dividing global
CSS are separate refactors. Component exports retain their existing names even
where the page/canvas filenames have been shortened.

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
