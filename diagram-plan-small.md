# new-diagram — smaller set, richer diagrams

## Decision

Generate **12 substantial diagrams on four parallel planes**, using the same **2 rows × 2 columns** on each plane. Twelve cells are occupied and four are intentionally empty.

This revises the granularity of `diagram-plan.md`. It combines related models, operations, state changes, and persistence into complete explanations. In particular, the old **CORE-5 catalog model and CORE-6 catalog writes are one diagram**, together with the records and storage context needed to understand them.

The density reference is **“D3 — Text input, editing, and undo”**, at:

`http://localhost:5188/mapping?diagram=representation-b07dc03c-716b-428c-891f-572746db1daa`

Inspected revision: `representation-revision-45ba88d5-c3e1-4a52-a381-f599b44ebcfc`. Its ASCII has **109 rows, a maximum width of 115 characters, and approximately 80–85 visible component/state/action label occurrences**. It combines controller state, edit execution, document mutation, history, restoration, and downstream notifications in one connected explanation.

“4× density” is a design direction, not a measured universal multiplier. The reference is roughly four times as tall as either small 26-row example, while its semantic-label count is roughly twice that of those two examples combined. The target here is the reference's **amount of connected behavior per diagram**, not a quota of extra boxes or text.

| Measure | `diagram-plan.md` | This plan |
| --- | ---: | ---: |
| Independent diagrams | 41 | 12 |
| Planes | 5 | 4 |
| Grid per plane | 5 rows × 8 columns | 2 rows × 2 columns |
| Available cells across all planes | 200 | 16 |
| Occupied cells | 41 | 12 |

The previous document specifies 40 cells per plane, rather than 30. This proposal reduces both over-segmentation and unused grid area. It does not simply divide a cell count by four.

Scope: the first-party `new-diagram` repository, source baseline `a17912d`. The VS Code diagram supplies a visual complexity benchmark; its components are not content for these new diagrams. Vendored repositories, generated output, and historical evidence snapshots remain external inputs or outputs. This file is a generation plan, not generated diagrams or a renderer implementation.

## Required diagram density and construction

Every generator receives this section, its complete SM brief below, applicable shared-anchor contracts, and the listed source files. It must not need another generator's output or the old document to understand its scope.

1. **Target 60–100 meaningful semantic label occurrences**, usually including at least 35 distinct components, records, states, operations, or guards. These are review targets, not permission to invent nodes. A label occurrence is one rendered semantic item; headings, connector glyphs, repeated legend entries, and repeated boundary anchors do not contribute to the target.
2. Use approximately **10–18 principal roots**, expanded into real responsibilities, fields, operations, or substates. Aim for the reference's nested depth where the code supports it. A ten-box summary of ten subsystems is insufficient.
3. Follow a **complete behavioral spine**: entry, preparation, decision, work, resulting state, and observable effect. A structural diagram must connect ownership and references to the operations that read or change them.
4. Include meaningful cross-branch connections: shared inputs, converging writers, feedback, invalidation, failure, recovery, or notification. Aim for roughly **8–15 such connections** in addition to tree containment where supported. Do not manufacture loops in a one-way pipeline.
5. Put essential detail **inside the structure**. “Validates and saves” should expand into the actual validation inputs, rejection branch, resulting records, and write boundary. Long explanatory captions are not a substitute for those nodes and edges.
6. Preserve different state authorities and identity spaces. Merge their explanations without pretending a DiagramSet, catalog revision, editor draft, saved workspace, or Plan is the same object.
7. Use a common rendering scale. All diagram cells are equal physical squares; the renderer measures actual character width and line height. A nominal **1792 × 1792 logical-unit cell**, with 160-unit gutters and 2000-unit plane separation, is sufficient as an initial layout convention. At 8 × 16 character metrics this accommodates 224 columns × 112 rows including headings. A generator can use three or four internal lanes to fit reference-scale content. Do not reduce the font in one cell to make it appear complete.
8. A useful body will commonly occupy roughly **80–105 ASCII rows**. Row count is secondary: wide, branching content may be shorter, and padding does not increase density. If a real mechanism cannot support the target, show the honest smaller structure and flag it for a boundary review.
9. External boundary stubs should be a small minority. Within the stated boundary, expand actual behavior instead of replacing it with boxes labeled “Core,” “API,” or “agent.” Source-file and symbol citations belong in an accompanying node/edge evidence manifest.
10. Shared anchors support cross-diagram projection, but must not dictate the entire diagram. Generate the substantial internal relationships first around the required anchor locations. Five aligned anchors surrounded by notes is explicitly below the desired standard.

**Acceptance question:** Does this diagram explain a mechanism with a comparable depth of decomposition and interaction to the reference's input → command → model → history → buffer → notification flow? If it reads like a short architecture slide, it needs more real detail or a wider boundary.

## Consolidation: every original topic has an owner

The diagram set was consolidated before laying out the smaller grid. The primary ownership mapping below assigns each of the 41 original IDs exactly once. A neighboring diagram may show a shared contract or one relevant subpath, but the mechanism's full expansion has one owner.

| New ID | Complete explanation | Original primary topics absorbed |
| --- | --- | --- |
| SM-01 | Application composition, requests, and runtime lifecycle | SYS-1, SYS-2, SYS-3, SYS-4, SYS-5, SYS-6, STU-1, MAP-1, CORE-1 |
| SM-02 | Project artifacts: records, workspace assembly, catalog writes, and storage | CORE-2, CORE-3, CORE-4, CORE-5, CORE-6, MAP-2 |
| SM-03 | Evidence identity, mapping, references, and source resolution | CORE-9, CORE-10, CORE-13, STU-4 |
| SM-04 | Shared browser workspaces, content surfaces, and interaction checks | CORE-12, CORE-14, CORE-15, TOOL-6 |
| SM-05 | Studio collection, prompt compilation, generation, and recovery | STU-2, STU-3, CORE-7, CORE-8 |
| SM-06 | Artifact derivation, editing history, and saved proposals | STU-5, TOOL-1 |
| SM-07 | Mapping scenes, document history, saves, and workspace restoration | MAP-3, MAP-4, CORE-11 |
| SM-08 | Selection exploration, projected panes, and source navigation | MAP-8 |
| SM-09 | Mapping agent actions: edit, ask, and compact | MAP-5, MAP-6, MAP-7 |
| SM-10 | External authoring, materialized imports, and explicit publication | TOOL-2, TOOL-3 |
| SM-11 | Controlled prompt experiments and dataset curation | STU-6 |
| SM-12 | ASCII parsing and independent parser evaluation | TOOL-4, TOOL-5 |

Not every new diagram absorbs the same number of old ones. MAP-8 and STU-6 already describe large connected mechanisms; they need richer generation, not arbitrary mergers. Conversely, multiple facade/rules/assembly views become branches within one system diagram.

Supporting details retained across boundaries:

- CORE-13's identity, reference, and source-service flow belongs to SM-03; shared source rendering is expanded in SM-04 and Mapping-specific navigation in SM-08.
- MAP-2's revision body belongs to SM-02; the editor scene and its serialization/restore behavior are expanded in SM-07.
- TOOL-6's fixture/server/CDP harness belongs to SM-04. Its source-performance instruments and viewport assertions also appear beside the behavior under test in SM-08.
- Plan storage and migration belong to SM-06; SM-02 shows the plan family as one part of aggregate storage.
- Existing session representation layers/recipes/feedback are included in SM-06. They are not the geometric planes in this proposal.

