# new-diagram — diagram set and 3D layout

Repository: `new-diagram` (branch `worktree/perf-debug`). Vendored `softwarez/tldraw` excluded.
Inputs: five independent slice proposals (Core, Studio, Mapping, Shared-browser/composition, Tooling) — 42 candidate
diagrams. This document is the consolidated result: **41 diagrams** on **5 stacked planes**, each on a shared 5×8 grid.

Part A — consolidation decisions (what changed vs. the slice proposals and why)
Part B — the 3D layout (planes, grid axes, coordinates, and the vertical stacks that carry meaning)
Part C — full specification of every diagram (self-contained; one LLM generates one diagram from one section)

---

## Part A — Consolidation decisions

Each slice agent proposed diagrams from the vantage of its own directory tree. Reviewing all five against the whole
codebase (layer rules in `tests/architecture/dependencies.test.ts`, the single composition root `src/server/app/bootstrap.ts`,
the shared schema `domain/core/records/domain.ts`, and the import graph), the following isolated decisions were corrected.

### A.1 Merged (same relationship described twice from two vantages)

| Kept as | Absorbed | Why |
| --- | --- | --- |
| **CORE-3** Persisted record model | Studio D6 "Studio record model" | ~90% the same records; Studio writes them but Core owns the schema. Studio's two genuine additions are kept as annotations: the *mutable template → immutable config snapshot* pairs, and the promotion hand-off into the catalog. Each record now carries a **writer badge** (Core / Studio / Mapping) — the "who owns which record type" question Studio raised. |
| **CORE-4** DiagramStore → modules → on-disk store | Tooling D1 ".diagrams on-disk store" | Core D4 already drew the disk tree from `paths.ts`; Tooling D1 added directories Core did not know about (`trash/`, `migrations/`, `sources/`, `mapping/compactions/`, `mapping-workspace.json`, and the separate `.datasets` root). Merged into one persistence diagram with both the module decomposition and the complete tree. |
| **CORE-6** Catalog writes — three writers, one serialized transition | Mapping D2 "Canvas save path" | Mapping D2 is one lane of Core D3 (the `saveMappingDiagram` writer with `expectedRevisionId` → 409). The browser-side half of Mapping D2 (draft rebase of `savedScene`/`revisionId`, dirty flag, 409 banner) moved into **MAP-3** where the draft registry already lives. |
| **SYS-6** NDJSON streaming protocol | Studio D7 "NDJSON streaming protocol (Studio)" + Shared D3 | Same protocol seen from two owners. Shared D3 is the base (helpers, header flush, disconnect/abort, `vitePlugin` error translation, and the finding that **Studio's five streaming routes register no `close` listener** while Mapping/Core do). Studio D7's event-vocabulary table and the client-side `mergeMappingWorkspace` asymmetry are folded in as panels. |
| **TOOL-6** Browser-check harness | Tooling D8 "Source-pane performance runner" | D8 is one check's measurement model; it becomes an inset panel of the harness diagram rather than a peer. |

### A.2 Removed as standalone

- Mapping D2, Studio D6, Studio D7, Tooling D1, Tooling D8 — per the merges above. Nothing else was cut: every remaining
  proposal describes a distinct mechanism.

### A.3 Added (relationships no slice could see because they cross every slice)

| New | What it covers | Who flagged the gap |
| --- | --- | --- |
| **SYS-1** System overview | Three ownership areas, three pages, three HTTP namespaces, the external clients, and the *exactly two* places Studio and Mapping meet (the shared `DiagramStore` instance and `representations/catalog.json`). Also the tools that bypass HTTP and write the store directly. | Studio ("catalog is the sole meeting point"), Mapping ("global composition diagram belongs to the coordinator"), Tooling (scripts bypass the serialized queue). |
| **SYS-4** Isomorphic domain modules | The 26 `domain/**` modules imported by *both* `src/` (browser) and `application/`/`infrastructure/` (server), paired with their callers on each side — e.g. `projectCanvasSnapshot` runs in `catalogRules` on save and in the workspace codec in the browser. A change to one changes both client validation and server acceptance. | Core ("the same composeScene/projectCanvasSnapshot code runs in both places — a global diagram would be worthwhile"). |
| **SYS-5** Domain profile fan-out | One value (`source-code` \| `document`) decided at project creation, and its reach: corpus binding kind, corpus provider, code-entity template family, agent tool set, view-kind availability, explorer surfaces, content presentation, element commands, compaction eligibility. Resolves Shared's open question: the browser learns it from `WorkspaceSnapshot.project.domainProfileId` (`StudioPage.tsx:329`). | Shared ("could not verify how the browser learns the profile"); Core, Studio and Mapping each dropped it as "a two-entry registry" — individually trivial, globally the one configuration axis that touches every layer. |
| **CORE-8** Prompt templates | Families, profiles, versions, per-target-kind bindings (`GENERATION_PROMPT_BINDINGS`), the mutable-template → immutable-config snapshot, reset-to-built-in, validation-by-rendering; contrasted with Mapping's file-based prompts. | Studio ("center of gravity is Core's `prompt.ts`") and Core ("better shown inside a Studio prompt-settings diagram") each deferred to the other — nobody drew it. |

### A.4 Corrections applied to slice proposals

- Core D4/D7 presented `DiagramStore.loadWorkspace() → application/core/workspace/loadWorkspace` as a layering *exception*.
  It is not: `allowedLayers.infrastructure = ["infrastructure","application","domain"]` (`dependencies.test.ts:70`). CORE-1 and
  CORE-4 now label it "permitted infrastructure → application edge" rather than an inversion.
- Core D9 was marked optional. It is kept at full weight: `representationIndex` is consumed by Studio evidence mapping,
  Core highlights, Mapping compaction validation **and** the browser `DiagramView` (SYS-4 shows this); revision-scoped
  element ids are the mechanism that makes stale evidence detectable everywhere.
- The untracked `src/server/features/mapping/compaction/prompts/compaction/single-file-compact2-herdr-w3A-pB.md` is
  byte-identical to `infrastructure/mapping/agents/compaction/prompts/compaction/single-file-compact2.md` and referenced
  by nothing (Mapping and Shared both confirmed). Excluded from every diagram.
- Documentation drift noted by Tooling (stale paths in both `SKILL.md` files and `tools/experiments/README.md`) is not
  diagrammed; it is recorded here for the maintainers.

### A.5 Findings surfaced by the review (not diagrams, but worth knowing)

1. Studio streaming routes (`src/server/routes/studio/routes.ts:362,455,478,540,705`) never abort the agent on client
   disconnect; Mapping and Core routes do. (SYS-6 draws the asymmetry.)
2. `ProjectCatalogStore.upsertFileCompaction` is the only catalog mutator outside the `serialize()` queue (different document,
   probably safe, no test asserts it). (CORE-6 annotates it.)
3. The NDJSON client loop is copied six times across `src/features/*/api.ts`; `src/shared/http` has no stream helper.
4. `tests/architecture` allows any `src` file to import `packages/*`; the ui-test-framework composition-boundary rule in the
   README is enforced by convention only.
5. `infrastructure/core/diagrams/__tests__/projectProjection.test.ts` has no non-test sibling.
6. `application/core/agents/hash.ts` is used only by Mapping infrastructure.

---

## Part B — 3D layout

### B.1 Axes

**Planes (Z, top → bottom)** — ordered by distance from the foundation. Looking *down* through the stack moves from
external consumers to the shared core.

| Z | Plane | Contents |
| --- | --- | --- |
| Z1 | **External & tooling** | Skills, example scripts, the Python parser and its evaluation, browser checks, migrations |
| Z2 | **System** | Overview, composition, layer rules, isomorphic domain, domain profile, streaming protocol |
| Z3 | **Studio** | Evidence collection, generation, candidates, editing, experiments |
| Z4 | **Mapping** | Canvas editor: saves, workspace, selection prompts, compaction, chat, source panes |
| Z5 | **Core** (foundation) | Records, catalog, persistence, agent runner, prompts, evidence, LineGrid, and the shared browser capabilities |

Studio (Z3) and Mapping (Z4) are peers — both depend on Core and never on each other — so their relative order is a
rendering choice, not a dependency claim. Core sits at the bottom because everything above imports it.

**Grid within a plane (same 5 rows × 8 columns on every plane).**

Rows (Y, top → bottom) = *runtime layer* where the diagram's centre of gravity sits:

| Row | Layer |
| --- | --- |
| R1 | Browser (`src/`) |
| R2 | Transport / HTTP boundary (`src/server/app`, `src/server/http`, `src/server/routes`, HTTP clients) |
| R3 | Application (`application/`) |
| R4 | Domain (`domain/`) |
| R5 | Persistence / on-disk (`infrastructure/*/persistence`, `.diagrams`, `.datasets`) |

Columns (X, left → right) = *concern thread*:

| Col | Concern |
| --- | --- |
| C1 | Composition & boundaries |
| C2 | Records & store |
| C3 | Representation catalog & revisions |
| C4 | Agent workflows & prompts |
| C5 | Source evidence & references |
| C6 | Diagram canvas & ASCII grid |
| C7 | Workspace UI: panes, documents, conversations |
| C8 | Streaming, lifecycle & state machines |

**Reading rule.** A cell `(R, C)` at the same position on two planes is the same layer × concern seen from two
ownership areas — that vertical alignment is the "shared concern" signal. Horizontal adjacency within a plane is by
concern (columns) and by layer (rows); a column read top-to-bottom on one plane is one concern descending through the
layers of that area.

One deliberate exception: on the **System** plane, column C1 is ordered by *abstraction* (overview → process →
rules → shared domain → configuration) rather than by runtime layer, because those five diagrams each span all layers.

### B.2 Coordinates

| Z | Plane | Cell | Id | Title |
| --- | --- | --- | --- | --- |
| Z1 | External | (R1,C6) | TOOL-6 | Browser-check harness and the performance runner |
| Z1 | External | (R2,C3) | TOOL-3 | map-diagram-sources: ASCII → materialized set → canvas → projection |
| Z1 | External | (R2,C4) | TOOL-2 | The `new-diagram` agent skill, end to end |
| Z1 | External | (R4,C6) | TOOL-4 | `diagram_parser`: the ASCII parsing pipeline |
| Z1 | External | (R5,C2) | TOOL-1 | Plan bundles and the `migrate-plans` schema change |
| Z1 | External | (R5,C4) | TOOL-5 | Parser evaluation rounds: generate, freeze, independent review |
| Z2 | System | (R1,C1) | SYS-1 | System overview: areas, pages, namespaces, meeting points |
| Z2 | System | (R2,C1) | SYS-2 | Process start to running app: the composition graph |
| Z2 | System | (R3,C1) | SYS-3 | The executable layer and ownership rules |
| Z2 | System | (R4,C1) | SYS-4 | Isomorphic domain modules |
| Z2 | System | (R5,C1) | SYS-5 | Domain profile fan-out |
| Z2 | System | (R2,C8) | SYS-6 | NDJSON streaming protocol: lifecycle, events, disconnect |
| Z3 | Studio | (R3,C1) | STU-1 | Studio layer spine: facade → capability services → ports |
| Z3 | Studio | (R3,C4) | STU-3 | One generation batch: parallel slots, retry, workflow turns |
| Z3 | Studio | (R3,C5) | STU-4 | Code-entity mapping: evidence onto artifacts |
| Z3 | Studio | (R3,C6) | STU-5 | Artifact edit session state machine |
| Z3 | Studio | (R3,C8) | STU-2 | DiagramSet lifecycle and run recovery |
| Z3 | Studio | (R5,C4) | STU-6 | Experiments and datasets |
| Z4 | Mapping | (R1,C5) | MAP-8 | Retained selection effect tree and the source pane |
| Z4 | Mapping | (R1,C6) | MAP-3 | Where mapping state lives: three persistence tiers |
| Z4 | Mapping | (R3,C1) | MAP-1 | Mapping surface, ports and adapters |
| Z4 | Mapping | (R3,C4) | MAP-6 | Two-step file compaction |
| Z4 | Mapping | (R3,C6) | MAP-5 | Selection prompt: from drag to editor proposal |
| Z4 | Mapping | (R3,C7) | MAP-7 | Local chat: context freezing and conversation lifecycle |
| Z4 | Mapping | (R4,C3) | MAP-2 | What a saved mapping revision contains |
| Z4 | Mapping | (R4,C7) | MAP-4 | Workspace snapshot codec |
| Z5 | Core | (R1,C5) | CORE-13 | Evidence to source: reference buffer and source viewer |
| Z5 | Core | (R1,C6) | CORE-12 | The shared ASCII diagram surface (DiagramView) |
| Z5 | Core | (R1,C7) | CORE-14 | The pane system |
| Z5 | Core | (R2,C7) | CORE-15 | Terminal Markdown: sandboxed iframe and its message protocol |
| Z5 | Core | (R3,C1) | CORE-1 | Core ports, adapters and the bootstrap seam |
| Z5 | Core | (R3,C2) | CORE-2 | `loadWorkspace`: assembling the WorkspaceSnapshot |
| Z5 | Core | (R3,C4) | CORE-7 | `AgentWorkflow<T>` runner and executor contract |
| Z5 | Core | (R3,C5) | CORE-9 | Source evidence resolution, hashes and the LSP session |
| Z5 | Core | (R4,C2) | CORE-3 | The persisted record model |
| Z5 | Core | (R4,C3) | CORE-5 | The project representation catalog |
| Z5 | Core | (R4,C4) | CORE-8 | Prompt templates: families, bindings, snapshots |
| Z5 | Core | (R4,C5) | CORE-10 | Representation index → agent work scope → spatial progress |
| Z5 | Core | (R4,C6) | CORE-11 | `LineGridScene`: canvas data model and pipeline |
| Z5 | Core | (R5,C2) | CORE-4 | DiagramStore facade → filesystem modules → on-disk store |
| Z5 | Core | (R5,C3) | CORE-6 | Catalog writes: three writers, one serialized transition |

### B.3 Plane maps

```
Z1  External & tooling          C1      C2      C3      C4      C5      C6      C7      C8
    R1 browser                  .       .       .       .       .       TOOL-6  .       .
    R2 transport                .       .       TOOL-3  TOOL-2  .       .       .       .
    R3 application              .       .       .       .       .       .       .       .
    R4 domain                   .       .       .       .       .       TOOL-4  .       .
    R5 persistence              .       TOOL-1  .       TOOL-5  .       .       .       .

Z2  System                      C1      C2      C3      C4      C5      C6      C7      C8
    R1                          SYS-1   .       .       .       .       .       .       .
    R2                          SYS-2   .       .       .       .       .       .       SYS-6
    R3                          SYS-3   .       .       .       .       .       .       .
    R4                          SYS-4   .       .       .       .       .       .       .
    R5                          SYS-5   .       .       .       .       .       .       .

Z3  Studio                      C1      C2      C3      C4      C5      C6      C7      C8
    R1                          .       .       .       .       .       .       .       .
    R2                          .       .       .       .       .       .       .       .
    R3                          STU-1   .       .       STU-3   STU-4   STU-5   .       STU-2
    R4                          .       .       .       .       .       .       .       .
    R5                          .       .       .       STU-6   .       .       .       .

Z4  Mapping                     C1      C2      C3      C4      C5      C6      C7      C8
    R1                          .       .       .       .       MAP-8   MAP-3   .       .
    R2                          .       .       .       .       .       .       .       .
    R3                          MAP-1   .       .       MAP-6   .       MAP-5   MAP-7   .
    R4                          .       .       MAP-2   .       .       .       MAP-4   .
    R5                          .       .       .       .       .       .       .       .

Z5  Core                        C1      C2      C3      C4      C5      C6      C7      C8
    R1                          .       .       .       .       CORE-13 CORE-12 CORE-14 .
    R2                          .       .       .       .       .       .       CORE-15 .
    R3                          CORE-1  CORE-2  .       CORE-7  CORE-9  .       .       .
    R4                          .       CORE-3  CORE-5  CORE-8  CORE-10 CORE-11 .       .
    R5                          .       CORE-4  CORE-6  .       .       .       .       .
```

### B.4 The vertical stacks that carry meaning

These are the cells occupied on more than one plane. Each is a deliberate "same concern, different owner" alignment and
is the natural place to draw cross-plane relations.

| Cell | Stack (top → bottom) | Shared concern |
| --- | --- | --- |
| (R3,C1) | STU-1 → MAP-1 → CORE-1 | Ports & adapters per ownership area; all three converge on `bootstrap.ts` and the single `DiagramStore` instance. |
| (R3,C4) | TOOL-2* → STU-3 → MAP-6 → CORE-7 | Agent workflows on the shared `runAgentWorkflow` runner (Studio generate→reference→map; Mapping compact→refine). *TOOL-2 is at R2 in the same column: the external HTTP client that triggers STU-3. |
| (R3,C5) | STU-4 → CORE-9 | Evidence: Studio attaches it to artifacts; Core resolves it to source. CORE-10 (R4,C5) is the domain model both use; MAP-8 and CORE-13 (R1,C5) are the browser views of the same evidence. |
| (R3,C6) | STU-5 → MAP-5 | Editing ASCII through an agent: Studio's undoable edit session vs. Mapping's stateless selection prompt (both produce patches validated for exact-hunk match; only Studio persists an operation log). |
| (R1,C6) | TOOL-6 → MAP-3 → CORE-12 | The canvas in the browser: checks drive it, Mapping holds its state, Core renders it. CORE-11 (R4,C6) is the pure model beneath; TOOL-4 (R4,C6) is the outside-in grammar of the same ASCII. |
| (R4,C3) | MAP-2 → CORE-5 | A revision: Core's catalog record vs. what Mapping stores vs. derives in it. CORE-6 (R5,C3) is the write path; TOOL-3 (R2,C3) is the external client that exercises promote → save → project. |
| (R5,C2) | TOOL-1 → CORE-4 | The on-disk store: Core's layout; the plan-bundle migration that rewrites part of it. CORE-3 (R4,C2) is the schema; CORE-2 (R3,C2) the read model assembled from it. |
| (R5,C4) | TOOL-5 → STU-6 | Offline evaluation bundles on disk: parser rounds vs. prompt-axis experiments — both freeze inputs by hash and are resumable by file existence. |
| C7 column | CORE-14 (R1) / CORE-15 (R2) on Core; MAP-7 (R3) / MAP-4 (R4) on Mapping | The two workspace models: Studio's BSP pane tree vs. Mapping's floating effect tree + codec. Mapping does not use the shared pane system. |
| (R2,C8) | SYS-6 | Streaming sits alone at the transport row; STU-2 (R3,C8) is the lifecycle it reports on. |
| C1 on System | SYS-1..5 | The architecture spine. SYS-3 (rules) sits directly above the (R3,C1) ports stack on the three area planes — the rules those diagrams obey. |

---

## Part C — Diagram specifications

Each section is self-contained. Sections are the slice agents' specifications, edited where Part A says so; a
**Provenance** line records the source and any modification. New diagrams (SYS-1, SYS-4, SYS-5, CORE-8) are written here
in full. Paths are repo-relative. Line numbers were verified by the slice agents at the time of reading.


## Plane Z1 — External & tooling

### TOOL-6 — Browser-check harness and the performance runner
- **Provenance**: Tooling slice, D7. Placement Z1 External (R1,C6).
- **Modifications**: MERGED: Tooling D8 (source-pane performance runner) becomes an inset panel of this diagram — keep its four instrumentation signals and the two hard gates (`chunkReads === 0`, `sourceMutations === 0`), drop the persistence-phase step list to a one-line caption.

- **Kind**: layered architecture + per-check inventory
- **Question it answers**: What is the common skeleton every browser check builds (fixture repo, seeded `.diagrams`, spawned preview server, headless CDP), and what does each individual check drive and assert?
- **Boundary (IN)**:
  - Shared skeleton, present in each check: `loadBrowserHarness()` / the direct `~/.codex/skills/front-end/browser-test.mjs` import providing `{withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot, elementClip}`; `freePort()` via `node:net`; `mkdtemp` + `git init -q`; `spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host','127.0.0.1','--port',N,'--strictPort'], {env:{NEW_DIAGRAM_PROJECT_ROOT, NEW_DIAGRAMS_DIR, NEW_DIAGRAM_AGENT:'fake'}})`; `waitFor(fetch(url).ok)`; `finally { server.kill(); rm(temp) }`
  - `scripts/dev/start-server.mjs` — thin Vite wrapper; `--lsp` sets `globalThis[Symbol.for('new-diagram.lsp-enabled')]` **process-locally** (explicitly not settable via env/workspace/request)
  - Support helpers: `tests/browser/support/browser-mapping-fixture.mjs` (`seedMappingFixture(root, diagram)` — `git init`, derive `projectId = project-<sha256(root/.git)[0:12]>`, load `MAPPING_POC_GRAPH_A`/`MAPPING_POC_A_NODES` from `domain/mapping/selection/mappingPoc.ts` through tsx, build evidence + mappings with real `originalLines` read from the repo or `git show HEAD:<path>`, write `.diagrams/project.json` and `.diagrams/representations/catalog.json` with one representation + one revision); `tests/browser/support/browser-source-navigation-check.mjs` (`checkSourceNavigation({...})`, invoked by the performance runner, not standalone)
  - Fixtures: `tests/fixtures/source-navigation/source.mjs` (`mathSource`, `mainSource` with a 😀 for UTF-16 coordinates, `tsconfig`), `tests/fixtures/source-pane-performance/source.mjs` (3,000-line `sourceText` with a 240-char wide last line), `tests/fixtures/source-pane-performance/workspace.json` (generated by `scripts/fixtures/create-source-pane-performance-fixture.mjs`)
  - Checks (nodes): `tests/browser/core/browser-diagram-canvas-check.mjs` (canvas pan/zoom, ASCII cell drag-selection, mapped-element → Code Entities tab, Ctrl-drag must select not pan, center control resets to 100%; emits a JSON `{event, status:"passed", screenshot}` line); `tests/browser/core/browser-aux-views-check.mjs` (empty → generate → star → toggle → reload); `tests/browser/core/browser-domain-profiles-check.mjs` (document profile); `tests/browser/core/browser-markdown-check.mjs` (run via tsx, imports `src/shared/markdown/render` and serves it over a local `node:http` server — the one check with no app server); `tests/browser/mapping/browser-project-mapping-check.mjs` (create, save, reload, grouped scene, navigation, internal prompt across a switch, Studio catalog) — re-exported by `browser-mapping-poc-check.mjs`; `tests/browser/mapping/browser-line-grid-check.mjs` (generation into shared rows, collision displacement, atomic undo/redo, nested collapse/expand, recursive generation, local edits, group movement, selection under pan/zoom, placement cancellation, generated evidence after save/reload); `tests/browser/mapping/browser-projection-check.mjs` (the largest: retained source panes, exact highlights, compaction folds, node expansion, file switching, stale/missing source + retry, save/reload, Ctrl-selection, retained groups, Escape, stacked/chained panes, edge connectors, recursive collapse, saved drafts/viewport, revision validation — and imports `buildProjectionTree` through `tsx/esm/api` to compute expectations independently of the UI); `tests/browser/mapping/browser-canvas-paste-check.mjs`; `tests/browser/mapping/browser-unmapped-selection-check.mjs`; `tests/browser/mapping/browser-local-chat-check.mjs` (compact/floating/docked chat, automatic placement, HTTP replies, context snapshots, verbosity); `tests/browser/studio/browser-check.mjs` (2,091 lines: source → components → archives → imports → set delete → reload; has its own `createDiagramSet()` NDJSON client)
  - `package.json` scripts wiring each check (`check:browser`, `check:canvas`, `check:mapping`, `check:line-grid`, `check:canvas-paste`, `check:unmapped-selection`, `check:local-chat`, `check:domain-profiles`, `check:markdown`, `check:aux-views`, `check:source-performance`, `check:source-navigation`)
  - `tests/architecture/dependencies.test.ts` (the only non-browser test in the slice) — enforces layer/feature import boundaries
- **Boundary (OUT)**: the app's React components and server routes (collapse to one node "app under test: `/mapping`, `/`, `/experiments`"); the external `browser-test.mjs` harness internals (one node); `vitest` unit tests.
- **Edges / relationships**:
  - `check --seeds--> temp git repo + .diagrams/{project.json, representations/catalog.json}` ; `check --spawns--> start-server.mjs preview` ; `start-server.mjs --imports--> vite bin` ; `check --CDP--> headless Chrome --HTTP--> preview server --reads/writes--> temp .diagrams`
  - Every UI interaction is a real CDP input event (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`); `evaluate` is used for geometry reads and DOM state only. Several checks add an occlusion guard (`el.contains(document.elementFromPoint(x,y))`) and a "point settled twice" guard before clicking.
  - Assertions come from three sources: DOM state via `evaluate`, HTTP round-trips (`fetch(url + '/api/mapping/workspace')`), and `Runtime.exceptionThrown` collected into an `errors` array asserted empty.
  - `NEW_DIAGRAM_AGENT=fake` (read at `src/server/app/bootstrap.ts:59`) swaps in fake agent runtimes so no provider call happens.
  - `browser-mapping-fixture.mjs --used by--> canvas-paste, unmapped-selection, line-grid, local-chat`
- **Notes for the renderer**: draw the shared skeleton once as a vertical stack (fixture → server → browser → assertions) and hang the individual checks off it as a fan, labelled with what each one drives. Mark `browser-markdown-check.mjs` as the exception that serves rendered HTML directly. Mark the two support modules as shared.

---

### TOOL-3 — map-diagram-sources: ASCII → materialized set → canvas → projection
- **Provenance**: Tooling slice, D4. Placement Z1 External (R2,C3).
- **Modifications**: The only diagram that shows the two-hop projection semantics end to end; CORE-5 holds the projection *records*, CORE-6 the write. Note the stale paths in `.skills/map-diagram-sources/SKILL.md` as a caption, not as nodes.

- **Kind**: multi-stage pipeline + API call sequence
- **Question it answers**: How does a supplied ASCII tree become a source-mapped Mapping canvas with a two-hop projection into per-file compactions, and which API is called in what order with which pinning checks?
- **Boundary (IN)**:
  - `.skills/map-diagram-sources/SKILL.md` (the instructions)
  - `examples/mapping-screen/prepare.ts` (TypeScript-AST compaction generator; writes `prepared.json` + `compactions/`), `examples/mapping-screen/import.ts` (the API sequence; writes `projection.json`, `receipt.json`), `examples/mapping-screen/refresh.ts` (correction path; writes `refresh-receipt.json`), `examples/mapping-screen/diagram.txt`, `implementation.txt`, `README.md`
  - Domain functions the scripts import directly: `domain/core/diagrams/projectDiagramCanvas.ts` (`sceneFromRevision`), `domain/core/diagrams/diagramProjection.ts` (`buildProjectionTree`, `projectSelection`, `validateProjection`), `domain/core/representations/compactionProjection.ts` (`projectCompactions`), `domain/core/representations/representationIndex.ts` (`buildTreeRepresentationIndex`)
  - `docs/guides/diagram-projections.md` (semantics), `scripts/diagrams/import-projection.ts` (offline alternative: writes straight through `ProjectCatalogStore.saveProjectedTree`), `scripts/diagrams/generate-prompt-call-tree.mjs` and `scripts/diagrams/validate-compactions.mjs` (the curated-tree generator/validator pair)
  - HTTP endpoints: `GET /api/core/project/representations`, `GET /api/core/workspace`, `POST /api/studio/diagram-sets` (`creationMode:"materialized"`), `POST /api/studio/project/representations/promote`, `POST /api/mapping/diagrams`, `POST /api/core/project/projections`
- **Boundary (OUT)**: the Mapping browser UI and its selection interaction (one node "Mapping canvas, press N → call tree → compaction → source"); `docs/compactions/` historical snapshots (one node); `examples/mapping-screen/compactions/` evidence dir (explicitly excluded).
- **Nodes**:
  - Stage 1 — Prepare (`prepare.ts`): `diagram.txt` (printable-ASCII assertion) + a hard-coded 16-row `choices` table (label → source file → symbol → behavior summary) → TypeScript `ts.createSourceFile` walk producing a declaration outline per file → per-file compaction `{sourceFile, sourceSha256, ascii, asciiSha256, mappings:[{treeLine, sourceRanges:[{startLine,endLine}]}]}` → `implementation.txt` derived tree → `prepared.json` bundle `{materialized:{name, path, codeEntities, diagrams}, projection:{name, ascii, links:[{handle, targetLines}], compactionProjection:{files, links:[{callTreeLine,file,treeLines}]}}}`
  - Stage 2 — Preflight (`import.ts:34-46`): re-read `diagram.txt` and assert the bundle's ASCII is byte-identical; for every compaction file re-hash current source and assert `sourceSha256`, assert `asciiSha256`, assert every range is within `[1, lineCount]` — **all before any mutation**
  - Stage 3 — Identify project: `GET /api/core/project/representations` → assert `project.canonicalRepoRoot === cwd`; receipt guard `receipt.projectId`/`bundleSha256`
  - Stage 4 — Materialized set: duplicate guard against `GET /api/core/workspace` by set name → `POST /api/studio/diagram-sets {creationMode:"materialized", …}` → parse NDJSON, take `type:"result"` → `{diagramSetId, diagramIdsByKey}`
  - Stage 5 — Promote: `POST /api/studio/project/representations/promote {diagramSetId, diagramId, makeActive:false}` → find the new representation by revision **provenance** `{diagramSetId, artifactId}`
  - Stage 6 — Canvas: if the current revision's `content.kind !== "mapping-canvas"`, `POST /api/mapping/diagrams {projectId, representationId, expectedRevisionId, name, scene: sceneFromRevision(revision)}` → new revision pinned by optimistic `expectedRevisionId` (409 on stale)
  - Stage 7 — Resolve evidence: for each prepared `link.handle`, find the saved revision's evidence by `handle`, assert its `sourceRanges` deep-equal the intended ones, assert the `ProjectionCompanion` special case (its lines must contain `className="mapping-poc-companion"`), build `{sourceEvidenceIds:[evidence.id], targetLines}`
  - Stage 8 — Projection: write `projection.json`, `POST /api/core/project/projections {sourceRepresentationId, sourceRevisionId, name, ascii, links, compactionProjection}` → server atomically writes target representation + immutable revision + projection into `representations/catalog.json`
  - Stage 9 — Verify: `validateProjection(projection, catalog)`, then for each of the 16 links `projectSelection(...)` must match exactly one evidence id and exactly the expected target lines, and `projectCompactions(...)` must return exactly one file — "a selective mapping must only expose its intended file"
  - `receipt.json` — resumability record written after every successful mutation (`server, projectId, bundleSha256, diagramSetId, diagramId, representationId, sourceRevisionId, projectionId, targetRepresentationId, url, verifiedAt`)
  - `refresh.ts` — correction path: promotes fresh evidence into the **existing** representation with `expectedRevisionId`, preserves canvas layout, rebuilds the existing projection target, journals to `refresh-receipt.json`
- **Edges / relationships**: strictly sequential stages; draw the receipt as a side store that each stage reads (skip) and writes (record). Mark the two-hop projection semantics on the projection node: hop 1 (evidence → call-tree rows) is OR-matching and expands matched subtrees plus display-only ancestors; hop 2 (call-tree rows → compaction rows) uses matched subtree nodes only and adds only necessary ancestors, never implicit descendants. Mark every revision id as pinned: later edits invalidate the projection.
- **Notes for the renderer**: lay left-to-right as a pipeline with the HTTP calls as a labelled band; annotate each stage with its abort condition (hash mismatch, duplicate set, stale revision, wrong evidence region). Make clear that `prepare.ts` touches no server at all and `import.ts` performs no computation the server would not also validate.

---

### TOOL-2 — The `new-diagram` agent skill, end to end
- **Provenance**: Tooling slice, D3. Placement Z1 External (R2,C4).
- **Modifications**: External-client view of STU-2/STU-3. The intermediate progress vocabulary it could not verify is specified in SYS-6 — cite it rather than re-deriving.

- **Kind**: sequence diagram with lifelines
- **Question it answers**: What does an external coding agent actually do when it runs the `new-diagram` skill, what does it expect the human to have done, and what happens server-side for that single HTTP call?
- **Boundary (IN)**:
  - `skills/new-diagram/SKILL.md` (the instruction set), `skills/new-diagram/agents/openai.yaml` (Codex surface metadata), `install-skill` (installer)
  - README sections "Install the agent skill" (README.md:19-31) and "Start a DiagramSet through HTTP" (README.md:113-150)
  - `src/server/routes/studio/routes.ts` (NDJSON framing: `sendEvent`, `content-type: application/x-ndjson`, `flushHeaders`)
  - `application/studio/collection/diagramSetWorkflow.ts` — `prepare()` (validation + template resolution, lines 8-71) and `run()` (lines 72-137)
  - `application/studio/collection/service.ts`, `application/studio/generation/*` shown as collapsed application nodes
  - Store targets: `diagram-sets/<setId>/diagram-set.json`, `code-entities.json`, `diagrams/*.json`, `generation-prompts/*.json`, `runs/*.json`
- **Boundary (OUT)**: the Pi agent SDK internals and provider auth (one node "read-only Pi collection agent"); the browser studio UI (one node, "picks up progress automatically"); all other `/api/studio` endpoints.
- **Nodes (lifelines, left to right)**: Human → External agent (Codex, running the skill) → `curl`/HTTP client → `POST /api/studio/diagram-sets` route → `DiagramSetWorkflow` → `StudioApplication` → collection agent → generation → `DiagramStore` (`.diagrams/`)
- **Edges / relationships (ordered messages)**:
  1. Human (setup, prerequisite): runs `./install-skill` → copies `skills/new-diagram/` to `$CODEX_HOME/skills/new-diagram` via staging dir + atomic rename with backup/rollback (`install-skill`); refuses to replace a symlinked target.
  2. Human (prerequisite): starts the server for the target corpus — `NEW_DIAGRAM_PROJECT_ROOT=/path/to/repo NEW_DIAGRAMS_DIR=.diagrams npm run dev -- --port 5173 --strictPort`. `NEW_DIAGRAM_DOMAIN=document` for document corpora.
  3. Human → agent: one repository path, one DiagramSet name, one concise collection prompt, optionally a prompt-style request.
  4. Agent → `GET /api/studio/system-prompt-templates` (only when a style was requested without an exact id); agent must use a returned `id` verbatim, never guess from the display label.
  5. Agent writes `request.json` = `{path, name, prompt, runReferencePrompt: true, promptTemplateId?, referencePrompt?}` and sends it **once**: `POST /api/studio/diagram-sets` with `--data-binary @request.json --no-buffer`.
  6. Route → `DiagramSetWorkflow.prepare()`: validates `path` + `name`, resolves `domainProfileId` (body → configured → existing project → `"source-code"`), rejects materialized fields in generate mode, `validateDiagramSetTarget(path, domain)`, `resolveSystemPromptTemplate` / `resolveCodeEntityPromptTemplate`.
  7. `run()` → `createDiagramSet()` → store writes `diagram-set.json` (+ empty `code-entities.json`) → emits NDJSON `{type:"created", diagramSetId, projectRoot, domainProfileId, promptTemplateId, codeEntityPromptTemplateId}` (diagramSetWorkflow.ts:93-100).
  8. `collectCodeEntities(setId, {promptTemplateId}, onEvent)` → one read-only Pi agent walks the corpus → progress events stream → finalizes the immutable CodeEntitiesSet (`code-entities.json`, `status`, `finalizedAt`), writes `code-entity-prompts/*.json` and `runs/*.json`.
  9. `generateInitialDiagrams(setId, {promptTemplateId, runReferencePrompt, referencePrompt}, onEvent)` → optional "Diagram reference" follow-up turn + **mandatory final mapping turn** → writes `diagrams/*.json`, `generation-batches/*.json`, immutable `generation-prompts/<promptConfigId>.json`.
  10. Final `{type:"result", diagramSetId, promptTemplateId, promptTemplateVersion, generationPromptConfigId, codeEntityPromptTemplateId/Version/ConfigId, workspace}` (diagramSetWorkflow.ts:125-136).
  11. Agent → Human: reports `diagramSetId`, server address, `promptTemplateId`, `promptTemplateVersion`, `generationPromptConfigId`.
  - Error/recovery edges (draw as dashed): agent must scan for `{type:"error"}` **even on HTTP 200** and must require a final `result`; if the connection drops after creation, the agent inspects `GET /api/core/workspace` before retrying, to avoid a duplicate DiagramSet.
  - Invocation-boundary constraints (draw as a boxed guard on the agent lifeline): exactly one logical diagram per invocation; no extra diagram/component/view in the set; no call to any generation endpoint from outside; multiple requested diagrams ⇒ separate invocations; stop after the first DiagramSet; never mutate a finalized CodeEntitiesSet.
  - Note edge: `promptTemplateId` selects the *latest persisted revision* of a template; it is **not** a historical `GenerationPromptConfigRecord` id — that immutable record is created server-side when generation begins.
- **Notes for the renderer**: this is one HTTP request with a long streaming response; draw step 5 as a single arrow and steps 7–10 as events flowing back up the same connection. Put the human's two prerequisites (install-skill, start server) above the main sequence as a setup band.

---

### TOOL-4 — `diagram_parser`: the ASCII parsing pipeline
- **Provenance**: Tooling slice, D5. Placement Z1 External (R4,C6).
- **Modifications**: Standalone Python; sits above CORE-11 (the in-app grid model) as the outside-in grammar of the same ASCII. No code edge between them — the alignment is conceptual.

- **Kind**: data-flow pipeline with the output record model attached
- **Question it answers**: How does raw LLM-drawn ASCII become a node/edge model, what decision does each stage make, and how does the graph parser reuse the tree parser?
- **Boundary (IN)**:
  - `tools/diagram-parser/diagram_parser/tree_parser.py` — `parse_tree` (:428), `_normalize` (:137), `_lex` (:141), `_prepare_rows` (:168), `_lookahead` (:226), `_exclude_detached_lists` (:238), `_clean_routed_wires` (:279), `_ForestBuilder` (:324) with `consume` (:346), `consume_plain` (:365), `should_join` (:396), `add_node` (:403); result types `Diagnostic` (:21), `Decoration` (:29), `Node` (:39), `LineRecord` (:54), `ParseResult` (:62) with `render` (:76); `TreeParseError` (:91); `main` (:469) CLI
  - `tools/diagram-parser/diagram_parser/graph_parser.py` — `parse_graph` (:575), `_scan` (:105), `_partition` (:190), `_trees` (:240), `_straighten` (:369), `_trace` (:483), `_render` (:547), helpers `_vertical_links` (:305), `_ordered_pairs` (:331), `_components` (:428), `_crossing` (:421), `_endpoint` (:461), `_target` (:465); result types `Span` (:24), `GraphNode` (:38), `Endpoint` (:47), `Reference` (:53), `Repair` (:62), `GraphResult` (:71); `main` (:625) CLI
  - The four option knobs: `mode ∈ {auto, tree}`, `continuation ∈ {auto, nodes, join}`, `label_mode ∈ {semantic, literal}`, `list_policy ∈ {auto, include}`; limits `max_nodes`, `max_chars`, `tab_size`
  - Fixtures `tools/diagram-parser/diagram_parser/fixtures/{mapping_graph,misaligned_neighbor,workbench_renderer}.{txt,cleaned.txt,parsed.json}`
- **Boundary (OUT)**: the test files (`test_tree_parser.py`, `test_semantic_labels.py`, `test_graph_parser.py`, `test_workbench_graph.py`, `test_graph_review.py`) — one collapsed node "52 tests incl. 2,000 randomized known-answer trees"; the evaluation bundles (that is D6); the TypeScript app (the parser is standalone and the app does not import it).
- **Nodes** — TREE LANE (top, left→right):
  1. `text: str` (UTF-8 file or stdin)
  2. `_normalize` — strip ANSI/OSC, drop zero-widths, map NBSP/narrow-NBSP/figure-space → space, `expandtabs(tab_size)`
  3. `_prepare_rows` — consistent `>` blockquote unwrap; fence scan (``` / ~~~ with info string in `{"", ascii, text, txt, tree, plaintext, console}`) selecting "tree blocks" and marking everything else `outside`; outer-frame detection (`+---+` corner rule) and frame-pipe stripping; assigns each row a `block` id
  4. `_lex` — classifies each row as `branch` (`_BRANCH` regex: joint + dashes, bare arrows, Unicode joints), `bullet` (`-+*•●◦▪▸▹` or `1.`/`1)`), `guide`, `border`, `blank`, `fence`, `prose` (Markdown heading or `_PROSE` opener regex), or `plain`; records `anchor` (connector column) and `column` (label column)
  5. `_exclude_detached_lists` (only when `mode="auto"` and `list_policy="auto"`) — after an explicit tree, a blank-separated ordinary bullet list at or left of the tree's top anchor becomes `excluded_prose`, and its heading with it
  6. `_clean_routed_wires` (only when `label_mode="semantic"`) — finds *paired* outgoing/incoming wire suffixes (`_WIRE_SUFFIX`), strips them from labels into `Decoration(line, column, text, kind="reference_wire")`; lone pipes/dashes and unpaired routes are kept
  7. `_ForestBuilder` loop — an explicit `stack: [(anchor, node_id)]`, **no recursion**: `consume` resets per block; `consume_plain` decides prose vs. continuation vs. unmarked node; `should_join` joins a wrap when `row.column == previous.column - 1` or the previous label ends in `/`, `,`, `\`; `add_node` pops the stack to the nearest shallower anchor, emitting `irregular_dedent` when the dedent matched no existing level
  8. `ParseResult` — `nodes[]` (preorder array indices as ids; `label, parent_id, depth, line, end_line, column, branch_column, children[], raw_lines[], decorations[]`), `roots[]`, `diagnostics[]`, and `lines[]` — **one `LineRecord` for every input line**, classified `node|continuation|prose|blank|guide|border|fence|outside|unparsed`
  9. `render(indent>=4)` — canonical ASCII with an explicit connector on every root (so leaf roots survive a re-parse)
  10. CLI `main` — `--strict --format json|ascii --mode --continuation --label-mode --list-policy --tab-size`; exit 1 on input error, empty tree, or (with `--strict`) any diagnostic; JSON still emitted
  - GRAPH LANE (bottom, left→right):
  11. `parse_graph(text, tree_tolerance=1, wire_tolerance=2)` entry
  12. `_scan` — split each line into `Span`s (label runs need **≥3 separating spaces**; balanced `[] {} ()` protect embedded arrows) and a `wires: {(row,col) → glyph}` grid; `_ROUTE` vs `_BRANCH` regexes decide connector vs containment
  13. `_partition` — cluster spans into `GraphNode`s of kind `tree` or `text` (consecutive unconnected same-column text lines = one multiline text region)
  14. `_trees` — **calls `parse_tree` per local tree region** (the reuse edge), records `Repair`s for branch drift within `tree_tolerance`
  15. `_straighten` + `_vertical_links` + `_ordered_pairs` + `_components` — move whole vertical wire runs (with corners) within `wire_tolerance`, keeping bundle left-to-right order; repairs never cross text or another wire
  16. `_trace` — follow headed wires to `Endpoint`s: a head on a neighbouring tree's branch/guide addresses the whole tree region (`node_id` only); a head at a label addresses that tree item (`node_id` + `tree_node_id`); `-|-` is a non-joining crossing; a shared bus yields one `Reference` per arrowhead plus an informational diagnostic
  17. `_render` → `cleaned_ascii`; `GraphResult{nodes, references, diagnostics, repairs, original_ascii, cleaned_ascii}`; `GraphParseError` on strict with any non-info diagnostic
  18. CLI `main` — `--format json|ascii`, `--nodes` (numbered source-order listing with subtrees), `--cleaned-output`, `--strict`
- **Edges / relationships**: pipeline edges are "produces"; `_trees --calls--> parse_tree` is the one cross-lane edge (graph_parser.py imports `Diagnostic, ParseResult, parse_tree` from `tree_parser`, with a try/except relative-import fallback so both module and script invocation work). Draw `Decoration` as a side output of stage 6 feeding `Node.decorations`, and `LineRecord` as a side output of every stage feeding `ParseResult.lines`. Draw the four option knobs as switches on stages 5, 6, and 7.
- **Notes for the renderer**: keep the two lanes horizontally aligned so the `_trees → parse_tree` edge is a clean vertical. Annotate the invariants: ids are array indices and never identities; labels are never identities; columns are one-based after normalization; nothing recurses (traversal, rendering, and building are all iterative). Add a caption: this targets text *trees* and a deliberately regular box-and-wire dialect — not arbitrary drawings.

---

### TOOL-1 — Plan bundles and the `migrate-plans` schema change
- **Provenance**: Tooling slice, D2. Placement Z1 External (R5,C2).
- **Modifications**: Now the single Plans diagram. Core D1 keeps only the `PlanRecord` node; the change-kind fan and file fan-out live here. Stacks above CORE-4.

- **Kind**: data-model transformation (before → after) with the migration control flow
- **Question it answers**: What does a Plan look like on disk, and precisely what does `npm run migrate:plans` convert from the legacy inline manifest to the exploded bundle?
- **Boundary (IN)**:
  - `scripts/migrations/migrate-plans.ts` (CLI: `[checkoutRoot] [--diagrams-dir X]`, default `.diagrams`)
  - `infrastructure/core/persistence/planMigration.ts` (`migrateLegacyPlanBundles`, `migrateChange`, `legacyManifest`)
  - `infrastructure/core/persistence/plans.ts` (`loadPlan`, `savePlan`, `assertPlanArtifacts`)
  - `infrastructure/core/persistence/paths.ts:20-48` (`plansRoot`, `planRoot`, `planManifestPath`, `planMarkdownPath`, `planSelectionPath`, `planChangeRoot`, `planChangePath`)
  - The real example bundle `.diagrams-parent-architecture/plans/global-representation-input-routing/` (`plan.json`, `legacy-plan.json`, `plan.md`, `selection.json`, `changes/interactive-studio-input-routing/{change.json, base.txt, output.txt, semantic-diff.json}`)
- **Boundary (OUT)**: `domain/core/plans/plans.ts` validation internals (single node "validatePlanRecord / applyPlanPatch"); the `/api/core/plans` HTTP routes (single node); the other two migration scripts (they are id relabellers, see D-notes below).
- **Nodes**:
  - LEFT (legacy): `plan.json` (legacy inline manifest) — `{schemaVersion, id, projectId, title, status, markdownPath:"plan.md", changes:[ …full change objects inline… ], createdAt, updatedAt}`; `plan.md`
  - MIDDLE (migration): `migrate-plans.ts` CLI → `new DiagramStore(checkoutRoot, diagramsDirectory)` → `migrateLegacyPlanBundles(store)` → per-directory loop → `migrateChange()` (three branches) → `store.savePlan(plan)` → `store.loadPlan(plan.id)` (read-back verification) → result `{migratedPlanIds[], skippedPlanIds[]}` printed as JSON
  - RIGHT (bundle): `plan.json` (reference manifest) — `{schemaVersion, id, projectId, title, status, migration, markdownPath:"plan.md", selectionPath:"selection.json", changes:[{id, kind, mode?, path:"changes/<id>/change.json"}]}`; `plan.md`; `selection.json` (`{schemaVersion, availability, affectedCodeEntities, diagramCandidates, selectedDiagramIds}`); `changes/<changeId>/change.json`; `changes/<changeId>/base.txt`; `.../output.txt`; `.../semantic-diff.json`; `.../base.json` + `.../output.json` (compaction changes only); `legacy-plan.json` (byte-exact preserved source manifest)
  - Three change kinds as branch nodes: `diagram-modified`, `diagram-added`, `code-entity-compaction`
- **Edges / relationships**:
  - `migrateLegacyPlanBundles` **skips** any directory whose `plan.json` already has `selectionPath === "selection.json"` → `skippedPlanIds` (idempotent; planMigration.ts, `if (raw.selectionPath === "selection.json")`)
  - `diagram-modified` branch: loads the canonical Diagram via `store.loadDiagram(diagramSetId, diagramId)`, **verifies** `asciiSha256(baseDiagram.ascii) === baseAsciiSha256` (aborts on drift), computes `outputAscii = applyPlanPatch(baseDiagram.ascii, patch)`, sets `mode = (patch.start === 0 && patch.deletedText === baseDiagram.ascii) ? "complete" : "partial"`, attaches `generation: {availability: "unavailable", contextDiagramIds: []}`
  - `code-entity-compaction` branch: resolves the entity from `store.loadCodeEntities(setId)` **or** `store.loadImportedCodeEntity(id)`, verifies the stored `baseCompactedSource` still equals the range's current `compactedSource`
  - `diagram-added` branch: validates the inline draft object only
  - Migration **adds** `selection: unavailablePlanSelection()` and `migration: {sourceFormat: "legacy-inline-plan", migratedAt, missingMetadata: ["diagram-selection","generation-prompt","generation-context"]}` — i.e. the legacy format simply had no selection/generation provenance
  - `write legacy-plan.json (raw text) --before--> savePlan` : rollback safety; `savePlan` replaces `plan.json` last, after all bundle artifacts are written
  - `savePlan` splits each change: ASCII bodies go to `base.txt`/`output.txt` (or `base.json`/`output.json` for compactions) and the manifest keeps only `{id, kind, mode?, path}`; `loadPlan` re-hydrates and rejects any unexpected artifact path string
  - `loadPlan` **refuses** legacy manifests outright (`unsupported Plan selection path`) — the migration is mandatory, one-time
- **Notes for the renderer**: lay left-to-right (legacy → migration → bundle). Put the three change-kind branches as a small fan in the middle with their verification predicates on the edges. Highlight the two safety properties: idempotent skip, and `legacy-plan.json` preserved byte-exact.

---

### TOOL-5 — Parser evaluation rounds: generate, freeze, independent review
- **Provenance**: Tooling slice, D6. Placement Z1 External (R5,C4).
- **Modifications**: Stacks above STU-6 (experiments): both are hash-frozen, file-resumable evaluation bundles.

- **Kind**: data-flow / provenance graph with a round-over-round timeline
- **Question it answers**: How is the parser evaluated without letting the parser (or its author) define the right answer, and what changed between rounds 1, 2, and 3?
- **Boundary (IN)**:
  - Inputs: `tools/diagram-parser/diagram_parser/source_ranges.json` (16 mapped ranges across 9 files, fetched via `GET /api/core/project/source`), `code_context.md` (845 unique merged source lines), `generation_prompt.txt` (context + the user's exact prompt)
  - Generation: `generate_corpus.py` — `generate()` per job, `blind_command()` (bubblewrap masking + `--disable shell_tool --disable multi_agent -c web_search="disabled"`), `capture_final_diagrams()` (recovers fenced ASCII from the last `agent_message` in `events.jsonl` when no file was written); jobs = 3× `gpt-5.6-sol`, 3× `gpt-6-astra`, `model_reasoning_effort="high"`, `ThreadPoolExecutor(max_workers=3)`, `--output-dir` refuses to overwrite existing runs
  - Round artifacts: `generated/<run>/{diagrams/*.txt, events.jsonl, stderr.log, receipt.json}` + `generated/receipts.json` (`{name, model, reasoningEffort, promptSha256, exitCode, elapsedSeconds, files[], artifactDelivery?, isolation?}`)
  - Freezing/capture: `round_2/manifest.json`, `round_3/manifest.json` (`{round, startedAt, parserSha256, promptSha256, codeContextSha256, parserOptions, generationPlan, evaluationPolicy}`), `round_2/tree_parser_snapshot.py`, `round_3/tree_parser_snapshot.py`, `capture_round.py` (verifies the snapshot hash against the manifest, verifies each receipt's `promptSha256`, refuses a non-empty `parsed/`), outputs `round_N/parsed/<gen>_<i>.json` + `.review.txt` (a NODE/SOURCE_LINE/PARENT_SOURCE_LINE/DEPTH/LABEL table plus every non-node line) and `round_N/parse_summary.json` (with `semanticCorrectness: "awaiting_independent_review"`, `semanticFailures: null`)
  - Independent review: `round_N/independent_expected.json` (written **before** reading any parser output; round 3's declares `reviewer_task`, `basis`, `accepted_diagrams`, `positions`, `diagrams`), `round_N/independent_check.py` (reads only the expected fixture, accepted sources, `parse_summary.json` and `parsed/`; never imports or reads the parser), `round_3/independent_build_expectations.py`, `round_N/independent_review.{json,md}`, `round_2/independent_check_results.json`
  - Regression + exclusions: `round_3/prior_round_regression.json` (re-runs round 3's parser against round 2's oracle: 6 passed / 0 failed), `round_3/generation_exclusions.json` + `round_3/excluded/{sol_2_contaminated, replacement_setup_failure}/`, `round_3/blind_replacement/sol_2/`
  - Round-1 path: `corpus_expected.json` → `validate_corpus.py` → `parsed/*.json` + `validation_report.json` (uses `list_policy="include"` to preserve the historical interpretation)
  - `capture_round.py`'s sibling READMEs: `tools/diagram-parser/diagram_parser/README.md`, `round_2/README.md`, `round_3/README.md`
- **Boundary (OUT)**: the parser stages themselves (one collapsed node — that is D5); the Codex CLI internals; `graph_review.md`/`test_graph_review.py` (a separate adversarial review of the graph layer, mention only).
- **Nodes**: live diagram + catalog revision → `source_ranges.json` → `code_context.md` → `generation_prompt.txt` (hashed) → `generate_corpus.py` → six isolated Codex workspaces → `generated/*/diagrams/*.txt` + `receipts.json` → (freeze: `manifest.json` + `tree_parser_snapshot.py`) → `capture_round.py` → `parsed/*.json` + `*.review.txt` + `parse_summary.json` → independent reviewer subagent → `independent_expected.json` → `independent_check.py` → `independent_review.{json,md}` → verdict table
- **Edges / relationships**:
  - Hash-pinning edges (draw as locks): `promptSha256` recorded per receipt and re-checked by `capture_round.py`; `parserSha256` in the manifest re-checked against the frozen snapshot before it is loaded via `importlib.util.spec_from_file_location`; `sourceSha256` per captured diagram; `parsedSha256` per parsed JSON; `corpus_expected.json` verifies input hashes so "changing a generated diagram cannot make a test pass"
  - Independence edges (draw as a barrier): the reviewer writes `independent_expected.json` before seeing any parser output and never reads/runs the parser; `independent_check.py` compares by *source coordinates* (`line:startColumn`) as primary identity with a unique-same-line fallback, and evaluates predeclared alternative readings (`sol_1` "Legend as root" / omit isolated target; `sol_3` "SOURCE MAP as root") as explicit variants
  - Round timeline edges: R1 (`generated/`, `corpus_expected.json`) — 762 nodes / 746 edges / 0 diagnostics under `list_policy="include"`; R2 (`round_2/`) — unchanged parser, frozen before generation; verdicts 1 fail / 4 pass / 1 ambiguous under clean-label rubric, 0 fail / 5 pass / 1 ambiguous under literal-label rubric; failure = 14 labels retaining routed-wire fragments; R3 (`round_3/`) — parser fixed first (semantic wire cleanup + `label_mode`, detached-list exclusion + `list_policy`, stage separation), 32 tests + 2,000 randomized cases pass, then re-frozen; verdicts 5 pass / 1 fail (`sol_1` hybrid overlapping-trees-plus-routing-arrows layout), plus one contaminated generation excluded and replaced under `--blind`
  - `parserOptions` differ per round: R2 `{mode:auto, continuation:auto, tab_size:4, strict:false}`; R3 adds `{label_mode:"semantic", list_policy:"auto"}` — the two knobs the R2 failure produced
- **Notes for the renderer**: two bands. Top band = the once-only provenance chain (live app → source ranges → context → prompt). Bottom band = the repeated per-round loop, drawn three times side by side (R1/R2/R3) sharing the same prompt hash, with the "freeze parser → generate → capture → independent review → fix parser" cycle arrow returning only *between* rounds, never within one. Put the hash locks on the arrows.

---


## Plane Z2 — System

### SYS-1 — System overview: areas, pages, namespaces, meeting points
- **Provenance**: new (coordinator). Placement Z2 System (R1,C1).
- **Kind**: context / ownership map.
- **Question it answers**: What are the three ownership areas, which browser page and HTTP namespace belongs to each, who the external clients are, and where exactly Studio and Mapping meet given that they never import each other?
- **Boundary (IN)**:
  - Pages: `src/app/App.tsx` (`pageFromPath`: `/` → `StudioPage`, `/mapping` → `MappingPocPage`, `/experiments` → `ExperimentViewerPage`; `onOpenProjectDiagram` pushes `/mapping?diagram=<id>`).
  - Namespaces: `src/server/app/vitePlugin.ts:32` dispatch on `pathname.split("/")[2]` → `routes.core|studio|mapping`; route factories `src/server/routes/{core,studio,mapping}/routes.ts`.
  - Areas: `application/core`, `application/studio`, `application/mapping` (+ their `domain/*` and `infrastructure/*`), as three collapsed blocks.
  - Meeting points: the single `DiagramStore` instance (`bootstrap.ts:63`, passed to Core, Studio and all Mapping services) and `representations/catalog.json` behind `ProjectCatalogStore` (Studio `promoteRepresentation` at `application/studio/candidates/service.ts:102`; Mapping `saveMappingDiagram` at `application/mapping/diagrams/diagramService.ts:12`; Core `saveProjectedTree` / `upsertFileCompaction`).
  - External clients over HTTP: `skills/new-diagram/SKILL.md` (Codex agent → `POST /api/studio/diagram-sets`), `.skills/map-diagram-sources/SKILL.md` + `examples/mapping-screen/import.ts` (materialize → promote → `POST /api/mapping/diagrams` → `POST /api/core/project/projections`), `tests/browser/**` (fake agents via `NEW_DIAGRAM_AGENT=fake`).
  - Clients that bypass HTTP and touch the store directly: `tools/experiments/runner.ts` (reads `.diagrams/diagram-sets/*`, constructs `PiDiagramAgentRuntime` itself), `scripts/diagrams/import-projection.ts` (constructs `ProjectCatalogStore`), `scripts/migrations/migrate-plans.ts` (constructs `DiagramStore`), `scripts/migrations/relabel-*.mjs` (rewrites JSON in place).
  - External processes: Pi agent sessions (`@earendil-works/pi-coding-agent`, provider `openai-codex`) for Studio generation/collection/edit/map and Mapping selection/compaction; `codex exec` child process for Mapping chat; `typescript-language-server --stdio` for definitions (only with `--lsp`).
- **Boundary (OUT)**: individual endpoints (SYS-6, STU-1, MAP-1, CORE-1); process start (SYS-2); the rules themselves (SYS-3).
- **Nodes**: `App` (3 pages) · `/api/studio` · `/api/mapping` · `/api/core` · Studio area · Mapping area · Core area · `DiagramStore` (one instance) · `representations/catalog.json` · each external client · each external process.
- **Edges / relationships**:
  - page → namespace it calls (StudioPage → studio + core; MappingPocPage → mapping + core; ExperimentViewerPage → studio).
  - namespace → area (1:1); Studio → Core and Mapping → Core (depends on); **no** Studio ↔ Mapping edge — draw the absence explicitly (a crossed-out dashed line) with the rule citation `dependencies.test.ts:77`.
  - Studio `promote` → catalog ← Mapping `save`: the one data-level meeting point, labelled "same file, same serialized queue (CORE-6)". Studio `star` = promote; Mapping "open Studio diagram" = read catalog then save a canvas revision under the same representation id.
  - The one UI-level crossing: `StudioPage.onOpenProjectDiagram → /mapping?diagram=<representationId>`.
  - External HTTP clients → namespace; direct-store tools → `DiagramStore`/`catalog.json` with a dashed "outside the server's serialization queue" label; server → external processes (spawn/session), with the `fake` diamond selecting doubles for all of them at once.
- **Notes for the renderer**: centre the three areas as columns with Core spanning the full width beneath Studio and Mapping (the `docs/architecture/api-ownership.md` triangle). Put pages above, external clients on the far left, external processes on the far right. This is the plane-Z2 cover diagram; keep node count under ~25.

---

### SYS-2 — Process start to running app: the composition graph
- **Provenance**: Shared-browser slice, D1. Placement Z2 System (R2,C1).

- **Kind**: composition / wiring graph (one process, two halves: browser bundle and Node API)
- **Question it answers**: From `npm run dev` to a rendered page and a served `/api/*` request, which module constructs what, from which environment variables, and where is the one place concrete adapters are chosen?
- **Boundary (IN)**:
  - `scripts/dev/start-server.mjs` (whole file)
  - `vite.config.ts` (whole file)
  - `src/server/app/vitePlugin.ts` → `diagramApi()`, its `middleware`, its `attach`
  - `src/server/app/bootstrap.ts` → `createBackend()`, `createCoreApplication()`, `createStudioApplication()`, `createFileCompactionService()`, the exported `corpusAccess` const
  - `index.html` → `src/main.tsx` → `src/app/App.tsx` (`pageFromPath`, `App`)
  - `src/shared/references/RefBufferContext.tsx` → `RefBufferProvider`
  - `src/app/styles/globals.css` (single node, imported by `main.tsx`)
  - Route factories as three nodes only: `src/server/routes/core/routes.ts#createCoreRoutes`, `src/server/routes/studio/routes.ts#createStudioRoutes`, `src/server/routes/mapping/routes.ts#createMappingRoutes`
  - Adapter classes named in `bootstrap.ts` imports: `DiagramStore`, `ProjectLanguageService`, `ExperimentCatalog`, `DiagramDatasetStore`, `MappingWorkspaceStore`, `FileCompactionStore`, and the six runtime pairs
    (`PiDiagramAgentRuntime`/`FakeDiagramAgentRuntime`, `CodexLocalChatRuntime`/`FakeLocalChatRuntime`,
    `PiMappingAgentRuntime`/`FakeMappingAgentRuntime`, `PiFileCompactionRuntime`/`FakeFileCompactionRuntime`)
  - Environment variables as a distinct node class: `NEW_DIAGRAM_PROJECT_ROOT`, `NEW_DIAGRAMS_DIR`, `NEW_DIAGRAM_DOMAIN`, `NEW_DIAGRAM_AGENT`, `NEW_DIAGRAM_EXPERIMENTS_ROOT`, `NEW_DIAGRAM_COLLECTIONS_ROOT`, `NEW_DIAGRAM_ALLOWED_HOSTS`, and the process-local `--lsp` flag
  - `src/features/studio/StudioPage.tsx#StudioPage`, `src/features/mapping/MappingPage.tsx#MappingPocPage`, `src/features/studio/experiments/ExperimentViewerPage.tsx#ExperimentViewerPage` — leaf nodes only
  - `@new-diagram/ui-test-framework#UiTestFramework` (leaf, mounted only by `MappingPage.tsx:8,183`)
- **Boundary (OUT)**: everything inside `application/**` and `infrastructure/**` beyond the class names constructed here (they are terminal nodes, not expanded); every individual HTTP path (D3 and the route-module slice cover those); the internals of the three page components.
- **Nodes**:
  - `npm run dev` / `npm start` — `node scripts/dev/start-server.mjs --host 127.0.0.1`
  - `start-server.mjs` — sets the LSP opt-in symbol, rewrites `process.argv`, imports Vite's CLI
  - `globalThis[Symbol.for('new-diagram.lsp-enabled')]` — process-local boolean, deliberately not an env var
  - Vite dev/preview server — loads `vite.config.ts`
  - `vite.config.ts` — resolves roots from env, registers `react()` and `diagramApi(...)`
  - `diagramApi()` plugin — builds the backend once, returns `configureServer` + `configurePreviewServer`
  - `createBackend()` — the only module that picks concrete adapters
  - `DiagramStore(projectRoot, diagramsDirectory)` — filesystem record store facade
  - `CoreApplication`, `StudioApplication`, and the per-capability services (`ProjectSourceService`, `PlanService`, `ProjectCatalogService`, `SelectionService`, `MappingDiagramService`, `MappingWorkspaceService`, `LocalChatService`, `FileCompactionService`, `DiagramSetWorkflow`, `DatasetService`)
  - `ProjectLanguageService` — constructed **only** when `--lsp` was passed
  - agent runtime pairs — real vs fake, chosen by one boolean
  - `routes = { core, studio, mapping }` — the namespace dispatch table
  - `middleware` — URL filter, namespace lookup, lazy `recover()`, error translation
  - `index.html` → `src/main.tsx` — `createRoot(...).render(<StrictMode><RefBufferProvider><App/></RefBufferProvider></StrictMode>)`
  - `App` — three-page switcher plus a navigation guard
  - `StudioPage`, `MappingPocPage`, `ExperimentViewerPage`
  - `UiTestFramework` — dev control dial, mounted at the page composition boundary
- **Edges / relationships**:
  - `npm run dev` → `start-server.mjs` (spawns)
  - `start-server.mjs` → LSP symbol (`start-server.mjs:9`, writes `true` only when `--lsp` is in `process.argv`); comment at `:5-6` states it cannot be set by inherited env, saved workspace, browser request, or Vite config
  - `start-server.mjs` → Vite CLI (`:11-14`, resolves `vite/bin/vite.js`, strips `--lsp`, dynamic `import()`)
  - Vite → `vite.config.ts` (loads)
  - `NEW_DIAGRAM_PROJECT_ROOT` → `PROJECT_ROOT` (`vite.config.ts:8`, defaults to `path.resolve(ROOT, "../..")`)
  - `NEW_DIAGRAMS_DIR` → `DIAGRAMS_DIRECTORY` (`vite.config.ts:9`, default `.diagrams`)
  - `NEW_DIAGRAM_EXPERIMENTS_ROOT` → `EXPERIMENTS_ROOT` (default `PROJECT_ROOT/.datasets`, `:10-12`); `NEW_DIAGRAM_COLLECTIONS_ROOT` → `DATASET_COLLECTIONS_ROOT` (default `EXPERIMENTS_ROOT/diagram-collections`, `:13-15`)
  - `NEW_DIAGRAM_ALLOWED_HOSTS` → `preview.allowedHosts` only (`:16-20`, `:42-44`)
  - `vite.config.ts:26-35` → `diagramApi(PROJECT_ROOT, DIAGRAMS_DIRECTORY, EXPERIMENTS_ROOT, DATASET_COLLECTIONS_ROOT, undefined, ROOT, { lspEnabled: <symbol> === true })` — note the 5th argument is passed as `undefined` so the domain profile falls through to the plugin's default parameter
  - `NEW_DIAGRAM_DOMAIN` → `configuredDomainProfileId` (`vitePlugin.ts:15-17`, via `isBuiltInDomainProfileId`; unrecognised values become `undefined`)
  - `diagramApi` → `createBackend(...)` (`vitePlugin.ts:22-23`, executed at plugin-construction time, before any request)
  - `NEW_DIAGRAM_AGENT === "fake"` → one boolean `fake` (`bootstrap.ts:59`) that selects **all four** runtime pairs (`:60-62`, `:65`)
  - `createBackend` → `new DiagramStore(projectRoot, diagramsDirectory)` (`:63`) → `createCoreApplication(store)` (`:64`) → `new CoreApplication(store, corpusAccess)` (`:43`)
  - `corpusAccess` (`bootstrap.ts:38-40`) composes `corpusProvider`, `readCorpusDocumentLines`, `discoverDomainCorpus` from `infrastructure/core/corpus` and `infrastructure/core/persistence/store`
  - `options.lspEnabled === true` → `new ProjectLanguageService()`, else `undefined` (`:66`) → injected into `ProjectSourceService` (`:71`); absence makes `/api/core/project/definitions` raise `ApplicationError('lsp-disabled')`
  - `configuredDomainProfileId ?? "source-code"` → `createStudioApplication` (`:67`) and separately into `DiagramSetWorkflow` (`:78`) and `MappingDiagramService` (`:82`)
  - `createBackend` → `routes` record (`:68-87`): `core`, `studio`, `mapping` keys, each built from explicit service objects
  - `middleware` → `routes[namespace]` where `namespace = url.pathname.split("/")[2]` (`vitePlugin.ts:32`)
  - `middleware` → `backend.recover()` memoised with `recovered ??=` (`:36`) — interrupted-run recovery happens lazily on the **first** API request, not at boot
  - `attach` → `server.middlewares.use(middleware)` and `httpServer.once("close", backend.dispose)` (`:49-55`); the same `attach` is used for `configureServer` and `configurePreviewServer` (`:57`)
  - `backend.dispose()` → `languageService?.dispose(); studio.dispose(); mappingRuntime.dispose(); chatRuntime.dispose(); compactionService.dispose()` (`:90`)
  - Vite (react plugin) → serves `index.html` → `src/main.tsx` (module entry)
  - `main.tsx` → `globals.css` (side-effect import), `RefBufferProvider` (wraps), `App` (renders)
  - `App` → `StudioPage` | `MappingPocPage` | `ExperimentViewerPage` (conditional render, `App.tsx:44-61`)
  - `MappingPage.tsx` → `UiTestFramework` (only importer in `src/`; render-prop hands plain values to product components)
  - Browser → `/api/{core,studio,mapping}/*` → `middleware` (the only runtime edge between the two halves)
- **Notes for the renderer**: lay the whole thing left-to-right as a timeline: `npm run dev` → Node/Vite → plugin construction → (branch down) browser bundle, (branch up) API middleware. Draw the environment variables as a separate column of small nodes feeding in from the left, with dashed edges, each labelled with its default. Put a visible box around `bootstrap.ts#createBackend` labelled "the only production module that chooses concrete integrations" (its own doc comment, `:55`). Show the `fake`/real runtime pairs as a single diamond with two outgoing labelled edges. Mark `recover()` and `dispose()` as lifecycle edges with a different line style from construction edges.

---

### SYS-3 — The executable layer and ownership rules
- **Provenance**: Shared-browser slice, D2. Placement Z2 System (R3,C1).
- **Modifications**: Add one annotation: `infrastructure → application` is allowed (`:70`), so `DiagramStore.loadWorkspace → application/core/workspace/loadWorkspace` is legal, not an exception. Add the finding that `src → packages` is unrestricted (ui-test-framework boundary is by convention).

- **Kind**: layered architecture + permission matrix (what the architecture test actually enforces)
- **Question it answers**: Which directory may import which, and which specific rule in `dependencies.test.ts` forbids each disallowed edge?
- **Boundary (IN)**:
  - `tests/architecture/dependencies.test.ts` — specifically `location()` (lines 20-31) and `allowedLayers` / `runtimeAllowed` / `ownershipAllowed` (lines 68-78)
  - Runtimes as node groups: `domain/`, `application/`, `infrastructure/`, `src/` (browser), `src/server/` (treated as runtime `server` by `location()`)
  - Owners as a second axis: `core`, `studio`, `mapping`, plus the `composition` marker
  - Composition nodes: `src/app/**` + `src/main.tsx` (`composition = true`), `src/server/app/**` (`composition = true`), and `src/server/app/bootstrap.ts` (additionally `bootstrap = true`)
  - External-module rules: `node:*`, `react`/`react-dom`, `vite`, `@earendil-works/*`, `vscode-jsonrpc`
  - `tsconfig.json` `paths` aliases (consulted at `:47-56` to decide whether to resolve a specifier)
- **Boundary (OUT)**: every concrete file inside those directories (the diagram is about the rule, not the file list); `tools/`, `tests/browser/`, `scripts/`, `packages/` (only `packages` appears, as an allowed target of `src`); test files, which the check skips (`:38`).
- **Nodes**: the five runtimes as stacked layers; three ownership columns (`core`, `studio`, `mapping`); two composition nodes (browser composition root, server composition root) drawn straddling the ownership columns; a `bootstrap.ts` node drawn inside the server composition node; an `external packages` node.
- **Edges / relationships**:
  - `domain → domain` only (`allowedLayers.domain`); every `node:`/`react`/`react-dom`/`vite` specifier is a violation for domain (`:63`, `externalRuntime`)
  - `src → src | domain | packages` (`allowedLayers.src`); `src` may not import `node:*` (`:64`)
  - `application → application | domain`; additionally forbidden: `node:fs`, `node:child_process`, `node:http`, `node:https`, `node:net`, `vite`, `react`, `react-dom`, `@earendil-works/*`, `vscode-jsonrpc` (`:65`) — i.e. no filesystem, subprocess, HTTP, or provider SDK
  - `infrastructure → infrastructure | application | domain`
  - `server → server | application | domain` **except** `bootstrap.ts`, which additionally reaches `infrastructure` (`:76`) — this single exception is why D1's adapter selection is legal
  - ownership rule (`:77`): a file may import a target when the importer is composition, **or** the target is not composition and (`target.owner === "core"` or `target.owner === from.owner`). Draw this as: `studio ↛ mapping`, `mapping ↛ studio`, `core ↛ studio`, `core ↛ mapping`, `studio → core` ✓, `mapping → core` ✓, `composition → anything` ✓, `anything ↛ composition`
  - note the classification quirk worth drawing (`:20-31`): `src/server/*` is re-rooted so that `src/server` is runtime `server`, not `src`; `owner` for `src` and `server` comes from the third segment when `area` is `features` or `routes`, otherwise `core` — which is why all of `src/shared/**` and `src/server/http/**` classify as `core`
- **Notes for the renderer**: two-axis grid. Vertical = runtime layer (domain at the bottom, then application, infrastructure, server, src-browser). Horizontal = owner (core in the middle, studio left, mapping right). Draw allowed edges as solid arrows and the three headline forbidden edges (`studio↔mapping`, `core→feature`, `application→node:fs`) as red crossed arrows with the source line cited. The bootstrap exception should be visually loud — a single dashed arrow from `src/server/app/bootstrap.ts` down into `infrastructure` labelled "composition only".

---

### SYS-4 — Isomorphic domain modules
- **Provenance**: new (coordinator). Placement Z2 System (R4,C1).
- **Kind**: bipartite dependency map (browser callers ↔ domain module ↔ server callers).
- **Question it answers**: Which pure `domain/**` modules execute on both sides of the HTTP boundary, and which browser and server callers pair up on each — so that a reader knows which single edit changes both client-side validation and server-side acceptance?
- **Boundary (IN)**: the 26 modules imported by both `src/{app,features,shared}` and `application|infrastructure` (verified by import grep):
  `domain/core/records/domain`, `domain/core/profiles/domainProfile`, `domain/core/profiles/domainProfiles`, `domain/core/prompts/prompt`,
  `domain/core/diagrams/lineGrid`, `domain/core/diagrams/projectDiagramCanvas`, `domain/core/diagrams/diagramSelection`, `domain/core/diagrams/diagramProjection`,
  `domain/core/representations/projectCatalog`, `domain/core/representations/representationIndex`, `domain/core/representations/representationGraph`, `domain/core/representations/compactionProjection`,
  `domain/core/agent-work/agentWork`, `domain/core/highlights/highlights`, `domain/core/plans/plans`, `domain/core/source/callGraphFocus`, `domain/core/source/sourceNavigation`,
  `domain/mapping/chat/localChat`, `domain/mapping/selection/mappingPoc`, `domain/mapping/selection/mappingPocPrompt`, `domain/mapping/workspace/mappingGrid`, `domain/mapping/workspace/mappingWorkspace`, `domain/mapping/workspace/mappingWorkspaceCodec`,
  `domain/studio/generation/prompt`, `domain/studio/experiments/experimentDomain`, `domain/studio/datasets/datasetDomain`.
  Draw the eight with a *behavioural* pairing (same function, both sides) at full size; the rest as a compact type-only list.
- **Boundary (OUT)**: modules used on one side only; the rule that permits this (`src → domain`, `application → domain`; SYS-3).
- **Nodes**: three columns — browser callers (files under `src/`), domain module, server callers (files under `application/`, `infrastructure/`, `src/server/`).
- **Edges / relationships** (the eight behavioural pairs; each edge is "calls the same function"):
  1. `projectDiagramCanvas.projectCanvasSnapshot` — server: `domain/core/representations/catalogRules.ts` `saveMappingDiagram` (revision derivation on save); browser: `domain/mapping/workspace/mappingWorkspaceCodec.ts` (via `scene()` validation) and `src/features/mapping/MappingPage.tsx` (`sceneFromRevision`, `singleDiagramScene`).
  2. `lineGrid.resolveScene/composeScene/layoutScene` — server: `catalogRules`, `mappingWorkspaceStore` (through the codec); browser: `src/features/mapping/canvas/MappingCanvas.tsx`, `pasteDiagram.ts`.
  3. `mappingWorkspaceCodec.deserializeWorkspace/serializeWorkspace` — server: `infrastructure/mapping/persistence/workspace/mappingWorkspaceStore.ts`; browser: `src/features/mapping/workspace/mappingWorkspaceRepository.ts` and Import/Export in `MappingPage.tsx` — the same function normalizes on both save and load.
  4. `mappingPocPrompt.validateMappingPocMappings` (re-export of `diagramMappings.validateDiagramLocalMappings`) — server: `SelectionService.prepare`, `validateLocalChatRequest`; browser: codec, `MappingCanvas`.
  5. `representationIndex.buildRepresentationIndex` — server: `application/studio/evidence-mapping/service.ts`, `application/core/highlights/service.ts`, `domain/mapping/compaction/validation.ts`; browser: `src/shared/diagrams/DiagramView.tsx:132`.
  6. `agentWork.validateSpatialProgressState` — server: evidence-mapping worker, `representations/service.saveAgentSpatialProgress`; browser: `DiagramView.tsx:151` (rejects invalid progress before painting).
  7. `diagramProjection.projectSelection/validateProjection` — server: `ProjectCatalogService.saveProjection`, `catalogRules.saveProjectedTree`; browser: `src/features/mapping/canvas/SelectionEffectsLayer.tsx`, `MappingCanvas.openMapped`; also `tests/browser/mapping/browser-projection-check.mjs` computes expectations with it.
  8. `sourceNavigation.isRepositoryFilePath/supportsDefinitions` — server: `ProjectSourceService.definitions`; browser: codec `source-code` rule, `src/features/mapping/source-pane/sourceCodePane.ts`.
  Plus `domainProfiles.resolveDomainProfile` (server: `bootstrap`/`vitePlugin`/`DiagramSetWorkflow`; browser: `StudioPage.tsx:329`) — cross-reference SYS-5.
- **Notes for the renderer**: three-column bipartite with the domain column in the middle; thicken the eight behavioural edges and grey the type-only ones. Caption: "domain has no Node/React/HTTP imports (`dependencies.test.ts:63`), which is what makes this sharing legal."

---

### SYS-5 — Domain profile fan-out
- **Provenance**: new (coordinator). Placement Z2 System (R5,C1).
- **Kind**: configuration fan-out map (one value → every layer), with a small "decided vs. read" legend.
- **Question it answers**: How does the domain profile (`source-code` | `document`) get decided once, persist, and then select corpus access, prompts, agent tools, view kinds, UI surfaces and content presentation across every layer?
- **Boundary (IN)**:
  - Registry: `domain/core/profiles/domainProfile.ts` (`BuiltInDomainProfileId`, `CorpusBinding` kinds `git-worktree` | `filesystem-documents`, `EvidenceSchema`, `WorkspaceSurfaceProfile`/`ExplorerSurfaceId`, `ContentPresentation {syntaxHighlighting, markdownRendering, wrap, sourceCompaction}`, `ElementCommandContribution`, `DomainProfile`), `domain/core/profiles/domainProfiles.ts` (`BUILT_IN_DOMAIN_PROFILES:98`, `resolveDomainProfile:104`, `profileSupportsCommand:108`, `representationKindForArtifact:118`, `isBuiltInDomainProfileId:128`).
  - Decision points: `NEW_DIAGRAM_DOMAIN` → `src/server/app/vitePlugin.ts:15-17` → `bootstrap.ts` (`createStudioApplication(..., profile)`, `DiagramSetWorkflow(studio, profile)`, `MappingDiagramService(..., profile)`); `DiagramSetWorkflow.prepare` resolution order body → configured → existing project → `"source-code"`; persisted as `ProjectRecord.domainProfileId` (`domain/core/records/domain.ts:143`) at `ensureProject`.
  - Server readers: `discoverDomainCorpus` (chooses `discoverRepository` vs `discoverDocumentCorpus`, `infrastructure/core/persistence/shared.ts:95`) → `CorpusBinding.kind` → `corpusProvider(binding)` (`infrastructure/core/corpus/corpus.ts:125`); `loadWorkspace.ts:66` selects the code-entity template family by profile; `infrastructure/core/persistence/templates.ts:122` `loadCodeEntityPromptTemplates(context, domainProfileId)`; `infrastructure/studio/agents/agentRuntime.ts:87-172` `documentCorpusTools` (`read_corpus`/`list_corpus`/`search_corpus`) swapped in for `document`; `domain/core/prompts/prompt.ts:38` `DOCUMENT_GENERATION_GUIDANCE` and the `DEFAULT_DOCUMENT_EVIDENCE_*` criteria (`:159,:174`); `validateDiagramSetTarget` rejects a profile mismatch (`application/studio/collection/service.ts:280-290`); `generate()` checks view-kind availability against the profile (`application/studio/generation/service.ts:64-85`); `FileCompactionService.prepare` requires `source-code` (`application/mapping/compaction/fileCompactionService.ts:41-62`); `MappingDiagramService.save` passes the profile to `corpus.discover` when creating the project.
  - Browser readers: `WorkspaceSnapshot.project.domainProfileId` → `src/features/studio/StudioPage.tsx:329` `resolveDomainProfile` → `createStudioPaneState(profile, …)` explorer tabs (`:210-266`), `ContentPresentation` → `src/shared/source/SourceCodeView.tsx` (`syntaxHighlighting === "plain"` skip) and `src/shared/source/CodeEntitiesPanel.tsx:93-97` (Markdown branch), `profileSupportsCommand` for element commands, `representationKindForArtifact`.
  - Check: `tests/browser/core/browser-domain-profiles-check.mjs`.
- **Boundary (OUT)**: the corpus path guards (CORE-9); prompt text (CORE-8); what each surface renders (CORE-14).
- **Nodes**: `NEW_DIAGRAM_DOMAIN` · `vitePlugin` · `bootstrap` · `DiagramSetWorkflow.prepare` (resolution order) · `ProjectRecord.domainProfileId` (persisted — the *decided* node) · `DomainProfile` (registry entry) · then one node per reader above, grouped by layer.
- **Edges / relationships**: env → plugin → bootstrap (dashed, "default only"); `prepare` → `ensureProject` (solid, "decided here, once per project"); `ProjectRecord` → every reader (solid, "read"); registry → each `DomainProfile` field → the reader that consumes that field (`corpus` → discovery/provider; `evidence` → prompts/templates; `workspace.surfaces` → pane state; `presentation` → source/markdown views; `commands` → element menus; `viewKinds` → generation guard). Mark the two places a *second* source is consulted: `DiagramSetWorkflow.prepare` (request body may name a profile, must match the existing project) and the browser (reads the snapshot, never the env).
- **Notes for the renderer**: radial or left-to-right fan-out from the persisted `ProjectRecord.domainProfileId`; layer bands for the readers (server/infrastructure, server/application, browser). Two-tone the edges: "decides" vs. "reads".

---

### SYS-6 — NDJSON streaming protocol: lifecycle, events, disconnect
- **Provenance**: Shared-browser slice, D3. Placement Z2 System (R2,C8).
- **Modifications**: MERGED with Studio D7. Add two panels from Studio D7: (a) the event-vocabulary table — `progress`, `workspace`, `result`, `created`, `error` — with fields and emitting endpoints, including the `DiagramSetWorkflow` `created`/`result` shapes (`diagramSetWorkflow.ts:75-137`); (b) the client rule that generation applies `setWorkspace(next)` wholesale while mapping applies `mergeMappingWorkspace` (only `agentRunIds`, `agentRuns`, `spatialProgress`, `codeEntityMaps`; `StudioPage.tsx:155-175`). Keep the Studio no-abort asymmetry as the headline finding.

- **Kind**: sequence diagram with a lifecycle/abort lane
- **Question it answers**: What exactly travels over an `application/x-ndjson` response, who aborts the backing agent when the browser goes away, and why an HTTP 200 does not mean the operation succeeded?
- **Boundary (IN)**:
  - Client: `src/shared/http/http.ts#apiFetch`, `#errorFrom`; the NDJSON reader loops at `src/features/mapping/api.ts:15-41` (`promptMappingPocSelection`) and `src/features/mapping/api.ts:53-81` (`localChatResponder.reply`); the equivalent loops at `src/features/studio/api.ts:315`, `:374`, `:495`, `:660`
  - Server helpers: `src/server/http/http.ts#sendJson`, `#sendEvent`, `#readBody` (incl. `MAX_REQUEST_BYTES = 10MB`)
  - Streaming routes: `src/server/routes/mapping/chat/localChatRoutes.ts#handleLocalChat` (whole file), `src/server/routes/mapping/compaction/fileCompactionRoutes.ts#handleFileCompaction` (whole file), `src/server/routes/mapping/routes.ts:32-43` (`/api/mapping/prompt`), `src/server/routes/studio/routes.ts:362-373`, `:455-475`, `:478-493`, `:540-560`, `:705-737`
  - Non-streaming abort case for contrast: `src/server/routes/core/routes.ts:52-64` (`/api/core/project/definitions`)
  - Error translation in `src/server/app/vitePlugin.ts:37-47`
  - Application-side consumers of the signal: `LocalChatService.reply({ signal, onProgress })`, `FileCompactionService.run(prepared, { signal, onEvent })`, `ProjectSourceService.definitions(body, signal)` — shown as one collapsed "application service" lane
- **Boundary (OUT)**: what the services actually do with the agent (Pi/Codex session management) — one collapsed "agent runtime" lane; the request bodies' schemas.
- **Nodes / lanes**: `browser caller` · `apiFetch` · `fetch/ReadableStream reader` · `Vite middleware (vitePlugin)` · `namespace route` · `application service` · `agent runtime (collapsed)`.
- **Edges / relationships (ordered)**:
  1. caller → `apiFetch(path, {method:'POST', body})` — `apiFetch` prefixes `import.meta.env.BASE_URL` (`shared/http/http.ts:1-4`) and does nothing else; there is **no** shared NDJSON client helper
  2. middleware: pathname must start `/api/`; `namespace = pathname.split("/")[2]`; unknown namespace → `sendJson(404)` (`vitePlugin.ts:29-34`)
  3. middleware → `await (recovered ??= backend.recover())` before dispatch (`:36`)
  4. route → `readBody(request)` — accumulates UTF-8, rejects >10MB with `request.destroy()`, rejects invalid JSON (`server/http/http.ts:17-37`)
  5. route → `service.prepare(input)` **before** headers are sent, so a validation failure can still become a JSON 4xx (chat `:8`, compaction `:19`, selection `routes.ts:34`)
  6. route registers `response.on("close", …)` → `controller.abort()` guarded by `!response.writableEnded` (chat `:11-13`, compaction `:15-17`, definitions `core/routes.ts:56-58`); compaction additionally re-checks `response.destroyed` and `controller.signal.throwIfAborted()` after `prepare` (`:20-21`)
  7. route → `statusCode = 200`, `content-type: application/x-ndjson; charset=utf-8`, `cache-control: no-cache, no-transform`, `flushHeaders()` (identical four lines in every streaming route)
  8. service → `onEvent/onProgress` → `sendEvent(response, payload)` → one `JSON.stringify(payload) + "\n"` write, skipped when `response.destroyed || response.writableEnded` (`server/http/http.ts:11-15`)
  9. event vocabulary per route: chat emits `{type:"context",sourceRanges}` then `{type:"progress",message}`* then `{type:"result",text}`; selection emits `{type:"progress",...event}`* then `{type:"result",result}`; studio generate/map emit service events then `{type:"result", workspace|...}`; compaction forwards the service's own event objects unchanged
  10. client reader loop: `getReader()` + `TextDecoder`, `decoder.decode(value,{stream:!done})`, split on `\n`, keep the trailing partial in `buffer`, `consume(buffer)` after `done` — the identical loop is copied in six places
  11. client `consume`: `type === "error"` → `throw new Error(event.error)` even though the HTTP status was 200; missing final `result` → throw ("stream ended without a …")
  12. `finally` on the chat client: `reader.cancel().catch(()=>{})` + `releaseLock()` (`features/mapping/api.ts:78-80`) — this is what triggers the server's `close` → `abort()`
  13. error after headers sent (`vitePlugin.ts:40-43`): `sendEvent(response,{type:"error",error})` then `response.end()`; error before headers: `sendJson` with status from `ProjectDiagramConflict → 409` or `ApplicationError.code → {conflict:409, 'invalid-input':400, 'binary-source':415, 'lsp-disabled':503}`, else `400`; `lsp-disabled` also carries `{code:'LSP_DISABLED'}`
  14. **asymmetry to draw explicitly**: the Studio streaming routes (`routes/studio/routes.ts:362`, `455`, `478`, `540`, `705`) create **no** `AbortController` and register **no** `close` listener — a browser disconnect during generation or code-entity mapping does not cancel the agent; the writes merely become no-ops via `sendEvent`'s `destroyed` guard.
- **Notes for the renderer**: standard sequence, time downward. Put the abort path in a separate right-hand lane drawn in a contrasting colour, starting from a "browser navigates away / reader.cancel()" event. Add a labelled note box for the 200-with-error-event hazard and another for the Studio no-abort asymmetry. Cite file:line on each of the four fixed header lines once, not on every route.

---


## Plane Z3 — Studio

### STU-1 — Studio layer spine: facade → capability services → ports
- **Provenance**: Studio slice, D1. Placement Z3 Studio (R3,C1).


- **Kind**: layered architecture / module dependency graph with an interface-implementation overlay.
- **Question it answers**: How does one Studio HTTP request get from a route through the compatibility facade into a capability service, and which two outward-facing ports (persistence, agents) does every capability service reach through?
- **Boundary (IN)**:
  - `src/server/routes/studio/routes.ts` (`createStudioRoutes`)
  - `application/studio/application.ts` (`StudioApplication` — facade class)
  - `application/studio/context.ts` (`StudioContext` interface)
  - `application/studio/shared.ts` (`ServiceEvent`, `MAX_GENERATION_COUNT`, `MAX_ATTEMPTS`, `MARKER_CHARACTERS`, `timestamp`, `stableProjectId`)
  - Capability service modules (each a namespace of free functions taking `StudioContext` as first argument):
    `application/studio/collection/service.ts`, `application/studio/generation/service.ts`,
    `application/studio/candidates/service.ts`, `application/studio/editing/service.ts`,
    `application/studio/evidence-mapping/service.ts`, `application/studio/representations/service.ts`,
    `application/studio/prompt-settings/service.ts`, `application/studio/lifecycle/service.ts`
  - `application/studio/collection/diagramSetWorkflow.ts` (`DiagramSetWorkflow`) — a route-level orchestrator that calls the facade, not a capability service
  - `application/studio/datasets/datasetService.ts` (`DatasetService`)
  - Ports: `application/studio/generation/agent.ts` (`DiagramAgentRuntime`), `application/core/ports/diagramRepository.ts` (`DiagramRepository`), `application/studio/experiments/repository.ts` (`ExperimentRepository`), `application/studio/datasets/repository.ts` (`DiagramDatasetRepository`)
  - Implementations: `infrastructure/studio/agents/agentRuntime.ts` (`PiDiagramAgentRuntime`, `FakeDiagramAgentRuntime`), `infrastructure/studio/persistence/experiments/experimentCatalog.ts` (`ExperimentCatalog`), `infrastructure/studio/persistence/datasets/diagramDatasetStore.ts` (`DiagramDatasetStore`)
  - Composition: `src/server/app/bootstrap.ts` (`createStudioApplication`, `createBackend` lines 45–80)
  - Collapsed external: `CoreApplication` (`application/core/application.ts`) as a single node
- **Boundary (OUT)**: Core's internals (workspace assembly, corpus access, catalog adapter) — collapsed to the single `CoreApplication` node; `DiagramStore` filesystem modules under `infrastructure/core/persistence/` — collapsed behind the `DiagramRepository` port; Mapping routes/services entirely (no Studio↔Mapping edge exists by design); browser UI (that is D7).
- **Nodes**:
  - `createStudioRoutes` — decodes HTTP, dispatches, formats/NDJSON
  - `DiagramSetWorkflow` — two-phase `prepare()` / `run()` set-creation orchestrator
  - `DatasetService` — joins experiment catalog reads to dataset writes
  - `StudioApplication` — thin compatibility facade, one method per operation
  - `StudioContext` — `{store, core, agents, defaultDomainProfileId, activeBatches, activeMappings}`
  - `collection/service` — create set, validate target, collect entities, delete set
  - `generation/service` — parallel batch generation + draft validation
  - `candidates/service` — rename/star/archive/rank/promote
  - `editing/service` — edit sessions + component capture
  - `evidence-mapping/service` — single and batch code-entity mapping
  - `representations/service` — representation graph, feedback, spatial progress
  - `prompt-settings/service` — template CRUD/resolve/reset for two families
  - `lifecycle/service` — run recovery + dispose
  - `DiagramAgentRuntime` (port, 5 methods) / `DiagramRepository` (port) / `ExperimentRepository` / `DiagramDatasetRepository`
  - `PiDiagramAgentRuntime`, `FakeDiagramAgentRuntime`, `ExperimentCatalog`, `DiagramDatasetStore`
  - `CoreApplication` (external)
  - `bootstrap.createBackend` — the only module choosing concrete adapters
- **Edges / relationships**:
  - `createStudioRoutes` --calls--> `StudioApplication` (most routes), `DiagramSetWorkflow` (POST `/diagram-sets`), `ExperimentRepository` (`/experiments`), `DatasetService` (`/diagram-datasets*`) — see routes.ts:160–213, 362–372.
  - `DiagramSetWorkflow` --calls--> `StudioApplication` (`validateDiagramSetTarget`, `resolveSystemPromptTemplate`, `resolveCodeEntityPromptTemplate`, `createDiagramSet`, `collectCodeEntities`, `generateInitialDiagrams`) — diagramSetWorkflow.ts:59–113. Note this is a *route-layer* orchestrator that reaches back through the facade.
  - `StudioApplication` --constructs--> `StudioContext` (application.ts:50); every facade method --delegates to--> exactly one capability-service function passing that context.
  - Each capability service --reads/writes--> `context.store` (`DiagramRepository`) and --calls--> `context.core` (`CoreApplication`) for `workspace()`, `projectCorpus()`, `artifactForDiagramSet()`, `mappedArtifactBundle()`, `settledViewIdsForSession()`, `corpus.readDocumentLines()`.
  - `collection/service`, `generation/service`, `editing/service`, `evidence-mapping/service` --call--> `context.agents` (`DiagramAgentRuntime`): `collectEntities`, `generateArtifact`, `editArtifact`, `mapArtifactEntities` respectively.
  - Intra-application edges worth drawing: `collection/service` --imports--> `candidates/service.promoteProjectRepresentation` (collection/service.ts:26, used for materialized featured views at :250) and --imports--> `prompt-settings/service.resolveCodeEntityPromptTemplate` (:29); `generation/service` --imports--> `prompt-settings/service.resolveSystemPromptTemplate` (generation/service.ts:30); `candidates/service.setStarredDiagram` --calls--> `promoteProjectRepresentation` (candidates/service.ts:148); `evidence-mapping/service.mapCodeEntities` --delegates to--> `mapCodeEntitiesBatch` with concurrency 1 (evidence-mapping/service.ts:24).
  - `PiDiagramAgentRuntime` / `FakeDiagramAgentRuntime` --implements--> `DiagramAgentRuntime`; `ExperimentCatalog` --implements--> `ExperimentRepository`; `DiagramDatasetStore` --implements--> `DiagramDatasetRepository`.
  - `DatasetService` --depends on both--> `DiagramDatasetRepository` + `ExperimentRepository` (datasetService.ts:5; `addFromExperiment` reads an experiment artifact then writes a dataset item).
  - `bootstrap.createBackend` --instantiates and injects--> every implementation node (`NEW_DIAGRAM_AGENT=fake` selects the fake runtime, bootstrap.ts:59–60), and --wires--> `recover: () => studio.recoverInterruptedRuns()` plus `dispose()`.
  - `lifecycle/service.dispose` --calls--> `agents.dispose()`.
- **Notes for the renderer**: Lay out as four horizontal bands top-to-bottom: routes/orchestrators, facade+context, capability services (a single row of eight boxes), ports; put implementations in a fifth band. Draw `bootstrap` as a box on the right spanning bands with dashed "constructs" arrows. Mark the `DiagramSetWorkflow → StudioApplication` edge distinctly (it is an upward-looking orchestrator, not a service). `StudioContext` should visually sit *inside* the facade band and be the hub every service arrow passes through.

---

### STU-3 — One generation batch: parallel slots, retry, workflow turns
- **Provenance**: Studio slice, D3. Placement Z3 Studio (R3,C4).
- **Modifications**: Collapse the runner to one node and cite CORE-7 (directly below in the stack); keep the three validation gates.


- **Kind**: sequence diagram with an inner loop (per-slot retries) and a nested workflow (per-slot turns).
- **Question it answers**: How does `generate()` fan out N parallel agent slots, what causes a slot to be retried, and how does each slot's agent session run the generate → optional reference → map turn sequence through Core's `runAgentWorkflow` while the submission tool validates each turn?
- **Boundary (IN)**:
  - `application/studio/generation/service.ts` — `generate` (:50–401) and `validateGeneratedArtifactDraft` (:403)
  - `application/studio/shared.ts` — `MAX_ATTEMPTS = 3`, `MAX_GENERATION_COUNT = 12`
  - `domain/studio/generation/prompt.ts` — `createGenerationPromptConfig` (returns `GenerationPromptBuildResult`: `config`, `allowedCodeEntityIds`, `allowedCodeEntityAliases`, `allowedCodeEntities`, `allowedDiagramIds`, `allowedDiagramComponentIds`)
  - `application/studio/generation/agent.ts` — `ArtifactGenerationRequest`, `DiagramAgentRuntime.generateArtifact`
  - `infrastructure/studio/agents/agentRuntime.ts` — `PiDiagramAgentRuntime.generateArtifact` (:298–458): `defineTool(submit_diagram | submit_diagram_component)` with `artifactSubmissionParameters` (:32), the `state.submissions` / `state.mappingSource` closure, `unchangedArtifactError` (:51), `diagramMappingValidationError`, session creation via `createAgentSession` + `SettingsManager.inMemory` + `DefaultResourceLoader` + `SessionManager.inMemory`
  - `application/studio/generation/generationWorkflow.ts` — `createGenerationWorkflow` (steps `generate`, optional `reference`, `map`)
  - `application/core/agents/agentWorkflow.ts` — `runAgentWorkflow`, `AgentWorkflow`, `AgentWorkflowStep`, `AgentStepExecutor` (external but essential; show as an annotated box)
  - `domain/core/prompts/prompt.ts` — `renderMappingPromptTemplate`, `DEFAULT_MAPPING_FOLLOW_UP_PROMPT`
  - `domain/core/diagrams/diagramMapping.ts` — `validateDiagramMappings`, `diagramMappingValidationError`
  - Store calls: `beginBatch`, `loadGenerationPromptConfig`, `saveBatch`, `saveRun`, `completeBatch`
- **Boundary (OUT)**: NDJSON transport to the browser (D7); the prompt-config *content* assembly (reference resolution, alias construction) — collapsed into one `createGenerationPromptConfig` node with its outputs listed; the Pi SDK internals; persistence file layout.
- **Nodes / participants** (left to right as sequence lifelines):
  `generate()` · `createGenerationPromptConfig` · `DiagramRepository` · `PiDiagramAgentRuntime.generateArtifact` · `runAgentWorkflow` (Core) · Pi agent session · `submit_*` tool · `validateGeneratedArtifactDraft`
- **Edges / relationships** (ordered):
  1. `generate` validates count ≤ 12, outputKind ∈ {diagram, diagram-component}, viewKind availability against the domain profile, model id; acquires `activeBatches` (service.ts:64–85).
  2. `generate` loads the CodeEntitiesSet, the system prompt template, stored + imported diagrams/components, and `settledViewIdsForSession`, then calls `createGenerationPromptConfig` (:113–135). The build result's `allowed*` lists are the agent's capability envelope.
  3. `generate` --creates--> one `GenerationBatchRecord` + N `AgentRunRecord`s (`kind: generate-one-diagram | generate-one-diagram-component`, `outputSlot: index+1`) and calls `beginBatch(promptConfig, batch, runs)`, then reloads the *persisted* prompt config (:169–173) — a deliberate read-back before dispatch.
  4. **Retry loop** `for attempt in 1..MAX_ATTEMPTS while pending.length > 0` (:189): all pending slots run via `Promise.all` concurrently. Each slot calls `agents.generateArtifact(...)` with the persisted config and the allowed lists, then `validateGeneratedArtifactDraft`.
  5. Slot rejection causes: thrown agent error; **duplicate normalized ASCII** against already-accepted slots (`usedAscii` set, :227, :237) — draw this explicitly, it is the non-obvious retry cause; a failed `validateGeneratedArtifactDraft` (blank name, non-7-bit ASCII, a `codeEntityId` outside `allowedCodeEntityIds`, missing `mappings`, or failed `validateDiagramMappings`, :403–413).
  6. On the last attempt a still-pending slot's run goes `failed` with `completedAt`; otherwise back to `queued` (:246–256).
  7. Inside one slot: `PiDiagramAgentRuntime.generateArtifact` builds the submission tool and session, then `runAgentWorkflow(workflow, executor)` where the executor is `async ({prompt}) => { state.submissions.length = 0; await session.prompt(prompt); return state.submissions.shift(); }` (agentRuntime.ts:452–456). **This is the seam**: Core owns sequencing; Studio owns prompts and validation; infrastructure owns the session and the tool.
  8. Workflow steps (generationWorkflow.ts): `generate` (prompt = persisted `contextPrompt.rendered` + slot line + allowed alias/id lists); optional `reference` (only when `promptConfig.referencePrompt` exists; `before` emits a progress event); `map` (prompt built by `renderMappingPromptTemplate` from `promptConfig.mappingPrompt.template`; `before` stores `state.mappingSource = artifact`; `validate` throws if `artifact.mappings` is absent).
  9. Submission-tool validation: while `state.mappingSource` is set, the tool compares the candidate against the previous turn's artifact via `unchangedArtifactError` (name/ascii/codeEntityIds must be byte-identical) plus `diagramMappingValidationError`, and returns `{accepted:false, terminate:false}` with a corrective message so the agent retries in-session; otherwise pushes the submission with `terminate: true` (agentRuntime.ts:341–370). Draw this as a self-loop on the tool.
  10. `runAgentWorkflow` throws if any step returns `undefined` ("finished without an accepted submission", agentWorkflow.ts:46) and honors `signal.throwIfAborted()` between every phase.
  11. On full acceptance: batch → `validating`; handles are slugified and de-duplicated against existing + imported artifacts; `DiagramRecord`/`DiagramComponentRecord` are built with `derivedFromDiagramIds` computed from `promptConfig.references` (same-view filtered for diagrams, :271–281); a `DiagramCodeEntityMapRecord` is built per artifact with `asciiSha256` and `validateDiagramMappings`; all runs → `complete`; `completeBatch(batch, runs, diagrams, components, codeEntityMaps)` commits atomically-ish in one call (:390).
- **Notes for the renderer**: Show the retry loop as a labeled `loop [attempt ≤ 3, pending slots]` frame containing a `par` frame over the slots. Inside one representative slot, nest a second frame for the three workflow turns. Annotate the executor arrow with its exact contract sentence from `agentWorkflow.ts:21` ("Return only this turn's accepted submission"). Use a distinct color for the three validation gates (draft validation in the application, unchanged-artifact + mapping validation in the tool, `validate()` in the workflow step) — the point of the diagram is that validation happens at three different layers.

---

### STU-4 — Code-entity mapping: evidence onto artifacts
- **Provenance**: Studio slice, D4. Placement Z3 Studio (R3,C5).
- **Modifications**: Cite CORE-10 for the index/progress model instead of restating it.


- **Kind**: data-flow pipeline with a bounded worker pool; includes the spatial-progress side channel.
- **Question it answers**: How is existing evidence (CodeEntities) attached to the visible text of an already-generated artifact, how does the batch form bound concurrency and de-duplicate in-flight targets, and what progress state does each job publish along the way?
- **Boundary (IN)**:
  - `application/studio/evidence-mapping/service.ts` — `mapCodeEntities` (:23), `mapCodeEntitiesBatch` (:35–267)
  - `application/studio/generation/agent.ts` — `ArtifactEntityMappingRequest`, `DiagramAgentRuntime.mapArtifactEntities`
  - `infrastructure/studio/agents/agentRuntime.ts` — `PiDiagramAgentRuntime.mapArtifactEntities` (:546–664): alias construction via `createCodeEntityPromptAliases`, `expected` artifact snapshot, the resubmit-unchanged tool, `renderMappingPromptTemplate` with `DEFAULT_MAPPING_FOLLOW_UP_PROMPT`
  - `domain/core/diagrams/diagramMapping.ts` — `validateDiagramMappings`, `diagramMappingValidationError`
  - `domain/core/representations/representationIndex.ts` — `buildRepresentationIndex`
  - `domain/core/agent-work/agentWork.ts` — `createSpatialProgressState`, `updateSpatialProgressState`, `representationElementIds`, `SpatialProgressState`
  - `application/studio/representations/service.ts` — `saveAgentSpatialProgress` (the browser-initiated writer of the same state)
  - `StudioContext.activeMappings` (context.ts:8)
  - Records: `DiagramCodeEntityMapRecord`, `CodeEntityMappingTarget`, `CodeEntityMappingResult`, `AgentRunRecord{kind: "map-code-entities"}` in `domain/core/records/domain.ts`
  - Core (collapsed): `CoreApplication.mappedArtifactBundle`
  - Routes: `POST /api/studio/diagram-sets/{set}/{diagrams|components}/{id}/code-entity-map` and `POST .../code-entity-maps` in `src/server/routes/studio/routes.ts:435–490`
- **Boundary (OUT)**: How evidence was collected in the first place (D2); the generation-time mapping turn (D3 — note in a caption that generation produces mappings inline and this pipeline *re*-maps an existing artifact); the NDJSON framing (D7).
- **Nodes**:
  - `mapCodeEntities(setId, kind, id)` — thin wrapper: batch of 1, concurrency 1, rethrows a failed result
  - Validation gate — ≤ 50 targets, concurrency 1–6, no duplicate `kind:id`, CodeEntitiesSet must be `finalized`
  - `prepare` phase (per target) — `mappedArtifactBundle`, reject archived, reject zero entities, build `AgentRunRecord`, compute `revision {artifactId, asciiSha256}`, `buildRepresentationIndex`, `createSpatialProgressState`
  - `activeMappings` guard — key `${setId}:${artifactId}`, checked twice (inside `prepare` at :59 and again across the prepared set at :105) and released in `finally`
  - Worker pool — `Math.min(concurrency, prepared.length)` workers sharing a `cursor`
  - `agents.mapArtifactEntities` → `PiDiagramAgentRuntime` session + resubmit-unchanged tool
  - `validateDiagramMappings` → `DiagramCodeEntityMapRecord` (`origin: "agent"`, `producedByRunId`, `asciiSha256`)
  - Spatial progress writer — `saveSpatialProgress(runId, state)`
  - Result assembly — `CodeEntityMappingResult[]` + final `WorkspaceSnapshot`
- **Edges / relationships**:
  - `mapCodeEntities` --delegates to--> `mapCodeEntitiesBatch(…, [target], 1)` and --throws--> on `results[0].status === "failed"` (:30–31). The single-artifact route is therefore the batch pipeline with N=1.
  - `prepare` --emits--> a `SpatialProgressState` seeded from a `RepresentationIndex` built over the artifact's *current* ascii and its *existing* code-entity map (:83–93); the index revision pins `asciiSha256`, so a later ascii change invalidates the scope.
  - Worker --updates--> spatial progress to `status: "running"` with `currentElementIds = representationElementIds(index)` before prompting (:134–138).
  - Worker --serializes--> run progress writes through a `progressWrites` promise chain (:139–150) so concurrent agent callbacks cannot interleave `saveRun` writes; awaited at :171 and swallowed on failure at :223.
  - `agents.mapArtifactEntities` --receives--> the artifact ascii, `codeEntityIds`, full `CodeEntityRecord[]`, and `domainProfileId`; inside, aliases are generated with `createCodeEntityPromptAliases` and the tool rejects any submission that changes the name/ascii/codeEntityIds (`unchangedArtifactError`) or whose mappings fail `diagramMappingValidationError`, returning `terminate: false` so the agent corrects in-session (agentRuntime.ts:592–620).
  - On success the worker --rebuilds--> a *completed* `RepresentationIndex` from the new map record, recreates the progress state against it, then applies two updates (`running` with all element ids, then `complete` with `completedElementIds`) before persisting (:185–201). Draw this three-step progress recomputation explicitly — it is the non-obvious part.
  - On failure the worker --writes--> run `failed` and a progress state derived from the *original* index with `status: "failed", error` (:226–241).
  - `representations/service.saveAgentSpatialProgress` --writes the same `spatialProgress[runId]` slot--> from the browser (PUT `/agent-runs/{id}/spatial-progress`), after re-validating the state against a freshly built index and checking the run belongs to the set (representations/service.ts:67–92). Draw as a second inbound arrow to the same store slot.
  - Batch --returns--> `{workspace, results}`; the route appends a terminal `{type:"result", ...}` NDJSON line (routes.ts:469).
- **Notes for the renderer**: Two columns — "prepare (all targets, sequential validation)" and "execute (bounded worker pool)" — with the `activeMappings` set drawn as a shared guarded resource spanning both and released by a `finally`. Show the spatial-progress store as a side store touched at four points (seed, running, complete/failed, browser PUT). Annotate the concurrency bound `1..6` and the target bound `≤ 50`.

---

### STU-5 — Artifact edit session state machine
- **Provenance**: Studio slice, D5. Placement Z3 Studio (R3,C6).


- **Kind**: state machine over `EditSessionRecord` with an operation-log/cursor sub-model.
- **Question it answers**: How does an edit session accumulate reversible text patches, how do location markers interact with the LLM edit turn, and what exactly does "finish" produce (a new artifact copy, never an in-place mutation)?
- **Boundary (IN)**:
  - `application/studio/editing/service.ts` — `createEditSession`, `activeEditSession`, `appendEditOperation`, `manualEdit`, `placeEditMarker`, `undoEdit`, `redoEdit`, `llmEdit`, `finishEdit`, `discardEdit`, `captureDiagramComponent`, `captureNestedDiagramComponent`, `captureComponentSelection`
  - `domain/studio/editing/operations.ts` — `textPatch`, `applyPatch`, `characterOffset`, `cropAsciiSelection`
  - `application/studio/shared.ts` — `MARKER_CHARACTERS = ["`", "~", "^", "{", "}"]`
  - Records: `EditSessionRecord` (`status: "active" | "committed" | "discarded"`, `operations`, `operationCursor`, `revision`, `baseAscii`, `workingAscii`, `outputArtifactId`) and `EditOperationRecord` (`kind: "manual" | "llm"`, `subtype?: "marker"`, `patch: TextPatch`, `markerChar`, `markerToken`, `replacedChar`, `agentRunId`) in `domain/core/records/domain.ts:520–575`
  - `application/studio/generation/agent.ts` — `ArtifactEditRequest` (carries `markers: {token, character, originalCharacter}[]`), `DiagramAgentRuntime.editArtifact`
  - `infrastructure/studio/agents/agentRuntime.ts` — `PiDiagramAgentRuntime.editArtifact` (:459–544), tool `submit_artifact_edit`
  - Route dispatch: `src/server/routes/studio/routes.ts` `parseEditSessionAction` (:131–144) and the action switch (:504–556) — note `llm` is the only NDJSON action, the other six return plain JSON
  - Browser: `src/features/studio/api.ts` `editAction`, `createEditSession`, `applyManualEdit`, `placeEditMarker`, `undoEdit`, `redoEdit`, `finishEdit`, `discardEdit`, `applyLlmEdit`; `src/features/studio/StudioPage.tsx` `editQueue` ref + `runEditAction` (:1590–1605) and `startEdit` session reuse (:1546–1570); `src/features/studio/editing/EditOperationsPanel.tsx`
- **Boundary (OUT)**: The Pi session mechanics (collapsed to one "edit agent" node); the diff rendering helper `src/features/studio/editing/artifactPartialDiffs.ts` (trivial); component capture can be shown as a small side-branch since it shares `cropAsciiSelection` but creates no session.
- **Nodes**:
  - States: `active` (with substate pair `operationCursor < operations.length` = redoable / `= length` = at tip), `committed`, `discarded`
  - Operations log: an ordered `EditOperationRecord[]` plus `operationCursor`
  - Transition actions: `createEditSession`, `manualEdit`, `placeEditMarker`, `undoEdit`, `redoEdit`, `llmEdit`, `finishEdit`, `discardEdit`
  - Guards: `activeEditSession` (session must belong to the set and be `active`), archived-artifact rejection, `assertSevenBitAscii`, 20 000-character cap, "at least one edit before saving", unresolved-marker rejection
  - Side nodes: `textPatch` / `applyPatch(reverse)` / `characterOffset`, the edit agent, the new output artifact record
- **Edges / relationships**:
  - `createEditSession` --creates--> `active` session with `baseAscii = workingAscii = artifact.ascii`, `operations: []`, `operationCursor: 0`, `revision: 0`; rejects `artifact.archivedAt` (editing/service.ts:35).
  - `manualEdit` --computes--> `textPatch(workingAscii, normalized)` (a single common-prefix/common-suffix diff, operations.ts:3–17) and appends a `kind:"manual"` op; a no-op edit short-circuits without touching the log (:92).
  - `appendEditOperation` --truncates the redo tail-- : `operations.slice(0, operationCursor)` then appends, so any new edit after an undo discards the redo branch (:77). This is the single most important edge in the diagram.
  - `placeEditMarker` --picks--> the first char in `MARKER_CHARACTERS` not already present in `workingAscii` (throws when all five are in use), computes a character offset from `(line, column)`, and appends a `kind:"manual", subtype:"marker"` op whose patch replaces exactly one character; returns `markerToken = "@" + markerChar` to the caller (editing/service.ts:103–122).
  - `undoEdit` --applies--> `applyPatch(..., reverse = true)` and decrements the cursor; `redoEdit` re-applies the op at the cursor. Both bump `revision`. `applyPatch` throws "edit operation no longer matches the working copy" if the text at `patch.start` no longer equals the expected side (operations.ts:22) — draw as a failure edge.
  - `llmEdit` --collects live markers-->: applied ops with `subtype === "marker"` whose `markerChar` is still present in `workingAscii` **and** that have no later `kind:"llm"` op after them (:176–185) — i.e. an LLM turn consumes all outstanding markers. Those become the `markers` array in `ArtifactEditRequest`, and the runtime renders them as a "Location markers" block in the prompt with the original replaced character (agentRuntime.ts:521–535).
  - `llmEdit` --creates--> an `AgentRunRecord{kind:"edit-artifact"}`, streams progress into it, then appends a `kind:"llm"` op carrying `instruction`, `modelId`, and `agentRunId`; the run goes `complete` or `failed` (editing/service.ts:159–243).
  - `finishEdit` --guards--> cursor > 0 and **no unresolved marker** (same "marker still present and no later llm op" predicate, :250–255) → creates a **new** artifact (`origin: "edited"`, `editSessionId`, `derivedFromDiagramIds: [source.id]`, new slugified unique handle, name `"<source> Edit"`) and sets the session `committed` with `outputArtifactId`. The source artifact is never modified — draw this as a fork, not a replace.
  - `discardEdit` --sets--> `discarded` (no artifact written).
  - Browser serialization: `StudioPage.editQueue` chains manual edits, and `runEditAction` awaits that queue before any undo/redo/finish/discard (`await editQueue.current`, StudioPage.tsx:1596, 1613, 1631, 1655) — annotate this, it is the client-side ordering guarantee that makes the server's patch-match check safe.
  - Side-branch: `captureDiagramComponent` / `captureNestedDiagramComponent` --call--> `cropAsciiSelection` (trims blank rows, tightens to occupied columns, re-asserts 7-bit ASCII) and create a `DiagramComponentRecord{origin: "selection", selectionBounds, sourceDiagramId|sourceDiagramComponentId}` without any edit session.
- **Notes for the renderer**: Draw the three statuses as the outer state machine; inside `active`, draw the operations array as a horizontal strip of boxes with a cursor caret, and show `manualEdit`/`marker`/`llmEdit` as "append (truncating tail)", `undo`/`redo` as cursor moves. Put the marker lifecycle (place → included in next llm prompt → must be gone before finish) as a labeled band across the bottom. Mark `committed` and `discarded` terminal.

---

### STU-2 — DiagramSet lifecycle and run recovery
- **Provenance**: Studio slice, D2. Placement Z3 Studio (R3,C8).


- **Kind**: state machine (composite: three interacting status fields) with the operations that cause each transition.
- **Question it answers**: What states does a DiagramSet and its CodeEntitiesSet/GenerationBatch pass through, which call causes each transition, which transitions are irreversible, and what happens to in-flight state when the server restarts?
- **Boundary (IN)**:
  - States from `domain/core/records/domain.ts`: `DiagramSetReadiness = "collecting" | "ready" | "failed"` (:10); `CodeEntitiesSetRecord.status = "collecting" | "finalized" | "failed"` (:128); `GenerationBatchStatus = "queued" | "running" | "validating" | "complete" | "failed"` (:61); `AgentRunStatus = "queued" | "reading-context" | "generating" | "validating" | "complete" | "failed" | "interrupted"` (:53)
  - Transition functions: `application/studio/collection/service.ts` — `createDiagramSet`, `createMaterializedDiagramSet`, `validateDiagramSetTarget`, `collectCodeEntities`, `deleteDiagramSet`; `application/studio/generation/service.ts` — `generateInitialDiagrams`, `generate`; `application/studio/candidates/service.ts` — `setStarredDiagram`, `promoteProjectRepresentation`, `archiveDiagram`, `archiveDiagramComponent`, `rankDiagramCandidates`, `renameDiagram`; `application/studio/lifecycle/service.ts` — `recoverInterruptedRuns`
  - Persistence transitions: `infrastructure/core/persistence/projects.ts` `createDiagramSet` (readiness starts `collecting`, :86), `moveDiagramSetToTrash` (:110); `infrastructure/core/persistence/runs.ts` `beginCodeEntityCollection` (:36), `completeCollection` (sets readiness `ready`, :50–68), `failCollection` (sets readiness `failed`, :71–82); `infrastructure/core/persistence/generation.ts` `beginBatch` (:265), `completeBatch` (:286), `ensureDiagramCandidateBatch` (:225)
  - Promotion target status: `domain/core/representations/projectCatalog.ts` `ProjectRepresentationRecord.status = "settled" | "archived"` (:118)
  - Guards in `StudioContext`: `activeBatches: Set<string>`, `activeMappings: Set<string>` (context.ts:8)
- **Boundary (OUT)**: The edit-session state machine (that is D5); the per-slot retry loop internals (that is D3); the representation-catalog revision chain (shown only as the terminal "settled representation" node); Mapping's canvas revisions.
- **Nodes** (grouped in three swim-lanes):
  - Lane "DiagramSet": `(absent)` → `collecting` → `ready` / `failed` → `trashed`
  - Lane "CodeEntitiesSet": `collecting` → `finalized` (terminal/immutable) / `failed`
  - Lane "GenerationBatch + AgentRun": `queued` → `running` → `validating` → `complete` / `failed`; AgentRun adds `reading-context`, `generating`, `interrupted`
  - Lane "Candidate outcome": `DiagramCandidateBatch` (created on complete batch) → `ranked` (rankings map) / `starred` → `ProjectRepresentation status=settled` → `archived`; separately `Diagram archivedAt`
- **Edges / relationships**:
  - `createDiagramSet` --creates--> DiagramSet in `collecting` + CodeEntitiesSet in `collecting` (projects.ts:86). Preceded by `validateDiagramSetTarget` which rejects a corpus with a different `repositoryIdentity` or domain profile (collection/service.ts:280–290).
  - `collectCodeEntities` --calls--> `beginCodeEntityCollection` (guard: throws if the set is already `finalized`, collection/service.ts:298 and runs.ts:38), then runs one `collect-entities` AgentRun, then `validateEntityDrafts` → `completeCollection` → DiagramSet `ready` + CodeEntitiesSet `finalized`. On throw: `failCollection` → both `failed` (collection/service.ts:362–376).
  - `createMaterializedDiagramSet` --bypasses the collector--: validates keys/ranges/mappings in-process, calls `completeCollection` directly with the supplied entities, adds diagrams + code-entity maps, then calls `promoteProjectRepresentation` for each `featuredViews` entry; **on any failure it moves the whole set to trash** (`moveDiagramSetToTrash` in the catch, collection/service.ts:262–265). Draw this as a compensating-transaction edge back to `trashed`.
  - `generate` guard --requires--> CodeEntitiesSet `finalized` AND DiagramSet `ready` (generation/service.ts:89), and --requires--> `!activeBatches.has(setId)` (:84, added at :85, removed in `finally` at :399).
  - `generate` --transitions--> batch `queued` →(`beginBatch`)→ `running` →(all slots accepted)→ `validating` →(`completeBatch`)→ `complete`; any slot exhausting `MAX_ATTEMPTS = 3` → batch `failed` with a joined per-slot message (:259–266).
  - `completeBatch` / `beginBatch` --call--> `ensureDiagramCandidateBatch`, which materializes a `DiagramCandidateBatchRecord` only when `status === "complete" && outputDiagramIds.length > 0`, with a deterministic `stableScopedId("candidate-batch", setId, batchId)` and an immutable membership check (generation.ts:225–252).
  - `rankDiagramCandidates` --writes--> `DiagramCandidateBatchRecord.rankings` (candidates/service.ts:159–163).
  - `setStarredDiagram(true)` --calls--> `promoteProjectRepresentation` (makeActive: true) → representation `settled`; `setStarredDiagram(false)` --calls--> `archiveRepresentation` only if the representation is currently `settled` (candidates/service.ts:144–155). Star is therefore *not* a flag on the Diagram — it is derived from catalog membership.
  - `archiveDiagram` / `archiveDiagramComponent` --set--> `archivedAt`; archived artifacts are rejected by `promoteProjectRepresentation` (:19), `renameDiagram` (:127), `createEditSession` (editing/service.ts:35), `captureDiagramComponent` (:29), and mapping (evidence-mapping/service.ts:56).
  - `deleteDiagramSet` --guards--> readiness ≠ `collecting`, no `activeBatches` entry, no `activeMappings` key prefixed `${setId}:`, and no AgentRun in `queued|reading-context|generating|validating` (collection/service.ts:436–448) → `moveDiagramSetToTrash` (moves the whole set directory under `trash/diagram-sets/<id>-<timestamp>` and drops it from `project.diagramSetIds`).
  - `recoverInterruptedRuns` (called from `bootstrap` at startup) --rewrites--> every AgentRun in `queued|reading-context|generating|validating` to `interrupted` and every GenerationBatch in `queued|running|validating` to `failed` (lifecycle/service.ts:6–27). Draw as two dashed "on server restart" edges crossing from the in-flight states to `interrupted`/`failed`.
- **Notes for the renderer**: Lay left-to-right as the user-visible lifecycle; put the four lanes as horizontal bands so the vertical alignment shows which statuses move together (e.g. `completeCollection` moves two lanes at once). Use a distinct edge style for guards/rejections, another for the two restart-recovery edges, and a third for the materialized compensating rollback. Mark `CodeEntitiesSet: finalized` and `AgentRun: interrupted` as terminal.

---

### STU-6 — Experiments and datasets
- **Provenance**: Studio slice, D8. Placement Z3 Studio (R5,C4).


- **Kind**: data-flow pipeline over an on-disk layout, with the axis/iteration/value/replicate coordinate system as the organizing key.
- **Question it answers**: How the offline evaluation runner produces a directory of generation/judgment/analysis records, how the server exposes them read-only, and how a viewer promotes one output into a labeled evaluation dataset.
- **Boundary (IN)**:
  - Runner: `tools/experiments/runner.ts` (`AXES`, `ITERATIONS`, `ExperimentRunner.initialize/source/promptFor/generate/judge/analyze/writeReport/run`, `writeJson` temp-file-then-rename, `mapLimit`, `generationPath`, `valueName`, `labeled`), `tools/experiments/runtime.ts` (`ExperimentRuntime` interface, `SolExperimentRuntime`, `EXPERIMENT_MODEL_ID = "gpt-5.6-sol"`), `tools/experiments/metrics.ts` (`diagramMetrics`, `validateRanking`, `aggregateScores`, `judgeSummary`)
  - Shared records: `domain/studio/experiments/types.ts` — `AxisDefinition`, `ExperimentManifest`, `GenerationRecord`, `StoredPromptConfig`, `DiagramMetrics`, `LabeledDiagram`, `CrossJudgment`, `WithinJudgment`, `StoredCrossJudgment`, `StoredWithinJudgment`, `AggregateScore`, `PromptAnalysis`, `StoredAnalysis`
  - Read model: `domain/studio/experiments/experimentDomain.ts` — `ExperimentSummary`, `ExperimentAxisSummary`, `ExperimentIterationSummary`, `ExperimentDiagramSummary`, `ExperimentDiagramArtifact`, `ExperimentCatalogSnapshot`
  - Server side: `infrastructure/studio/persistence/experiments/experimentCatalog.ts` (`ExperimentCatalog.list/artifact`), `application/studio/experiments/repository.ts` (`ExperimentRepository`), `application/studio/datasets/datasetService.ts` (`DatasetService.addFromExperiment`), `application/studio/datasets/repository.ts` (`DiagramDatasetRepository`), `infrastructure/studio/persistence/datasets/diagramDatasetStore.ts` (`DiagramDatasetStore`, `normalizeDatasetLabels`, `sourceKey` de-duplication, `summary` field stripping)
  - Dataset records: `domain/studio/datasets/datasetDomain.ts` — `DiagramDatasetSourceRef`, `DiagramDatasetItemSummary`, `DiagramDatasetItemRecord`, `DiagramDatasetSummary`, `AddDiagramDatasetItemInput/Result`
  - Routes: `src/server/routes/studio/routes.ts` `/api/studio/experiments`, `/experiments/{id}/artifact?axis&iteration&value&replicate` (:202–213), `/diagram-datasets` and `/diagram-datasets/{id}/items[/{item}]` (:166–200)
  - Browser: `src/features/studio/api.ts` `fetchExperiments`, `fetchExperimentArtifact` (note `value: input.value.toFixed(2)` on the wire), `fetchDiagramDatasets`, `createDiagramDataset`, `addDiagramDatasetItem`, `fetchDiagramDatasetItem`, `updateDiagramDatasetItemLabels`, `removeDiagramDatasetItem`; `src/features/studio/experiments/ExperimentViewerPage.tsx`
  - Reuse edge into the Studio stack: the runner imports `domain/studio/generation/prompt.createGenerationPromptConfig` and `infrastructure/studio/agents/agentRuntime.PiDiagramAgentRuntime` directly (runner.ts:12, runtime.ts:11) — it reuses generation without going through the application layer.
- **Boundary (OUT)**: The Pi judge/analyst session internals (collapse `SolExperimentRuntime.structured` into one "structured LLM call" node); `REPORT.md` rendering detail; the parser evaluation bundles under `tools/diagram-parser/`.
- **Nodes**:
  - `AXES` (semantic_zoom, topology) each pinned to a real `diagramSetId` in a `.diagrams` store, with a `baselinePrompt` containing a literal `{{value}}`
  - `ITERATIONS` — iteration 1: values [0, 0.5, 1] × 3 replicates; iteration 2: values [0, 0.25, 0.5, 0.75, 1] × 3
  - `ExperimentRunner.generate` → `GenerationRecord` files at `axes/<axis>/iteration-<n>/generations/value-<v.vv>/replicate-<r>.json`, plus `prompt-config.json` (`StoredPromptConfig`) per condition
  - `ExperimentRunner.judge` → `judgments/cross-r<r>-window<w>.json` and `judgments/within-value-<v.vv>.json`
  - `ExperimentRunner.analyze` → `aggregate.json` + `analysis.json` (`StoredAnalysis`)
  - `experiment.json` (`ExperimentManifest`), `REPORT.md`
  - `ExperimentCatalog` (read-only directory scanner) → `ExperimentCatalogSnapshot` / `ExperimentDiagramArtifact`
  - `DatasetService.addFromExperiment` → `DiagramDatasetStore` → `datasets/<id>/dataset.json`
  - `ExperimentViewerPage` (tree mode `experiments` | `datasets`, metric selector, threshold, replicate stepper)
- **Edges / relationships**:
  - `run(through)` --iterates--> for each iteration spec, for each axis: `promptFor` → `generate` → `judge` → `analyze`. `promptFor(axis, 2)` reads iteration 1's `analysis.analysis.revisedPromptBlock` — **the closed loop**: the analyst's revised prompt becomes iteration 2's tested prompt (runner.ts:183–187). Draw this feedback edge prominently.
  - Every stage is **resumable**: each writes only if `readJsonIfExists` returns nothing, and logs `resume …` otherwise (runner.ts:196–200, 281–282, 296–297, 317–318). Annotate the pipeline as idempotent-by-file-existence.
  - `generate` --builds--> a `GenerationPromptConfigRecord` via `createGenerationPromptConfig` using the real `DiagramSetRecord` + `CodeEntitiesSetRecord` read straight from `<sourceRoot>/.diagrams/diagram-sets/<setId>/`, requiring `readiness === "ready"` and `status === "finalized"` (runner.ts:175–181), then calls `runtime.generate` → `PiDiagramAgentRuntime.generateArtifact` (i.e. the same workflow as D3), then validates ascii and unknown entity ids and computes `diagramMetrics`.
  - `renderAxisPrompt` --requires--> the literal `{{value}}`; `analyze` re-checks that the analyst's revised block still contains `{{value}}` and stays under a 180/240-word limit (runner.ts:332–336).
  - `judge` --labels--> triples of diagrams A/B/C with a rotating `seed` so the judge cannot learn a positional prior (`labeled(…, index + iteration)`, runner.ts:102–111, 283, 298); cross-value judgments compare across axis values, within-value judgments compare replicates at one value.
  - `aggregateScores` --derives--> `distinguishabilityScore` and friends from the judgments and metrics; `writeReport` renders the iteration-1 vs iteration-2 delta table.
  - `ExperimentCatalog.list` --scans--> `<datasetRoot>/<catalogId>/experiment.json`, then for each axis/iteration reads `analysis.json` plus every existing `replicate-*.json`, and enriches with the *source repository's* `project.json` and `diagram-set.json` (experimentCatalog.ts:63–135). It is read-only and tolerant of missing files.
  - `ExperimentCatalog.artifact` --addresses by--> `(catalogId, axisId, iteration, value, replicate)` with regex/range validation and `value-${value.toFixed(2)}` directory naming — the wire query uses the same two-decimal encoding (`api.ts:149`), so the coordinate encoding is duplicated in three places (runner `valueName`, catalog `valueDirectory`, client query). Worth drawing as a shared-format annotation.
  - `DatasetService.addFromExperiment` --joins--> `ExperimentRepository.list()` (to resolve `experimentId`, `projectId`, `projectName`, `axisLabel`, and the tested prompt from `iterationSummary.aggregate.prompt`) with `ExperimentRepository.artifact()` (for ascii/metrics/modelId/promptConfigId), then calls `DiagramDatasetRepository.addItem` (datasetService.ts:11–46).
  - `DiagramDatasetStore.addItem` --de-duplicates by--> `sourceKey = catalogId:axisId:iteration:value.toFixed(6):replicate` and returns `added: false` for a repeat; `summary()` strips `ascii`, `codeEntityIds`, `modelId`, `promptConfigId`, `testedPrompt` from list responses so only the item endpoint returns the full record (diagramDatasetStore.ts:50–64).
  - `ExperimentViewerPage` --fetches--> the catalog + dataset snapshots on mount, then fetches every artifact matching the current selection in parallel with a cancellation flag; dataset item detail is a separate fetch keyed by `(datasetId, itemId)`.
- **Notes for the renderer**: Lay out left-to-right in three zones separated by a vertical "process boundary" line: (A) offline Node runner + its on-disk tree, (B) server read/write adapters + routes, (C) browser viewer. Draw the on-disk tree as a small literal directory sketch (`experiment.json`, `axes/<axis>/iteration-<n>/{generations/value-<v>/replicate-<r>.json, prompt-config.json, judgments/*.json, aggregate.json, analysis.json}`, `REPORT.md`) since path shape *is* the addressing scheme. Curve the iteration-1-analysis → iteration-2-prompt feedback edge back on itself and label it "revisedPromptBlock becomes the next tested prompt".

---


## Plane Z4 — Mapping

### MAP-8 — Retained selection effect tree and the source pane
- **Provenance**: Mapping slice, D9. Placement Z4 Mapping (R1,C5).
- **Modifications**: The `SourceScrollState` contract it implements is drawn in CORE-13 (same cell, Core plane).

- **Kind**: ownership tree + component/data-flow hybrid
- **Question it answers**: How one retained selection owns a tree of projection / compaction / source-code / conversation panes, how stacked vs chained layout and collapse work, and how the source pane loads and keeps scroll position without re-rendering on every pan.
- **Boundary (IN)**:
  - `domain/mapping/workspace/displayModel.ts` — `DisplayState`, `DisplayNodeBase` (`childIds`, `expansion`, `geometryPolicy{placement, sizing}`, `expandedGeometry`), `SelectionRegion`, `ProjectedPane` (`content` union), `SourceCodePaneContent`, `ConversationPane`, `DetailPane`, and the operations `addDisplayNode`, `removeDisplayNode`, `setExpansion`, `updateDisplayGeometry`, `measureDisplayNode`, `visibleProjectionIds`.
  - `domain/mapping/workspace/projectedPaneLayout.ts` `layoutProjectedPanes` (+ `PROJECTION_GAP = 72`).
  - `domain/mapping/chat/conversationPaneLayout.ts` `layoutConversationPane`.
  - `src/features/mapping/canvas/SelectionEffectsLayer.tsx` (whole file), `src/features/mapping/canvas/DisplayPane.tsx` (`DisplayPane`, `EffectPaneHeader`).
  - `src/features/mapping/source-pane/sourceCodePane.ts` (`openSourceCodePane`, `updateSourceCodePane`, `SourceCodePaneView`), `SourceCodePane.tsx`, `sourceCodeCompaction.ts`, `sourcePaneViewState.ts`, `SourcePaneViewStateContext.tsx`.
  - `MappingCanvas.tsx` — `openMapped` (`N`, :507–521), `retainSelection` (:493–506), `removeEffect` (:522–530), `openDetail` (:244–254), the `<SelectionEffectsLayer>` wiring (:1285–1292).
- **Boundary (OUT)**: Core's `projectSelection`/`validateProjection`/`projectCompactions` and the projection catalog — collapse to two nodes ("call-tree projection" and "compaction projection"). `src/shared/source/SourceCodeView` and `RepositoryFileExplorer` — one node each ("shared source viewer", "shared file explorer"), plus the Core endpoints they call. LSP internals.
- **Nodes**:
  - Tree: `SelectionRegion` (root, `rootIds`) → `ProjectedPane{call-tree}` → `ProjectedPane{compaction}` → `ProjectedPane{source-code}`; `ConversationPane` as a sibling child of the selection; `DetailPane` as a root-level node.
  - Layout/geometry: `layoutProjectedPanes`, `visibleProjectionIds`, `geometryPolicy`, `expandedGeometry`, `ResizeObserver` in `DisplayPane`/`LocalChatConvo`.
  - Source pane internals: `sourceCodeCompaction(file)` → `{entries, compactedSource}`; `fetchProjectSourceFile`; `fetchSourceDefinitions`; local `history{back, forward}`; `SourcePaneViewState.bind(documentId, paneId, sourceFile, fallback)` → `SourceScrollState{read, connect, write}`.
- **Edges / relationships**:
  - `retainSelection()` creates the `SelectionRegion` with pixel geometry derived from the box bounds × cell metrics and stores `sourceBoxId`, `sourceContentId`, `sourceAscii`, `sourceRevisionId`, `rect`, `selectedIds` — `sourceAscii` is the staleness witness.
  - `addDisplayNode(state, node, ownerId)` appends to `owner.childIds` and, when both owner and child are projection/selection, sets `activeChildId` (stacked navigation's "current slot").
  - `removeDisplayNode` removes the whole subtree and repairs dangling `activeChildId`s; `removeEffect` additionally drops the matching control surface and clears `retainedSelectionId`/`activeThreadId` — and refuses while that selection's surface is `generating` (`MappingCanvas.tsx:523`).
  - `visibleProjectionIds(state, id, mode)`: in **stacked** mode only `activeChildId` descends and only the deepest pane renders; in **chained** mode all children render. Collapsed nodes contribute only themselves.
  - `layoutProjectedPanes` computes one horizontal axis at `source.y + min(24, height/2)`, writes **automatic** positions back through `updateDisplayGeometry`, leaves **manual** positions untouched, and returns `links` used to draw the routed SVG connectors and the `+/−` join buttons.
  - `setExpansion` stores `expandedGeometry` on collapse and restores it on expand — the mechanism that makes a collapsed fixed-size pane re-expand to the same allocation.
  - `DisplayPane` reports its measured border box via `ResizeObserver` → `measureDisplayNode`, which **ignores** measurements for `sizing:'fixed'` expanded panes — so content-sized frames feed layout and fixed frames do not.
  - `SelectionEffectsLayer`'s `useLayoutEffect` re-derives the selection rectangle from current box bounds + cell metrics **only when the source box exists, is not collapsed, and `scene.contents[sourceContentId].ascii === sourceAscii`**; otherwise the node keeps its saved geometry and is rendered with `data-source-stale` and "Source changed · saved selection", with Actions disabled.
  - `openMapped` (`N`) builds a `call-tree` pane from `callTreeProjection.result` (or a fallback), with `coverage` text; the projection is refused when the diagram is dirty, when the catalog revisions have moved, or when validation fails.
  - `openCompaction` → `projectCompactions(projection.compactionProjection, selectedIds ?? projectedNodeIds)` → a `compaction` child pane. Ctrl-drag on `<pre data-projected-tree>` selects rendered rows and "Project selected rows" narrows that call.
  - "Open source" → `openSourceCodePane(state, paneId, projectId, sourceFile)`: reuses an existing `source-code` sibling (switching its file, resetting `rangeIndex` and `scroll`) or creates one with `geometryPolicy { placement:'automatic', sizing:'fixed' }` at 860×640 — the source pane is the one deliberately fixed-size pane.
  - `updateSourceCodePane` is the single write path for `sourceFile` / `showCompactions` / `rangeIndex` / `scroll`; it validates `isRepositoryFilePath` and **returns the same state object when nothing changed**, preserving React identity.
  - `SourceCodePane` loads content with `fetchProjectSourceFile(projectId, sourceFile)` (aborted on file change / unmount), compares `loaded.sourceSha256` against the projected `file.sourceSha256` → `stale` disables compaction folds and range highlights; `sourceCodeCompaction(file)` merges overlapping mapped ranges into fold groups and produces a Studio-shaped `CompactedSource`.
  - Scroll persistence: `viewState.bind(documentId, paneId, sourceFile, content.scroll)` returns a `SourceScrollState`; the viewer `connect`s a reader and `write`s positions into a plain `Map` **outside React**, with `owner` symbols so a remount takes ownership before the previous cleanup runs. `captureDisplay` samples `entry.read?.()` at snapshot time; `resetPane` discards on navigation; `prune` drops entries for removed panes/files. Label this cluster "scroll and camera never enter the React display tree — that is what keeps pan/scroll off the render path".
  - Navigation: `navigate(visit, direction)` maintains a **pane-local** `history{back, forward}` (capped at 100) that is *not* serialized; Ctrl/Cmd+click or F12 → `fetchSourceDefinitions` → one result navigates, several show a picker; `explorerOpen` is also pane-local.
- **Notes for the renderer**: Draw the ownership tree on the left and the source-pane data flow on the right, joined by the "Open source" edge. Put stacked-vs-chained as a small inset showing the same three panes in both modes. Mark `SourcePaneViewState` as living outside React with a different node shape.

---

### MAP-3 — Where mapping state lives: three persistence tiers
- **Provenance**: Mapping slice, D4. Placement Z4 Mapping (R1,C6).
- **Modifications**: ABSORBS the browser half of Mapping D2: add to Tier A the `save()` steps — post `{projectId, representationId, expectedRevisionId: draft.revisionId, name, scene}` (`MappingPage.tsx:159-160`), rebase `savedScene`/`savedName`/`revisionId` on success (`:161-164`), and the 409 branch (`errorFrom` → banner, draft keeps its edits, reload required). The server side of that save is CORE-6.

- **Kind**: state-ownership / data-flow map (not a class diagram)
- **Question it answers**: For every piece of mapping editor state, which of three tiers owns it — (a) immutable catalog revision, (b) explicitly saved workspace snapshot, (c) browser-session-only — and how the per-document draft registry keeps several diagrams open with independent unsaved edits, undo history, and in-flight prompts.
- **Boundary (IN)**:
  - `src/features/mapping/MappingPage.tsx`: `Draft` interface (:35–45), `dirty()` (:46), `drafts` / `activeId` state (:56–57), `open()` (:67–80), `restore()` (:82–90), `capture()` (:91–98), `workspaceAction()` (:99–114), boot effect (:115–135), `beforeunload` + navigation guard (:142–151), `save()` (:153–167), per-draft rendering loop (:209–222), `viewState.prune` effect (:179–181).
  - `src/features/mapping/canvas/MappingCanvas.tsx`: `canvasState` (:149–152), `history {past,present,future}` with the 50-snapshot cap in `commit` (:215–217, :231–233), `undo(redo)` (:647–658 approx. "const undo = (redo = false)"), `clientSessionId` (:213), `operationOwnerRef` (:165), `replyControllers` map (:208–212, :613–617), `updateSurface` (:167–169), `useControl` surface accessor (:63–85).
  - `domain/mapping/workspace/mappingWorkspace.ts`: `MappingWorkspaceSnapshot`, `MappingDocumentSnapshot`, `MappingCanvasState`, `MappingControls`, `SelectionSurfaceState`, `initialCanvasState`.
  - `domain/mapping/workspace/displayModel.ts`: `DisplayState { rootIds, nodes }` and the four node kinds.
  - `src/features/mapping/source-pane/sourcePaneViewState.ts`: `SourcePaneViewState` (`bind`, `resetPane`, `prune`, `captureDisplay`, `setCamera`, `captureCamera`).
  - `src/features/mapping/workspace/mappingWorkspaceRepository.ts`, `infrastructure/mapping/persistence/workspace/mappingWorkspaceStore.ts` (`mapping-workspace.json`, atomic temp+rename, last-write-wins).
- **Boundary (OUT)**: The codec's validation rules (D5). The catalog revision internals (D3). The agent flows (D6–D8).
- **Nodes** (three ownership columns + a per-document band):
  - **Tier A — catalog revision (server, immutable)**: scene, evidence, composed ASCII. Written only by `POST /api/mapping/diagrams`.
  - **Tier B — workspace snapshot (server, single mutable file)**: `schemaVersion: 3`, `projectId`, `activeDocumentId`, `documents[]`; each document = `{ representationId, name, savedName, savedScene, revisionId, document: MappingGridDocument, canvas: { display, controls }, viewport }`. Written only by `PUT /api/mapping/workspace` ("Save workspace"), never automatically.
  - **Tier C — browser-only**: `history.past/future` (undo, 50 deep, per open document), `cell` metrics, `activeSelectionRef` / pointer capture, `placementPreview`, `movingBoxId`, `diagramPlacement`, `clientSessionId`, `replyControllers` (AbortControllers), `explorerOpen` + source pane Back/Forward history, `draft.busy`, `focusBox`.
  - **Live-but-captured (SourcePaneViewState)**: per-`(documentId, paneId)` scroll positions and per-document camera transform — held outside React, merged into Tier B only at `capture()` time.
  - **Per-document band**: `drafts: Record<representationId, Draft>`; N canvases mounted simultaneously, only the active one visible (`hidden={id !== activeId}`).
- **Edges / relationships**:
  - `open(id)` reads Tier A → `sceneFromRevision` → `mappingDocumentFromScene` → creates a `Draft` with `savedScene = JSON.stringify(document.scene)` and a fresh `initialCanvasState()` (`MappingPage.tsx:71–73`). Dirty = name differs **or** `JSON.stringify(scene) !== savedScene` (`:46`).
  - `save()` (Tier A write) rebases `savedScene`/`revisionId`; **it does not touch Tier B**.
  - `capture()` builds a Tier-B snapshot from `drafts` + `activeId`, and for each document calls `viewState.captureDisplay(id, draft.canvas.display)` (samples live scroll offsets into `content.scroll`) and `viewState.captureCamera(id, draft.viewport)` (`:91–98`) — label this edge "samples live viewport immediately before Save/Export, before a scroll event would arrive".
  - `workspaceAction('save'|'restore'|'export')` and Import → `mappingWorkspaceRepository` → `PUT`/`GET /api/mapping/workspace` → `MappingWorkspaceService` → `MappingWorkspaceStore` (atomic write of `mapping-workspace.json`, last-write-wins; invalid input leaves the previous file intact).
  - `restore(workspace)` **replaces** `drafts` wholesale, constructs a **new** `SourcePaneViewState`, bumps `workspaceEpoch` (which is part of the React key, forcing remount) (`:82–90`, `:209`).
  - Boot effect: `loadProjectRepresentations()` then `mappingWorkspaceRepository.load()`; a saved workspace with documents wins over the `?diagram=` query parameter (`:115–135`) — this is why the saved workspace is restored on reload.
  - `MappingCanvas.onCanvasStateChange` → `setDrafts(... canvas ...)` (per-document canvas state flows up); `onDocumentChange` → per-document `document`; `onBusyChange` → `draft.busy`.
  - `commit(next)` pushes onto `history.past` capped at 50 (`:231–233`) and clears `future`; undo/redo restore the **whole** `MappingGridDocument`, and `undo()` is blocked while `isGenerating` — undo history is **never** serialized into Tier B.
  - `operationOwnerRef.current` (the retained selection id, or `'draft'`) is read when a prompt starts and compared again when it resolves (`MappingCanvas.tsx:665–668, 725`), so a streamed result updates the surface that started it even if the active selection changed.
  - `replyControllers` is keyed by thread id and aborted when the thread's display node disappears (`:274–278`) or the canvas unmounts.
  - `viewState.prune(id, display)` drops scroll entries whose pane/file no longer exists (`MappingPage.tsx:179–181`).
  - `beforeunload` + `registerNavigationGuard` read `dirty(draft) || draft.busy` across **all** drafts (`:142–151`).
- **Notes for the renderer**: Three vertical columns A/B/C with a horizontal "per open document" swimlane crossing B and C. Put `SourcePaneViewState` as a bridge box between C and B with one arrow labelled `capture()`. Annotate: "no autosave", "Save (revision) and Save workspace are different commands", "undo history and pan/zoom of the *live* camera are session-local; the camera is captured into B".

---

### MAP-1 — Mapping surface, ports and adapters
- **Provenance**: Mapping slice, D1. Placement Z4 Mapping (R3,C1).

- **Kind**: layered architecture + interface/implementation map (composition view)
- **Question it answers**: For each of Mapping's five HTTP endpoints, which browser client calls it, which application service owns the operation, which port interface it depends on, and which concrete infrastructure adapter (real vs fake) is bound at bootstrap.
- **Boundary (IN)**:
  - Browser clients: `src/features/mapping/api.ts` (`promptMappingPocSelection`, `localChatResponder`), `src/features/mapping/workspace/mappingProjectApi.ts` (`saveMappingProjectDiagram`), `src/features/mapping/workspace/mappingWorkspaceRepository.ts` (`mappingWorkspaceRepository`).
  - Routes: `src/server/routes/mapping/routes.ts` (`createMappingRoutes`), `src/server/routes/mapping/chat/localChatRoutes.ts` (`handleLocalChat`), `src/server/routes/mapping/compaction/fileCompactionRoutes.ts` (`handleFileCompaction`).
  - Application services: `application/mapping/diagrams/diagramService.ts` (`MappingDiagramService`), `application/mapping/workspace/workspaceService.ts` (`MappingWorkspaceService`), `application/mapping/selection/selectionService.ts` (`SelectionService`), `application/mapping/chat/chatService.ts` (`LocalChatService`), `application/mapping/compaction/fileCompactionService.ts` (`FileCompactionService`).
  - Ports (interfaces declared in `application/mapping`): `application/mapping/selection/agent.ts` (`MappingAgentRuntime`), `application/mapping/chat/agent.ts` (`LocalChatRuntime`), `application/mapping/compaction/agent.ts` (`FileCompactionRuntime` / `FileCompactionSession`), `application/mapping/compaction/repository.ts` (`FileCompactionRepository`), `application/mapping/workspace/repository.ts` (`MappingWorkspaceRepository`).
  - Adapters: `infrastructure/mapping/agents/selection/agentRuntime.ts` (`PiMappingAgentRuntime`, `FakeMappingAgentRuntime`), `infrastructure/mapping/agents/chat/localChatRuntime.ts` (`CodexLocalChatRuntime`, `FakeLocalChatRuntime`), `infrastructure/mapping/agents/compaction/fileCompactionRuntime.ts` (`PiFileCompactionRuntime`, `FakeFileCompactionRuntime`), `infrastructure/mapping/persistence/compactionStore.ts` (`FileCompactionStore`), `infrastructure/mapping/persistence/workspace/mappingWorkspaceStore.ts` (`MappingWorkspaceStore`), settings/prompt loaders `infrastructure/mapping/agents/compaction/fileCompactionSettings.ts` + `prompts.ts`.
  - Composition: `src/server/app/bootstrap.ts` lines 49–90 (one node).
- **Boundary (OUT)**: Core's `DiagramRepository` / `projectCatalogs` / `CorpusAccess` / `CoreApplication` — show as a single collapsed node **"Core application (store, corpus, catalog)"**, because Core is another slice. Studio entirely. The React canvas components (D4/D9 cover them).
- **Nodes** (grouped by row):
  - Row 1 (browser): `mappingProjectApi.saveMappingProjectDiagram`, `mappingWorkspaceRepository`, `api.promptMappingPocSelection`, `api.localChatResponder`. (No browser client exists for compaction — note this.)
  - Row 2 (routes): `createMappingRoutes` dispatcher, `handleLocalChat`, `handleFileCompaction`.
  - Row 3 (application services): the five services above.
  - Row 4 (ports): the five interfaces above.
  - Row 5 (adapters): real + fake pairs, the two stores, the settings/prompt loaders.
  - Side node: `bootstrap.ts` composition root. Collapsed node: Core application.
- **Edges / relationships**:
  - `createMappingRoutes` dispatches by path (`routes.ts:19–44`): `/api/mapping/compactions[/…]` → `handleFileCompaction`; `/api/mapping/workspace` GET/PUT → `MappingWorkspaceService.load|save`; `/api/mapping/chat` → `handleLocalChat`; `/api/mapping/diagrams` POST → `MappingDiagramService.save`; `/api/mapping/prompt` POST → `SelectionService.prepare` then `.run`; anything else 404; wrong method 405.
  - Each browser client → its endpoint (HTTP, labelled with method + `application/x-ndjson` where streaming: `/prompt`, `/chat`, `POST /compactions`).
  - Each service → its port (constructor dependency).
  - Each adapter → port (`implements`). Label the fake variants "test/`NEW_DIAGRAM_AGENT=fake`".
  - `bootstrap.ts` → every service and adapter ("constructs / selects"), `bootstrap.ts:61–65,80–86`; and `bootstrap.ts:90` "dispose() aborts runtimes and active compaction runs".
  - `MappingDiagramService`, `SelectionService`, `LocalChatService`, `MappingWorkspaceService`, `FileCompactionService` → collapsed Core node ("loadProject / projectCatalogs / corpus provider").
- **Notes for the renderer**: Strict left-to-right or top-to-bottom layering; do not let an adapter edge skip the port row. Mark the `/api/mapping/compactions` column with a dashed "no browser client — curl/test driven" annotation. Mark `/prompt`, `/chat`, `POST /compactions` edges as streaming.

---

### MAP-6 — Two-step file compaction
- **Provenance**: Mapping slice, D7. Placement Z4 Mapping (R3,C4).
- **Modifications**: Collapse the runner to one node and cite CORE-7 (directly below in the stack).

- **Kind**: data-flow pipeline + run-status state machine (two coupled panels)
- **Question it answers**: How `POST /api/mapping/compactions` turns one frozen source file into two validated ASCII passes in the same agent conversation, what is written to disk at each step, and what statuses a run can end in.
- **Boundary (IN)**:
  - `src/server/routes/mapping/compaction/fileCompactionRoutes.ts` (both POST and `GET /:runId`).
  - `application/mapping/compaction/fileCompactionService.ts` — `prepare` (:41–63), `run` (:65–127), `get` (:129–136), `dispose` (:138–141), `active` map (:30).
  - `application/mapping/compaction/fileCompactionWorkflow.ts:5–21`.
  - `application/core/agents/agentWorkflow.ts` `runAgentWorkflow` (shown as one node — Core-owned runner).
  - `domain/mapping/compaction/validation.ts` — `validateFileCompactionDraft` (:14–41), `compactionSnapshot` (:43–49), `FileCompactionSource`, `FileCompactionPrompts`.
  - `domain/mapping/compaction/fileCompaction.ts` (`FileCompactionRequest`, `Draft`, `Result`, `Event`, `Stage`, `ThinkingLevel`), `domain/mapping/compaction/compactionRun.ts` (`FileCompactionRun`), `domain/mapping/compaction/agentSettings.ts`.
  - `infrastructure/mapping/agents/compaction/fileCompactionRuntime.ts` (`PiFileCompactionRuntime.openSession`, `runStep`, the `submit_file_compaction` tool, `FakeFileCompactionRuntime`).
  - `infrastructure/mapping/agents/compaction/fileCompactionSettings.ts` (`resolveFileCompactionSettings`, `FILE_COMPACTION_SUBMISSION_CONTRACT`), `prompts.ts` (`loadFileCompactionPrompts`).
  - Prompt files: `prompts/compaction/single-file-compact.md`, `single-file-compact2.md`, `prompts/system/codex.md` (+ `codex-source.json`, `CODEX-LICENSE`).
  - `infrastructure/mapping/persistence/compactionStore.ts` (`directory`, `create`, `save`, `load`, `artifacts`, `savePass`).
- **Boundary (OUT)**: Core's `CompactionSnapshot` / `buildTreeRepresentationIndex` / `asciiSha256` — collapsed to one node "Core representation index (semantic rows)". The corpus provider — one node. Canvas insertion (the workflow explicitly does not insert a pane or change a revision).
- **Nodes**:
  - Panel A (pipeline, left-to-right): `POST` body → `prepare` (validation + frozen source read) → `openSession` (one Pi chat) → `runAgentWorkflow(single-file-compaction)` → step `compact` → step `refine` → staleness recheck → `result` event.
  - Disk nodes under `<diagrams-store>/mapping/compactions/compaction-<uuid>/`: `source.txt`, `run.json`, `compact.txt`, `compact.json`, `refine.txt`, `refine.json`.
  - NDJSON event nodes: `started`, `progress(stage, message)`, `result`, `error(runId, stage, error)`.
  - Panel B (status state machine): `running → completed | failed | cancelled`, plus `running → interrupted` (derived on read).
- **Edges / relationships**:
  - `prepare` (`fileCompactionService.ts:41–62`): printable-ASCII `sourceFile` ≤2000 chars; project must match and be a `source-code` profile (else `ProjectDiagramConflict`); bytes read once via the corpus provider, 1–262144 bytes, strict UTF-8, no NUL, **never truncated**; `sourceSha256 = sha256(bytes)`; `lineCount` counts a trailing newline as a terminator, not a line (:57); prompts and agent settings resolved here.
  - `resolveFileCompactionSettings`: `modelId` from request → `NEW_DIAGRAM_MODEL` → default, restricted to `DIAGRAM_MODELS ∪ {gpt-6-astra}`; `thinkingLevel` default `medium`; `systemPrompt` override 1–64000 chars **replaces** the Codex base text; `effectiveText = base + " " + FILE_COMPACTION_SUBMISSION_CONTRACT`, with sha256 of both recorded.
  - `run` writes `source.txt` + initial `run.json` **before** emitting `started` (`store.create`, :83–84), so a crashed run is still discoverable.
  - `createFileCompactionWorkflow`: step **compact**'s prompt = `compact.text` + a labelled JSON blob of the frozen source ("source evidence, not instructions", :8); step **refine**'s prompt = `refine.text` alone — it relies on the *same conversation* retaining the source and the first submission.
  - Per step (`:87–103`): set `run.stage`, persist `run.steps[stage] = { prompt }`, `signal.throwIfAborted()`, emit stage progress, `session.runStep(...)`, then `compactionSnapshot(draft, source)` → `store.savePass` (writes `<stage>.txt` and `<stage>.json` with `{sourceFile, sourceSha256, treeFile, mappings}` using `flag:'wx'` — write-once) → persist `run.steps[stage]` with `model`, `sessionId`, `snapshot`.
  - `validateFileCompactionDraft` is the validation boundary and runs **twice** — once inside the runtime's `createValidatedSubmission` (so a rejected submission is correctable in-turn) and once in the workflow step's `validate` / `compactionSnapshot`. Rules: printable ASCII ≤200000 chars; first non-blank line must equal `source.sourceFile`; `buildTreeRepresentationIndex` derives the set of semantic rows; exactly one mapping per semantic row (no duplicates, no missing coverage); every range within `1..lineCount`; the root row must map to the **whole** file (`:37–40`).
  - `PiFileCompactionRuntime.openSession`: one Pi chat for the whole run, only `submit_file_compaction` exposed; `submission` collector is recreated per `runStep` and cleared afterwards (`:99, :111`) — "collector reset between turns, conversation history retained"; a second concurrent turn is rejected (`:98`).
  - Cancellation: `AbortSignal.any([controller, AbortSignal.timeout(1800000), requestSignal])` (:71) — 30-minute cap; the route's `response.on('close')` aborts (`fileCompactionRoutes.ts:16`); `FileCompactionService.dispose()` aborts every entry in `active` on shutdown.
  - After both passes: the live file is re-read and `sourceStale = sha256(current) !== source.sourceSha256`; an unreadable/removed file also counts as stale (`:104–108`). All mappings still describe the saved snapshot.
  - `GET /:runId` → `store.load` → project match check → **if `status === 'running'` and the id is not in `active`, report `interrupted`** (`:134`) — no automatic resume.
  - Failure edges: a `refine` failure leaves the accepted `compact` artifacts on disk; `status` becomes `cancelled` when the signal aborted, else `failed`; an `error` event carries `runId` + `stage`.
- **Notes for the renderer**: Two panels side by side, pipeline above, state machine below. Render `compact` and `refine` as identical sub-blocks to make "the same validate/save loop twice in one chat" visually obvious. Draw the 6 files as a disk cluster with write arrows labelled by stage, and mark `compact.*`/`refine.*` as write-once. Annotate the `prepare`/streaming boundary: "validation errors are JSON (400/409) before headers; after headers, failure is an `error` event with HTTP 200".

---

### MAP-5 — Selection prompt: from drag to editor proposal
- **Provenance**: Mapping slice, D6. Placement Z4 Mapping (R3,C6).

- **Kind**: sequence diagram with an inner tool-submission loop
- **Question it answers**: How selecting mapped diagram text and pressing **P** becomes an agent-produced patch that is applied to the *in-memory* document only, and what guards (session identity, revision equality, exact-hunk match, evidence scoping) sit on that path.
- **Boundary (IN)**:
  - Browser: `MappingCanvas.tsx` — ctrl-drag `onPointerDown/Move/Up` (:857–927), `finishSelection` (:465–491), hotkey handler `P`/`A`/`N`/`C` (:751–814), `openPrompt` (:558–569), `submitPrompt` (:660–697), `generateAt` (:699–732), `nodesAfterPatch`/`sectionsAfterPatch` (:101–132), `commit`.
  - `src/features/mapping/api.ts:4–42` `promptMappingPocSelection` (NDJSON reader).
  - `src/server/routes/mapping/routes.ts:32–43` (`/api/mapping/prompt`, NDJSON `progress` then `result`).
  - `application/mapping/selection/selectionService.ts` — `prepare` (:12–71), `run` (:72–74).
  - `application/mapping/selection/mappingPocSourceContext.ts:9–47`.
  - `infrastructure/mapping/agents/selection/agentRuntime.ts` — `promptDiagramSelection` (:216–297), `createMappingPocSession` (:73–214) incl. the `submit_diagram_patch` tool (:84–161), `disposeMappingPocSession` (:63–71), `FakeMappingAgentRuntime` (:304–351).
  - `domain/mapping/selection/mappingPocPrompt.ts` — `mappingPocPromptHunk` (:62–88), `renderMappingPocAgentSystemPrompt` (:90–104), `renderMappingPocEditPrompt` (:106–159), `validateReplacementLines` (:161–175), `generatedMappingPocResult` (:178–193), `applyMappingPocPromptPatch` (:195–229).
  - `domain/mapping/selection/mappingPocMappings.ts` `mappingPocElementMappingsAfterPatch`.
- **Boundary (OUT)**: The Pi SDK internals (`@earendil-works/pi-coding-agent`) — one node "Pi agent session". Core's `PiAgentRuntime` / `progressFor` — collapsed. The canvas save (D2) — shown only as the terminal "still unsaved" state.
- **Nodes / lifelines**: User → `MappingCanvas` → `promptMappingPocSelection` → route → `SelectionService` → `mappingPocSourceContextForSelection` (+ corpus provider) → `PiMappingAgentRuntime` → Pi session → `submit_diagram_patch` tool → domain patch functions.
- **Edges / relationships (ordered)**:
  1. Ctrl+drag hit-tests the scene (`hitTest(scene, scenePoint)`), sets `activeBoxId`, and normalizes a `MappingPocGridRect`; `finishSelection` selects the `MappingPocANode`s whose heads intersect the rect and reports "N mapped corpus ranges ready".
  2. `P` → `openPrompt` requires a rect, ≥1 selected node, **complete** source coverage (`hasCompleteSourceCoverage`), and not already generating; it retains the selection (creates a `SelectionRegion` display node) and sets phase `composing`.
  3. Submit → `submitPrompt` posts `{ ...projectContext, clientSessionId: "<page-session>-<uuid>", diagramAscii, diagramRevision, mappings, selection, instruction }`. **A fresh `clientSessionId` per request** (`:335`) so undo can restore earlier content without colliding with a server-side session.
  4. Route: `selection.prepare(body)` runs *before* headers are flushed, so validation errors are ordinary JSON errors; then headers flush as `application/x-ndjson` and progress events stream (`routes.ts:34–41`).
  5. `SelectionService.prepare` validates `clientSessionId` (`/^[A-Za-z0-9-]{8,120}$/`), `diagramAscii` ≤20000, non-negative integer revision, instruction ≤4000, positive-integer rect, `operation ∈ {edit, generate}`, and `validateMappingPocMappings(diagramAscii, mappings)` (:18–52). If any of `representationId/projectId/baseRevisionId` is present it loads the project catalog, rejects a foreign project, and throws **`ProjectDiagramConflict`** when the representation is archived or `currentRevisionId !== baseRevisionId` (:55–65); it then takes `projectEvidence` from **the saved revision** and `sourceRoot` from the project corpus.
  6. `PiMappingAgentRuntime.promptDiagramSelection`: single-flight guard `mappingPocPromptBusy` (:220); session lookup/creation keyed by `clientSessionId`, LRU-evicting at 12 sessions (:76–80); **staleness check** — stored `revision`/`ascii` must equal the request's, else "session is stale; reload" (:229–231).
  7. `mappingPocSourceContextForSelection` resolves selected mappings → evidence ranges → source lines: for a project revision it uses the snapshot's `originalLines`, otherwise it reads the working tree through the corpus provider (`mappingPocSourceContext.ts:22–27`); identity is checked via `sourceRangeId` (:26), line count must match exactly (:29–31), and total context is capped at 5000 lines (:46).
  8. Prompt rendering: **edit** → `renderMappingPocEditPrompt` with `>>` TARGET / `::` CONTEXT gutters, ±3 context rows, and a `MAPPED_CORPUS` block, all wrapped in collision-safe nonce tags (`collisionSafePromptNonce`, :56–61); **generate** → a JSON payload plus a different system prompt (`agentRuntime.ts:178`).
  9. Inner loop: agent calls `submit_diagram_patch`. The tool checks `selectionId` matches the pending request, then either `applyMappingPocPromptPatch` (revision equality + **exact** `expectedOldLines` match, no fuzzy matching, `validateReplacementLines`: 1–500 lines, ≤500 columns, printable 7-bit ASCII) or `generatedMappingPocResult` (mappings must reference evidence *inside* the selection, :185–189). **Rejection returns `terminate:false` with a corrective message so the agent can retry in the same turn; acceptance returns `terminate:true`** (`agentRuntime.ts:140–159`).
  10. On success, session state advances (`ascii`, `revision`, `mappings` via `mappingPocElementMappingsAfterPatch`) and `pending.submission` is returned; any thrown error disposes the whole client session (:287–289).
  11. Browser applies the result locally: new `CanvasDiagram` content + `layoutScene`, then either `mappingDocumentFromScene(nextScene, evidence)` (project documents) or the local `nodesAfterPatch`/`sectionsAfterPatch` shift (`submitPrompt`, :672–678); `commit()` pushes an undo snapshot. `generateAt` instead inserts a new `GridBox` via `insertGridDiagram` into the enclosing container — or the root when the drag started above/left of it (:705–723).
  12. Terminal state: **the document is dirty; nothing was persisted.** Only `POST /api/mapping/diagrams` (D2) makes it a revision.
- **Notes for the renderer**: Show step 9 as a self-loop on the Pi-session lifeline labelled "rejected → correct and resubmit". Put a vertical band over steps 5–7 labelled "evidence comes from the saved revision snapshot, not the working tree". Mark the boundary between "server response" and "editor proposal" with a bold dashed line labelled "unsaved".

---

### MAP-7 — Local chat: context freezing and conversation lifecycle
- **Provenance**: Mapping slice, D8. Placement Z4 Mapping (R3,C7).

- **Kind**: sequence diagram + thread state machine
- **Question it answers**: What source evidence is frozen into a conversation when the user presses **A**, how follow-up turns reuse it, and how a thread moves through pending / answered / error / interrupted-by-reload states.
- **Boundary (IN)**:
  - Browser: `MappingCanvas.tsx` — `openAsk` (:571–577), `submitAsk` (:579–614), `requestLocalReply` (:435–463), `submitLocalFollowUp` (:616–624), `retryLocalReply` (:626–632), `changeThreadVerbosity` (:634–636), `setChatThreads` (:263–273), `replyControllers` cleanup (:274–278), the bubble/pane rendering (:1198–1269).
  - `src/features/mapping/chat/LocalChatConvo.tsx`, `LocalChatVerbosityToggle.tsx`.
  - `src/features/mapping/api.ts:43–82` `localChatResponder` (NDJSON: `context`, `progress`, `result`, `error`).
  - `src/server/routes/mapping/chat/localChatRoutes.ts:6–28`.
  - `application/mapping/chat/chatService.ts:12–37`, `application/mapping/chat/agent.ts`.
  - `domain/mapping/chat/localChat.ts` (`LocalChatThread`, `LocalChatContext`, `LocalChatSelection`, `LocalChatReplyRequest`, `LocalChatResponder`, `isLocalChatSubmitHotkey`).
  - `domain/mapping/chat/localChatPrompt.ts` (`validateLocalChatRequest:23–67`, `renderLocalChatPrompt:11–21`, `conditionChatQuery`, `LOW_CHAT_PREFIX`).
  - `domain/mapping/chat/conversationPaneLayout.ts` `layoutConversationPane`.
  - `infrastructure/mapping/agents/chat/localChatRuntime.ts` (`CodexLocalChatRuntime`, `FakeLocalChatRuntime`).
  - `application/mapping/selection/mappingPocSourceContext.ts` (shared with D6).
- **Boundary (OUT)**: The Codex CLI itself — one node "codex exec (child process)". The workspace codec's conversation rules (D5, referenced by one arrow). `DisplayState` ownership (D9).
- **Nodes / lifelines**: User → `MappingCanvas.submitAsk` → `ConversationPane` display node → `localChatResponder` → `POST /api/mapping/chat` → `handleLocalChat` → `LocalChatService.prepare` → `mappingPocSourceContextForSelection` → `CodexLocalChatRuntime.reply` → codex child process.
- **Edges / relationships (ordered)**:
  1. `A` on a selection opens the ask form (works on **unmapped** text too — no source-coverage requirement, unlike `P`). Submit builds a `LocalChatThread` whose `context` is a `structuredClone` of `{ ...projectContext, contentId, diagramAscii, diagramRevision, mappings }` and whose `selection` records `boxId`, `nodeIds`, `rect`, `summary` (`MappingCanvas.tsx:245–254`). It is immediately added as a `ConversationPane` **child of the retained selection node** with a `canvasAnchor` at the selection's top-right (`:257–265`) — there is no placement step.
  2. `requestLocalReply` registers an `AbortController` keyed by thread id and refuses to start if one exists; a thread without `context` is short-circuited into an error state.
  3. `localChatResponder.reply` posts the whole `LocalChatReplyRequest` (`threadId`, `context`, `verbosity`, `selection`, `history`) and reads NDJSON.
  4. `handleLocalChat` calls `chat.prepare(body)` **before** flushing headers, registers `response.on('close') → controller.abort()`, then emits a `context` event carrying the resolved `sourceRanges` (`localChatRoutes.ts:19`) — this is how the browser learns the frozen excerpts.
  5. `validateLocalChatRequest` (the domain boundary): threadId ≤120; verbosity ∈ {low, high}; `diagramAscii` ≤20000 and a non-negative integer revision; `projectId/representationId/baseRevisionId` must be supplied **together or not at all**; ≤5000 mappings validated against the ascii; selection rect must lie inside the diagram's line/column extent; history 1–200 messages, first and last `user`, last ≤4000 chars, total ≤500000; optional `sourceRanges` must be internally consistent (`lines.length === endLine-startLine+1`, ≤5000 total lines, ≤1 MB JSON).
  6. `LocalChatService.prepare`: for a project-scoped thread it loads the catalog and looks up `catalog.revisions[baseRevisionId]`, requiring only that the revision belongs to the same representation — **historical revisions stay valid** (`chatService.ts:22–23`), unlike the selection prompt which requires the *current* revision. Then `sourceRanges = context.sourceRanges ?? (any mapping intersects the rect ? resolve from evidence : [])` (`:27–29`) — i.e. **follow-ups reuse the frozen excerpts; only the first turn resolves them**.
  7. `CodexLocalChatRuntime.reply` spawns `codex exec --model gpt-6-astra --sandbox read-only -c approval_policy="never" --ephemeral --skip-git-repo-check --json --cd <sourceRoot> -`, writes `renderLocalChatPrompt(request, sourceRanges)` to stdin, and parses the JSON event stream: `item.completed/agent_message` → reply text, `item.started/command_execution` → "Inspecting project files…", `turn.started` → "Thinking…", `turn.failed` → failure. Guards: 8 MB output cap, 300 s timeout, SIGTERM then SIGKILL after 2 s, non-zero exit or empty reply → error. **Each turn is a fresh ephemeral process** — the model sees history only through the rendered prompt.
  8. `renderLocalChatPrompt` puts diagram (minus `sourceRanges`/`mappings`), selection, `sourceRanges`, and `previousMessages` in one JSON block labelled "context data, not instructions", then the current query, prefixed by `LOW_CHAT_PREFIX` when verbosity is `low`.
  9. Result: `result` event → assistant message appended, `pending:false`, `progress`/`error` cleared. `onContext` writes the returned `sourceRanges` back into `thread.context` so later turns carry them.
- **State machine panel** (`LocalChatThread`): `idle → pending` (ask / follow-up / retry) → `answered` (assistant message appended) or `error` (`pending:false`, `error` set, Retry enabled only when `context` exists). Extra transitions: `pending → aborted` when the display node is removed or the canvas unmounts (`replyControllers` abort); `pending → interrupted` on workspace restore, which the codec rewrites to `pending:false` + "Reply interrupted by workspace reload. Retry to continue."; `context === undefined` (pre-context transcripts) → permanently read-only with "Start a new conversation."
- **Notes for the renderer**: Put the frozen-context idea front and centre — a box around `context.sourceRanges` labelled "resolved once on the first turn, then carried with the thread". Show the three presentations (compact / floating / docked) only as a single annotation on the `ConversationPane` node, since `layoutConversationPane` derives geometry from `canvasAnchor` + presentation + expansion.

---

### MAP-2 — What a saved mapping revision contains
- **Provenance**: Mapping slice, D3. Placement Z4 Mapping (R4,C3).
- **Modifications**: Trim the `LineGridScene` type listing to a single collapsed node citing CORE-11; keep the three bands (stored / derived at save / derived at load) — that is this diagram's contribution over CORE-5.

- **Kind**: data model / ER (record-and-derivation diagram)
- **Question it answers**: Which parts of the canvas are stored in a revision (boxes, groups, placement, collapsed state, per-box ASCII, local mappings, source evidence snapshots) and which are *derived* at save time (composed ASCII, absolute mappings) versus derived at load time (`MappingGridDocument.nodes`).
- **Boundary (IN)**:
  - `domain/core/diagrams/lineGrid.ts` types `LineGridScene`, `CanvasDiagram`, `GridBox` (diagram | container), `layout.collisionPolicy`, `collapsedContentId`, `minimumSize`, plus `resolveScene` / `flattenGrid` / `composeScene` / `measureContent` as derivation functions.
  - `domain/core/records/domain.ts` `DiagramElementMapping` (`id`, `entityId`, `sourceRangeIndex`, `sourceRangeId?`, `line`, `startColumn`, `endColumn`).
  - `domain/core/representations/projectCatalog.ts` `ProjectRepresentationRecord`, `ProjectRepresentationRevisionRecord`, `ProjectRepresentationEvidenceRecord`, `ProjectRepresentationMappingRecord`.
  - `domain/core/diagrams/projectDiagramCanvas.ts` — `ProjectDiagramContent`, `SaveProjectDiagramInput`, `sceneFromRevision:32–41`, `singleDiagramScene:21–30`, `projectCanvasSnapshot:44–84`.
  - `domain/mapping/workspace/mappingGrid.ts` `MappingGridDocument` (`scene`, `evidence`, `nodes`, `sections`), `initialMappingGrid`, `insertGridDiagram:52–62`, `generatedGridNodes:39–50`.
  - `domain/mapping/workspace/mappingDocument.ts` `mappingDocumentFromScene:4–15`.
  - `domain/mapping/selection/mappingPoc.ts` `MappingPocANode` (label/head/extent/sourceRanges/selectableBecause).
- **Boundary (OUT)**: The catalog's projections/compaction-projection records (Core; referenced only as "projection catalog" in D9). Studio promotion. The LineGrid layout algorithm itself (`layoutScene`) — one node, not expanded.
- **Nodes**:
  - `ProjectRepresentationRecord` — id, name, status, `currentRevisionId`, ordered `revisionIds`.
  - `ProjectRepresentationRevisionRecord` — the immutable unit.
  - `content: {kind:'mapping-canvas', scene}` — the authoritative stored canvas.
  - `content: {kind:'ascii'}` / bare `ascii` — the legacy shape.
  - `LineGridScene` — `contents` map + `root` box.
  - `CanvasDiagram` — `id`, `revision`, `ascii`, `mappings[]` (per-box, diagram-local coordinates).
  - `GridBox(diagram)` — `position{column,row}` relative to parent, `collapsed`, `contentId`, `collapsedContentId`, optional `minimumSize`.
  - `GridBox(container)` — children, `layout{collisionPolicy:'push-right', gap}`, `collapsed`, `collapsedContentId` (a group).
  - `DiagramElementMapping` — box-local mapping row/columns → `entityId` + `sourceRangeIndex`.
  - `evidence: Record<entityId, ProjectRepresentationEvidenceRecord>` — the **saved source snapshot** (label, `sourceRanges[]` with `path`, `startLine`, `endLine`, `id`, and `originalLines`).
  - Derived-at-save: `ascii` (`composeScene`), `asciiSha256`, `mappings[]` (`ProjectRepresentationMappingRecord`, scene-absolute `line/startColumn/endColumn`, `id = "<boxId>:<mappingId>"`, `sourceRangeId` resolved from evidence).
  - Derived-at-load: `MappingGridDocument.nodes` (`Record<contentId, MappingPocANode[]>`), `sections`.
- **Edges / relationships**:
  - representation `1 —— currentRevisionId ——> 1` revision; `1 —— revisionIds ——> N` revisions (append-only history).
  - revision `contains` `content.scene`; revision `contains` `evidence`; revision `contains` derived `ascii` + `mappings`.
  - scene `contents: id → CanvasDiagram`; scene `root: GridBox`; container `children: GridBox[]` (recursive; boxes reference `contentId` and `collapsedContentId` into `contents`).
  - `CanvasDiagram.mappings[i].entityId` → `evidence[entityId]`; `.sourceRangeIndex` → `evidence[...].sourceRanges[i]` (validated at `projectDiagramCanvas.ts:67–70` — "canvas mapping references unknown project evidence").
  - `projectCanvasSnapshot` reads scene+evidence and **emits** `ascii` and absolute `mappings` — label the edge "derived, never an edit target"; absolute line/column = `node.bounds.row/column + local` (`:80–81`).
  - `sceneFromRevision` reads a revision and **returns** either the stored scene or a synthesized single-diagram scene from legacy `ascii`+`mappings` (`:32–41`) — the legacy-compat edge.
  - `mappingDocumentFromScene(scene, evidence)` **produces** `MappingGridDocument.nodes` — per-content selectable `MappingPocANode`s with `id = "<contentId>:<mappingId>"`, label from evidence, `sourceRanges` = the one resolved range.
  - `insertGridDiagram` **adds** a `CanvasDiagram` + an auto-generated `"<id>-summary"` collapsed content + a child `GridBox`, then calls `layoutScene(scene, box.id)`.
- **Notes for the renderer**: Split the canvas into three bands — **stored in the revision** (scene, evidence), **derived at save** (composed ASCII, absolute mappings), **derived at load** (MappingGridDocument.nodes/sections). Use a dashed border for derived bands. Show the legacy `kind:'ascii'` path as a thin side branch.

---

### MAP-4 — Workspace snapshot codec
- **Provenance**: Mapping slice, D5. Placement Z4 Mapping (R4,C7).

- **Kind**: data-flow pipeline with decision/normalization steps (format boundary)
- **Question it answers**: What `mappingWorkspaceCodec` checks before a workspace snapshot may be written or restored, what v1/v2 snapshots are migrated into, and which runtime states are deliberately rewritten on restore rather than resumed.
- **Boundary (IN)**: `domain/mapping/workspace/mappingWorkspaceCodec.ts` in full (`deserializeWorkspace:44–203`, `serializeWorkspace:204–207`) and its helpers `check/object/string/id/number/strings/rect/ranges/scene/geometry` (:9–42). Its callers: `src/features/mapping/workspace/mappingWorkspaceRepository.ts` (browser, both directions), `infrastructure/mapping/persistence/workspace/mappingWorkspaceStore.ts:11,17,19` (server, both directions), `src/features/mapping/MappingPage.tsx:102,108` (Import/Export). Cross-checks it calls: `validateMappingPocMappings` (`domain/core/diagrams/diagramMappings`), `resolveScene`/`flattenGrid` (`domain/core/diagrams/lineGrid`), `isRepositoryFilePath` (`domain/core/source/sourceNavigation`), `layoutConversationPane`, `layoutProjectedPanes`.
- **Boundary (OUT)**: The display node semantics themselves (D4/D9). The store's atomic-write mechanics (one node "MappingWorkspaceStore atomic write").
- **Nodes** (pipeline stages, in execution order):
  1. **Parse / clone** — string → `JSON.parse`, object → `structuredClone` (:45).
  2. **Envelope check** — `schemaVersion ∈ {1,2,3}`, `projectId` is a safe id, ≤100 documents, no duplicate `representationId` (:47–52).
  3. **Per-document scene check** — both `document.scene` **and** `JSON.parse(savedScene)` go through `scene()` (:53–56): ≤1000 contents, content id matches key, `validateMappingPocMappings(ascii, mappings)`, ≤2000 boxes, depth <100, `collisionPolicy === 'push-right'`, and `resolveScene` is run **twice** — once as stored and once with every box force-expanded (:35), so collapsed boxes cannot hide an invalid layout.
  4. **Nodes/sections check** — mapped node heads and section line numbers (:57–64).
  5. **Display tree check** — ≤2000 nodes, `node.id === key`, expansion ∈ {expanded, collapsed}, `activeChildId` must be an owned child (:65–72).
  6. **Kind-specific payload checks** — `selection` (rect, sourceBoxId/ContentId, sourceAscii, displayMode ∈ {stacked, chained}); `projection` with `call-tree` (result rows, coverage, the five id arrays) or `compaction`/`source-code` (files with `sourceFile`, `sourceSha256`, `ascii`, `rows[].sourceRanges`); `source-code` extra rules — `projectId` must equal the workspace's project (:94), `isRepositoryFilePath(sourceFile)` (:96), **v1/v2 only**: the file must be one of the projected compactions (:97) — this is the v3 relaxation; `showCompactions` boolean; `rangeIndex ≥ 0`; non-negative `scroll`; `conversation` (presentation, thread id === node id, selection rect, message roles, verbosity default `'low'`, frozen `context` with `validateMappingPocMappings` and `sourceRanges` whose `lines.length === endLine-startLine+1`); `detail` (title, ascii).
  7. **Restore normalization** (the important behavioural step): conversation without `context` → set a "no source context, start a new conversation" error (:131–134); `pending && context` → "Reply interrupted by workspace reload. Retry to continue." (:135); `progress` deleted, `pending = false` (:136–137); control surfaces with `promptPhase === 'generating'` → `'error'` + "Operation interrupted by workspace reload; review before retrying." (:192).
  8. **v1 migration** — every node gets `displayGeometry()`; `detail` x/y → `position` + `placement:'manual'`; `conversation.thread.anchor` → `canvasAnchor`; `selection` geometry seeded from `flattenGrid(resolveScene(scene))` at 8×18 px per cell (:140–154); then conversations are re-laid-out with `layoutConversationPane(…, 1280×720)` and selection roots with `layoutProjectedPanes` (:171–180).
  9. **Geometry check** — finite coordinates < 1e8, positive bounds, `coordinateSpace` must be `'viewport'` **iff** the node is an expanded docked conversation, else `'canvas'` (:156–163).
  10. **Ownership graph check** — DFS from `rootIds`, depth <100, no cycles, no duplicate ownership, and `seen.size === node count` → "unowned node" (:165–170).
  11. **Controls check** — `surfaces` must contain `'draft'`; every other surface key must be an existing `selection` node; enum checks for presentation/operation/phase; `retainedSelectionId` must be a selection node **with** a surface; `activeThreadId` must be a conversation (:181–197).
  12. **Viewport check** — `0.25 ≤ scale ≤ 4` (:198).
  13. **Stamp** `schemaVersion = 3` and return (:201–202).
- **Edges / relationships**: Linear pipeline 1→13 with `check()` throwing `Invalid workspace: <reason>` out of any stage. Fan-in edges: browser `load()`/`save()`, server `MappingWorkspaceStore.load/save`, Import/Export — all four pass through the *same* function; `serializeWorkspace` = `JSON.stringify(deserializeWorkspace(value))`, so **saving also normalizes** (the comment at :205 — "never live state").
- **Notes for the renderer**: Lay stages top-to-bottom; branch stage 8 (v1 migration) off to the side with a merge back before stage 9. Highlight stage 7 in a distinct colour — those are the "interrupted work is not resumed, it is marked" rules. Put the four callers as a fan-in at the top and the `check()` failure exit as a single side arrow.

---


## Plane Z5 — Core

### CORE-13 — Evidence to source: reference buffer and source viewer
- **Provenance**: Shared-browser slice, D7. Placement Z5 Core (R1,C5).

- **Kind**: data-flow pipeline with a reference state machine
- **Question it answers**: How does a selected piece of diagram text become a durable reference, a clipboard path, a prompt token, or a highlighted, syntax-coloured, LSP-navigable source range?
- **Boundary (IN)**:
  - `src/shared/references/RefBufferContext.tsx` — `RefBufferProvider`, `RefBufferApi`, `useRefBuffer` (reducer over `reduceRefBuffer`)
  - `src/shared/references/RefBufferTray.tsx` — the four output actions and `display call-graph`
  - `src/shared/references/refOutputSinks.ts` — `OutputSink<T>`, `ClipboardSink`, `WindowReferenceSink`, `ReferenceEnvelope` (`schemaVersion: 2`), `REFERENCE_ENVELOPE_EVENT = "new-diagram:reference-buffer"`, `createReferenceEnvelope`
  - `src/shared/source/CodeEntitiesPanel.tsx` — entity list, `CodeEntityReveal`, `markdownAnchor` (`:93-97`), the `TerminalMarkdownView` vs `SourceCodeView` branch (`:349-375`), `CONTEXT_STORAGE_KEY`/context-percent clamping
  - `src/shared/source/SourceCodeView.tsx` — `LANGUAGE_BY_EXTENSION`, `tokenizeSource` + `tokenCache` (limit 40), `SHIKI_THEME = "dark-plus"`, `collapsedSections`, `formatCollapsedCallGraph`, `GraphNodeSource`, `SourceCodeContent` (chunking at `SOURCE_CHUNK_ROWS = 80`, `content-visibility`/`contain-intrinsic-size`), the reveal/scroll `useLayoutEffect` (`:289-320`), the definition handlers (`:483-494`)
  - `src/shared/source/sourceDomPosition.ts` — `sourcePositionAtNode`, `sourcePositionAtPoint`, `selectSourceRange`
  - `src/shared/source/sourceScrollState.ts` — `SourceScrollState` (`read`/`connect`/`write`)
  - `src/shared/source/FileExplorerPanel.tsx` and `src/shared/source/RepositoryFileExplorer.tsx` — the two directory browsers and their differing caching strategies
  - `src/shared/call-graph/CallGraphFocusTree.tsx` — `flattenVisibleCallGraph`, the focus tree
  - `src/shared/http/api.ts` — `fetchSourceSnippet`, `fetchProjectSourceFile`, `fetchProjectDirectory`, `fetchRepositoryDirectory`, `fetchSourceDefinitions`, `fetchCallGraphFocus`, `fetchMappedArtifactBundle`
  - Domain terminal nodes: `domain/core/references/referenceResolver.ts#resolveReference`/`resolveReferences`/`ReferenceResolutionContext`, `refBuffer.ts#reduceRefBuffer`/`referenceIdentityKey`, `refFormatters.ts#formatReferences`/`formatDiagramReferenceClipboard`/`displayTextForReference`, `source/callGraphFocus.ts#createCallGraphFocusRequest`, `source/sourceNavigation.ts#SourcePosition`/`SourceDefinitions`/`supportsDefinitions`, `source/fileTree.ts#buildFileTree`/`diagramFileFilter`
  - Consumer shown as terminal node: `src/features/mapping/source-pane/SourceCodePane.tsx:38-96` (the only caller of `fetchSourceDefinitions`)
- **Boundary (OUT)**: the server's LSP implementation (`infrastructure/core/language-services/**`, collapsed to one node); the shape of `CodeEntityRecord`/`SourceRange` beyond the fields used; Markdown rendering internals (D8).
- **Nodes**: `ReferenceIdentity` → `RefBufferState { scopeKey, entries, diagramSelections }` → `resolveReferences` → `{resolved, unresolved}` → four sinks (`ClipboardSink`, prompt-token insertion callback, `WindowReferenceSink` CustomEvent, `createCallGraphFocusRequest` → `POST /api/core/call-graph-focus` → `CallGraphFocusTree`); and the source branch `CodeEntitiesPanel` → `fetchSourceSnippet` → `SourceSnippet {path, startLine, lines[]}` → (`markdownAnchor`?) `TerminalMarkdownView` : `SourceCodeView` → `tokenizeSource` (shiki) → rows → DOM; plus the navigation branch `Ctrl/Cmd-click | F12` → `sourcePositionAtPoint`/`sourcePositionAtNode` → `fetchSourceDefinitions` → `SourceDefinitions` → `selectSourceRange`.
- **Edges / relationships**:
  - `RefBufferProvider` is mounted once, at `src/main.tsx:10`, **above** `App` — so the buffer outlives page switches; `useRefBuffer` throws outside it
  - `RefBufferApi` commands (`setScope`, `add`, `remove`, `clear`, `replace`, `contains`) all dispatch into the pure `reduceRefBuffer`; `contains` is memoised over a `Set` of `referenceIdentityKey`
  - `RefBufferTray` derives `resolution = resolveReferences(buffer.entries, resolutionContext)` and a separate `previewResolution` for the entries currently under the drag rectangle, with committed entries filtered out (`:42-55`)
  - all four output buttons are disabled when `resolution.unresolved.length > 0 || resolution.resolved.length === 0` (`:67`) — resolution failure blocks every sink
  - `copy paths` → `formatDiagramReferenceClipboard(buffer.diagramSelections, resolved)` → `ClipboardSink` → `navigator.clipboard.writeText`
  - `insert tokens` → `formatReferences(resolved, "prompt-token")` → `props.onInsertTokens` (a feature callback, no I/O)
  - `send` → `createReferenceEnvelope({schemaVersion:2, projectId, diagramSetId, sourceArtifactId?, references})` → `WindowReferenceSink` → `window.dispatchEvent(new CustomEvent("new-diagram:reference-buffer"))` — the versioned internal integration point; the sink is injectable via `props.internalSink`
  - `display call-graph` → `createCallGraphFocusRequest({diagramSetId, sourceDiagram, references})` → `props.onOpenCallGraphFocus` → `fetchCallGraphFocus` → `CallGraphFocusResult` → `flattenVisibleCallGraph(roots, expanded)` → tree rows. Only references whose key is in `callGraphFocusReferenceKeys` (i.e. actually mapped on the active Diagram) are eligible (`:68-71`)
  - `resolveReference` (domain) enforces **origin matching** (`sameOrigin`, projectId + diagramSetId + optional codeEntitiesSetId) and returns `null` when a requested `sourceRangeId`/`sourceRangeIndex` does not exist — this is what makes imported/foreign references show as `unavailable: kind:targetId`
  - `CodeEntitiesPanel` → `fetchSourceSnippet(setId, entityId, rangeIndex)` → `GET /api/core/source` → `SourceSnippet`
  - branch: `contentPresentation.markdownRendering === "terminal" && isMarkdownDocumentPath(preview.path)` → `TerminalMarkdownView`, else `SourceCodeView` (`CodeEntitiesPanel.tsx:93-97`, `:349-375`). `ContentPresentation` (`domain/core/profiles/domainProfile.ts:64-69`: `syntaxHighlighting`, `markdownRendering`, `wrap`, `sourceCompaction`) comes from the domain profile chosen by `NEW_DIAGRAM_DOMAIN` — connect this back to D1
  - `SourceCodeView` → dynamic `import("shiki")` inside `tokenizeSource`, keyed `theme\0language\0source`, memoised in a module-level `Map` capped at 40 with FIFO eviction and self-removal on rejection (`:90-114`); highlighting is skipped entirely when `presentation.syntaxHighlighting === "plain"` (`:273`)
  - compaction folds: `range.compactedSource.sections` filtered to `kind === "collapsed-comment"` fully inside the preview (`:118-126`) → an unexpanded section renders a `[+]` fold placeholder plus an ASCII call graph, where each `section.nodes[].graphLine` becomes its own independently expandable `[+]` button revealing exactly `node.startLine..node.endLine` via `GraphNodeSource` (`:389-425`). Two independent expansion sets: `expandedSections` (whole range) and `expandedGraphNodes` (per node).
  - reveal/scroll: `useLayoutEffect` (`:289-320`) restores `scrollState.read() ?? initialScrollPosition` when the source identity is unchanged, else scrolls `[data-line="<target>"]` (falling back to the containing folded section's start line) to 20% from the top, accumulating `offsetTop` through offset parents
  - `scrollState.connect(() => viewer.getClientRects().length ? {top,left} : undefined)` (`:326-327`) — a hidden pane has no CSS box and would otherwise report 0/0; the same guard appears in `onScroll` (`:497`)
  - perf: `SourceCodeContent` chunks rows into groups of 80 when `deferOffscreen` and >240 rows, measures each chunk once with `contentVisibility:"visible"`, then pins `containIntrinsicSize` and switches to `contentVisibility:"auto"`, re-measuring on width change (`:192-229`)
  - definitions: `Ctrl/Cmd-click` → `sourcePositionAtPoint` (rejects hits outside `code[data-source-text]`, then `document.caretRangeFromPoint`) ; `F12` → `sourcePositionAtNode` from the current selection. Both produce `{line: Number(row.dataset.line) - 1, character: <prefix length within the code element>}` — i.e. **0-based LSP coordinates from 1-based DOM line numbers**. Handlers only attach when `onGoToDefinition` is supplied (`data-definitions` attribute).
  - `SourceCodePane` (feature) → `fetchSourceDefinitions(projectId, path, position, sourceSha256, signal)` → `POST /api/core/project/definitions`; the `sourceSha256` from `fetchProjectSourceFile` is the staleness guard, and a disabled LSP returns `503 {code:'LSP_DISABLED'}` (see D1/D3)
  - `selectSourceRange(viewer, line, start, end)` walks text nodes to place a real DOM `Range`, sets the window selection, and adjusts only `scrollLeft` so the surrounding canvas does not move (`sourceDomPosition.ts:22-39`); it is re-applied after tokenization replaces text nodes (`SourceCodeView.tsx:331-336`)
  - the two explorers differ deliberately: `RepositoryFileExplorer` uses a **module-level** promise cache keyed `[projectId, directory]` capped at 256 with a manual "Refresh files" invalidation and roving-focus keyboard nav; `FileExplorerPanel` keeps per-instance listings with an `AbortController` per directory and a `requestGeneration` counter that invalidates in-flight requests when the active set changes, and layers `diagramFileFilter`/`buildFileTree` on top to mark unavailable and foreign-project paths
- **Notes for the renderer**: two columns. Left column = the reference lifecycle (identity → buffer → resolution → four sinks), drawn as a fan-out with the disabled-when-unresolved gate. Right column = the source rendering pipeline (snippet → branch → tokenize → rows → DOM), with the definition round-trip drawn as a loop that leaves the DOM, crosses to the server, and returns into `selectSourceRange`. Call out the coordinate convention change (1-based DOM `data-line` → 0-based `SourcePosition`) on the edge where it happens.

---

### CORE-12 — The shared ASCII diagram surface (DiagramView)
- **Provenance**: Shared-browser slice, D4. Placement Z5 Core (R1,C6).

- **Kind**: data-flow pipeline with an embedded mode state machine
- **Question it answers**: How does one ASCII string plus a persisted evidence map become clickable, highlightable, rectangle-selectable text, and how are pixel coordinates turned back into `{line, column}`?
- **Boundary (IN)**:
  - `src/shared/diagrams/DiagramView.tsx` — the whole component, especially `activeAsciiSha256` (`:125`), `currentCodeEntityMap` (`:126-130`), `representationIndex` (`:132-146`), `spatialProgressByElementId` (`:151-162`), `liveMappings`/`liveReferences`/`overlayReferences` (`:163-195`), `gridMode` (`:197-203`), `completeSelection` (`:224-245`)
  - `src/shared/diagrams/AsciiSelectionGrid.tsx` — `cellMetrics` measurement (`:155-180`), `pointAtClient` (`:207-223`), `onPointerDown`/`onPointerMove`/`finishRectangle`/`onClickCapture` (`:225-287`), `hiddenLines`/`collapsedNodeIds` (`:101-111`), per-line mapping splicing (`:371-442`), the `.ascii-cell-probe` element (`:300`)
  - `src/shared/diagrams/DiagramSelectionOverlay.tsx`, `src/shared/diagrams/DiagramPartialDiffOverlay.tsx` (incl. `diagramPixelRect`)
  - `src/shared/diagrams/DraggableDiagramCanvas.tsx` (as one node here; its gesture machine is a note)
  - `src/shared/representations/representationPresentation.ts` — `presentationForRepresentation`, the `tree`/`diagram` presentation table
  - Domain collaborators (terminal nodes, not expanded): `domain/core/diagrams/asciiSha256.ts#asciiSha256`, `domain/core/diagrams/asciiTree.ts#parseAsciiTree`/`hiddenAsciiTreeLines`, `domain/core/diagrams/diagramSelection.ts#normalizeDiagramSelection`/`mappingsForSelection`/`asciiForSelection`, `domain/core/representations/representationIndex.ts#buildRepresentationIndex`/`representationElementIdForMapping`, `domain/core/references/refBuffer.ts#referencesFromMappings`/`referenceIdentityKey`, `domain/core/references/referenceResolver.ts#resolveReference`, `domain/core/agent-work/agentWork.ts#validateSpatialProgressState`
  - `src/shared/references/RefBufferContext.tsx#useRefBuffer` and `RefBufferTray` (as the selection sink)
- **Boundary (OUT)**: the persistence of mappings/highlights (server side, D3 and the route slices); the Mapping feature's own canvas (that's D5's scene model); `DiagramPartialDiffOverlay`'s modal internals.
- **Nodes**: `DiagramRecord|DiagramComponentRecord.ascii` → `asciiSha256` → `revision guard` → `buildRepresentationIndex` → `representationIndex (tree | diagram)` → `presentationForRepresentation` → `AsciiSelectionGrid` → `<pre> line spans + mapped-element buttons` → `DiagramSelectionOverlay` / `DiagramPartialDiffOverlay`; parallel input branch `codeEntityMap.mappings` → `mappingsByLine`; parallel branch `spatialProgress[]` → `spatialProgressByElementId`; pointer branch `pointer event` → `pointAtClient` → `DiagramGridPoint` → `normalizeDiagramSelection` → `DiagramSelectionBounds` → `mappingsForSelection` → `referencesFromMappings` → `RefBuffer` / `onCapture`.
- **Edges / relationships**:
  - **Revision guard (the important invariant)**: `DiagramView.tsx:126-130` discards the persisted `codeEntityMap` whenever `props.editMode`, or `codeEntityMap.artifactId !== active.id`, or `codeEntityMap.asciiSha256 !== asciiSha256(active.ascii)`. Comment at `:123-124`: edit sessions mutate ASCII under the same artifact id, so stale evidence bounds must never be reused. Draw this as a gate on the mappings branch.
  - `buildRepresentationIndex({kind, revision:{artifactId, asciiSha256}, ascii, codeEntityMap})` (`:132-146`) — wrapped in try/catch, yields `undefined` on mismatch; `representationIndex.kind` selects tree vs diagram behaviour downstream
  - presentation table (`representationPresentation.ts:16-24`): `tree` → `controls.collapse:"gutter"`, `savedHighlight:"gutter"`; `diagram` → `collapse:"none"`, `savedHighlight:"gutter"`. This is the only thing that decides whether collapse chevrons render (`AsciiSelectionGrid.tsx:309-311`).
  - **Cell measurement**: a hidden `<span class="ascii-cell-probe">0000000000</span>` is measured and divided by 10 for cell width; line height comes from `getComputedStyle(pre).lineHeight` (`:159-170`); re-measured by `ResizeObserver` on the `<pre>` and on `window.resize`; `gridOriginRef` is invalidated on every measurement.
  - **Hit test**: `pointAtClient(clientX, clientY)` = `floor((y - originTop)/cellHeight)+1` and `floor((x - originLeft)/cellWidth)+1`, clamped to `[1, rawLines.length]` / `[1, columnCount]` (`:219-222`). Origin is cached in a ref and only refreshed on pointerdown/click (`refreshOrigin = true`) — a deliberate per-drag cache.
  - **Mode state machine** (`gridMode`, `DiagramView.tsx:197-203`): `read` ⇄ `capture` ⇄ `select-refs`, plus `marker` which pre-empts everything. Transitions: `capture component` button toggles `capturing`; `select refs` toggles `selectingRefs` (refused with status text when `codeEntityMap` is absent, `:317-321`); `props.markerMode` forces `marker`; `Escape` cancels an active rectangle first, then exits the mode (`AsciiSelectionGrid.tsx:188-203`); mode resets on `active.id` / `active.ascii` / `codeEntityMap.producedByRunId` change (`:110-115`) and on entering edit/marker mode (`:116-121`). In `read` mode a `Ctrl`/`Cmd`-drag produces a `select-refs` rectangle without entering the mode (`:229`).
  - **Drag**: pointerdown captures the pointer and sets `anchor`; pointermove coalesces through a single `requestAnimationFrame` with a `pendingPointRef` (`:242-258`); pointerup normalises `anchor→focus` and calls `onSelectionComplete(kind, bounds, {alt})`; `onClickCapture` swallows the synthetic click after a drag (`suppressClickRef`).
  - **Selection sink** (`DiagramView.tsx:224-245`): `kind==="capture"` → `props.onCapture(bounds)` (server-side component crop); `kind==="select-refs"` → `mappingsForSelection` → `referencesFromMappings(selected, codeEntities)` → `refBuffer.add(refs, { sourceArtifactId, ascii: asciiForSelection(ascii, bounds) })`.
  - **Live preview**: `liveSelection` → `liveMappings` → `liveReferences` → `resolveReference(...).selectableText.getSelectionText(identity)` → `overlayReferences` → `DiagramSelectionOverlay` (max 6 shown, `+n more`, placed left when `rect.x >= 180`).
  - **Per-line render** (`:371-442`): mappings for a line are sorted by `startColumn`, and each becomes a `<button class="mapped-element">` carrying `data-mapping-id`, `data-entity-id`, `data-reference-key`, `data-line`, `data-start-column`, `data-end-column`; unmapped runs stay plain text. Classes add `is-selection-preview` (in the live rect) and `is-buffered-ref` (already in the buffer).
  - **Collapse**: `collapsedNodeIds` (representation element ids) → `collapsedNodeLines` → `hiddenAsciiTreeLines(ascii, lines)` → `hiddenLines`, applied only in `read` mode; the gutter and the `<pre>` filter by the same set so rows stay aligned.
  - **Padding**: lines are right-padded to `columnCount` only while a rectangle is possible (`padRows = mode !== "read" || liveSelection !== null`, `:116-120`) so read mode keeps ragged text.
  - `DiagramView` → `DraggableDiagramCanvas` with `resetKey = ${active.id}:${asciiSha256}` and `enabled = canvasMode && gridMode === "read"` (`:426-430`) — pan/zoom and rectangle selection are mutually exclusive by construction.
- **Notes for the renderer**: left-to-right pipeline with three input rails (ascii, mappings, spatial progress) converging on `AsciiSelectionGrid`. Inset the four-state mode machine as a small box in the lower half, with `marker` drawn as an overriding state. Show the coordinate conversion as a labelled transform box (`pixels → cell (line, column)`) with the formula written out — it is the single least obvious mechanism here. Keep the domain functions as a shaded "pure domain" band along the bottom.

---

### CORE-14 — The pane system
- **Provenance**: Shared-browser slice, D6. Placement Z5 Core (R1,C7).
- **Modifications**: Caption: consumed only by Studio; Mapping's workspace model is MAP-4/MAP-8 in the same column.

- **Kind**: module/responsibility split + state-transition map
- **Question it answers**: Who owns pane layout state, which operations can change it, how does React subscribe, and how does a cross-pane "jump" get delivered to the right feature?
- **Boundary (IN)**:
  - `src/shared/panes/model.ts` — types `Pane`, `PaneTab`, `PaneLeaf`, `PaneSplit`, `PaneNode`, `PaneLayoutState`, `CreatePaneInput`, `SplitPaneOptions`; functions `definePane`, `emptyPaneLayout`, `createPaneLayout`, `parsePaneLayout`, `paneIds`, `addPane`, `removePane`, `focusPane`, `activatePaneTab`, `setPaneTabs`, `addPaneTab`, `closePaneTab`, `movePaneTab`, `resizePaneSplit`, `findPaneSplit`, `clampPaneRatio`, `clampPaneRatioToSizes`
  - `src/shared/panes/api.ts` — `PaneApi` (all 9 commands + `subscribe`/`getState`/`commit`)
  - `src/shared/panes/PaneWorkspace.tsx` — `PaneWorkspace`, `PaneFrame`, `SplitNode`, `usePaneApi`, `PaneApiContext`, `PaneTabView`, `PaneMinimumSize`, `minimumNodeSize`, `DIVIDER_SIZE = 9`
  - `src/shared/panes/navigation.ts` — `PaneNavigationApi`, `PaneJumpDestination`, `PaneJumpHistoryEntry`, `afterPaneRender`, `DEFAULT_HISTORY_LIMIT = 3`
  - `src/shared/panes/index.ts` (the public surface)
  - Mount point (terminal node): `src/features/studio/StudioPage.tsx#createStudioPaneState` (`:210-266`), `#createStudioPaneApi` (`:268-272`), the `PANE_LAYOUT_STORAGE_KEY` localStorage round-trip, and `src/App.test.ts` which asserts profile-driven explorer tabs
  - `src/shared/markdown/MarkdownSectionsPanel.tsx#mapJumpHistoryToSections` — the one shared consumer of jump history
- **Boundary (OUT)**: the concrete tab contents Studio registers (a collapsed "views: Record<tabId, PaneTabView>" node); the Mapping feature, which uses its own floating panes and does **not** use this system.
- **Nodes**: `PaneLayoutState` (root `PaneNode` tree + `panes` dictionary + `focusedPaneId`) · `PaneLeaf` · `PaneSplit` · pure transition functions · `PaneApi` (mutable holder + listener set) · `PaneWorkspace` (`useSyncExternalStore`) · `PaneFrame` · `SplitNode` · `PaneApiContext`/`usePaneApi` · `PaneNavigationApi` (handlers map, pending map, history) · `localStorage` · `StudioPage`.
- **Edges / relationships**:
  - Structure: `PaneLayoutState.root: PaneNode|null`; `PaneSplit{orientation, ratio, first, second}` is the only branch node; `PaneLeaf` holds only a `paneId` — panes themselves live in the flat `panes` dictionary (so tab identity is global, not per-subtree)
  - Global invariants enforced by the model: tab ids are unique across **all** panes (`addPane:236-240`, `addPaneTab:334-336`, `setPaneTabs:317-319` via `tabExistsOutsidePane`); pane ids are unique (`addPane:234`); `paneIds(root)` and `Object.keys(panes)` must agree (checked when parsing, `:170-172`)
  - Transitions to draw as a state map on `PaneLayoutState`:
    `addPane` (splits a target leaf into a `PaneSplit`; placement left/top puts the new pane first; focus moves to the new pane),
    `removePane` (collapses the split by returning the surviving child),
    `closePaneTab` → **`removePane` when the last tab closes** (`:351`),
    `movePaneTab` → cross-pane move that focuses the target and **removes the emptied source pane** (`:399`),
    `focusPane`, `activatePaneTab` (activating also focuses, `:304`), `setPaneTabs` (JSON-compare no-op guard, `:324`), `resizePaneSplit`
  - Ratio clamping: `clampPaneRatio` to `[0.1, 0.9]`; `clampPaneRatioToSizes(ratio, containerSize, firstMin, secondMin, divider=9)` derives min/max ratios from requested pixel minimums and degrades proportionally when both minimums cannot fit (`:85-90`)
  - `PaneApi.commit(next)` → identity check → replace `state` → notify every listener (`api.ts:35-39`); every command is a thin wrapper over the matching pure function
  - `PaneWorkspace` → `useSyncExternalStore(api.subscribe, api.getState, api.getState)` (`PaneWorkspace.tsx:248`) — the single React subscription for the whole tree
  - `PaneWorkspace` → `PaneApiContext.Provider` → `usePaneApi()` gives any descendant the same command surface (throws outside the workspace)
  - `SplitNode` → `minimumNodeSize` walk (sums along the matching orientation, maxes across the other, `:34-48`) → `constrainedRatio` → `ResizeObserver` + `useLayoutEffect` `enforceMinimumSizes` → `api.resizeSplit` — i.e. layout constraints feed **back** into the model
  - `SplitNode` divider: `role="separator"` with `aria-valuemin/max/now`, pointer capture drag (`updateFromPointer` computes ratio from the pointer offset minus half the divider), and keyboard Arrow/Home/End resizing (`:219-235`)
  - `PaneFrame` → renders `role="tablist"` buttons per `pane.tabs`, plus `views[activeTabId].content`, falling back to "No view is registered for this tab."; `activate(tab)` also calls `views[tab.id].onActivate?.()`
  - `PaneNavigationApi.jump(destination)` → `panes.activateTab` + `panes.focusPane` → record into history (deduped by `destination.key`, capped at 3) → `pending.set(destination.kind, destination)` → `schedule(deliver)` where the default schedule is **two nested `requestAnimationFrame`s** (`navigation.ts:24-26`) so the target pane has rendered before the feature's handler runs
  - `registerHandler(kind, handler)` → if a pending destination of that kind exists, deliver it after the same schedule (`:53-60`) — this is how a jump issued before its destination view mounted still lands
  - `deliver` drops a destination if a newer one for the same kind arrived (`:89`) — last-write-wins per kind
  - `StudioPage` → `parsePaneLayout(localStorage.getItem(...))` → `createStudioPaneState(profile, restored, storedPercent)` → `new PaneApi(...)` and `new PaneNavigationApi(paneApi)`; `createStudioPaneState` reconciles a restored layout against the active domain profile's explorer tabs via `setPaneTabs`/`addPane` (`StudioPage.tsx:215-241`)
- **Notes for the renderer**: three horizontal bands — *pure model* (bottom), *command/subscription* (middle: `PaneApi`, `PaneNavigationApi`), *React* (top: `PaneWorkspace`/`PaneFrame`/`SplitNode`/`usePaneApi`). Draw the feedback edge from `SplitNode`'s ResizeObserver back down into `resizePaneSplit` — it is the only upward-then-downward loop and is easy to miss. Put the jump lifecycle as a small numbered inset (jump → activate+focus → schedule(2×rAF) → deliver → feature handler animates), since the double-rAF is the non-obvious part.

---

### CORE-15 — Terminal Markdown: sandboxed iframe and its message protocol
- **Provenance**: Shared-browser slice, D8. Placement Z5 Core (R2,C7).

- **Kind**: sequence / protocol diagram across a trust boundary
- **Question it answers**: How is Markdown turned into a self-contained sandboxed document, and what is the exact two-way `postMessage` contract between the host app and that iframe?
- **Boundary (IN)**:
  - `src/shared/markdown/render.ts` — the module-level `MarkdownIt` (`html:false`, `linkify:false`, `breaks:false`, `typographer:false`), `renderTerminalMarkdownFragment`, `renderTerminalMarkdownDocument`, `parseTerminalMarkdownOutline`, `renderTerminalMarkdownErrorDocument`, the heading-marker renderer override, `decorateTerminalMarkdownSourceLines`, `splitDocument`, the inlined `<style>` shell
  - `src/shared/markdown/links.ts` — `decorateMarkdownLinks`, `decorateLink`, `resolveRepositoryReference`, `absoluteHttpUrl`, `terminalRepositoryLinkController` (the injected `<script>`), and the three message constants
  - `src/shared/markdown/toc.ts` — `decorateTerminalMarkdownHeadings`, `renderTerminalMarkdownToc`, `TerminalMarkdownHeading`/`Section`/`Outline`
  - `src/shared/markdown/sidenotes.ts` — `installTerminalSidenotes`, `extractTerminalSidenotes`, `renderTerminalSidenoteRail`, `terminalSidenoteController`
  - `src/shared/markdown/syntaxHighlight.ts` — `installTerminalCodeRenderer`, `highlightTerminalMarkdownFences`, `LANGUAGE_ALIASES`, `SHIKI_THEME = "catppuccin-mocha"`, `MAX_HIGHLIGHT_BYTES = 512KB`, `MAX_HIGHLIGHT_LINES = 10_000`, `CACHE_LIMIT = 80`
  - `src/shared/markdown/TerminalMarkdownView.tsx` — the `<iframe sandbox="allow-scripts allow-popups" srcDoc={...}>`, the `message` listener, `revealTargetLine`, `isMarkdownDocumentPath`
  - `src/shared/markdown/TerminalMarkdownContent.tsx` — the non-iframe fragment renderer (used by Mapping chat)
  - `src/shared/markdown/MarkdownSectionsPanel.tsx` — `buildMarkdownSectionTree`, `mapJumpHistoryToSections`, `MarkdownSectionsPanel`
  - Host callers as terminal nodes: `src/shared/source/CodeEntitiesPanel.tsx:351`, `src/shared/plans/PlanPreview.tsx`, `src/features/mapping/chat/LocalChatConvo.tsx` (via `TerminalMarkdownContent`), `src/features/studio/StudioPage.tsx` (consumes `TerminalMarkdownOutline` + `MarkdownSectionsPanel`)
- **Boundary (OUT)**: the CSS in the document shell (one collapsed node); `markdown-it` and `shiki` internals; the pane system (D6) beyond the `PaneJumpHistoryEntry` type that `mapJumpHistoryToSections` consumes.
- **Nodes / lanes**: `host React (TerminalMarkdownView)` · `render.ts pipeline` · `shiki (dynamic import)` · `iframe document (srcDoc)` · `injected controller script` · `MarkdownSectionsPanel`.
- **Edges / relationships (ordered)**:
  1. `TerminalMarkdownView` effect → `parseTerminalMarkdownOutline(source)` → `props.onOutlineChange({path, ...outline})` (best-effort; failures are swallowed because the renderer owns the visible error, `:28-30`)
  2. → `renderTerminalMarkdownDocument(source, path)`; on rejection → `renderTerminalMarkdownErrorDocument(message)` so a broken document still renders
  3. pipeline order inside `renderTerminalMarkdownFragment`: `parse` → `highlightTerminalMarkdownFences` (async, per-fence, `Promise.all`) → `decorateTerminalMarkdownSourceLines(tokens, offset)` → `decorateTerminalMarkdownHeadings` → `decorateMarkdownLinks(tokens, documentPath)` → `render`. Draw this as a strict five-stage chain; each stage mutates tokens in place.
  4. `highlightTerminalMarkdownFences` → `import("shiki").codeToHtml` under the `catppuccin-mocha` theme, skipped for unknown languages or content over 512KB / 10 000 lines, cached in a module `Map` capped at 80; the result is stashed on `token.meta.terminalHighlightedHtml` and picked up by the fence renderer installed by `installTerminalCodeRenderer`
  5. `decorateLink` classifies every href three ways: absolute http(s) → `target=_blank rel="noopener noreferrer" class="external-ref"`; resolvable repository-relative path → `href="#repository:<encoded>"` + `data-repository-path` + `class="repository-ref"`; anything else → `href="#" aria-disabled="true"`. `resolveRepositoryReference` refuses NUL, backslashes, absolute paths, and any `scheme:` prefix, and resolves `.`/`..` against the document's directory, refusing to escape the root (`links.ts:40-57`)
  6. the document is assembled as a complete `<!DOCTYPE html>` string with inline `<style>`, the rendered content, the sidenote rail, and the two controller `<script>`s — no external resources
  7. host → iframe: `srcDoc` (initial delivery). Trust boundary: `sandbox="allow-scripts allow-popups"` — no `allow-same-origin`, so the frame is opaque-origin
  8. iframe → host, message `new-diagram:open-repository-file` `{path}`: emitted by a delegated click handler on `[data-repository-path]` → host `props.onOpenRepositoryFile(path)` → in `CodeEntitiesPanel`, `openLinkedAnchor` finds the entity whose source range matches that path and selects it
  9. host → iframe, message `new-diagram:reveal-markdown-line` `{line, startLine, endLine, behavior}`: sent by `revealTargetLine` on mount, on `srcDoc` load, and whenever `targetLine`/`targetRange`/`jumpRequestId` change. The controller matches `[data-source-start-line]`/`[data-source-end-line]` blocks, clears `.is-source-selection`, marks only **leaf** intersecting blocks (a block with an intersecting child is not marked, `links.ts:104-109`), then scrolls the smallest containing block (or nearest preceding/following) into view, downgrading `smooth` to `auto` under `prefers-reduced-motion`
  10. iframe → host, message `new-diagram:active-markdown-section` `{id, line, scrollTop}`: an rAF-throttled scroll listener picks the last `h2|h3|h4[id]` whose top is above `max(24, 12% of viewport height)` → host `props.onActiveSectionChange`
  11. host `message` listener rejects any event whose `event.source !== frameRef.current.contentWindow` (`TerminalMarkdownView.tsx:46`) — the only origin check, since the frame has no usable origin
  12. `TerminalMarkdownOutline` → `buildMarkdownSectionTree(sections)` and `mapJumpHistoryToSections(history, sections)` → `MarkdownSectionsPanel` (a Studio explorer tab, wired through the pane system)
  13. `TerminalMarkdownContent` bypasses the iframe entirely: `renderTerminalMarkdownFragment` → `dangerouslySetInnerHTML`-style inline content for chat replies — note the different trust posture
- **Notes for the renderer**: draw a hard vertical trust boundary between the host lane and the iframe lane, labelled with the sandbox attribute. Put the three message constants on the three crossing arrows, with direction and payload shape. Render the five-stage token pipeline as a separate small strip above the sequence, since it is a pure transformation that happens before any message flows.

---

### CORE-1 — Core ports, adapters and the bootstrap seam
- **Provenance**: Core slice, D7. Placement Z5 Core (R3,C1).
- **Modifications**: Relabel the `store.ts → loadWorkspace` edge "permitted infrastructure → application edge (dependencies.test.ts:70)", not an exception. Collapse `bootstrap.ts` to one node and cite SYS-2 for the full composition.


- **Kind**: interface/implementation map layered by dependency direction
- **Question it answers**: Which interfaces Core's application layer depends on, who implements them, and why
  `bootstrap.ts` is the only module that knows both sides.
- **Boundary (IN)**:
  - Ports: `application/core/ports/diagramRepository.ts` (`DiagramRepository`, :9 — ~55 methods + the `ids`
    bag), `application/core/ports/projectCatalogRepository.ts` (`ProjectCatalogRepository`, :112),
    `application/core/corpus/corpusAccess.ts` (`CorpusAccess` :161, `ReadableCorpusProvider` :155),
    `application/core/source/languageService.ts` (`LanguageService`, :178),
    `application/core/context.ts` (`CoreContext = {store, corpus}`),
    `application/core/errors.ts` (`ApplicationError` with codes
    `conflict|invalid-input|binary-source|lsp-disabled`).
  - Application services: `CoreApplication` (`application/core/application.ts:27`, a facade over
    `workspace/`, `representations/`, `source/`, `imports/`, `highlights/` function modules),
    `ProjectSourceService` (`application/core/source/projectSource.ts:165`),
    `PlanService` (`application/core/plans/planService.ts:91`),
    `ProjectCatalogService` (`application/core/representations/projectCatalogService.ts:68`).
  - Implementations: `DiagramStore` (`infrastructure/core/persistence/store.ts:43`),
    `ProjectCatalogStore` (`infrastructure/core/persistence/projectCatalogStore.ts:83`),
    the `corpusAccess` object literal (`src/server/app/bootstrap.ts:38`) wrapping
    `corpusProvider`/`readCorpusDocumentLines` (`infrastructure/core/corpus/corpus.ts:125,:129`) and
    `discoverDomainCorpus` (`infrastructure/core/persistence/shared.ts:95`),
    `ProjectLanguageService` (`infrastructure/core/language-services/projectLanguageService.ts:251`),
    `PiAgentRuntime` (`infrastructure/core/agents/agentRuntime.ts:19`).
  - Composition: `src/server/app/bootstrap.ts` — `corpusAccess` (:38), `createCoreApplication` (:42),
    `createBackend` (:56) lines 63-73, and `src/server/routes/core/routes.ts:39`
    (`createCoreRoutes({application, source, plans, catalog})`).
  - Error mapping: `src/server/app/vitePlugin.ts:45-47`.
- **Boundary (OUT)**: Studio/Mapping services and runtimes — one collapsed node each, with only the edges
  that show they receive the **same** `DiagramStore` / `corpusAccess` instances.
- **Nodes** grouped into four horizontal bands, top → bottom:
  `src/server/routes/core` · `application/core (services + ports)` · `domain/core` ·
  `infrastructure/core`, plus a floating `bootstrap.ts` node.
- **Edges / relationships**:
  - `createCoreRoutes` receives four collaborators; each route line calls exactly one of them
    (`routes.ts:48-221`) — annotate the route table: `project/files|definitions|source → ProjectSourceService`,
    `project/projections → ProjectCatalogService`, `plans* → PlanService`, everything else → `CoreApplication`.
  - `CoreApplication → CoreContext → {DiagramRepository, CorpusAccess}` (constructor injection,
    `application.ts:29`).
  - **Narrowed ports** (an intentional pattern worth its own edge style): `ProjectSourceService` takes
    `Pick<DiagramRepository,'loadProject'>`; `PlanService` takes
    `Pick<…,'loadProject'|'loadPlan'|'loadPlans'|'savePlan'|'ids'>`; `ProjectCatalogService` takes
    `Pick<…,'loadProject'|'projectCatalogs'>`; `PersistenceContext` takes
    `Pick<…,'checkoutRoot'|'storeRoot'|'projectCatalogs'|'ids'>`.
  - `DiagramStore implements DiagramRepository`; `ProjectCatalogStore implements ProjectCatalogRepository`;
    `ProjectLanguageService implements LanguageService`; the bootstrap literal `implements CorpusAccess`;
    `FilesystemCorpusProvider implements CorpusProvider` (`domain/core/profiles/domainProfile.ts:22`).
  - `DiagramRepository.projectCatalogs: ProjectCatalogRepository` — port composed inside port.
  - `bootstrap.ts` → `new DiagramStore(projectRoot, diagramsDirectory)` (:63) and passes that single instance
    to Core, Studio (`createStudioApplication`, :67) and all three Mapping services (:81-84).
  - `bootstrap.ts` → `languageService = options.lspEnabled ? new ProjectLanguageService() : undefined` (:66) —
    the optional dependency that makes `ProjectSourceService.definitions` throw
    `ApplicationError('lsp-disabled')` → HTTP 503 + `{code:'LSP_DISABLED'}`.
  - `dispose()` chain (:89-91): `languageService?.dispose()` → studio → mapping runtimes → compaction service.
  - `PiAgentRuntime` has **no Core-side consumer** — it is extended only by
    `PiDiagramAgentRuntime` (Studio), `PiMappingAgentRuntime` and `PiFileCompactionRuntime` (Mapping).
    Draw those three as dashed "extends" edges leaving the slice.
  - Constraint annotation (enforced by `tests/architecture/dependencies.test.ts`): `domain/core` has no Node/
    HTTP/React imports; `application/core` has no fs/subprocess/provider imports (the two exceptions are
    `node:crypto` in `application/core/agents/hash.ts`, `application/core/source/projectSource.ts:158`,
    `application/core/highlights/service.ts:121`, `application/core/imports/service.ts:1`, and `node:path`
    in `application/core/source/service.ts:1`).
- **Notes for the renderer**: draw the dependency arrows so every one points *toward* `domain/core`, and make
  the two upward arrows stand out as the deliberate exceptions: `infrastructure/.../store.ts → application/
  core/workspace/loadWorkspace` and `bootstrap.ts → everything`.

---

### CORE-2 — `loadWorkspace`: assembling the WorkspaceSnapshot
- **Provenance**: Core slice, D5. Placement Z5 Core (R3,C2).


- **Kind**: data-flow / fan-in pipeline (with sequencing)
- **Question it answers**: What a single `GET /api/core/workspace` actually reads, in what order, and why the
  response is one large denormalized object rather than a set of endpoints.
- **Boundary (IN)**: `application/core/workspace/loadWorkspace.ts` in full (`loadWorkspace`, :19) plus
  `application/core/workspace/service.ts:188` (`workspace(context)`), the `DiagramRepository` methods it calls,
  `store.projectCatalogs.loadCompactionCatalog/loadRepresentationCatalog` (:139-140), and the shape of
  `WorkspaceSnapshot` (`domain/core/records/domain.ts:676`). Also in: `src/server/routes/core/routes.ts:85-88`
  as the entry point and every Core operation that returns a fresh `WorkspaceSnapshot` as its result
  (`application/core/imports/service.ts:208,218,224,229`, `application/core/highlights/service.ts:215,220`,
  `application/core/representations/service.ts:62`).
- **Boundary (OUT)**: the record field detail (D1) and the filesystem mechanics (D4).
- **Nodes**:
  - `GET /api/core/workspace` → `CoreApplication.workspace()` → `workspaceOperations.workspace(context)` →
    `loadWorkspace(store)`.
  - Guard: `loadProject()` returns null → **early-return branch** that still loads the global imports library
    and its artifacts and returns an otherwise-empty snapshot (:22-56).
  - `migrateLegacyImports(diagramSets, globalImports)` (:58) — mutating migration in the middle of a read,
    followed by a **re-read of every DiagramSet** (:59).
  - Per-set loop (:93-136): representation graph, code entities, code-entity prompt config, generation
    batches → candidate batches → generation prompt configs, diagrams (+ their code-entity maps),
    components (+ maps), cross-product of global imports × this set (`codeEntityMaps["<setId>:<id>"]`, :126-129),
    agent runs, edit sessions.
  - Project-level reads: system prompt templates, code-entity prompt templates (profile-selected:
    `document` vs `source-code`, :66-68), compaction catalog, representation catalog, spatial progress,
    highlights, plans.
  - Output: `WorkspaceSnapshot` with `Record<id, …>` maps per record kind.
- **Edges / relationships**: each arrow is "awaited read, result placed into snapshot field X". Mark which
  reads are `Promise.all` parallel (:23-31, :57, :59, :69) and which are the serial `for` loops (:80-136) —
  the per-set body is fully sequential, one file read per record. Mark the two edges that write:
  `migrateLegacyImports` and the read-time normalizations reached through `loadCodeEntities`/`loadDiagram`.
  Show the "every mutation returns the whole workspace" fan-in: Core's import/highlight/compaction operations
  all end with `return workspace(context)`.
- **Notes for the renderer**: lay it as a pipeline left→right with a clear branch for the "no project yet"
  case, and a boxed loop for the per-DiagramSet body. This diagram is also the best place to make the read
  amplification legible (O(diagrams + components + runs + editSessions + batches) individual JSON file reads
  per request) — annotate counts rather than drawing every edge.

---

### CORE-7 — `AgentWorkflow<T>` runner and executor contract
- **Provenance**: Core slice, D6. Placement Z5 Core (R3,C4).
- **Modifications**: This is the shared diagram STU-3 and MAP-6 collapse to; keep both concrete workflows as the small step chains at the bottom.


- **Kind**: control-flow / lifecycle diagram (activity + a sequence lane for the executor)
- **Question it answers**: Exactly what the shared workflow runner owns versus what each feature's executor
  owns, and where a workflow can abort or reject a step.
- **Boundary (IN)**:
  - `application/core/agents/agentWorkflow.ts` in full — `AgentWorkflowStep<T>` (:1-7 region, interface at
    the top), `AgentWorkflow<T>` (:9), `AgentStepRequest` (:14), `AgentStepExecutor<T>` (:22),
    `runAgentWorkflow` (:24).
  - Executor implementations: `infrastructure/studio/agents/agentRuntime.ts:450` (session-reusing executor:
    clears `state.submissions`, `await session.prompt(prompt)`, returns `state.submissions.shift()`),
    `application/mapping/compaction/fileCompactionService.ts:87` (per-step persistence executor).
  - Workflow definitions: `application/studio/generation/generationWorkflow.ts:4`
    (`generate` → optional `reference` → `map`, with a `validate` that requires `mappings`),
    `application/mapping/compaction/fileCompactionWorkflow.ts:5`
    (`compact` → `refine`, both validated by `validateFileCompactionDraft`).
  - Submission gate: `infrastructure/core/agents/validatedSubmission.ts:9` (`createValidatedSubmission`) —
    reject → `{accepted:false, terminate:false}` + a correction message; accept → `{accepted:true,
    terminate:true}` and the value is latched.
  - Session/provider machinery: `infrastructure/core/agents/agentRuntime.ts` — `PiAgentRuntime` (:19),
    `runtime()`/`model()` (:25/:30), the `sessions` set and `dispose()` (:46), and `progressFor` (:4) which
    maps `AgentSessionEvent` → `AgentProgress`.
- **Boundary (OUT)**: the actual prompts and tool schemas of Studio/Mapping (collapsed into two nodes
  "Studio generation workflow" / "Mapping compaction workflow"); NDJSON route streaming (mentioned only as
  the sink for progress events).
- **Nodes / steps**:
  `runAgentWorkflow(workflow, execute, {signal, onStepStart})` → **preflight validation**
  (`workflow.id` non-empty, ≥1 step, step ids non-empty and unique, :23-28) → loop over steps:
  `signal.throwIfAborted()` → `onStepStart(step.id)` → `await step.before?.(previous)` →
  `throwIfAborted` → `execute({workflowId, stepId, prompt: step.prompt(previous), signal})` →
  `throwIfAborted` → **`output === undefined` ⇒ throw `"<workflowId>/<stepId> finished without an accepted
  submission"`** → `await step.validate?.(output, previous)` → `throwIfAborted` → `previous = output` →
  next step → return `previous`.
- **Edges / relationships**:
  - `step.prompt(previous)` receives **only the previous accepted output**, never the whole history — that is
    the runner's entire state (`agentWorkflow.ts:230,:237`).
  - `execute` returns `T | undefined`; `undefined` means "the turn ended without an accepted submission" and
    is fatal. Draw this as a failure edge, not a retry edge — the runner never retries a step.
  - Four distinct `throwIfAborted` points per step (before `before`, after `before`, after `execute`, after
    `validate`); the signal is also handed *into* `execute` so the executor can cancel in-flight work.
  - Studio executor edge: reuses **one session** across all steps (`session.prompt` per step) and drains a
    submissions queue; disposes the session in `finally` and removes it from `PiAgentRuntime.sessions`.
  - Mapping executor edge: writes the step prompt into a `FileCompactionRun` and persists before and after
    each step, and composes its own `AbortSignal.any([controller, timeout(1800000), options.signal])`
    (`fileCompactionService.ts:71`) — so abort has two independent sources.
  - `createValidatedSubmission` sits *inside* the executor, not the runner: rejection loops the **agent**
    (tool returns an error text, `terminate:false`), while `step.validate` loops nothing and fails the whole
    workflow. Drawing both rejection paths side by side is the most valuable part of this diagram.
  - `progressFor(event, model, sessionId)` maps `agent_start|turn_start|message_start → "generating"`,
    `tool_execution_start` with `read|grep|find|ls → "reading-context"`, `submit_* → "validating"`;
    output feeds `AgentProgress` → NDJSON progress events.
- **Notes for the renderer**: two swimlanes — "Core runner (feature-agnostic)" and "Feature executor +
  session" — with the `AgentStepRequest` / `T | undefined` boundary drawn as the only contract between them.
  Show the two concrete workflows as small step chains below, sharing the same runner.

---

### CORE-9 — Source evidence resolution, hashes and the LSP session
- **Provenance**: Core slice, D8. Placement Z5 Core (R3,C5).


- **Kind**: data-flow pipeline + a subprocess lifecycle inset
- **Question it answers**: How a stored evidence address (path + line range + snapshot) becomes rendered
  source, and what guards the boundary between the store and the live corpus.
- **Boundary (IN)**:
  - Addresses: `SourceRange` (`domain/core/records/domain.ts:99`), `assertSourceRange` (:991),
    `ProjectRepresentationEvidenceRange` + `sourceRangeFromProjectEvidence`
    (`domain/core/representations/projectCatalog.ts:61,:145`), `ProjectFileCompactionRecord` (:16).
  - Corpus binding: `CorpusBinding` (`domain/core/profiles/domainProfile.ts:7`, kinds `git-worktree` |
    `filesystem-documents`), `CorpusProvider` (:22), `BUILT_IN_DOMAIN_PROFILES`
    (`domain/core/profiles/domainProfiles.ts:98`).
  - Application: `application/core/source/service.ts` — `projectCorpus` (:22), `sourceSnippet` (:119),
    `listRepositoryDirectory` (:145), `callGraphFocus` (:33); `application/core/source/projectSource.ts` —
    `files` (:172), `source` (:189), `definitions` (:182), `ensureDefinitionsEnabled` (:178);
    `application/core/representations/service.ts:44` (`upsertProjectFileCompaction` staleness check).
  - Infrastructure: `infrastructure/core/corpus/corpus.ts` — `relativeSegments` (:12),
    `canonicalBindingRoot` (:26), `resolveWithoutSymlinks` (:37), `FilesystemCorpusProvider` (:60),
    the `providers` record (:120), `corpusProvider` (:125), `readCorpusDocumentLines` (:129);
    `infrastructure/core/language-services/projectLanguageService.ts` — `LanguageSession` (:157),
    `ProjectLanguageService` (:251), `registerSession` (:148).
  - Pure helpers: `domain/core/source/sourceNavigation.ts` (`isRepositoryFilePath`, `supportsDefinitions`,
    `SourcePosition` in zero-based UTF-16), `domain/core/source/callGraphTree.ts`
    (`parseCallGraphTree`/`filterCallGraphTree`), `domain/core/source/callGraphFocus.ts`
    (`CallGraphFocusRequest/Result`, `focusIdentityKey`), `domain/core/source/fileTree.ts`
    (`normalizeRepositoryPath`, `diagramFileFilter`).
  - Routes: `src/server/routes/core/routes.ts:48` (`project/files`), `:52` (`project/definitions` with
    `AbortController` wired to `response.once('close')`), `:65` (`project/source`), `:143` (`/api/core/source`),
    `:151` (`diagram-sets/{set}/files`), `:138` (`call-graph-focus`).
- **Boundary (OUT)**: the browser source panes; Mapping's file compaction agent (collapsed to one "compaction
  producer" node feeding `upsertFileCompaction`).
- **Nodes / stages**:
  1. `ProjectRecord.corpus: CorpusBinding` (chosen once at `ensureProject`; `discoverRepository` derives
     `git-worktree` + revision via `git rev-parse`, `discoverDocumentCorpus` derives `filesystem-documents`).
  2. `corpusProvider(binding)` → one of two `FilesystemCorpusProvider` singletons keyed by binding kind.
  3. Path guard: `relativeSegments` (reject absolute, `\`, NUL, `.`/`..`) → `canonicalBindingRoot`
     (`realpath` + must be a directory + kind must match) → `resolveWithoutSymlinks`
     (**lstat every segment; any symlink is refused**; final containment check).
  4. Read: `readDocumentBytes → readDocumentText → readDocumentLines → readLines(range)`.
  5. `sourceSnippet` overlay: reads the **live** file, then splices `range.originalLines` over
     `[startLine-1, endLine]` so the stored snapshot wins over drifted source (`service.ts:133-137`).
  6. `ProjectSourceService.source`: rejects `\0` (binary → `ApplicationError('binary-source')` → 415),
     returns `lines` + `sourceSha256` + `lspEnabled`.
  7. `definitions`: requires the caller's `sourceSha256` to still match the file, else
     "Source changed on disk"; requires `isRepositoryFilePath` + `supportsDefinitions` + an in-range position.
  8. `LanguageSession` per realpath'd root: spawn `typescript-language-server --stdio` (detached, own process
     group) → `initialize` (must advertise `definitionProvider` and UTF-16 `positionEncoding`) → `initialized`
     → per lookup `didOpen` / `textDocument/definition` / `didClose`, all behind a FIFO `queue` and a 20s
     `bounded()` race, with a 5-minute unref'd idle timer → `dispose()` (`process.kill(-pid, SIGTERM)`).
     Process-level `SIGTERM`/`SIGINT` handlers dispose every live session (:152-154).
  9. Result filtering: file URIs only, `path.relative(root, …)` must still satisfy `isRepositoryFilePath`,
     de-dupe by JSON key, everything else counted into `outsideRoot`.
  10. `upsertProjectFileCompaction`: re-reads the live document, strips a trailing empty line, and requires
      the captured `originalLines` to match exactly (else "active compaction snapshot is stale") and a
      full-file compaction to still cover the whole file — then delegates to `upsertFileCompaction`, which
      content-addresses the record by `sha256(originalLines.join("\n"))` + profile.
  11. `callGraphFocus`: DiagramSet → settled call-graph representation (`settledViewIdsForSession`) →
      provenance checks (`sameArtifactOrigin`, `focusIdentityKey`) → `parseCallGraphTree(ascii, entities)` →
      `filterCallGraphTree(roots, selectedKeys)` → `CallGraphFocusResult`.
- **Edges / relationships**: pipeline arrows as numbered above, with three guard styles: **path guards**
  (steps 3), **hash/staleness guards** (steps 6–7, 10), **provenance guards** (step 11). Add the abort edge
  from `routes.ts:56-62` (`response.once('close') → controller.abort() → signal → session.lookup →
  CancellationTokenSource.cancel`) — it is the only request-cancellation path in the Core routes.
- **Notes for the renderer**: put the LSP subprocess lifecycle in a boxed inset (spawn → initialize → N
  lookups → idle/abort/exit → dispose), since it is a different time scale from the request pipeline. The
  three hashes in play (`SourceRange.originalLines` snapshot, `ProjectFileCompactionRecord.sourceSha256`,
  and the per-request `sourceSha256`) are easy to confuse — label each explicitly.

---

### CORE-3 — The persisted record model
- **Provenance**: Core slice, D1. Placement Z5 Core (R4,C2).
- **Modifications**: MERGED with Studio D6. Add a **writer badge** per record (Core / Studio / Mapping / Core-legacy), the two "mutable template → immutable config snapshot" pairs drawn side by side (`SystemPromptTemplateRecord → GenerationPromptConfigRecord.systemPrompt`, `CodeEntityPromptTemplateRecord → CodeEntityPromptConfigRecord.template`), and the promotion hand-off edge (`CodeEntityRecord` + `DiagramCodeEntityMapRecord` → `ProjectRepresentationEvidenceRecord` + `MappingRecord` via `stableProjectId`, `candidates/service.ts:33,41,94`) as a labelled boundary crossing into CORE-5. Plans: keep only the `PlanRecord` node; TOOL-1 owns the rest.


- **Kind**: data model / ER (records + cardinalities + id-reference edges)
- **Question it answers**: What records does a Core store actually persist under one Project, and which record
  owns which id list, so a reader can tell canonical ownership from a back-reference.
- **Boundary (IN)**: types declared in `domain/core/records/domain.ts`:
  `ProjectRecord` (:136), `DiagramSetRecord` (:151, alias `GenerationSessionRecord` :176),
  `CodeEntitiesSetRecord` (:123), `CodeEntityRecord` (:112), `SourceRange` (:99),
  `CompactedSource`/`CompactedSourceSection`/`CompactedSourceNode` (:73–:97),
  `DiagramRecord` (:383), `DiagramComponentRecord` (:354),
  `DiagramCodeEntityMapRecord` (:422) + `DiagramElementMapping` (:411),
  `GenerationBatchRecord` (:479), `DiagramCandidateBatchRecord` (:497), `AgentRunRecord` (:510),
  `GenerationPromptConfigRecord` (:237), `CodeEntityPromptConfigRecord` (:326),
  `SystemPromptTemplateRecord`/`CodeEntityPromptTemplateRecord` (:319/:321),
  `EditSessionRecord` (:554) + `EditOperationRecord` (:537) + `TextPatch` (:531),
  `ImportedArtifactLibraryRecord` (:191), `PlanRecord` (:662) + `PlanChange` union (:656),
  `DiagramHighlightRecord` (:449) and `HighlightRecordV2` (`domain/core/highlights/highlights.ts:45`),
  `RepresentationGraphRecord` (`domain/core/representations/representationGraph.ts:67`),
  `SpatialProgressState` (`domain/core/agent-work/agentWork.ts:245`),
  plus the provenance types `ArtifactOrigin` (:64) and `CodeEntityOrigin` (:69).
- **Boundary (OUT)**: the Project representation catalog records (they get their own diagram, D2) — show them
  here only as one collapsed node "Project representation catalog (see D2)" hanging off `ProjectRecord`.
  Also out: `WorkspaceSnapshot` (that is an assembled read model, see D5), all `Materialized*Input` /
  `*Draft` request-local types (:708–:799), and the pure classes `CodeEntity`/`Diagram`/`DiagramComponent`
  (:827/:943/:954) which are prompt-rendering wrappers, not records.
- **Nodes** (gloss):
  - `ProjectRecord` — one corpus; holds `diagramSetIds`, `domainProfileId`, `corpus` binding.
  - `DiagramSetRecord` — one generation session; id lists for every child record kind.
  - `CodeEntitiesSetRecord` — immutable-after-finalize evidence set; `revision`, `status`.
  - `CodeEntityRecord` — one piece of evidence; `handle`, `category`, `sourceRanges`.
  - `SourceRange` — path + line span + `originalLines` snapshot + optional `compactedSource`.
  - `CompactedSource` — presentation-only section list over one range.
  - `DiagramRecord` — full ASCII artifact; `viewKind`, `codeEntityIds`, `origin`.
  - `DiagramComponentRecord` — sub-artifact captured from a selection or generated.
  - `DiagramCodeEntityMapRecord` — ASCII-anchored evidence mapping, pinned by `asciiSha256`.
  - `GenerationBatchRecord` — one generation request; N child runs, output artifact ids.
  - `DiagramCandidateBatchRecord` — immutable candidate membership + `rankings`.
  - `AgentRunRecord` — one agent turn; status, model, session, output ids.
  - `GenerationPromptConfigRecord` / `CodeEntityPromptConfigRecord` — immutable prompt snapshots.
  - `SystemPromptTemplateRecord` / `CodeEntityPromptTemplateRecord` — project-level editable templates.
  - `EditSessionRecord` — undo/redo cursor over `EditOperationRecord[]` patches.
  - `ImportedArtifactLibraryRecord` — the `global-imports` pseudo-set index.
  - `PlanRecord` — proposal container; `PlanChange[]` are projections, never canonical.
  - `DiagramHighlightRecord` / `HighlightRecordV2` — project-level saved evidence pins.
  - `RepresentationGraphRecord` — per-DiagramSet refined visual layers.
  - `SpatialProgressState` — keyed by `AgentRunRecord.id`.
- **Edges / relationships**:
  - `ProjectRecord.diagramSetIds[] → DiagramSetRecord` (owns, ordered list).
  - `DiagramSetRecord.codeEntitiesSetId → CodeEntitiesSetRecord` (1:1).
  - `CodeEntitiesSetRecord.entities[] → CodeEntityRecord` (embedded, 1:N).
  - `CodeEntityRecord.sourceRanges[] → SourceRange` (embedded); `SourceRange.compactedSource → CompactedSource`.
  - `DiagramSetRecord.diagramIds[] / diagramComponentIds[] / generationBatchIds[] / agentRunIds[] /
    editSessionIds[]` → the corresponding records (owns).
  - `DiagramSetRecord.featuredViewIds: Partial<Record<DiagramViewKind, diagramId>>` → `DiagramRecord`
    (preference, not ownership).
  - `DiagramRecord.codeEntityIds[] → CodeEntityRecord` (declared dependencies; resolution may cross into the
    imports library, see D5/D7).
  - `DiagramCodeEntityMapRecord.(artifactKind, artifactId) → DiagramRecord | DiagramComponentRecord`
    (1:0..1 per artifact) and `.asciiSha256` pins the artifact revision; `mappings[].entityId/sourceRangeId`
    → `CodeEntityRecord`/`SourceRange`.
  - `GenerationBatchRecord.childRunIds[] → AgentRunRecord`; `.promptConfigId → GenerationPromptConfigRecord`;
    `.codeEntitiesRevision → CodeEntitiesSetRecord.revision` (pin, validated at
    `infrastructure/core/persistence/generation.ts:269` and `:288`);
    `.outputDiagramIds[]/.outputDiagramComponentIds[]` → artifacts;
    `.diagramCandidateBatchId → DiagramCandidateBatchRecord` (created lazily, `generation.ts:225`).
  - `DiagramCandidateBatchRecord.diagramIds[]` mirrors the batch's output order **including archived**
    diagrams; `.rankings: Record<diagramId, rank>`.
  - `AgentRunRecord.outputDiagramId / outputDiagramComponentId / outputCodeEntityIds[]` → produced records;
    `DiagramRecord.producedByRunId` is the reverse edge.
  - `EditSessionRecord.sourceArtifactId → DiagramRecord|DiagramComponentRecord`;
    `.outputArtifactId →` the committed copy; `DiagramRecord.editSessionId` is the reverse edge.
  - `DiagramRecord.derivedFromDiagramIds[]`, `DiagramComponentRecord.derivedFromDiagram(Component)Ids[]`,
    `.sourceDiagramId`, `basedOnDiagramId` — derivation edges among artifacts (draw as dashed).
  - `ImportedArtifactLibraryRecord.{diagramIds,diagramComponentIds,codeEntityIds,codeEntityMapArtifactIds}` →
    the same record types but stored under the synthetic set id
    `GLOBAL_IMPORTS_DIAGRAM_SET_ID = "global-imports"` (:6).
  - `PlanRecord.projectId → ProjectRecord`; `PlanModifiedDiagramChange.baseDiagram` **embeds a whole
    `DiagramRecord` snapshot** + `baseAsciiSha256` + `patch` (deliberately not a live reference);
    `PlanCodeEntityCompactionChange.baseEntity` embeds a `CodeEntityRecord` snapshot.
  - `DiagramHighlightRecord/HighlightRecordV2 → (projectId, diagramSetId, artifactId, mappingId, entityId)`.
  - `SpatialProgressState` keyed by `AgentRunRecord.id`.
  - Provenance overlay: `ArtifactOrigin{projectId,diagramSetId}` on `DiagramRecord.recordOrigin` /
    `DiagramComponentRecord.recordOrigin`, `CodeEntityOrigin{+codeEntitiesSetId}` on `CodeEntityRecord.origin`.
    For imported records `recordOrigin` ≠ `diagramSetId` — that difference is the whole point of the field.
- **Notes for the renderer**: group into four bands — **Project scope** (Project, imports library, plans,
  highlights, templates), **DiagramSet scope** (set, evidence, artifacts, maps), **Generation scope**
  (prompt configs, batches, runs, candidate batches), **Editing scope** (edit sessions, operations).
  Mark fields commented "Optional only while reading legacy records" with a small "legacy-optional" badge —
  the schema is one version (`SCHEMA_VERSION = 1`) with read-time normalization, not versioned migrations.
  Use solid arrows for ownership/id-lists, dashed for derivation/back-references, and a distinct style for
  the two *embedded snapshot* edges inside `PlanChange`.

---

### CORE-5 — The project representation catalog
- **Provenance**: Core slice, D2. Placement Z5 Core (R4,C3).


- **Kind**: data model / ER with a revision-history spine
- **Question it answers**: How a "settled" project diagram differs from the DiagramSet artifacts that produced
  it, and how revisions, evidence, mappings, projections and corpus compactions hang together.
- **Boundary (IN)**: `domain/core/representations/projectCatalog.ts` in full —
  `ProjectRepresentationCatalogRecord` (:125), `ProjectRepresentationRecord` (:110),
  `ProjectRepresentationRevisionRecord` (:90), `ProjectRepresentationEvidenceRecord` (:72),
  `ProjectRepresentationEvidenceRange` (:61), `ProjectRepresentationMappingRecord` (:81),
  `ProjectCorpusCompactionCatalogRecord` (:36), `ProjectFileCompactionRecord` (:16),
  `ProjectCompactionProvenance` (:8), `sourceRangeFromProjectEvidence` (:145);
  `ProjectProjectionRecord` (`domain/core/diagrams/diagramProjection.ts:5`);
  `CompactionProjection`/`CompactionSnapshot` (`domain/core/representations/compactionProjection.ts:3,:11`);
  `ProjectDiagramContent` (`domain/core/diagrams/projectDiagramCanvas.ts:11`) and `LineGridScene`
  (`domain/core/diagrams/lineGrid.ts:26`) as the two possible revision bodies.
- **Boundary (OUT)**: the transition functions themselves (D3), and the DiagramSet-side records — show
  `DiagramRecord` as one collapsed "source artifact (D1)" node so the `provenance` edge is visible.
- **Nodes**:
  - `ProjectRepresentationCatalogRecord` — single JSON doc at `<store>/representations/catalog.json`.
  - `activeByKind: Partial<Record<DiagramViewKind, representationId>>` — the "starred"/active pointer per kind.
  - `ProjectRepresentationRecord` — stable identity; `status: settled|archived`, `currentRevisionId`, `revisionIds[]`.
  - `ProjectRepresentationRevisionRecord` — immutable revision; `ascii`, `asciiSha256`, `content`, `evidence`, `mappings`, `provenance`.
  - `content: {kind:"ascii"} | {kind:"mapping-canvas", scene}` — legacy revisions have none and are
    back-filled on load (`infrastructure/core/persistence/projectCatalogStore.ts:160`).
  - `ProjectRepresentationEvidenceRecord` — catalog-local copy of a CodeEntity (id/handle/label/category/summary).
  - `ProjectRepresentationEvidenceRange` — catalog-local copy of a SourceRange + optional `compactionId`.
  - `ProjectRepresentationMappingRecord` — evidenceId + sourceRangeId + line/column span.
  - `ProjectProjectionRecord` — revision-pinned correspondence between two representations.
  - `CompactionProjection` — immutable per-file ASCII tree snapshots + call-tree-row links.
  - `ProjectCorpusCompactionCatalogRecord` — separate doc at `<store>/corpus/compactions.json`.
  - `ProjectFileCompactionRecord` — immutable, content-addressed by `sourceSha256` + profile.
  - `activeByPath: Record<path, compactionId>` — current presentation for a live corpus path.
- **Edges / relationships**:
  - `catalog.representations[id] → ProjectRepresentationRecord`; `catalog.revisions[id] → …RevisionRecord`
    (both flat maps inside the one document).
  - `representation.currentRevisionId → revision` (1:1 head pointer); `representation.revisionIds[] → revisions`
    (append-only history; a revision is never mutated).
  - `revision.representationId → representation` (back-reference, validated in
    `catalogRules.saveProjectedTree` at `domain/core/representations/catalogRules.ts:47-48`).
  - `revision.evidence: Record<evidenceId, EvidenceRecord>` (embedded, copied at promotion; note
    `saveProjectedTree` does `structuredClone(sourceRevision.evidence)`, `catalogRules.ts:68`).
  - `revision.mappings[] → evidence[] / evidence.sourceRanges[]`.
  - `evidenceRange.compactionId → ProjectFileCompactionRecord` — **cross-document edge into the compaction
    catalog**; `sourceRangeFromProjectEvidence` (:145) is the function that rejoins them into a `SourceRange`.
  - `revision.provenance {diagramSetId, artifactId} → "source artifact (D1)"` — the only link back to the
    generation session; `ProjectCatalogStore.representationForSource` (`projectCatalogStore.ts:213`) is a
    reverse lookup that scans every revision for this pair.
  - `catalog.activeByKind[viewKind] → representationId` (0..1 per `DiagramViewKind`).
  - `catalog.projections[id] → ProjectProjectionRecord`; each projection points at
    `sourceRepresentationId + sourceRevisionId` **and** `targetRepresentationId + targetRevisionId`
    (four pins — this is what makes a projection immutable and non-fuzzy).
  - `projection.links[] {sourceEvidenceIds[], targetNodeIds[]}` → evidence in the *source* revision and tree
    node ids in the *target* revision.
  - `projection.compactionProjection.files[] → CompactionSnapshot` (self-contained ASCII + two sha256s);
    `.links[] {callTreeNodeId, file, treeLines[]}` → node ids + snapshot rows.
  - `compactionCatalog.compactions[id] → ProjectFileCompactionRecord`; `activeByPath[path] → id`
    (many historical compactions per path; exactly one active).
- **Notes for the renderer**: lay the representation/revision spine left→right as a version chain
  (rev 1 → rev 2 → rev 3 with the head pointer on the newest), and hang evidence/mappings under each revision
  to make the "each revision carries its own full evidence copy" property visible. Draw the two JSON documents
  (`representations/catalog.json`, `corpus/compactions.json`) as containers and the `compactionId` link as the
  single edge crossing between them. Call out the invariant "revisions are immutable; a mapping-only change
  still produces a new revision" (`catalogRules.ts:54-55`).

---

### CORE-8 — Prompt templates: families, bindings, snapshots
- **Provenance**: new (coordinator). Placement Z5 Core (R4,C4).
- **Kind**: data model + resolution pipeline.
- **Question it answers**: How do the two template families, their profiles and versions, and the per-target-kind bindings resolve into the immutable prompt config a generation batch is pinned to — and how does that differ from Mapping's file-based prompts?
- **Boundary (IN)**:
  - `domain/core/prompts/prompt.ts` — `GENERATION_PROMPT_BINDINGS:54` (`diagram` | `call-graph` | `dir-view` | `diagram-component` → `{system, reference, mapping}` prompt names), `generationPromptBindings:77`, `BUILT_IN_SYSTEM_PROMPT_TEMPLATES:188`, `validatePromptTemplate:206`, `createSystemPromptTemplate:211`, `createBuiltInSystemPromptTemplates:261`, `createBuiltInCodeEntityPromptTemplates:273`, `renderSystemPromptTemplate:300`, `systemManagedOutputContract:313`, `renderReferencePromptTemplate:338`, `renderMappingPromptTemplate:353`, `promptTemplate:384`, `renderArtifactSystemPrompt:393`, `promptOptions:406`; the defaults `DEFAULT_REFERENCE_FOLLOW_UP_PROMPT:40`, `DEFAULT_MAPPING_FOLLOW_UP_PROMPT:44`, `DEFAULT_CODE_ENTITY_IDENTIFICATION_CRITERIA:81`, `DEFAULT_CODE_ENTITY_COMPACTION_CRITERIA:101`, `DEFAULT_DOCUMENT_EVIDENCE_*:159,174`, `DOCUMENT_GENERATION_GUIDANCE:38`.
  - Records (`domain/core/records/domain.ts`): `PromptTemplateRecord:289`, `NamedPromptTemplate:301`, `PromptTemplateSetRecord:307`, `SystemPromptTemplateRecord:319`, `CodeEntityPromptTemplateRecord:321` (`prompts["code-entity-identification" | "code-entity-compaction"]`), `GenerationPromptConfigRecord:237` (`systemPrompt{profileId, profileVersion, promptName, rendered}`, `referencePrompt?`, `mappingPrompt`, `contextPrompt`), `CodeEntityPromptConfigRecord:326` (`template{profileId, profileVersion}`), `DEFAULT_GENERATION_PROMPT_PROFILE_ID:24`, `DEFAULT_CODE_ENTITY_PROMPT_PROFILE_ID:26`.
  - Persistence: `infrastructure/core/persistence/templates.ts` — `loadSystemPromptTemplates:19` (seeds built-ins, migrates prompt variables on load), `saveSystemPromptTemplates:115`, `loadCodeEntityPromptTemplates(context, domainProfileId):122`, `saveCodeEntityPromptTemplates:153`; files `system-prompt-templates.json`, `code-entity-prompt-templates.json`; `infrastructure/core/persistence/generation.ts:54,66` (prompt configs are immutable — rewrite with different content throws).
  - Application: `application/studio/prompt-settings/service.ts` — `resolveSystemPromptTemplate:59`, `resolveCodeEntityPromptTemplate:38`, `saveSystemPromptTemplate:82` (validation-by-rendering for all four target kinds, `:142-178`), `resetSystemPromptTemplate:185`, `deleteSystemPromptTemplate:204`, and the code-entity equivalents `:215,:274,:295`; consumers `domain/studio/generation/prompt.ts` `createGenerationPromptConfig` and `application/studio/generation/codeEntityPrompt.ts` (snapshot at `:104`).
  - Routes: `GET/POST /api/studio/{system-prompt-templates,code-entity-prompt-templates}`, `PUT/DELETE /{family}/{id}`, `POST /{family}/{id}/reset`. Browser: `src/features/studio/prompt-settings/{SystemPromptSettingsDialog,PromptConfigDialog,PromptProfileSelector}.tsx`.
  - Contrast node (collapsed): Mapping prompts are **files, not records** — `infrastructure/mapping/agents/compaction/prompts/{compaction/*.md, system/codex.md}` loaded by `loadFileCompactionPrompts` and sha256-pinned into the run (`fileCompactionSettings.ts`), and the in-code renderers in `domain/mapping/selection/mappingPocPrompt.ts` / `domain/mapping/chat/localChatPrompt.ts`.
- **Boundary (OUT)**: prompt text; the generation sequencing that consumes the rendered prompts (CORE-7, STU-3); the experiment runner's own `{{value}}` prompt axis (STU-6).
- **Nodes**: `family` (system-prompt | code-entity-prompt) → `PromptTemplateSetRecord` (profile: `id`, `builtIn`, `version`, `prompts: name → NamedPromptTemplate`) → `targetKind` → `GENERATION_PROMPT_BINDINGS[targetKind]` → three prompt names → `render*Template` → `GenerationPromptConfigRecord.systemPrompt{profileId, profileVersion, promptName, rendered}` (immutable) ; parallel lane for code-entity: `CodeEntityPromptTemplateRecord` (chosen by domain profile) → `CodeEntityPromptConfigRecord.template{profileId, profileVersion}`; side nodes `createBuiltIn*` (reset source), `validatePromptTemplate`, `promptOptions`.
- **Edges / relationships**:
  - `resolve*Template(id?)` → default profile id when absent → **latest persisted revision** (`version` increments on save); a `promptTemplateId` in a request is *not* a historical config id.
  - `targetKind` → binding names (4 × 3 = 12 slots); `saveSystemPromptTemplate` proves a "standard" set by rendering every slot for every target kind (`:142-178`) — draw as a validation gate.
  - `render*` → `GenerationPromptConfigRecord` fields: system → `systemPrompt.rendered`; reference → `referencePrompt` (optional, only when `runReferencePrompt`); mapping → `mappingPrompt.template`, later rendered per turn by `renderMappingPromptTemplate` with `DEFAULT_MAPPING_FOLLOW_UP_PROMPT`.
  - `GenerationBatchRecord.promptConfigId` → config; config immutable (`generation.ts:54/66`); `DiagramRecord.generationPromptConfigId` back-reference — the provenance chain that lets a diagram be traced to the exact template version.
  - `reset` → `createBuiltIn*Templates(createdAt)` replaces the profile with the built-in text but keeps the id; `delete` refuses built-ins.
  - `loadWorkspace.ts:66` → `loadCodeEntityPromptTemplates(context, project.domainProfileId === "document" ? … )` — the family is profile-selected (SYS-5).
  - `templates.ts` load-time migration of prompt variables — "reading can write" (same pattern as CORE-4).
  - Contrast edge: Mapping prompt files → `FileCompactionRun.steps[stage].prompt` + `systemPromptSha256` (pinned per run, never versioned as records).
- **Notes for the renderer**: two lanes (system-prompt family top, code-entity family bottom) converging on the immutable config records at the right; the 4×3 binding matrix as a small table in the middle. Put the Mapping contrast node in a dashed box at the bottom-right labelled "the other prompt world."

---

### CORE-10 — Representation index → agent work scope → spatial progress
- **Provenance**: Core slice, D9. Placement Z5 Core (R4,C5).
- **Modifications**: Promoted from optional to full weight: its consumers span Studio (STU-4), Core highlights, Mapping compaction validation and the browser `DiagramView` (CORE-12) — see SYS-4.


- **Kind**: derivation chain + state machine
- **Question it answers**: How an ASCII artifact plus its evidence map becomes addressable element ids, how a
  work scope is validated against them, and what the rules are for advancing/merging agent progress.
- **Boundary (IN)**: `domain/core/representations/representationIndex.ts` in full —
  `RepresentationRevision` (:4), `EvidenceElementLink` (:9), `TreeRepresentationNode` (:15),
  `TreeRepresentationIndex` (:28), `DiagramRepresentationElement` (:35), `DiagramRepresentationIndex` (:44),
  `buildTreeRepresentationIndex` (:137), `buildDiagramRepresentationIndex` (:227),
  `buildRepresentationIndex` (:250), `treeRepresentationLineage` (:257), `treeRepresentationSubtree` (:273),
  `spatialEvidenceResolver` (:297), `representationElementIdForMapping` (:331),
  `assertRepresentationRevision` (:98), `isRepresentationRevisionCurrent` (:114);
  `domain/core/diagrams/asciiTree.ts` (`parseAsciiTree`);
  `domain/core/agent-work/agentWork.ts` in full — `AgentWorkTarget` (:16), `AgentWorkScope` (:30),
  `validateAgentWorkScope` (:108), `resolveAgentWorkScope` (:207), `SpatialProgressState` (:245),
  `SpatialProgressUpdate` (:254), `validateSpatialProgressState` (:313),
  `createSpatialProgressState` (:416), `updateSpatialProgressState` (:441),
  `mergeSpatialProgressStates` (:493), the `statusOrder` lattice (:429);
  consumers: `application/core/highlights/service.ts:162-213` (builds an index to derive
  `representationElementId` + `treeLineage` for `HighlightRecordV2`) and
  `infrastructure/core/persistence/highlights.ts:31` (`saveSpatialProgress`, keyed by AgentRun id).
- **Boundary (OUT)**: Studio's own use of the same module (`application/studio/representations/service.ts`,
  `application/studio/evidence-mapping/service.ts`) — collapse to one "Studio consumers" node.
- **Nodes**:
  - Inputs: `ascii`, `DiagramCodeEntityMapRecord`, `RepresentationRevision {artifactId, asciiSha256}`.
  - `buildRepresentationIndex({kind:"tree"|"diagram", …})` → `TreeRepresentationIndex` (pre-order nodes with
    `rootId`/`parentId`/`childIds`/`mappingIds`/`evidence`) or `DiagramRepresentationIndex` (elements in
    row/column order).
  - `AgentWorkTarget` variants: `artifact` | `tree-node` | `tree-subtree` | `diagram-element` | `evidence`.
  - `AgentWorkScope` = target + `revision` + `representationKind` (a discriminated union that forbids e.g.
    `diagram-element` on a tree).
  - `ResolvedAgentWorkScope {scope, elementIds[], locations[]}`.
  - `SpatialProgressState {scope, status, currentElementIds, visitedElementIds, completedElementIds, error?}`.
  - Status lattice `queued(0) → running(1) → failed(2) → complete(3)`.
- **Edges / relationships**:
  - Element ids are **scoped to the revision** (`revisionScope` = `encodeURIComponent(artifactId)@sha256`,
    `representationIndex.ts:71`), so a changed ASCII invalidates every id — the `stale-revision` validation
    code (`agentWork.ts:108-113`) is the enforcement point.
  - `validateAgentWorkScope` failure codes as labelled rejection edges: `stale-revision`,
    `representation-kind-mismatch`, `target-kind-mismatch`, `element-not-found`, `evidence-not-found`.
  - `resolveAgentWorkScope` expands a target into `elementIds` in **representation order**
    (tree pre-order / diagram row-column), using `treeRepresentationSubtree` for `tree-subtree`,
    `treeRepresentationLineage` for lineage, `resolveEvidenceElements` for `evidence`.
  - `updateSpatialProgressState` transitions: status may never move backward (`statusOrder` check, :455);
    `completed` and `visited` are **monotonic unions**; `current` is *replaceable* and is emptied unless
    status is `running`, and always minus `completed`; `visited` absorbs `current ∪ completed`;
    `error` survives only while `failed`, and `null` clears it. Every result is re-asserted against the index.
  - `mergeSpatialProgressStates` — a CRDT-shaped join: set union, status = lattice max, error = lexical min;
    documented as commutative/associative/idempotent (:486-489). Requires `sameScope` across inputs.
  - Additional progress validation codes: `element-outside-scope`, `duplicate-element`,
    `current-not-visited`, `completed-not-visited`, `current-already-completed`, `inactive-current-elements`.
  - Downstream: `WorkspaceSnapshot.spatialProgress: Record<agentRunId, SpatialProgressState>`;
    `HighlightRecordV2.representationElementId` + `treeLineage` come from the same index.
- **Notes for the renderer**: two halves — the derivation chain on the left (ascii + map → index → scope →
  resolved element ids) and the status lattice / set-monotonicity rules on the right. The lattice is small
  enough to draw literally as a 4-node partial order with the "never moves backward" edge constraint.

---

### CORE-11 — `LineGridScene`: canvas data model and pipeline
- **Provenance**: Shared-browser slice, D5. Placement Z5 Core (R4,C6).
- **Modifications**: Owned by `domain/core/diagrams/lineGrid.ts`; both Core and Mapping agents asked for this diagram. MAP-2 and MAP-3 cite it.

- **Kind**: data model / ER plus an operation pipeline
- **Question it answers**: What is the composable diagram-canvas document (boxes, groups, contents, collapse) and what sequence of pure functions turns it into rendered ASCII, resolved bounds, and hit results?
- **Boundary (IN)**:
  - `domain/core/diagrams/lineGrid.ts` — types `GridPoint`, `GridSize`, `GridBounds`, `CanvasDiagram`, `GridBox` (the `"diagram" | "container"` union), `LineGridScene`, `ResolvedGridBox`; functions `measureContent`, `boxesOverlap`, `resolveScene`, `flattenGrid`, `findCollisions`, `updateGridBox`, `layoutScene`, `composeScene`, `hitTest`, `projectMapping`; constants `MAX_EXTENT = 20000`, `MAX_CELLS = 4_000_000`
  - `domain/core/diagrams/projectDiagramCanvas.ts` — `ProjectDiagramContent` (`{kind:"ascii"} | {kind:"mapping-canvas", scene}`), `SaveProjectDiagramInput`, `singleDiagramScene`, `sceneFromRevision`, `projectCanvasSnapshot`
  - `domain/core/records/domain.ts#DiagramElementMapping` (terminal node — the thing `projectMapping` rebases)
  - Consumers shown as terminal nodes only: `src/features/mapping/MappingPage.tsx` (imports `sceneFromRevision`, `singleDiagramScene`), `src/features/mapping/canvas/MappingCanvas.tsx`, `src/server/routes/mapping/routes.ts:28-31` (`POST /api/mapping/diagrams` takes `SaveProjectDiagramInput`)
- **Boundary (OUT)**: the Mapping feature's React canvas internals (owned by another slice); the persistence format of `ProjectRepresentationRevisionRecord`; `AsciiSelectionGrid` (D4) — this model is the *other* diagram representation in the app and the contrast is the point.
- **Nodes**:
  - `LineGridScene { contents: Record<string, CanvasDiagram>; root: GridBox }`
  - `CanvasDiagram { id, revision, ascii, mappings[] }` — a referenced ASCII document with its own evidence mappings
  - `GridBox` — common fields `id`, `position: GridPoint` (relative to parent), `minimumSize?`, `collapsed`, `collapsedContentId?`
  - `GridBox.kind = "diagram"` — leaf, `contentId` into `scene.contents`
  - `GridBox.kind = "container"` — the *group*: `children: GridBox[]`, `layout: { collisionPolicy: "push-right"; gap }`
  - `ResolvedGridBox { box, bounds (absolute), contentId?, children }`
  - operations: `measureContent`, `resolveScene`, `layoutScene`, `composeScene`, `hitTest`, `findCollisions`, `updateGridBox`, `flattenGrid`, `projectMapping`
  - `ProjectDiagramContent` union and `SaveProjectDiagramInput`
- **Edges / relationships**:
  - `LineGridScene.root : GridBox` (composition, 1); `container.children : GridBox[]` (recursive composition)
  - `GridBox.contentId` / `collapsedContentId` → key of `scene.contents` (reference, resolved at `lineGrid.ts:79-83`, throws `Missing grid content` when dangling)
  - `collapsed && !contentId` → error (`:77`) — a collapsed box must supply substitute content
  - `measureContent(ascii)` → `GridSize`; rejects any character outside `\x20-\x7e\n` (`:50`) — printable 7-bit ASCII with LF only
  - `resolveScene` (`:61-100`): pre-order walk, `origin = parent + box.position`, size = content size, expanded to cover children (`:86-89`), then floored by `minimumSize` **only when not collapsed** (`:91-94`); validates every coordinate as an integer in `[0, 20000]`; rejects duplicate box ids
  - `layoutScene(scene, changedId)` (`:130-164`): re-settles siblings inside each container — the changed subtree is anchored first (sort key at `:138-141`), remaining boxes settle in stable spatial order and are only ever pushed **right** (`bounds.column = max(other.column + other.columns + gap)`, `:147-150`); each settled box becomes an immutable obstacle so the chain terminates; finally calls `composeScene` as a validation transaction before publishing (`:161-163`)
  - `composeScene` (`:166-192`): re-resolves, refuses `width*height > 4_000_000`, checks pairwise sibling overlap and throws `GridBox collision: a and b`, then paints each content's lines into a row buffer at its absolute origin
  - `hitTest(scene, point)` (`:194-207`): depth-first, children win over parents, returns `{ boxId, contentId?, local }` with `local` relative to the hit box — this is how a canvas pointer position becomes a position inside one embedded diagram
  - `projectMapping(bounds, mapping)` (`:209-211`): rebases a `DiagramElementMapping` (`line`, `startColumn`, `endColumn`, 1-based) into absolute 0-based scene `GridBounds` — the bridge between D4's per-diagram evidence coordinates and this scene's coordinates
  - `updateGridBox` — immutable tree edit, throws on unknown id; doc comment says to follow with `layoutScene`
  - `singleDiagramScene(ascii)` → a one-box scene; `sceneFromRevision(revision)` → scene from a persisted revision, falling back to `singleDiagramScene` for `kind:"ascii"` revisions; `projectCanvasSnapshot(scene, evidence)` → the save payload
  - `SaveProjectDiagramInput` → `POST /api/mapping/diagrams` (`src/server/routes/mapping/routes.ts:30`)
- **Notes for the renderer**: two panels. Left: the type/ER model with the `GridBox` discriminated union drawn as one box with two variant compartments, and the `contentId → contents[]` reference as a dashed lookup arrow. Right: the operation pipeline `updateGridBox → layoutScene → (resolveScene → composeScene) → ascii`, with `hitTest` drawn as a reverse arrow from a pointer icon back into the model. Annotate the coordinate conventions prominently: grid cells are zero-based with exclusive right/bottom edges (`lineGrid.ts:3`), while `DiagramElementMapping` is 1-based — that mismatch is exactly what `projectMapping` absorbs.

---

### CORE-4 — DiagramStore facade → filesystem modules → on-disk store
- **Provenance**: Core slice, D4. Placement Z5 Core (R5,C2).
- **Modifications**: MERGED with Tooling D1. Extend the disk tree with: `trash/diagram-sets/<setId>-<timestamp>/`, `migrations/<name>-<timestamp>.json` (observed historical journals; no in-repo writer today), `sources/*.txt` (document-domain inputs), `mapping/compactions/compaction-<uuid>/{source.txt,run.json,compact.*,refine.*}` and `mapping-workspace.json` (Mapping-owned stores under the same root), and the separate `.datasets/` root (`<catalog>/experiment.json`, `axes/…`, `diagram-collections/<id>/dataset.json`). Label `code-entity-maps/<artifactId>.json` "filename is the foreign key". Relabel the `loadWorkspace` edge as permitted (see CORE-1).


- **Kind**: module-decomposition map fused with a directory-layout tree
- **Question it answers**: What the `DiagramStore` facade actually delegates to, and which file on disk each
  capability module owns.
- **Boundary (IN)**:
  - `infrastructure/core/persistence/store.ts` — `DiagramStore` (:43), its `ids` factory bag (:47-61),
    `PersistenceContext` construction (:67), `projectCatalogs` field (:46), `loadWorkspace()` (:69).
  - `infrastructure/core/persistence/context.ts` — `PersistenceContext = Pick<DiagramRepository,
    'checkoutRoot'|'storeRoot'|'projectCatalogs'|'ids'>` (the whole file, 2 lines).
  - Modules: `projects.ts`, `artifacts.ts`, `generation.ts`, `runs.ts`, `imports.ts`, `plans.ts`,
    `highlights.ts`, `templates.ts`, `paths.ts`, `shared.ts`, `projectCatalogStore.ts`, `planMigration.ts`.
  - `paths.ts` path builders (all ~20 exported functions, :212-354) as the mapping to disk.
- **Boundary (OUT)**: the record field detail (D1) and the catalog transition logic (D2/D3). Studio/Mapping
  persistence (`infrastructure/studio/persistence/**`, `infrastructure/mapping/persistence/**`) appears only
  as one collapsed "feature stores (separate roots)" node.
- **Nodes**:
  - `DiagramStore` — thin facade; ~60 one-line methods, each `return <module>.<fn>(this.context, …)`.
  - `PersistenceContext` — the 4-field cut of `DiagramRepository` that every module takes as its first arg.
  - `projects.ts` — `ensureProject` / `createDiagramSet` / `moveDiagramSetToTrash` / `loadProject` /
    `loadDiagramSet` (+ legacy field back-fill at :157-164).
  - `artifacts.ts` — evidence sets, diagrams, components, edit sessions, code-entity maps, representation
    graphs, featured views; **read-time normalization** that back-fills `origin`, `recordOrigin`, and
    `SourceRange.id` and rewrites the file (:45-112).
  - `generation.ts` — prompt configs (immutable: rewrite with different content throws, :54/:66),
    generation batches, `ensureDiagramCandidateBatch` (:225), `beginBatch` (:265), `completeBatch` (:286).
  - `runs.ts` — AgentRun save/load, `attachRuns`, and the CodeEntitiesSet lifecycle
    (`beginCodeEntityCollection` / `completeCollection` / `failCollection`).
  - `imports.ts` — the `global-imports` library + `migrateLegacyImports` (:188), which relocates
    `origin:"imported"` artifacts out of DiagramSets into the shared library and rewrites both.
  - `plans.ts` — explodes one `PlanRecord` into a directory of small files and re-validates on read.
  - `highlights.ts` — single `highlights.json` + `spatial-progress.json`; dedupes on
    `(diagramSetId, artifactId, mappingId | representationElementId)` (:43-49).
  - `templates.ts` — built-in template seeding + prompt-variable migration on load (:30-…).
  - `paths.ts` — every path builder; calls `assertSafeId` before interpolating any id into a path.
  - `shared.ts` — `readJson`/`readJsonIfExists`/`writeJsonAtomic`, `makeId`, `stableScopedId`,
    corpus discovery (`discoverRepository` via `git rev-parse`, `discoverDocumentCorpus`), `projectIdFor`,
    `normalizedProject`.
  - `projectCatalogStore.ts` — separate adapter, owned by `DiagramStore.projectCatalogs` (see D3).
  - `planMigration.ts` — one-shot migration of legacy inline plan bundles; takes a whole `DiagramStore`.
  - Disk tree under `<checkoutRoot>/<NEW_DIAGRAMS_DIR default .diagrams>/`:
    `project.json`, `highlights.json`, `spatial-progress.json`,
    `system-prompt-templates.json`, `code-entity-prompt-templates.json`,
    `representations/catalog.json`, `corpus/compactions.json`,
    `imports/{library.json,diagrams/,diagram-components/,code-entities/,code-entity-maps/}`,
    `plans/<planId>/{plan.json,plan.md,selection.json,changes/<changeId>/{change.json,base.txt,output.txt,semantic-diff.json|base.json,output.json}}`,
    `diagram-sets/<setId>/{diagram-set.json,code-entities.json,diagrams/,diagram-components/,
    generation-batches/,diagram-candidate-batches/,generation-prompts/,code-entity-prompts/,runs/,
    edit-sessions/,code-entity-maps/,representation-graph.json}`,
    `trash/diagram-sets/<setId>-<timestamp>/`.
- **Edges / relationships**:
  - `DiagramStore.<method> → <module>.<fn>(this.context, …)` — delegation (draw one bundled edge per module,
    labelled with the method group, not 60 separate arrows).
  - `<module> → paths.<builder> → <disk node>` — "writes/reads this file".
  - `<module> → shared.writeJsonAtomic` — "atomic tmp+rename write"; `shared.readJson` enforces
    `schemaVersion === SCHEMA_VERSION` and throws on anything else (`shared.ts:139`).
  - Intra-module dependencies worth drawing: `runs.ts → artifacts.ts` (`loadCodeEntities`) and
    `runs.ts → generation.ts` (`saveCodeEntityPromptConfig`); `generation.ts → artifacts.ts` and
    `generation.ts → runs.ts` and `generation.ts → projects.ts`; `plans.ts → projects.ts` (`loadProject`).
  - `DiagramStore.loadWorkspace() → application/core/workspace/loadWorkspace.ts` — **inverted edge**:
    infrastructure calls into application to assemble the read model (`store.ts:3,:69`). Draw it distinctly;
    it is the one place the usual layering reads backwards.
  - `store.ts` re-exports `discoverRepository` / `discoverDocumentCorpus` / `discoverDomainCorpus` /
    `projectIdFor` from `shared.ts` (`store.ts:40`) — that re-export is what `bootstrap.ts:32` imports.
- **Notes for the renderer**: two columns — modules on the left, the disk tree on the right — with the path
  builders as the bridge. Annotate the three modules that perform silent read-time rewrites
  (`artifacts.ts`, `projects.ts`, `templates.ts`, plus `imports.migrateLegacyImports`): reading can write.

---

### CORE-6 — Catalog writes: three writers, one serialized transition
- **Provenance**: Core slice, D3. Placement Z5 Core (R5,C3).
- **Modifications**: ABSORBS Mapping D2 (server side). Keep all four writer lanes; the Mapping lane should show the `expectedRevisionId` guard → `ProjectDiagramConflict` → 409 explicitly. The browser-side rebase is in MAP-3.


- **Kind**: sequence diagram with a concurrency/lock lane
- **Question it answers**: How every mutation of the shared representation catalog is funnelled through one
  serialization queue and one set of pure transition functions, and where optimistic-revision conflicts are
  detected and turned into HTTP 409.
- **Boundary (IN)**:
  - Writers: `application/studio/candidates/service.ts:102` (`promoteProjectRepresentation` →
    `promoteRepresentation`), `application/mapping/diagrams/diagramService.ts:12`
    (`MappingDiagramService.save` → `saveMappingDiagram`),
    `application/core/representations/projectCatalogService.ts:70` (`ProjectCatalogService.saveProjection` →
    `saveProjectedTree`), `application/core/representations/service.ts:44`
    (`upsertProjectFileCompaction` → `upsertFileCompaction`).
  - Port: `application/core/ports/projectCatalogRepository.ts` (`ProjectCatalogRepository`).
  - Adapter: `infrastructure/core/persistence/projectCatalogStore.ts` — `serialize()` (:86-91),
    `loadRepresentationCatalog` (:152), `saveRepresentationCatalog` (:167), `catalogEnvironment()` (:226),
    `writeJsonAtomic` (:48), `readJsonIfExists` (:37).
  - Pure rules: `domain/core/representations/catalogRules.ts` — `CatalogEnvironment` (:20),
    `saveProjection` (:25), `saveProjectedTree` (:38), `saveMappingDiagram` (:137),
    `upsertFileCompaction` (:178), `promoteRepresentation` (:244), `clearActiveRepresentation` (:323),
    `archiveRepresentation` (:335).
  - Validation called from the rules: `validateProjection` / `buildProjectionTree`
    (`domain/core/diagrams/diagramProjection.ts:109,:77`), `projectCanvasSnapshot`
    (`domain/core/diagrams/projectDiagramCanvas.ts:44`), `validateCompactionProjection`
    (`domain/core/representations/compactionProjection.ts:28`), `assertSourceRange`/`assertSafeId`
    (`domain/core/records/domain.ts:991,:985`).
  - Error path: `ProjectDiagramConflict` (`domain/core/representations/errors.ts:1`) →
    `src/server/app/vitePlugin.ts:45` → HTTP 409.
- **Boundary (OUT)**: HTTP request decoding detail for Studio/Mapping routes (one collapsed node each);
  the filesystem layout (D4).
- **Nodes / lanes** (left → right):
  `Studio promote` · `Mapping canvas save` · `Core projection save` · `Core compaction upsert` ·
  `ProjectCatalogRepository (port)` · `ProjectCatalogStore.serialize (FIFO promise chain)` ·
  `read catalog.json` · `catalogRules.<transition> (pure)` · `writeJsonAtomic (tmp → rename)` ·
  `ProjectDiagramConflict → 409`.
- **Edges / relationships**:
  1. Each writer first resolves the Project (`store.loadProject()`), then calls the matching
     `projectCatalogs.*` method — **all four writers go through the same object instance**
     (`DiagramStore.projectCatalogs`, `infrastructure/core/persistence/store.ts:46,:66`).
  2. `serialize(write)` chains onto `this.representationWrite` and swallows the previous rejection
     (`.catch(() => undefined)`, `projectCatalogStore.ts:89`) so one failed write does not poison the queue.
     Note which methods are serialized: `saveProjection`, `saveProjectedTree`, `saveMappingDiagram`,
     `promoteRepresentation`, `clearActiveRepresentation`, `archiveRepresentation`.
     **`upsertFileCompaction` (:142) is NOT serialized** — it writes a different document. Worth an annotation.
  3. Inside the queue: load full catalog → build a `CatalogEnvironment` (`timestamp`, fresh
     `representation-<uuid>` / `representation-revision-<uuid>`, a sha256 `hash`, and a content-addressing
     `stableId`) → call the pure transition → write back **only if the transition returned a new object**
     (`if (result.catalog !== catalog)`, repeated at :97, :107, :116, :148, :180, :195, :209).
  4. Optimistic checks inside the transitions (draw as guard diamonds):
     - `saveMappingDiagram`: `current.currentRevisionId !== input.expectedRevisionId` → `ProjectDiagramConflict`
       (`catalogRules.ts:143-145`).
     - `promoteRepresentation`: `draft.expectedRevisionId !== current?.currentRevisionId` → conflict (:255);
       also a hard error if `viewKind`/`representationKind` would change between revisions (:258).
     - `saveProjectedTree`: source representation must still be settled **and** still be at
       `input.sourceRevisionId` (:47); target must match `expectedTargetRevisionId` *or already equal the
       computed content-addressed revisionId* (:60) — the idempotent-reimport escape hatch.
     - `saveProjection`: an existing projection with different JSON → "Projection is immutable" (:29).
     - `upsertFileCompaction`: an existing id whose content differs (ignoring `updatedAt`) →
       "conflicting Project compaction" (:226).
  5. Idempotency edges: `saveProjectedTree` returns the untouched catalog when the projection id already
     exists (:123); `promoteRepresentation` reuses an existing revision whose
     `(asciiSha256, evidence, mappings)` signature matches instead of appending a new one (:264-269).
  6. Write: `writeJsonAtomic` writes `.<name>.<pid>.<uuid>.tmp` then `rename()`.
  7. Failure edge: `ProjectDiagramConflict` propagates up through the route to `vitePlugin.ts:45`, which maps
     it to 409 (and `ApplicationError` codes to 409/400/415/503).
- **Notes for the renderer**: make the serialization queue a visually distinct vertical bar spanning the
  read→transition→write span (that's the "queue held around the complete read, transition and atomic write"
  invariant from `docs/architecture/file-layout.md`). Keep the pure-domain column visually separate — it does
  no I/O and receives clock + ids through `CatalogEnvironment`. Show the three *different* writers converging
  on the same bar: that convergence is the point of the diagram.

---

## Appendix — Absorbed proposals (reference material for the merged diagrams)

These five slice proposals were merged into other diagrams (Part A.1). They are reproduced verbatim so the generator of the
absorbing diagram has the full source; they are **not** diagrams to generate.

### [absorbed] Studio D6 — Studio record model
- **Disposition**: absorbed into CORE-3.


- **Kind**: data model / ER diagram (persisted records and their id references).
- **Question it answers**: Which records a DiagramSet aggregates, how a generated artifact traces back to the exact prompt config, agent run, code-entity revision, and evidence spans that produced it, and where Studio's records hand off to Core's project representation catalog.
- **Boundary (IN)** (types in `domain/core/records/domain.ts` unless noted; Studio writes them, Core owns the schema module):
  `ProjectRecord`, `DiagramSetRecord`, `CodeEntitiesSetRecord`, `CodeEntityRecord` + `SourceRange`, `CodeEntityPromptConfigRecord`, `CodeEntityPromptTemplateRecord`, `SystemPromptTemplateRecord`, `GenerationPromptConfigRecord` (+ `GenerationPromptReference`, `GenerationDerivationRecord`, `GenerationReferenceSelection`), `GenerationBatchRecord`, `DiagramCandidateBatchRecord`, `AgentRunRecord`, `DiagramRecord`, `DiagramComponentRecord`, `DiagramCodeEntityMapRecord`, `EditSessionRecord` + `EditOperationRecord`, `ImportedArtifactLibraryRecord`, `WorkspaceSnapshot`;
  plus `domain/core/representations/representationGraph.ts` (`RepresentationGraphRecord`, `RepresentationLayerRecord`, `RepresentationTransitionRecord`, `RepresentationFeedbackRecord`, `RepresentationRecipe`) and `domain/core/representations/projectCatalog.ts` (`ProjectRepresentationRecord`, `ProjectRepresentationRevisionRecord`, `ProjectRepresentationEvidenceRecord`, `ProjectRepresentationMappingRecord`, `ProjectRepresentationCatalogRecord`).
- **Boundary (OUT)**: Plans, highlights, corpus compactions, projections, Mapping workspace records — omit or show `ProjectRecord` with a single "other Core catalogs" stub; the filesystem path layout under `.diagrams/`.
- **Nodes** (with the identifying fields worth printing):
  - `ProjectRecord` {id, repositoryIdentity, domainProfileId, corpus, diagramSetIds}
  - `DiagramSetRecord` {id, projectId, codeEntitiesSetId, featuredViewIds, diagramIds, diagramComponentIds, generationBatchIds, agentRunIds, editSessionIds, readiness, creationMode}
  - `CodeEntitiesSetRecord` {id, diagramSetId, revision, status, entities, promptConfigId}
  - `CodeEntityRecord` {id, origin{projectId,diagramSetId,codeEntitiesSetId}, handle, category, sourceRanges[]}
  - `SourceRange` {id, path, startLine, endLine, symbol, compactedSource, originalLines}
  - `CodeEntityPromptTemplateRecord` {id, builtIn, version, prompts["code-entity-identification"|"code-entity-compaction"]}
  - `CodeEntityPromptConfigRecord` {id, diagramSetId, template{profileId,profileVersion}, contextPrompt.rendered}
  - `SystemPromptTemplateRecord` {id, builtIn, version, prompts: Record<name, NamedPromptTemplate>}
  - `GenerationPromptConfigRecord` {id, diagramSetId, outputKind, viewKind, modelId, selectedCodeEntityIds, references[], omittedReferences[], referencePrompt?, mappingPrompt, derivation?, contextPrompt, systemPrompt{profileId,profileVersion,promptName}}
  - `GenerationBatchRecord` {id, promptConfigId, codeEntitiesRevision, childRunIds, outputDiagramIds, outputDiagramComponentIds, diagramCandidateBatchId?, status}
  - `DiagramCandidateBatchRecord` {id, generationBatchId, diagramIds (immutable membership), rankings}
  - `AgentRunRecord` {id, kind, status, generationBatchId?, outputSlot, codeEntitiesRevision, outputDiagramId?/outputDiagramComponentId?, sessionId, model}
  - `DiagramRecord` {id, viewKind, representationKind, handle, ascii, codeEntityIds, origin("generated"|"edited"|"selection"|"materialized"|"imported"), producedByRunId, generationPromptConfigId, editSessionId?, derivedFromDiagramIds, basedOnDiagramId?, archivedAt?}
  - `DiagramComponentRecord` {…, sourceDiagramId?, sourceDiagramComponentId?, selectionBounds?, derivedFromDiagramComponentIds}
  - `DiagramCodeEntityMapRecord` {diagramSetId, artifactKind, artifactId, asciiSha256, mappings[{entityId, sourceRangeIndex, line, startColumn, endColumn}], origin("agent"|"materialized"), producedByRunId}
  - `EditSessionRecord` / `EditOperationRecord`
  - `RepresentationGraphRecord` {layers[{artifactRevision{artifactId,asciiSha256}, informationRank, representationKind, evidenceReferences}], transitions, recipes, feedback}
  - `ProjectRepresentationRecord` / `ProjectRepresentationRevisionRecord` {evidence, mappings, provenance{diagramSetId, artifactId}}
  - `ImportedArtifactLibraryRecord`
  - `WorkspaceSnapshot` (the aggregate read model returned by nearly every operation)
- **Edges / relationships**:
  - `ProjectRecord` 1—N `DiagramSetRecord`; `DiagramSetRecord` 1—1 `CodeEntitiesSetRecord`; 1—N each of batches, runs, diagrams, components, edit sessions (by id list).
  - `CodeEntitiesSetRecord` 1—N `CodeEntityRecord` 1—N `SourceRange`; `CodeEntityRecord.origin` back-references project/set/entity-set.
  - `CodeEntityPromptTemplateRecord` --snapshotted into--> `CodeEntityPromptConfigRecord.template{profileId, profileVersion}` (codeEntityPrompt.ts:104); `CodeEntitiesSetRecord.promptConfigId` --points at--> that config. Templates are mutable and versioned; configs are immutable snapshots — label this pair.
  - `SystemPromptTemplateRecord` --snapshotted into--> `GenerationPromptConfigRecord.systemPrompt{profileId, profileVersion, promptName, rendered}`; `promptName` resolves through `GENERATION_PROMPT_BINDINGS[targetKind]` (see D8's sibling note / `domain/core/prompts/prompt.ts:56`).
  - `GenerationBatchRecord.promptConfigId` → `GenerationPromptConfigRecord`; `.codeEntitiesRevision` pins `CodeEntitiesSetRecord.revision` and is re-checked in `beginBatch`/`completeBatch` (generation.ts:266, 287).
  - `GenerationBatchRecord.childRunIds` → `AgentRunRecord[]`; `AgentRunRecord.outputDiagramId` → `DiagramRecord`; `DiagramRecord.producedByRunId` → the run and `.generationPromptConfigId` → the config (a two-way provenance pair).
  - `GenerationBatchRecord.diagramCandidateBatchId` → `DiagramCandidateBatchRecord`, whose `diagramIds` is immutable and whose `rankings` is the only mutable field.
  - `DiagramRecord.codeEntityIds` → `CodeEntityRecord[]`; `DiagramCodeEntityMapRecord.(artifactKind, artifactId)` → the artifact, `.mappings[].entityId` → CodeEntity, `.mappings[].sourceRangeIndex` → that entity's range by position, `.asciiSha256` pins the artifact text the mappings were computed against.
  - `DiagramRecord.derivedFromDiagramIds` / `DiagramComponentRecord.derivedFromDiagramComponentIds` form the lineage DAG rendered by `DiagramLineagePanel`; `.basedOnDiagramId` links an auxiliary view (call-graph / dir-view) back to its settled main diagram (generation/service.ts:307).
  - `EditSessionRecord.sourceArtifactId` → source artifact; `.outputArtifactId` → the new copy; `DiagramRecord.editSessionId` → back to the session.
  - `ImportedArtifactLibraryRecord` supplies additional diagram/component/code-entity ids that generation and edit-handle uniqueness both read (generation/service.ts:93–99, editing/service.ts:266–272).
  - Promotion hand-off: `candidates/service.promoteProjectRepresentation` --transforms--> `CodeEntityRecord` + `DiagramCodeEntityMapRecord` into `ProjectRepresentationEvidenceRecord` + `ProjectRepresentationMappingRecord`, with ids derived by `stableProjectId("evidence"|"evidence-range"|"representation-map", …)` so the same diagram promotes to the same ids twice (candidates/service.ts:33, 41, 94). `ProjectRepresentationRevisionRecord.provenance{diagramSetId, artifactId}` is the back-pointer. Draw this as a labeled boundary crossing into Core's catalog.
  - `RepresentationGraphRecord.layers[].artifactRevision` pins `{artifactId, asciiSha256}`; `saveRepresentationGraph` rejects a stale sha or a mismatched `representationKind` (representations/service.ts:36–49).
  - `WorkspaceSnapshot` --aggregates by id--> essentially every node; draw it once on the side with a dashed "read model of" boundary rather than N edges.
- **Notes for the renderer**: Three clusters: (1) evidence — project/set/entities/ranges/templates/configs; (2) production — batches/runs/prompt configs/candidate batches/artifacts/maps/edit sessions; (3) settled output — representation graph and Core's project representation catalog. Put the "immutable snapshot of a mutable template" pairs side by side and label them. Use a distinct arrow style for `stableProjectId`-derived (deterministic) references.

---

### [absorbed] Studio D7 — NDJSON streaming protocol (Studio)
- **Disposition**: absorbed into SYS-6.


- **Kind**: event/stream protocol + request/response sequence, with the event shapes as a small schema panel.
- **Question it answers**: What exactly travels over the four streaming Studio endpoints, why HTTP 200 alone does not mean success, and how a stream's `workspace` payload lands in React state.
- **Boundary (IN)**:
  - Producer type: `application/studio/shared.ts` `ServiceEvent {type: "progress" | "workspace", message, workspace?, artifactKind?, artifactId?, status?}`
  - Emitters: `collection/service.collectCodeEntities` (`onEvent` progress + final workspace), `generation/service.generate` (batch start, per-slot `slot N: <message>`, "validating complete parallel batch", final workspace), `evidence-mapping/service.mapCodeEntitiesBatch` (per-target progress with `artifactKind`/`artifactId`/`status`), `editing/service.llmEdit`, `collection/diagramSetWorkflow.run` (emits its own `{type:"created"}` and `{type:"result"}` shapes, *not* `ServiceEvent`)
  - Transport: `src/server/http/http.ts` `sendEvent` (writes `JSON.stringify(payload) + "\n"`, guarded by `!destroyed && !writableEnded`), `sendJson`, `readBody`
  - Streaming routes in `src/server/routes/studio/routes.ts`: `POST /api/studio/diagram-sets` (:362–373), `POST .../code-entity-maps` (:461–472), `POST .../{diagrams|components}/{id}/code-entity-map` (:475–490), `POST .../edit-sessions/{id}/llm` (:539–556), `POST .../generate` (:711–740). Each sets `content-type: application/x-ndjson; charset=utf-8`, `cache-control: no-cache, no-transform`, calls `flushHeaders()`, and appends a terminal `{type:"result", …}` line.
  - Browser consumers in `src/features/studio/api.ts`: `generateArtifacts` (:636–690), `mapCodeEntities` (:302–351), `mapCodeEntitiesBatch` (:358–414), `applyLlmEdit` (:478–525), `createMaterializedDiagramSet` (:43–73, buffers the whole body instead of streaming). All share the reader/decoder/`buffer.split("\n")`/`buffer.pop()` idiom plus a trailing-partial-line flush, and all throw if the stream ends without a `workspace`.
  - UI sinks in `src/features/studio/StudioPage.tsx`: `setProgress` (generation), `setEditProgress` (llm edit), `setMappingJobs` keyed by `mappingJobKey(setId, target) = "${setId}:${artifactKind}:${artifactId}"` (:151), `mergeMappingWorkspace` (:155–175), `setWorkspace`
- **Boundary (OUT)**: Non-streaming JSON routes (they are covered structurally by D1); Mapping's NDJSON endpoints (same helpers, different owner — mention as a shared-helper note only); the Vite middleware mounting.
- **Nodes / lifelines**: capability service (`onEvent` callback) · route handler · `sendEvent` · HTTP response body · `apiFetch` + `ReadableStreamDefaultReader` · line-buffer parser · React state setters
- **Edges / relationships** (ordered, with the event vocabulary as a side panel):
  1. Route validates the body, sets `statusCode = 200` + NDJSON headers, `flushHeaders()` — **before** the operation runs, so status alone carries no outcome.
  2. Service calls `onEvent({type:"progress", message})` repeatedly → `sendEvent` → one JSON line.
  3. Mapping events additionally carry `{artifactKind, artifactId, status}` so a single stream multiplexes N concurrent jobs; the client demultiplexes by `mappingJobKey`.
  4. Service calls `onEvent({type:"workspace", message, workspace})` at the end of the operation → one large line.
  5. Route appends `{type:"result", workspace}` (generation, llm edit, single mapping) or `{type:"result", workspace, results}` (batch mapping) then `response.end()`.
  6. `DiagramSetWorkflow.run` emits a different vocabulary on the create stream: `{type:"created", diagramSetId, projectRoot, domainProfileId, promptTemplateId, codeEntityPromptTemplateId}` then interleaved collection + generation `ServiceEvent`s then `{type:"result", diagramSetId, promptTemplateId, promptTemplateVersion, generationPromptConfigId, codeEntityPromptTemplateId, codeEntityPromptTemplateVersion, codeEntityPromptConfigId, workspace}` (diagramSetWorkflow.ts:75–137). Materialized mode emits `created` + `result` with `codeEntityIdsByKey`/`diagramIdsByKey` and no progress lines.
  7. Client loop: `reader.read()` → `decoder.decode(value, {stream: !done})` → split on `\n` → `pop()` the partial tail → parse each complete line; after `done`, parse any remaining buffer. An `{type:"error", error}` line throws; every `message` goes to the progress callback; every `workspace` overwrites the local candidate.
  8. Client post-condition: `if (!workspace) throw new Error("… stream ended without a workspace result")` — the explicit reason HTTP 200 is insufficient. Batch mapping additionally requires `results`.
  9. `StudioPage` applies the generation workspace wholesale (`setWorkspace(next)`) but applies the *mapping* workspace through `mergeMappingWorkspace`, which merges only `agentRunIds`, `agentRuns`, `spatialProgress`, and `codeEntityMaps` onto the current snapshot (StudioPage.tsx:155–175) — draw this asymmetry, it is the interesting client-side rule (mapping runs concurrently with other edits, so a full overwrite would clobber).
- **Notes for the renderer**: One sequence with a `loop [per event]` frame, and a separate compact table/panel enumerating the five line shapes (`progress`, `workspace`, `result`, `created`, `error`) with their fields and which endpoints emit them. Mark the header-flush and the terminal `result` line as the two protocol invariants. Note in a caption that the NDJSON helpers in `src/server/http/http.ts` are shared with Mapping.

---

### [absorbed] Mapping D2 — Canvas save path
- **Disposition**: server half absorbed into CORE-6, browser half into MAP-3.

- **Kind**: sequence diagram (with the conflict branch)
- **Question it answers**: Exactly what happens between clicking **Save** on the mapping canvas and a new immutable revision existing, and how `expectedRevisionId` turns a concurrent edit into a 409 the user must reload past.
- **Boundary (IN)**:
  - `src/features/mapping/MappingPage.tsx` — `save()` at lines 153–167, and `create()` at 168–177.
  - `src/features/mapping/workspace/mappingProjectApi.ts:6` `saveMappingProjectDiagram`.
  - `src/shared/http/http.ts` `apiFetch` / `errorFrom` (collapsed into the client node).
  - `src/server/routes/mapping/routes.ts:28–31` (`POST /api/mapping/diagrams`).
  - `application/mapping/diagrams/diagramService.ts:10–13` `MappingDiagramService.save`.
  - `infrastructure/core/persistence/projectCatalogStore.ts:112–120` `saveMappingDiagram` (the serialization queue).
  - `domain/core/representations/catalogRules.ts:137–176` `saveMappingDiagram`.
  - `domain/core/diagrams/projectDiagramCanvas.ts:44–84` `projectCanvasSnapshot`.
  - `domain/core/representations/errors.ts` `ProjectDiagramConflict`.
- **Boundary (OUT)**: The catalog JSON file layout on disk (one node "representations/catalog.json"). Core's project bootstrap (`ensureProject` / `corpus.discover`) shown as one alternative step. The undo history and workspace snapshot (D4).
- **Nodes / lifelines**: `MappingPocPage.save()` → `saveMappingProjectDiagram` → `POST /api/mapping/diagrams` → `MappingDiagramService` → `ProjectCatalogStore.serialize()` → `catalogRules.saveMappingDiagram` → `projectCanvasSnapshot` → `catalog.json`.
- **Edges / relationships (ordered)**:
  1. `save()` captures the current draft and posts `{ projectId, representationId, expectedRevisionId: draft.revisionId, name, scene: draft.document.scene }` (`MappingPage.tsx:159–160`). `create()` posts the same shape without `representationId`, with either `sourceRevisionId + scene` (copy current, keeping evidence) or `singleDiagramScene(newAscii)`.
  2. `MappingDiagramService.save` resolves the project: `loadProject()` **or** `ensureProject(corpus.discover(root, profile))` (`diagramService.ts:11`).
  3. Calls `projectCatalogs.saveMappingDiagram(project.id, input)`, which runs inside a **serialization queue** around read → transition → atomic write (`projectCatalogStore.ts:113–118`) — the mechanism that makes concurrent saves ordered rather than interleaved.
  4. `catalogRules.saveMappingDiagram` validates: foreign `projectId` → error (`:138`); name 1–120 chars (`:139`); unknown representation → error (`:142`); **archived, or `currentRevisionId !== expectedRevisionId` → `ProjectDiagramConflict`** (`:143–145`) → HTTP 409.
  5. Evidence for the new revision is **inherited from the source revision**, never supplied by the client: `evidence = source?.evidence ?? {}` (`:149`).
  6. `projectCanvasSnapshot(scene, evidence)` validates the whole scene — including collapsed content — and derives `ascii` (composed) + absolute-coordinate `mappings` (`projectDiagramCanvas.ts:44–84`).
  7. A new `ProjectRepresentationRevisionRecord` is appended with `content = { kind:'mapping-canvas', scene }`, `ascii`, `asciiSha256`, `evidence`, derived `mappings`, `revision = previousCount + 1` (`catalogRules.ts:155–162`); the representation's `revisionIds` grows — history is append-only.
  8. Response `{ project, catalog, representation }` → `setSnapshot(result)`, and the draft's `savedScene` / `savedName` / `revisionId` are rebased to the new revision (`MappingPage.tsx:161–164`) so `dirty()` flips back to clean.
  9. Conflict branch: `errorFrom(response)` throws → `setError(...)` → banner; the draft keeps its edits, the user must reload/reopen.
- **Notes for the renderer**: Draw the serialization queue as a box spanning steps 3–7 ("one read → transition → atomic write, serialized"). Put the 409 as an `alt` fragment at step 4 returning to the browser. Annotate step 5 with "client scene cannot introduce new evidence" and step 6 with "collapsed content is validated too".

---

### [absorbed] Tooling D1 — The `.diagrams` on-disk store
- **Disposition**: absorbed into CORE-4.

- **Kind**: data model / ER over a filesystem layout (directory tree + foreign-key edges)
- **Question it answers**: What exactly does the server write into a `.diagrams` store, which file holds which record, and how do the records reference each other across directories?
- **Boundary (IN)**:
  - Path constructors that define every location: `infrastructure/core/persistence/paths.ts` (all exported functions, lines 7–148)
  - `infrastructure/core/persistence/projectCatalogStore.ts:122` (`corpus/compactions.json`) and `:126` (`representations/catalog.json`)
  - `infrastructure/core/persistence/projects.ts:110-125` (`moveDiagramSetToTrash`, writes `trash/diagram-sets/<setId>-<ISO timestamp with ':' and '.' replaced by '-'>/`)
  - `infrastructure/core/persistence/store.ts:63-67` (`DiagramStore(checkoutRoot, diagramsDirectory = ".diagrams")`, `storeRoot = resolve(checkoutRoot, diagramsDirectory)`)
  - The concrete example store `.diagrams-parent-architecture/` (its `project.json`, `diagram-sets/set-*/`, `representations/catalog.json`, `corpus/compactions.json`, `plans/`, `migrations/`, `trash/`), plus `.diagrams/imports/` and `.diagrams/sources/` for the directories the parent-architecture example lacks.
- **Boundary (OUT)**: the application/domain services that produce the records (`application/core/**`, `domain/core/records/domain.ts`) — collapse to one node "server (only writer)"; the individual TypeScript record interfaces; `.diagrams-code/` (a second sample of the same shape); plan bundle internals (that is D2).
- **Nodes** (group as directories containing record-file nodes):
  - Store root `.diagrams/` (name configurable via `NEW_DIAGRAMS_DIR`) — resolved relative to the corpus checkout.
  - `project.json` — `ProjectRecord`: `{schemaVersion, id, name, repositoryIdentity, canonicalRepoRoot, domainProfileId, corpus:{kind,root}, diagramSetIds[], createdAt, updatedAt}`. One project per store.
  - `highlights.json`, `spatial-progress.json` — flat singleton files.
  - `system-prompt-templates.json`, `code-entity-prompt-templates.json` — template families used by the skill's template lookup.
  - `diagram-sets/<setId>/` — one directory per DiagramSet. Inside:
    - `diagram-set.json` — `{id, projectId, name, initialPrompt, sourceCheckoutRoot, gitRevision, codeEntitiesSetId, featuredViewIds[], diagramIds[], diagramComponentIds[], generationBatchIds[], agentRunIds[], editSessionIds[], readiness, creationMode}`
    - `code-entities.json` — immutable `CodeEntitiesSet` `{id, diagramSetId, revision, status, entities[], finalizedAt}`
    - `diagrams/<diagramId>.json` — `{id, recordOrigin, diagramSetId, viewKind, handle, name, ascii, representationKind, codeEntityIds[], origin, derivedFromDiagramIds[]}`
    - `diagram-components/<componentId>.json`
    - `code-entity-maps/<artifactId>.json` — `{artifactKind, artifactId, asciiSha256, mappings[], origin}` (keyed by the *artifact* id, not its own id)
    - `generation-batches/<batchId>.json`, `diagram-candidate-batches/<id>.json`
    - `generation-prompts/<promptConfigId>.json`, `code-entity-prompts/<promptConfigId>.json` — immutable prompt configs
    - `runs/<runId>.json` — AgentRun records
    - `edit-sessions/<sessionId>.json` — `{baseAscii, workingAscii, operations[], operationCursor, revision, status}`
    - `representation-graph.json`
  - `representations/catalog.json` — one large file: `{schemaVersion, projectId, activeByKind:{viewKind→representationId}, representations:{id→ProjectRepresentationRecord}, revisions:{id→revision}, projections:{id→ProjectProjectionRecord}}`. Representation = `{id, handle, name, viewKind, representationKind, status, currentRevisionId, revisionIds[]}`; revision = `{id, representationId, revision, ascii, asciiSha256, evidence:{id→{handle,label,category,summary,sourceRanges[]}}, mappings:[{id,evidenceId,sourceRangeId,line,startColumn,endColumn}], provenance, content}`; projection = `{sourceRepresentationId, sourceRevisionId, targetRepresentationId, targetRevisionId, match, links}`.
  - `corpus/compactions.json` — `{projectId, activeByPath:{path→id}, compactions:{id→record}}`
  - `imports/library.json` + `imports/diagrams/<id>.json`, `imports/diagram-components/<id>.json`, `imports/code-entities/<id>.json`, `imports/code-entity-maps/<artifactId>.json` — project-scoped, set-independent artifacts. `library.json` = `{diagramIds[], diagramComponentIds[], codeEntityIds[], codeEntityMapArtifactIds[]}`
  - `plans/<planId>/` — plan bundles (expanded in D2)
  - `trash/diagram-sets/<setId>-<timestamp>/` — whole set directory moved intact on DELETE
  - `migrations/<name>-<timestamp>.json` — migration journals (observed in the example store: `project-catalog-v1-*.json`, `legacy-featured-representations-*.json`)
  - `sources/*.txt` — raw corpus inputs for document-domain stores (`.diagrams/sources/brendan-foody-20vc-transcript.txt`, `…-call-graph.txt`)
  - "server process (only writer)" — single external node
- **Edges / relationships**:
  - `project.json --diagramSetIds[]--> diagram-sets/<setId>/diagram-set.json` (containment + id list)
  - `diagram-set.json --codeEntitiesSetId--> code-entities.json`; `--diagramIds[]--> diagrams/*.json`; `--editSessionIds[]--> edit-sessions/*.json`; `--generationBatchIds[]--> generation-batches/*.json`; `--agentRunIds[]--> runs/*.json`
  - `diagrams/<id>.json --codeEntityIds[]--> entities inside code-entities.json` (cross-file reference by id)
  - `code-entity-maps/<artifactId>.json --artifactId--> diagrams/<artifactId>.json or diagram-components/<artifactId>.json` (filename *is* the foreign key; see `codeEntityMapPath`, paths.ts:141)
  - `representations/catalog.json.revisions[*].provenance --{diagramSetId, artifactId}--> diagrams/<id>.json` (promotion provenance; used by `examples/mapping-screen/import.ts:63-66` to find a promoted representation)
  - `catalog.json.representations[*].currentRevisionId/revisionIds[] --> catalog.json.revisions` (immutable revision history, append-only)
  - `catalog.json.projections[*] --sourceRevisionId/targetRevisionId--> catalog.json.revisions` (pinned both ends)
  - `catalog.json.activeByKind --> representations` (one active representation per view kind)
  - `plans/<id>/plan.json --projectId--> project.json` (savePlan rejects a plan from another project, `infrastructure/core/persistence/plans.ts` `savePlan`)
  - `server --atomic write (tmp file + rename)--> every JSON file` (`writeJsonAtomic`, projectCatalogStore.ts:48-57 and `persistence/shared.ts`); `ProjectCatalogStore.serialize` (projectCatalogStore.ts:86-91) serializes *all* catalog read-modify-write cycles into one promise chain
  - `DELETE /api/studio/diagram-sets/{set} --rename--> trash/diagram-sets/<setId>-<timestamp>/`
- **Notes for the renderer**: draw as a directory tree on the left with record-file leaves, and dashed foreign-key arrows crossing between subtrees. Emphasize three distinct id spaces: set-scoped artifacts (`diagram-sets/<setId>/…`), project-scoped imports (`imports/…`), and the single-file catalog (`representations/catalog.json`) that holds representation+revision+projection together. Mark `catalog.json` as "single file, serialized writer, 3.3 MB in the sample store". Mark `code-entities.json`, revisions, and prompt-config files as immutable.

---

### [absorbed] Tooling D8 — Source-pane performance runner
- **Disposition**: absorbed into TOOL-6 as an inset.

- **Kind**: instrumented control flow / measurement pipeline
- **Question it answers**: How does `tests/performance/browser-source-pane-performance.mjs` actually measure a gesture, what four independent signals does it collect, and which of them are hard pass/fail gates rather than reported numbers?
- **Boundary (IN)**: `tests/performance/browser-source-pane-performance.mjs` in full — the fixture build (lines 122–152), server spawn (:150-153), browser session (:154-259), `measure(cdp, kind, count, trial)` (:60-119), helpers `metrics` (:26), `percentile` (:27), `point`, `click`, `settle` (:43), `reload` (:46), `positions` (:55), report assembly (:260-263); its inputs `tests/fixtures/source-pane-performance/workspace.json` and `tests/fixtures/source-pane-performance/source.mjs`; the fixture generator `scripts/fixtures/create-source-pane-performance-fixture.mjs`; `tests/browser/support/browser-source-navigation-check.mjs` (invoked at :254 when `SOURCE_NAVIGATION=1`); outputs under `artifacts/source-pane-performance/` (`before.json`, `after.json`, `navigation-collapsed.json`, `navigation-expanded.json`, `*.workspace.json`, `*.png`, `comparison.md`, `navigation-comparison.md`).
- **Boundary (OUT)**: the source-pane React implementation being measured (one node "source viewer under test"); the general browser checks (D7).
- **Nodes**:
  - Env switches: `SOURCE_PERF_BASELINE=1` (disables the hard gates so a pre-fix baseline can be recorded), `SOURCE_PERF_EXPLORERS=1` (shifts selection nodes 180px left and opens each pane's file explorer), `SOURCE_PERF_TRIALS` (0–4, default 3), `SOURCE_PERF_REPORT`, `SOURCE_NAVIGATION=1` (adds `--lsp` to the server and runs the navigation check)
  - Fixture assembly: temp `git init` repo + `src/large.ts` (3,000 lines), `src/math.ts`, `src/main.ts`, `tsconfig.json`; `workspace.json` read as text and `replaceAll('performance-fixture', projectId)` so the canonical fixture is rebound to the disposable project; a hand-built `.diagrams/representations/catalog.json` with two representations (`source`, `other`) whose revision `content = {kind:'mapping-canvas', scene}`; `.diagrams/mapping-workspace.json`
  - Instrumentation installed inside the page before each gesture (`window.__sourcePerf`): (a) a `requestAnimationFrame` tick loop recording frame intervals; (b) a monkey-patched `window.getComputedStyle` counting reads on `.source-code-chunk`; (c) a `MutationObserver` on every `.source-code-content` (subtree, childList, attributes, characterData) counting records; (d) a `PerformanceObserver({type:'longtask'})`
  - Gesture loop: 40 steps at a 1000/60 ms cadence; `drag` = middle-button press, a triangular move path, release (with a mid-gesture assertion that the canvas transform *did* change); `scroll` = 40 `mouseWheel` deltaY 60 events, then `waitFor` the target pane to have scrolled the full requested distance
  - CPU sampling: `Performance.getMetrics` before/after, differenced into `mainThreadMs (TaskDuration)`, `scriptMs`, `layoutMs`, `styleMs` (×1000 s→ms)
  - Derived per-observation row: `{panes, gesture, trial, elapsedMs, mainThreadMs, scriptMs, layoutMs, styleMs, frameP95Ms, frameMaxMs, frames, framesOver25Ms, longTasks, chunkReads, sourceMutations}` (first frame interval dropped)
  - Correctness gates inside `measure`: canvas transform unchanged at the end; drag must preserve **every** pane's viewport (`deepEqual(final, initial)`); scroll must move only pane 1 (panes 2..N unchanged); and unless `baseline`, `chunkReads === 0` ("gestures must not remeasure the full source") and `sourceMutations === 0` ("gestures must not rebuild source rows or reset block containment")
  - Sweep: collapse panes 5→2, then for `count = 1..5` expand one more pane, wait for exactly `count` highlighted viewers, and run `trials × {drag, scroll}`
  - Persistence phase (after the sweep): independent per-pane horizontal+vertical scroll; save with pane 5 collapsed and the document inactive; assert inactive documents retain offsets; reload; activate a background document and assert its viewport restores; immediate save captures the live position; export via `Browser.setDownloadBehavior` (with a WSL `wslpath` conversion) and assert the export samples live position without a prior save; restore discards the newer runtime cache; reload restores all five positions; collapse/reopen round-trip; `schemaVersion: 3` workspace assertion inside the navigation check
  - Outputs: `report = {baseline, explorersOpen, navigationChecked, createdAt, browser: Browser.getVersion, sourceLines: 3000, fixtureSha256, viewport:{2400,1500}, steps:40, cadenceMs, trials, notes, results[]}` → `reportPath`; plus `<report>.png`, `<report>.workspace.json`, `<report>.navigation.png`, `<report>.explorers.png`
  - Navigation check (`checkSourceNavigation`): collapsed-by-default explorer, lazy directory expansion, same-pane file opening, real Ctrl+click cross-file definition through the language server, UTF-16 coordinates, F12 same-file lookup, a definition inside a compaction fold that must expand and select original source, Back/Forward history including restored scroll offsets, and save/reload of an arbitrary repository file
- **Edges / relationships**: strictly sequential; draw the four instrumentation sources as parallel inputs converging on one result row, and split the row's fields into "reported" (timings, frame percentiles) vs "asserted" (chunkReads, sourceMutations, viewport invariance). Draw `SOURCE_PERF_BASELINE` as the switch that disables the two hard gates. Draw `artifacts/source-pane-performance/comparison.md` and `navigation-comparison.md` as human-written summaries consuming `before.json`/`after.json`/`navigation-*.json`.
- **Notes for the renderer**: include the methodology caveats verbatim as a caption, because they are load-bearing: frame intervals are main-thread rAF observations (not compositor dropped frames or input latency); CDP CPU metrics overlap and must not be summed; the runner awaits each CDP dispatch so elapsed time includes transport backpressure.

---