## Final diagram briefs

### SM-01 — Application composition, requests, and runtime lifecycle

**Question:** How do configured corpus identity, browser pages, HTTP operations, application ports, and concrete integrations become one running application, and what happens when work starts, fails, disconnects, or the process closes?

**Boundary in:** startup/configuration; browser page composition; Core/Studio/Mapping ownership; backend dependency injection; runtime-neutral shared domain; profile fan-out; HTTP/NDJSON lifecycle; recovery and disposal. **Boundary out:** individual business workflows, complete record schemas, filesystem transactions, and provider internals.

**Behavioral spine:** launcher → Vite plugin → `createBackend` → constructed routes/services → browser/API request → operation/events → result/error → shutdown or recovery.

**Expand these connected regions, rather than drawing nine old diagrams side by side:**

- Configuration: project root, diagram-store root, experiment/dataset roots, domain profile, explicit `--lsp`, and fake/real agent selection. Show which settings are environment inputs and which are process-local.
- Composition: one `DiagramStore`, its catalog adapter, `CorpusAccess`, optional `ProjectLanguageService`, Studio runtime, Mapping selection runtime, Codex chat runtime, compaction runtime, experiment catalog, and dataset repository. Show injection into the actual capability services and facade contexts.
- Browser: `createRoot`, `RefBufferProvider`, `App`, three page choices, browser history, catalog-diagram navigation, and Mapping's registered dirty-navigation guard.
- Request path: client helper, namespace selection, unsupported route/method, input preparation, service invocation, and response encoding. Distinguish runtime calls from allowed imports.
- Stream path: preflight before headers, NDJSON framing, partial client buffers, progress/context/workspace/result/error events, and the requirement for a terminal result. Expand a failed request after headers separately from an ordinary HTTP failure.
- Cancellation and lifecycle: recovery promise before API work, interrupted Studio runs/batches, response-close abort for chat/compaction and applicable Core requests, runtime disposal, and lazy LSP cleanup. Inspect each route: the Mapping selection route, like Studio generation routes, does not automatically get chat's cancellation behavior.
- Shared rules: browser → domain; application → ports/domain; infrastructure → application/domain; bootstrap → implementations. Show representative shared algorithms with callers on both sides, not a directory-only import inventory.
- Profile fan-out: source-code/document → corpus binding, evidence vocabulary, collection tools/templates, view availability, commands, rendering policy, and compaction eligibility. The browser receives the choice through project metadata.

**Must remain explicit:** feature ownership and runtime layers are different axes. Core and feature interfaces are shared more broadly than a literal “exactly two meeting points” claim. A permitted infrastructure → application dependency is not a layer violation. There is no universal cancellation or session implementation for every agent action.

**Boundary connections:** repository and catalog → SM-02; source services → SM-03; shared UI → SM-04; Studio execution → SM-05; Mapping execution → SM-09.

**Sources:** `scripts/dev/start-server.mjs`; `vite.config.ts`; `src/main.tsx`; `src/app/App.tsx`; `src/server/app/bootstrap.ts`; `src/server/app/vitePlugin.ts`; `src/server/http/http.ts`; `src/server/routes/core/routes.ts`; `src/server/routes/studio/routes.ts`; `src/server/routes/mapping/routes.ts`; `src/server/routes/mapping/chat/localChatRoutes.ts`; `src/server/routes/mapping/compaction/fileCompactionRoutes.ts`; `tests/architecture/dependencies.test.ts`; `domain/core/profiles/domainProfiles.ts`.

### SM-02 — Project artifacts: records, workspace assembly, catalog writes, and storage

**Question:** How do project/session artifacts and Mapping scenes become durable, evidence-bearing records, and how are those records assembled, versioned, and safely updated?

**Boundary in:** aggregate ownership; import library; workspace assembly; representation/revision/evidence/projection schema; candidate promotion; catalog mutation and conflict rules; persistence facade/modules/files. **Boundary out:** generation agent internals, editor gestures/history, detailed Plan changes, and source-navigation implementation.

**Behavioral spine:** workflow-produced records → repository → persisted families → workspace assembly/readers; in parallel, explicit promotion or scene/projection save → serialized catalog transition → immutable revision and updated pointers.

**Expand:**

- Ownership tree: Project → DiagramSets → evidence collections, diagrams/components, batches, candidates, prompt configurations, runs, maps, and edit sessions. Show the set-independent import library alongside it. Label writers separately from schema ownership.
- Read assembly: project/library lookup, absent-project branch, legacy import migration, set iteration, keyed dictionaries, imported dependencies, representation graphs, catalog, compactions, plans, highlights, and spatial progress → `WorkspaceSnapshot`.
- Repository implementation: `DiagramRepository` → `DiagramStore` → projects/artifacts/imports/generation/runs/templates/plans/highlights/paths modules → store roots. Show its compatibility workspace method delegating to application assembly.
- Catalog spine: stable representation identity → current revision and history; immutable revision → ASCII/hash, content variant, evidence/ranges, mappings, and optional Studio provenance. Add active-by-kind and settled/archived state.
- Promotion: local/imported artifact selection, evidence-ID/range conversion, captured source text, translated maps, content/evidence signature comparison, revision reuse or append, and explicit active selection.
- Writer convergence: Studio promotion, Mapping scene save, and Core projected-tree publication → the same catalog repository → in-process read/transition/write queue. Expand expected-revision rejection, source/target pin checks, domain validation, injected clock/IDs/hash, idempotent paths, and temp-file/rename publication.
- Projection/evidence relationships: source and target revision pins, source evidence to target tree nodes, optional embedded compaction snapshots, and range `compactionId` crossing into the separate compaction catalog.
- Storage: `project.json`, session subdirectories, global imports, representation catalog, corpus compactions, plan family, highlights/progress, trash, and separate Mapping workspace/compaction-run stores. Show direct-store tooling as an explicit external writer rather than claiming HTTP is the only entry.

**Must remain explicit:** Mapping workspace Save is a separate persistence authority. Catalog serialization is in process, not a cross-process lock. Compaction-catalog upsert writes a separate document outside the representation queue. No automatic publication edge comes from the standalone compaction run. Candidate archival and representation archival are different operations.

**Boundary connections:** produced candidates → SM-05/SM-06; Mapping scene and save result → SM-07; source-backed projection → SM-08/SM-10; evidence resolution → SM-03.

**Sources:** `domain/core/records/domain.ts`; `application/core/workspace/loadWorkspace.ts`; `application/core/ports/diagramRepository.ts`; `application/core/ports/projectCatalogRepository.ts`; `application/studio/candidates/service.ts`; `domain/core/representations/projectCatalog.ts`; `domain/core/representations/catalogRules.ts`; `domain/core/representations/catalogCommands.ts`; `domain/core/diagrams/projectDiagramCanvas.ts`; `infrastructure/core/persistence/store.ts`; `infrastructure/core/persistence/projectCatalogStore.ts`; `infrastructure/core/persistence/paths.ts`; `infrastructure/core/persistence/shared.ts`; `application/core/representations/service.ts`.

### SM-03 — Evidence identity, mapping, references, and source resolution

**Question:** How can one diagram selection retain precise source meaning across generation, imported evidence, remapping, references, highlights, live files, and definitions?

**Boundary in:** evidence/provenance identity; mapping generation and validation; representation indexes/work scopes; reference buffer/sinks; highlight capture; corpus/snippet/full-source/LSP resolution. **Boundary out:** Mapping-specific pane ownership, shared renderer internals, prompt compilation, and catalog transaction mechanics.

**Behavioral spine:** artifact revision + source evidence → validated map/index → selected element → reference/highlight/source request → resolved source or explicit stale/unavailable result.

**Expand:**

- Identity: local versus imported entities, source-range IDs versus legacy indexes, artifact origin, project/session identity, ASCII hash, and captured `originalLines`. Keep CodeEntity IDs distinct from promoted project evidence IDs.
- Remapping: finalized evidence and unique targets → artifact bundle lookup → active-target guard → hash-scoped run/index/progress → bounded workers → unchanged-ASCII agent submission → mapping validation → sidecar persistence. Show independent success/failure and browser merge of only the affected state.
- Indexing: tree parsing/structural node IDs versus diagram character spans; mapping-to-element links; artifact, element, subtree, and evidence work targets; freshness/kind/target validation; current/visited/completed/failed progress.
- Studio Call Graph focus: source artifact/provenance → session's settled Call Graph → matching foundation and declared local/imported entities → validated selected identities → parsed/filtered tree → focused browser view. Keep this branch separate from Mapping's catalog projection and expose missing-foundation/dependency rejection.
- Reference lifecycle: mapped selection → typed identity → scoped reducer/deduplication → local/imported resolution → unresolved gate → clipboard/source location/prompt text, or structured `ReferenceEnvelope` browser event. Show highlights as a separate durable branch with revision/evidence/lineage capture.
- Corpus: project binding, Git/document providers, root/path/symlink checks, directory listing, binary/text checks, and file reads.
- Source alternatives: snippet reads may overlay captured source onto live text; complete project-file reads return current lines/hash and LSP capability. Draw both data paths to avoid implying snapshot context is always live.
- Definition round trip: DOM position conversion → path/project/hash/UTF-16 request → enabled-service check → lazy language session → document open/definition/close → normalized locations, outside-root count, multiple-result handling, timeout/cancellation/disposal.

**Must remain explicit:** the temporary reference buffer is not a durable bookmark store. Formatted text sinks and the structured browser event differ. A representation index is revision-scoped. Evidence remapping in Studio is not the Mapping editor. Current live source and captured historical evidence are different inputs.

**Boundary connections:** evidence records → SM-02; render/source activation → SM-04/SM-08; allowed prompt references → SM-05; selection context → SM-09; publication provenance → SM-10.

**Sources:** `application/studio/evidence-mapping/service.ts`; `domain/core/diagrams/diagramMapping.ts`; `domain/core/representations/representationIndex.ts`; `domain/core/agent-work/agentWork.ts`; `domain/core/references/refBuffer.ts`; `domain/core/references/referenceResolver.ts`; `domain/core/references/refFormatters.ts`; `src/shared/references/refOutputSinks.ts`; `application/core/highlights/service.ts`; `application/core/source/service.ts`; `application/core/source/projectSource.ts`; `domain/core/source/callGraphFocus.ts`; `infrastructure/core/corpus/corpus.ts`; `infrastructure/core/language-services/projectLanguageService.ts`; `src/shared/source/sourceDomPosition.ts`.

### SM-04 — Shared browser workspaces, content surfaces, and interaction checks

**Question:** How do shared layout, diagram, source, and Markdown capabilities turn application state into navigable views, and how are the resulting interactions checked?

**Boundary in:** Studio's shared pane platform; diagram/source/document rendering; evidence-action handoffs; Markdown message protocol; browser-check harness and UI variant controls. **Boundary out:** Mapping's separate document/display state model, backend source/agent internals, and full performance measurement details.

**Behavioral spine:** host state/profile → pane/layout/content selection → rendered surface → user action → domain/navigation callback → updated view; disposable tests exercise the same public path.

**Expand:**

- Shared panes: split/leaf tree, pane/tab registry, active tab and focus, model transitions, ratio constraints, `PaneApi` subscriptions, React frames/splits, resize observation, and layout restoration.
- Deferred navigation: destination identity → activate/focus → bounded deduplicated history → pending-by-kind request → render scheduling → registered destination handler → final focus/scroll. Show replacement of an older pending jump.
- Diagram surface: kind/profile policy, ASCII/hash/map match, structural index, collapsible tree or spatial grid, selection bounds, mapped overlays, reference/highlight actions, scoped progress, and partial-diff previews.
- Source surface: snippet/content policy, code/plain highlighting, line ranges, folds, DOM positions, selection/reveal, and source/definition request handoffs. Backend source identity remains the SM-03 boundary.
- Markdown: tokens, source anchors, headings/TOC, links, fenced code, document shell, sandboxed iframe, host validation, and bidirectional section/source/file messages. Identify directions and payload kinds on crossing edges.
- Verification: disposable Git corpus and store, fake runtime setting, separate server/port, readiness, external CDP helper, pointer/keyboard actions, DOM assertions, save/reload checks, screenshots, and cleanup. Show a representative navigation and persistence scenario through the UI, rather than a list of test filenames.
- UI variant control: `UiTestFramework` validated settings/localStorage and render-prop inputs feed Mapping chat presentation. It is an actual mounted control surface, not a separate product backend.

**Must remain explicit:** Mapping does not use Studio's shared pane system. Browser checks exercise real HTTP/UI boundaries with explicit fakes where configured; a fixture edge is not a production import. Third-party Markdown/highlighter implementations are external nodes.

**Boundary connections:** app/profile → SM-01; index/source contracts → SM-03; Mapping source-view host → SM-08; chat variant consumer → SM-09; plan/experiment preview consumers → SM-06/SM-11.

**Sources:** `src/shared/panes/model.ts`; `src/shared/panes/api.ts`; `src/shared/panes/navigation.ts`; `src/shared/panes/PaneWorkspace.tsx`; `src/shared/diagrams/DiagramView.tsx`; `src/shared/diagrams/AsciiSelectionGrid.tsx`; `src/shared/source/SourceCodeView.tsx`; `src/shared/markdown/TerminalMarkdownView.tsx`; `src/shared/markdown/render.ts`; `src/shared/markdown/links.ts`; `src/shared/markdown/toc.ts`; `tests/browser/support/browser-mapping-fixture.mjs`; `tests/browser/mapping/browser-project-mapping-check.mjs`; `packages/ui-test-framework/src/UiTestFramework.tsx`.

### SM-05 — Studio collection, prompt compilation, generation, and recovery

**Question:** How does one creation or generation request become finalized evidence and a complete batch of distinct, validated candidates, with exact prompt provenance and recoverable execution state?

**Boundary in:** generated/materialized creation fork; collection; template resolution and compilation; auxiliary prerequisites; batch/slot execution; accepted submission; retry/deduplication; status events and restart recovery. **Boundary out:** general catalog/storage mechanics, derived edit operations, standalone remapping, and experiment iteration.

**Behavioral spine:** request → corpus/profile preflight → session/evidence → immutable prompt configuration → parallel slots → per-slot accepted turns → validated distinct batch → workspace/candidates.

**Expand:**

- Creation: shape/mode validation, corpus/store identity, project/session creation, collection criteria/configuration, reader/tool choice, submitted entity drafts, range validation, IDs, captured lines, ready/finalized state, failed collection, and materialized supplied-artifact/cleanup branch.
- Prompt controls: named template families, profiles/versions, target bindings, mutable template edits/reset/delete, browser generation draft, derivative correction history, resolved entity/artifact/component mentions, inclusion overrides, and unknown/ambiguous rejection.
- Context closure: local/imported evidence, aliases versus durable IDs, selected references, forced foundations for Call Graph and Directory View, rendered system/context/reference/mapping bodies, allowed-ID lists, and immutable config persistence/reload.
- Batch lifecycle: active-set guard, queued runs, shared config, distinct slot IDs, parallel dispatch, progress/status writes, accepted outputs, normalized-ASCII duplicates, pending-slot retries, maximum attempts, complete versus failed batch, and released guard.
- Per-slot execution: isolated session → initial submission → optional reference refinement → mandatory final mapping turn; locked artifact content, corrected invalid submissions, final evidence validation, and artifact/map/run provenance.
- Shared runner: ordered step IDs, before/prompt/execute/validate, previous accepted value, missing-output failure, cancellation checks, executor-owned tools, `createValidatedSubmission`, Pi model/session setup, and disposal.
- Recovery: incomplete batches fail, interrupted runs are classified, immutable evidence/configurations remain addressable, and clients require final results rather than treating HTTP 200 as success.

**Must remain explicit:** candidate slots share a configuration; this is different from twelve independently scoped diagram requests. An accepted batch is not automatic promotion of every candidate. Provider/session mechanics do not own feature persistence. Materialized creation does not run collection or generation agents.

**Boundary connections:** repository/catalog foundations → SM-02; reference/evidence validation → SM-03; derived artifacts → SM-06; shared runner contract also used by SM-09 compaction; creation client → SM-10.

**Sources:** `application/studio/collection/diagramSetWorkflow.ts`; `application/studio/collection/service.ts`; `application/studio/generation/service.ts`; `application/studio/generation/generationWorkflow.ts`; `application/studio/generation/codeEntityPrompt.ts`; `application/studio/prompt-settings/service.ts`; `domain/studio/generation/prompt.ts`; `domain/core/prompts/prompt.ts`; `application/core/agents/agentWorkflow.ts`; `infrastructure/core/agents/validatedSubmission.ts`; `infrastructure/studio/agents/agentRuntime.ts`; `application/studio/lifecycle/service.ts`; `src/features/studio/generation/derivativePrompt.ts`; `src/features/studio/generation/generationPageDraft.ts`.

### SM-06 — Artifact derivation, editing history, and saved proposals

**Question:** How can an existing artifact be edited, cropped, proposed for change, and reviewed while preserving its source and distinguishing a published derivative from an unapplied proposal?

**Boundary in:** Studio edit sessions, patch/marker/LLM history, component capture, derivation and curation, Plan snapshots/previews/bundles/migration, and session layer/recipe feedback. **Boundary out:** Mapping scene history, initial generation, detailed catalog transactions, and applying a Plan to source.

**Behavioral spine:** source artifact or selected baseline → working edit / component extraction / saved proposal → operation or change validation → review → publish derivative, retain proposal, or discard.

**Expand:**

- Edit-session identity: local/imported source, base/working ASCII, evidence IDs, revision, status, operation list/cursor, and output-artifact link.
- Manual/marker paths: serialized edits, exact patches, forward/inverse application, undo/redo, redo-tail truncation, character offsets, unused marker selection, unresolved markers, and marker guidance.
- LLM path: working copy + instruction + markers → agent run → submitted ASCII → recorded patch; run/model provenance joins operation history.
- Finish/discard: required changes and resolved markers; new diagram/component with edited origin and derivation IDs; committed session versus retained discarded history. Optional later remapping and promotion remain explicit external actions.
- Capture/curation: rectangular crop, parent diagram/component, nested captures, selection bounds, inherited evidence, lineage display, rename/archive, candidate membership/ranks, and catalog-promotion handoff.
- Plans: selected baseline, modified-diagram patch, added-diagram draft, structured before/after compaction, validation, manifest/Markdown/selection/per-change files, reconstructed preview text/maps, and shared renderers. Plan updates can replace snapshots; do not label the whole Plan store immutable.
- Migration: legacy inline manifest → validated exploded bundle, per-kind conversions, idempotent skip, preserved legacy manifest, and reload checks.
- Session representation graph: revision-pinned layers, information ranks, DAG transitions, targeted feedback, versioned recipes, availability/hash/kind checks, and layer UI. Draw its associations to artifacts; do not invent automatic regeneration from feedback.

**Must remain explicit:** editing publishes a new artifact, a Plan previews proposed content, and catalog Save appends a project revision. These are separate operations that share baselines and renderers. Existing graph layers are not the planes in this plan.

**Boundary connections:** source/derived records and promotion → SM-02; map/index validation → SM-03; previews → SM-04; generation lineage → SM-05.

**Sources:** `application/studio/editing/service.ts`; `domain/studio/editing/operations.ts`; `src/features/studio/editing/EditOperationsPanel.tsx`; `src/features/studio/editing/artifactPartialDiffs.ts`; `application/studio/candidates/service.ts`; `domain/core/plans/plans.ts`; `application/core/plans/planService.ts`; `infrastructure/core/persistence/plans.ts`; `infrastructure/core/persistence/planMigration.ts`; `scripts/migrations/migrate-plans.ts`; `src/shared/plans/PlanPreview.tsx`; `domain/core/representations/representationGraph.ts`; `application/studio/representations/service.ts`; `src/features/studio/candidates/RepresentationLayersPanel.tsx`.

### SM-07 — Mapping scenes, document history, saves, and workspace restoration

**Question:** How does a catalog diagram become an editable scene, and which changes survive undo, switching diagrams, saving a revision, or restoring a workspace?

**Boundary in:** scene structure and editing, paste, document history, draft registry, dirty navigation, revision Save, workspace capture/codec/persistence/restore. **Boundary out:** the detailed catalog transaction, projected-pane selection algorithms, and agent execution.

**Behavioral spine:** catalog revision → editable document → scene operations → history/dirty draft → revision Save or workspace capture → reconstructed editor.

**Expand:**

- Scene structure: grid text, nodes, edges, boxes, containers, ownership, geometry, measured bounds, layout, and composed ASCII. Expand the distinction between visual containment and semantic relationships, including validation and cycle rejection where implemented.
- Editing: hit testing and selection, text replacement, moving scene elements, grouping, collapsing, offsets, paste parsing, insertion placement, and resulting source-map adjustments. Trace an operation through the scene into both rendering and serialized content.
- Document history: past/present/future, committed operations, undo, redo, truncated redo branch, initial baseline, and history kept in browser memory. Show which transient pointer/selection states are outside document history.
- Open diagrams: per-diagram drafts, active identity, mount/visibility behavior, rename, dirty calculation, switching, navigation guard, and discard. A hidden draft can still own unsaved state.
- Diagram Save: current draft → composed canvas payload → expected base revision → service validation → catalog append or revision conflict → returned revision → refreshed draft baseline. Preserve the conflict branch and unsaved work.
- Workspace capture: open diagrams, draft content, active diagram, display tree, pane controls, camera, chat state, and source-pane current path/range index/scroll. Capture is a different operation from publishing a diagram revision.
- Codec and restore: version/shape checks, identifier relationships, valid ownership, evidence/control reconstruction, migrations, busy states normalized to interrupted, missing/invalid references, import/export, and restored page state.
- Storage: workspace repository and HTTP boundary → workspace service → atomic filesystem replacement → reload. Draw catalog revision checks separately from workspace-file replacement; do not imply a revision compare-and-swap for both.

**Must remain explicit:** editor undo history and source-navigation back/forward history are browser-local. Workspace capture retains the supported current source view, not the complete `Visit[]` history. Diagram Save publishes a revision; workspace Save captures the working environment, including drafts.

**Boundary connections:** revision bodies/catalog writes → SM-02; rendering → SM-04; display ownership and projected children → SM-08; agent proposals/chat → SM-09.

**Sources:** `src/features/mapping/MappingPage.tsx`; `src/features/mapping/canvas/MappingCanvas.tsx`; `src/features/mapping/canvas/pasteDiagram.ts`; `domain/core/diagrams/lineGrid.ts`; `domain/core/diagrams/projectDiagramCanvas.ts`; `domain/mapping/workspace/mappingGrid.ts`; `domain/mapping/workspace/mappingDocument.ts`; `domain/mapping/workspace/mappingWorkspace.ts`; `domain/mapping/workspace/mappingWorkspaceCodec.ts`; `domain/mapping/workspace/displayModel.ts`; `src/features/mapping/workspace/mappingProjectApi.ts`; `src/features/mapping/workspace/mappingWorkspaceRepository.ts`; `application/mapping/diagrams/diagramService.ts`; `application/mapping/workspace/workspaceService.ts`; `infrastructure/mapping/persistence/workspace/mappingWorkspaceStore.ts`.

### SM-08 — Selection exploration, projected panes, and source navigation

**Question:** How does selecting part of a diagram reveal related representations and source, while preserving pane ownership, revision validity, readable context, and responsive navigation?

**Boundary in:** Mapping selection effects, display tree, projection hops, retained snapshots, source pane and local navigation, viewport geometry, and source-performance checks. **Boundary out:** editing document history, catalog publication, source identity construction, and implementing the language server.

**Behavioral spine:** selected scene region → mapped evidence/index → valid pinned projection → retained child display → compacted/source ranges → navigable source view → viewport updates.

**Expand:**

- Selection: selected cells/elements, flattened scene mappings, mapped node IDs, source IDs/ranges, empty/unmapped cases, and selection effects dispatched to the owning pane.
- Display ownership: one parent per projected child, child identities, retained selection snapshots, active controls, layout dimensions, anchored positioning, closing/replacing children, and recursive descendants.
- First projection hop: catalog relation, source/target revision pins, matching source evidence, OR matching where implemented, target matches, retained subtrees, and ancestors required to display structure.
- Compaction hop: matched/projected nodes → source ranges → relevant compaction rows → exact row selection plus required ancestors. Distinguish real match membership from ancestors included only for presentation; display ancestors must not leak into compaction inputs.
- Validity: unsaved draft/current-revision mismatch prevents a new projection; missing targets and invalid evidence produce explicit unavailable states. A retained snapshot can remain visible. Do not draw it as a live recomputation from every source edit.
- Source navigation: path/range index, current text, highlighted spans, compacted versus full view, expansion, source click, definition request, hash/UTF-16 coordinates, jump result, local back/forward visits, and scroll restoration. Show the boundary to shared source resolution.
- View state: camera and pane coordinates, source scroll, live readers outside React, clipped geometry, selection overlays, and subscriptions. Follow a pan/scroll update through the values it changes without inventing a full DOM remeasurement.
- Verification: large source fixture, CDP gestures and timings, animation-frame probes, computed-style calls, mutation observations, long tasks, retained viewport assertions, and `SOURCE_PERF_BASELINE` behavior. Measurements can overlap; their durations are not additive components of one total.

**Must remain explicit:** these projections are relationships between catalog representations and source ranges, not this plan's geometric stack. Mapping uses its own display tree. Studio's Call Graph focus is a different session/foundation-filtered mechanism, owned by SM-03; it must not be relabeled as a catalog projection.

**Boundary connections:** catalog revisions/projections → SM-02; evidence indexes and definition service → SM-03; shared rendering and browser harness → SM-04; persisted current view → SM-07.

**Sources:** `src/features/mapping/canvas/MappingCanvas.tsx`; `src/features/mapping/canvas/SelectionEffectsLayer.tsx`; `src/features/mapping/canvas/DisplayPane.tsx`; `domain/mapping/workspace/displayModel.ts`; `domain/mapping/workspace/projectedPaneLayout.ts`; `domain/core/diagrams/diagramProjection.ts`; `domain/core/representations/compactionProjection.ts`; `src/features/mapping/source-pane/SourceCodePane.tsx`; `src/features/mapping/source-pane/sourceCodeCompaction.ts`; `src/features/mapping/source-pane/sourcePaneViewState.ts`; `src/features/mapping/source-pane/SourcePaneViewStateContext.tsx`; `scripts/fixtures/create-source-pane-performance-fixture.mjs`; `tests/performance/browser-source-pane-performance.mjs`; `tests/browser/support/browser-source-navigation-check.mjs`.

### SM-09 — Mapping agent actions: edit, ask, and compact

**Question:** How do three source-aware agent actions prepare context, run work, validate output, and return different kinds of state to the user?

**Boundary in:** selection edit, local chat, and standalone single-file compaction, including preparation, runtime adapters, validation, lifecycle, and their distinct result stores. **Boundary out:** provider internals, generic HTTP routing, accepting an edit into document history, and publishing compaction into the Core catalog.

**Behavioral spine:** selected diagram/source context → action-specific preparation → isolated agent execution → validated result/events → editable proposal, chat turn, or durable compaction run.

**Expand three connected lanes with shared contracts at their actual junctions:**

- Selection preparation: request shape, project identity, current base revision, selected region, existing ASCII, project evidence, and corpus root. Show stale-current rejection; this differs from chat's historical-revision behavior.
- Selection execution: adapter resolves source excerpts through `mappingPocSourceContextForSelection`, assembles grid/mapping guidance, obtains proposed ASCII, validates the changed region/full-row constraints and mappings, then returns a proposal. Applying it is a separate browser action.
- Chat preparation: conversation/turn identity, selected snapshot, available historical revision, source excerpts, prior messages, verbosity, and prompt serialization. Associate context with the turn rather than assuming it always follows the current editor revision.
- Chat runtime: fresh Codex process/thread per request, read-only tool policy, progress/message events, retries and failures, abort/cleanup, accepted assistant message, browser conversation state, and later workspace capture. It does not use the Pi selection adapter or generic workflow runner.
- Compaction preparation: single-file eligibility, path/root checks, bounded UTF-8 input, captured bytes/hash, selected prompt/system/model settings, run identity, and frozen inputs.
- Compaction execution: initial pass → output/structural validation → refinement pass → accepted structured result. Show the shared workflow runner, validated submissions, session lifecycle, and the input/output passed between the two stages.
- Compaction state: per-pass artifacts, run status, progress, failure/abort, restart interruption, source-stale detection, durable run directory, and retrieval of the result. Frozen source input and current source status are distinct.
- Compare terminal ownership: selection proposal returned to browser; chat messages live in the workspace capture path; compaction writes its own run store. Link the common corpus and validation contracts without merging these states.

**Must remain explicit:** response-close cancellation is route-specific. No React caller for the standalone compaction API was identified in this baseline; show its caller as an external/API boundary. A completed run does not automatically publish a Core compaction record or create a project projection.

**Boundary connections:** runtime composition/transport → SM-01; catalog revisions → SM-02; corpus/evidence resolution → SM-03; generic runner also used by SM-05; proposal acceptance and chat capture → SM-07.

**Sources:** `application/mapping/selection/selectionService.ts`; `application/mapping/selection/mappingPocSourceContext.ts`; `infrastructure/mapping/agents/selection/agentRuntime.ts`; `domain/mapping/selection/mappingPocMappings.ts`; `application/mapping/chat/chatService.ts`; `infrastructure/mapping/agents/chat/localChatRuntime.ts`; `domain/mapping/chat/localChatPrompt.ts`; `src/features/mapping/chat/LocalChatConvo.tsx`; `application/mapping/compaction/fileCompactionService.ts`; `application/mapping/compaction/fileCompactionWorkflow.ts`; `infrastructure/mapping/agents/compaction/fileCompactionRuntime.ts`; `infrastructure/mapping/persistence/compactionStore.ts`; `domain/mapping/compaction/validation.ts`; `domain/mapping/compaction/compactionRun.ts`; `application/core/agents/agentWorkflow.ts`.

### SM-10 — External authoring, materialized imports, and explicit publication

**Question:** How does externally authored or collected content become a source-backed, revisioned, navigable diagram without confusing preparation with publication?

**Boundary in:** repository authoring instructions/client entry points, generated versus materialized creation, example preparation/import/refresh scripts, explicit promotion and projection publication, receipts, and identity migrations. **Boundary out:** the complete generation agent loop, catalog internals, historical vendored source, and applying a generated diagram to source code.

**Behavioral spine:** repository/source selection → captured evidence and authored ASCII → validated input bundle → create/import → promote → save canvas/publish related records → link projection → verify receipts.

**Expand:**

- Authoring entry: installed skill/instructions, repo identity, diagram name/scope, source inspection, collection criteria, client/API configuration, and selected output path. These are external producer responsibilities, not a hidden server agent.
- Creation fork: generated mode delegates collection and candidate execution to Studio; materialized mode supplies entities/ASCII/maps directly and bypasses those agents. Show required inputs and returned identities for both branches.
- Preparation: live source paths, AST or explicit ranges, captured source lines/hashes, source identities, artifact/component IDs, diagram ASCII, mapped ranges, compaction text/maps, and a prepared bundle. Trace coordinate validation to the precise text version used.
- Import: project identity/hash checks, evidence remapping, artifact creation, promotion, catalog representation/revision IDs, mapping-canvas content Save, and revision-pinned source/target projection. Separate API-driven example operations from the direct-store projection CLI.
- Publication: promoted diagrams and imported compactions become addressable catalog records only through explicit writes. Attach provenance to the representation revision that actually contains the content.
- Receipts and repeat runs: record created IDs/revisions, inspect persisted outputs, verify relations, locate a failed stage, refresh against current source, and distinguish idempotent checks from operations that append another revision.
- Identity maintenance: legacy artifact/evidence names, reference rewrites, consistency checks, and migration scripts. Show these as maintenance paths around persisted identities, not a routine step in every import.
- Consumer handoff: catalog discovery, opening the editor, selection-to-source projection, and explicit follow-up editing. An import receipt is evidence of completed writes, not a substitute for checking source freshness.

**Must remain explicit:** example bundles include historical source coordinates; regeneration and verification against the intended project are required before reusing them. This diagram describes existing authoring/publication tooling and does not instruct generators to perform publication.

**Boundary connections:** generated creation → SM-05; materialized records, promotion, and projection writes → SM-02; identity/source validation → SM-03; Mapping consumers → SM-07/SM-08.

**Sources:** `skills/new-diagram/SKILL.md`; `application/studio/collection/diagramSetWorkflow.ts`; `application/core/imports/service.ts`; `examples/mapping-screen/README.md`; `examples/mapping-screen/prepare.ts`; `examples/mapping-screen/import.ts`; `examples/mapping-screen/refresh.ts`; `scripts/diagrams/import-projection.ts`; `scripts/diagrams/map-compositional-domain.ts`; `scripts/diagrams/validate-compactions.mjs`; `scripts/migrations/relabel-code-entity-identities.mjs`; `scripts/migrations/relabel-artifact-ids.mjs`.

### SM-11 — Controlled prompt experiments and dataset curation

**Question:** How are prompt-control effects separated from stochastic variation, turned into reviewable experiment results, and optionally captured as curated diagram examples?

**Boundary in:** experiment domain, offline runner/runtime, generation conditions, metrics and blinded judgments, resumable outputs, read-only experiment catalog/viewer, and writable dataset snapshots. **Boundary out:** an HTTP run-launch endpoint, production batch recovery, training consumers, and automatic promotion into a DiagramSet.

**Behavioral spine:** axis/iteration design → value × replicate generations → deterministic metrics and blinded judgments → aggregate/analyst revision → catalog/viewer → explicit dataset snapshot.

**Expand:**

- Experimental design: source DiagramSet, axis (`semantic_zoom` or `topology`), control prompt, discrete values, iteration number, three independent replicates, model identity, exact prompt snapshot, and isolated output root.
- Generation: shared compiler/runtime boundaries, resolved source evidence, per-condition requests, accepted ASCII, invalid/failed output, immutable result records, and separation from the source DiagramSet.
- Measurement: structural metrics, component/node/edge-related quantities actually implemented, per-replicate results, same-value variation, and cross-value changes. Name real metrics from the source; do not invent a generic quality score.
- Judging: blinded presentation IDs, three-diagram comparisons, cross-value order/discriminability, within-value consistency, judge outputs, validity checks, and restoring experiment identities after judgment.
- Iteration: deterministic aggregates → analyst feedback → revised control block → denser value sweep → final recommendation. Distinguish analysis output from a prompt setting automatically installed in production.
- Resumption: existing JSON records, completed generation/judgment detection, skipped work, partial outputs, read/retry behavior, and reproducibility through stored inputs and model/prompt provenance.
- Viewer: filesystem catalog scan, project/axis/value/replicate tree, configurable pass metric/threshold, selected replicate, previous/next, ASCII, metrics, tested prompt, aggregate scores, and loading/error states.
- Dataset curation: named dataset → explicit add → copied ASCII/metrics/evidence IDs/prompt/model/provenance → duplicate-source idempotency → persisted item; label edits, removal, and independent browsing after the source experiment moves.

**Must remain explicit:** the runner is an internal TypeScript module; the baseline has no CLI or HTTP endpoint for launching runs. The experiment API reads existing results. Datasets copy snapshots; they are not live references or an implemented model-training pipeline.

**Boundary connections:** shared generation compiler/agent concepts → SM-05; shared content rendering → SM-04; source identity types → SM-03. Dataset storage is a separate root from ordinary project artifact persistence.

**Sources:** `tools/experiments/README.md`; `tools/experiments/runner.ts`; `tools/experiments/runtime.ts`; `tools/experiments/metrics.ts`; `domain/studio/experiments/experimentDomain.ts`; `domain/studio/experiments/types.ts`; `application/studio/experiments/repository.ts`; `infrastructure/studio/persistence/experiments/experimentCatalog.ts`; `infrastructure/studio/persistence/datasets/diagramDatasetStore.ts`; `src/features/studio/experiments/ExperimentViewerPage.tsx`.

### SM-12 — ASCII parsing and independent parser evaluation

**Question:** How are tree and graph semantics recovered from ASCII, and how do independent generated examples and frozen evaluations reveal parsing errors?

**Boundary in:** standalone Python tree/graph parser, normalization and structural passes, output/diagnostics, corpus generation artifacts, independent expectations, frozen rounds, and regression comparison. **Boundary out:** live React rendering, TypeScript source-map indexes, diagram generation inside the app, and running new evaluation agents as part of this planning task.

**Behavioral spine:** original ASCII → normalization/line analysis → structure and wire interpretation → semantic nodes/relations → output/diagnostics → independently expected structure → mismatch report and regression cases.

**Expand:**

- Input: file/CLI text, newline/indent handling, line numbers, connector glyphs, labels, branches, blank lines, and source spans. Preserve the distinction between original coordinates and cleaned parser coordinates.
- Tree parsing: candidate lines, connector/indent classification, ancestor stack, parent assignment, roots/forest, multiline labels where supported, ordered children, stable-within-output IDs, and serialization.
- Graph parsing: region scanning/partitioning, embedded tree parsing, wire straightening/tracing, junctions, arrow direction, endpoints, reference-label resolution, and emitted relationships. Show ambiguous/unresolved cases as diagnostics where the implementation does so.
- Correctness boundaries: labels versus decorative lines, connector text excluded from semantics, parent/child order, original line preservation, strict failures, and resource/depth limits actually enforced by code.
- Generated corpus: fixed task prompt, independent generation runs, model/run identity, prompt hash, output diagrams, execution receipts, accepted/excluded submissions, and documented replacement handling. These are evaluation artifacts, not application representations.
- Independent oracle: separately built expected labels/parents/lines, frozen parser snapshot, capture script, parsed outputs, exact comparison, mismatch categories, and human-readable review files.
- Regression: discovered counterexample → retained fixture → later parser run → prior-round comparison; semantic-label, deep-tree, graph-review, and workbench tests. Explain what each assertion checks rather than listing test filenames as boxes.
- Output handling: parse summary, validation report, CLI success/failure, and archived rounds. Connect failed cases back to parser stages without implying automatic code repair.

**Must remain explicit:** the Python parser and browser/domain TypeScript ASCII-tree implementation are separate. This plan places them in a common interpretation column because of shared concerns; it does not claim a runtime dependency or equivalent node identities. Generated corpus files and frozen snapshots are evidence assets, not production modules.

**Boundary connections:** conceptual comparison only with SM-04's TypeScript rendering/indexing. No application ingestion edge exists unless a source-backed adapter is found during generation.

**Sources:** `tools/diagram-parser/README.md`; `tools/diagram-parser/diagram_parser/README.md`; `tools/diagram-parser/diagram_parser/tree_parser.py`; `tools/diagram-parser/diagram_parser/graph_parser.py`; `tools/diagram-parser/diagram_parser/capture_round.py`; `tools/diagram-parser/diagram_parser/generation_prompt.txt`; `tools/diagram-parser/diagram_parser/test_tree_parser.py`; `tools/diagram-parser/diagram_parser/test_semantic_labels.py`; `tools/diagram-parser/diagram_parser/test_graph_parser.py`; `tools/diagram-parser/diagram_parser/test_graph_review.py`; `tools/diagram-parser/diagram_parser/test_workbench_graph.py`; `tools/diagram-parser/diagram_parser/round_3/independent_check.py`; `tools/diagram-parser/diagram_parser/round_3/independent_build_expectations.py`; `tools/diagram-parser/diagram_parser/round_3/README.md`.

## Layout of the finalized set

Layout follows the diagram boundaries above. The four cell positions retain the same concern on every plane:

| Position | Shared concern |
| --- | --- |
| R1 C1 | Execution and orchestration |
| R1 C2 | Artifact state and change |
| R2 C1 | Source evidence and exploration |
| R2 C2 | Presentation, interpretation, and evaluation |

Planes are ordered **External → Studio → Mapping → Shared foundations**. This is a viewing order, not a dependency chain: Studio and Mapping are peer features. A diagram's plane identifies its principal audience/owner; it can cross architectural layers internally to explain a complete operation.

| Diagram | Plane Z | Row | Column | Short cell name |
| --- | ---: | ---: | ---: | --- |
| SM-01 | 4 | 1 | 1 | Application lifecycle |
| SM-02 | 4 | 1 | 2 | Artifacts and catalog |
| SM-03 | 4 | 2 | 1 | Evidence and references |
| SM-04 | 4 | 2 | 2 | Browser surfaces |
| SM-05 | 2 | 1 | 1 | Studio generation |
| SM-06 | 2 | 1 | 2 | Derivation and proposals |
| SM-07 | 3 | 1 | 2 | Editor and workspace |
| SM-08 | 3 | 2 | 1 | Selection and source |
| SM-09 | 3 | 1 | 1 | Mapping agent actions |
| SM-10 | 1 | 2 | 1 | Authoring and publication |
| SM-11 | 2 | 2 | 2 | Experiments and datasets |
| SM-12 | 1 | 2 | 2 | Parser and evaluation |

The following is a compact cell index; its text rectangles stand for equal physical square cells. Expand all cells uniformly in a renderer. Empty cells keep their space so the planes register exactly.

```text
Z1 — EXTERNAL
+--------------------------------+--------------------------------+
|                                |                                |
|             empty              |             empty              |
|                                |                                |
+--------------------------------+--------------------------------+
| SM-10                          | SM-12                          |
| Authoring and publication      | Parser and evaluation          |
|                                |                                |
+--------------------------------+--------------------------------+

Z2 — STUDIO
+--------------------------------+--------------------------------+
| SM-05                          | SM-06                          |
| Studio generation              | Derivation and proposals       |
|                                |                                |
+--------------------------------+--------------------------------+
|                                | SM-11                          |
|             empty              | Experiments and datasets       |
|                                |                                |
+--------------------------------+--------------------------------+

Z3 — MAPPING
+--------------------------------+--------------------------------+
| SM-09                          | SM-07                          |
| Mapping agent actions          | Editor and workspace           |
|                                |                                |
+--------------------------------+--------------------------------+
| SM-08                          |                                |
| Selection and source           |             empty              |
|                                |                                |
+--------------------------------+--------------------------------+

Z4 — SHARED FOUNDATIONS
+--------------------------------+--------------------------------+
| SM-01                          | SM-02                          |
| Application lifecycle          | Artifacts and catalog          |
|                                |                                |
+--------------------------------+--------------------------------+
| SM-03                          | SM-04                          |
| Evidence and references        | Browser surfaces               |
|                                |                                |
+--------------------------------+--------------------------------+
```

Why these stacks work:

- **Execution:** Studio generation and Mapping actions meet at configured services, corpus access, transport, and selected shared runtime contracts. They retain their different agents and cancellation behavior.
- **Artifacts:** derivation/proposals and editor/workspace state meet at persisted artifacts and revisioned publication. Their different history and save semantics become visible above the common store.
- **Evidence:** external authoring supplies source-backed material; selection exploration consumes it; shared identities, maps, indexes, and resolvers explain the connection.
- **Interpretation:** parser evaluation, experiment review, and browser surfaces all interpret or assess diagram content. This is thematic registration; the standalone Python tool is not wired into the application.

The empty cells are deliberate. They avoid adding diagrams to satisfy a rectangular count and leave breathing room around dense cells. Do not move a diagram into an empty slot solely to make one plane look balanced.

### Physical coordinates

Use a right-handed world convention with X right, Y up, and Z increasing toward the viewer. Row 1 appears above row 2. With cell side `S = 1792`, gutter `G = 160`, and depth step `D = 2000`, the lower-left origin of cell `(plane, row, column)` is:

```text
x = (column - 1) * (S + G)
y = (2 - row)    * (S + G)
z = (4 - plane)  * D
```

Thus External is at depth 6000, Studio 4000, Mapping 2000, and Shared foundations 0. All cells have the same orientation and scale. Plane number is an index; the formula defines its actual world depth. The dimensions are a proposed layout convention, not a claim about the current application's renderer.

## Shared elements and parallel projection

Shared concerns determine cell placement. **Actual shared entities/contracts** determine cross-diagram anchors. These are different relationships: proximity alone does not establish a data-flow edge.

Every independent generation packet includes a small applicable anchor registry. Use approximately two to six anchors in a diagram when real connections justify them; do not add phantom nodes to fill the registry. Most of each diagram remains a substantial internal explanation.

The starting registry below fixes normalized positions inside a cell, measured from its lower-left corner. Display a shared node once and connect its internal uses to it. A boundary-only occurrence is marked as such and excluded from the density target.

| Canonical anchor | Local `(u, v)` | Applicable diagrams | Identity constraint |
| --- | --- | --- | --- |
| `DiagramRepository` | `(0.14, 0.82)` | SM-01, SM-02, SM-05, SM-06 | The injected application port; distinguish concrete store methods |
| `ProjectRepresentationCatalogRecord` | `(0.86, 0.82)` | SM-02, SM-07, SM-08, SM-10 | Shared record type, not a claim of one project instance |
| `ProjectRepresentationRevisionRecord` | `(0.86, 0.65)` | SM-02, SM-07, SM-08, SM-10 | Published revision; never substitute an unsaved draft |
| `ProjectRepresentationEvidenceRecord` | `(0.86, 0.48)` | SM-02, SM-03, SM-08, SM-10 | Project evidence; keep session entities distinct |
| `RepresentationIndex` | `(0.50, 0.20)` | SM-03, SM-04, SM-08 | Indexed representation contract, with context-specific instances |
| `runAgentWorkflow` | `(0.14, 0.64)` | SM-05, SM-09 | Shared implementation; SM-09 binds its compaction branch only |

Before generation, check the named source symbol and bind each applicable anchor to its exact file/export. If a proposed occurrence is not supported by the code, remove that binding and record why; do not create an adapter or duplicate entity to make the layout work. Type-equivalence links and links between the same persisted instance must use different edge labels.

For equal-scale parallel planes, corresponding points produce parallel connecting lines when every displacement is the same. In common local coordinates:

```text
q_i - p_i = t             for every corresponding shared anchor i
```

Identical local anchors have `t = (0, 0)`. For vertically registered cells, their connections are normal to the planes. For adjacent cells, include the difference in cell origins: a common nonzero lateral displacement produces equally slanted connections. An arbitrary linear map can scale or shear positions and does not guarantee this property; the required local mapping is a **translation**, generally an affine map.

In 3D the general condition is `B_i - A_i = lambda_i * v`: each connection follows one common direction `v`. Between two fixed parallel planes, the depth separation fixes the same `lambda` for all connections. “Same angle” needs a direction in 3D—both inclination and azimuth—not just an angle against a page edge.

If an oblique projection is desired for the entire stack, apply one global lateral shift proportional to world depth. Do not independently shift individual anchors or rotate/resize individual diagrams. Check anchor registration with:

```text
t = mean(q_i - p_i)
registration_error = sqrt(mean(|| (q_i - p_i) - t ||^2))
```

The planned coordinate error is zero; a renderer can declare a small pixel tolerance. Parallelism applies to the designated corresponding anchors of a diagram pair. It does not require every causal edge in the atlas, including edges between different entities/cells, to have the same direction.

### Important connections to expose across cells

| Connection | Relationship to show |
| --- | --- |
| SM-10 → SM-05 | Generated creation request invokes collection/generation |
| SM-10 → SM-02 | Materialized import, explicit promotion, canvas revision, and projection publication |
| SM-05 → SM-02 | Accepted generation records are persisted; candidate promotion is a separate action |
| SM-05 → SM-06 | Existing generated artifacts supply derivation/capture baselines |
| SM-06 → SM-03 | Explicit remapping and reference/evidence resolution for derived content |
| SM-07 ↔ SM-02 | Save with expected revision; success or conflict returns to the draft |
| SM-07 ↔ SM-09 | Selected context starts an action; proposals/chat return to browser-owned state |
| SM-02 → SM-08 | Published revisions and projection relations enable exploration |
| SM-08 ↔ SM-03 | Evidence/index lookup, source resolution, and definition navigation |
| SM-03 → SM-05 | Selected references and validated evidence feed compiled context |
| SM-11 ↔ SM-05 | Shared compiler/runtime implementations; not a viewer call into interactive batch execution |
| SM-11 → SM-04 | Experiment/dataset results use shared browser content rendering |
| SM-12 ··· SM-04 | Thematic interpretation relationship only; no runtime integration edge |

Keep composition edges from SM-01 available on demand. Rendering every composition dependency simultaneously would obscure the stronger behavioral connections above.

## Generation handoff and review

Each independent generator receives:

1. The baseline/scope and density rules from this document.
2. Its one complete brief, including boundary exclusions and source anchors.
3. Its cell origin/size and applicable canonical anchor bindings.
4. The relevant incoming/outgoing contracts from the connection table.

Its later output should include one diagram, a source-backed node/edge manifest, anchor coordinates, and a short uncertainty list. That output is future work; this document delivers only descriptions and spatial layout.

Review each diagram first for coherent boundaries, real behavior, and reference-level complexity. Count meaningful labels and cross-branch relationships as diagnostics, then inspect the flow itself. Reject caption-heavy summaries, fabricated detail, conflated state authorities, and diagrams that require another cell to supply most of their explanation. Review shared-anchor registration and inter-cell relationships only after the individual diagrams meet that bar.
