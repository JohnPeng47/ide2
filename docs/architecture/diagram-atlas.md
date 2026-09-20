# Codebase diagram atlas

This is a specification for **28 independently generated diagrams**, followed by their placement on **three parallel planes**. It contains descriptions and layout metadata, not generated diagrams or changes to the application renderer.

Source baseline: `a17912d`, reviewed September 14, 2026. Paths refer to this repository, not the VS Code project currently served at port 5188. The scope is first-party application, domain, infrastructure, browser, development, evaluation, and parser code. Vendored `softwarez/`, dependencies, build outputs, saved user diagrams, and frozen evaluation outputs are inputs or external boundaries, not additional codebases to diagram.

## How the set was finalized

Three independent reviewers proposed 23 diagrams: seven Studio, seven Mapping, and nine Core/shared. The primary review covered composition, application navigation, scripts, Python tooling, and verification. Diagram boundaries were reconciled **before** assigning coordinates.

| Local proposal or omission | Global decision |
| --- | --- |
| Studio candidate promotion and Core catalog lifecycle repeated the same story. | Merge into D04. Include candidate ranking and promotion conversion there; give catalog revisions one authoritative explanation. |
| Core catalog proposal also expanded selection projection, overlapping Mapping traversal. | Move traversal into D20, including its Core rules. D04 owns publication and consistency; D20 owns interpretation and navigation. |
| Studio and Mapping both have editors and LLM generation. | Retain D14, D19, and D22 separately: persisted derived artifacts, browser document history, and selected-row proposals have different mutation contracts. |
| Core source access and Mapping source-pane navigation overlap. | Retain D06 and D21 with a precise HTTP boundary. File identity/LSP and browser history/scroll ownership are different explanations. |
| Experiment execution and dataset curation were one large diagram. | Split at persisted experiment artifacts into D16 and D17. This keeps each independently readable. |
| Existing representation layers were mentioned only as a side concern. | Add D25 for the session graph, feedback, and recipes. It is distinct from catalog projections and from this atlas's presentation planes. |
| Core session call-graph focus was outside the main proposals. | Add a separately labeled lane to D20; never merge its validator or identity model with catalog projection. |
| Shared panes could become repeated component inventories. | D02 combines application navigation with the reusable pane protocol. Feature briefs retain only host/consumer interfaces. |
| Cross-system and supporting code fell outside feature ownership. | Add D01 runtime composition, D26 standalone parser, D27 artifact preparation/exchange, and D28 verification. |
| Small helpers, fixtures, migrations, and UI variant controls could inflate the count. | Cover them in their owning explanation: migrations in D03/D09, UI controls in D23/D28, historical inputs in D26/D27. No diagram per helper or test. |

The resulting set is 28. Empty layout cells are intentional; no diagram was invented to fill a grid.

## Contract for every independent generator

Give the generator this section, its complete numbered brief, and the named source files from the baseline. Follow relevant imports to verify an edge, but keep excluded implementations as labeled boundary stubs. Other diagrams' generated outputs are unnecessary.

- Explain the brief's question. Use roughly 8–16 primary nodes, grouping related records or implementation stages. A source file is evidence, not automatically a node.
- Label relationships with what they mean: calls, contains, reads, writes, produces, snapshots, validates, or refers to. Distinguish a control-flow arrow from an ownership/provenance association.
- Show the important fork or rejection path specified in the brief. Do not turn a tested example or legacy fixture into an unconditional runtime connection.
- Use source symbol names for concrete components; identify conceptual groupings as such. Record source-file/symbol evidence for nodes and edges. Re-resolve line ranges from the baseline if a later renderer needs source mappings.
- Give the diagram its stable `Dxx` ID. Preserve the named external ports in its brief, using IDs `Dxx.port-name`. Their exact local coordinates can be supplied after generation; the proposed atlas never assumes independently generated nodes happen to align.
- Fit the same 1200 × 800 logical-unit content rectangle as every other diagram. Labels must remain legible at a common scale; simplify groups rather than shrinking only one diagram. Titles and source notes should use the same reserved margins.
- Spatial proximity means related concerns. **Only explicit edges assert a code/data relationship.** The atlas does not claim this repository already implements a 3D renderer.

Shared terminology:

| Term | Meaning that must remain consistent |
| --- | --- |
| Project | Corpus identity plus project resources. It can have catalog representations without any DiagramSets. |
| DiagramSet | A generation session with evidence, candidates, batches, runs, and editing records. |
| Studio artifact | A diagram or component produced/imported/derived for Studio; distinct from a catalog revision. |
| Project representation / revision | Stable catalog identity and immutable version containing ASCII, mappings, evidence, and optional scene content. |
| Mapping document / workspace | Browser scene and history / separately saved drafts, display state, conversations, panes, and camera. |
| Evidence | Entity/range identity with provenance and potentially captured source text; not just a filename or label. |
| RepresentationIndex | Structural or spatial element identities scoped to an artifact revision/hash. |
| ProjectProjectionRecord | Relation between pinned project representation revisions and their evidence/target nodes. |
| RepresentationGraphRecord | Session-owned layers, ranked transitions, recipes, and feedback. Its layers are not atlas planes. |
| File compaction | Distinguish a standalone agent run, a published Core compaction record, and an embedded projection snapshot. They are not automatically synchronized. |

## Final diagram descriptions

### D01 — Runtime composition and ownership

**Question:** How do the browser, thin HTTP layer, application services, and concrete integrations form one running system?

**Boundary:** Include process startup, React/browser versus Node boundaries, three feature namespaces, port injection, first-request recovery, shutdown, and JSON/NDJSON error translation. Exclude endpoint-by-endpoint inventories, individual workflows, and storage algorithms.

**Relationships:** The launcher sets process-local LSP opt-in and starts Vite. Vite loads `diagramApi`; `createBackend` constructs repositories, corpus access, optional language service, and real/fake feature runtimes, then injects them into services/routes. Browser clients call HTTP namespaces, never import backend implementations. Application code uses ports; infrastructure implements them; domain supplies pure rules. The middleware gates requests on one recovery promise and disposes integrations on server close. Before headers, failures become HTTP errors; after streaming starts they become error events. Do not depict every streaming operation as cancellable: chat and compaction explicitly connect response close to cancellation, whereas the selection/Studio routes do not all do so.

**External ports:** `browser` = browser application; `workflows` = feature operations; `adapters` = concrete integrations; `recovery` = Studio lifecycle. Filesystem, Pi provider, Codex child process, and language server remain separate external nodes.

**Sources:** `scripts/dev/start-server.mjs`; `vite.config.ts`; `src/server/app/bootstrap.ts`; `src/server/app/vitePlugin.ts`; `src/server/http/http.ts`; `src/shared/http/http.ts`; `tests/architecture/dependencies.test.ts`.

### D02 — Application navigation and shared pane delivery

**Question:** How do page navigation and pane navigation deliver a user to the right view without coupling destination behavior to layout?

**Boundary:** Include React mount/provider, Studio/Mapping/Experiments page choice, Mapping leave guard, Studio pane composition, pane state/API/rendering, and deferred jump delivery. Exclude each screen's internal workflow and Mapping's retained canvas display tree, which is a separate model.

**Relationships:** `App` maps paths to pages, observes browser history, and consults Mapping's dirty-navigation guard. Studio can open a catalog diagram through `/mapping?diagram=…`. `RefBufferProvider` surrounds the app. Feature pane commands update `PaneApi` and its split/leaf/tab state; subscribers drive `PaneWorkspace`. `PaneNavigationApi` activates/focuses a destination, keeps bounded deduplicated history, and queues delivery until a registered feature handler can perform final focus/scroll. Newer requests of the same kind supersede pending older ones. Profile configuration supplies view/tab choices; it does not implement navigation.

**External ports:** `app` = browser application entry; `workspace` = loaded Core snapshot; `profile` = profile contributions; `destination` = feature focus/reveal handler; `mapping-guard` = Mapping draft owner.

**Sources:** `src/main.tsx`; `src/app/App.tsx`; `src/features/studio/StudioPage.tsx`; `src/features/mapping/MappingPage.tsx`; `src/shared/panes/model.ts`; `src/shared/panes/api.ts`; `src/shared/panes/navigation.ts`; `src/shared/panes/PaneWorkspace.tsx`.

### D03 — Persisted record families and workspace assembly

**Question:** What owns the artifacts, and how do distributed records become one workspace snapshot?

**Boundary:** Include project/session ownership, global import library, aggregate repository facade, capability persistence modules, and application assembly. Exclude catalog mutation rules, detailed workflows, and Mapping workspace encoding.

**Relationships:** Project IDs identify DiagramSets; each set identifies its entity collection, artifacts/components, batches, runs, maps, and edit sessions. Entities own source-range snapshots. The global library owns imported artifacts and dependencies alongside local set records. `loadWorkspace` reads these families, migrates legacy imports, builds keyed dictionaries, and adds catalog, plans, highlights, and progress. `DiagramRepository` is the application contract; `DiagramStore` forwards to filesystem modules. Its compatibility `loadWorkspace` forwards to application assembly, so assembly must not be placed inside the filesystem layer. Show missing-project handling: imports may still be available. Identity-relabeling migrations form an explicit offline branch that validates planned rewrites and preserves backups, not a normal request stage.

**External ports:** `workspace` = `WorkspaceSnapshot`; `records` = session/artifact repository; `catalog` = parallel project catalog; `import-library` = reusable artifact/evidence records.

**Sources:** `domain/core/records/domain.ts`; `application/core/workspace/loadWorkspace.ts`; `application/core/ports/diagramRepository.ts`; `infrastructure/core/persistence/store.ts`; `infrastructure/core/persistence/paths.ts`; `infrastructure/core/persistence/shared.ts`; `infrastructure/core/persistence/imports.ts`; `scripts/migrations/relabel-code-entity-identities.mjs`; `scripts/migrations/relabel-artifact-ids.mjs`.

### D04 — Candidate curation and immutable project revisions

**Question:** How do Studio candidates and Mapping scenes enter one catalog without losing provenance or overwriting a newer revision?

**Boundary:** Include candidate ranking/archival as entry actions, star/promotion conversion, representation/revision identity, active pointers, Mapping-save consistency, and projection publication as a catalog command. Exclude generation, scene gestures, and traversal algorithms.

**Relationships:** Candidate batches retain membership and rankings; lineage refers to generation/derivation records. Starring invokes promotion. Promotion converts local/imported entity and range addresses into project evidence IDs, captures source text when absent, translates mappings, and preserves source provenance. Catalog rules create/reuse a representation revision; active-by-kind selects settled views used by later generation. Mapping save requires an expected current revision, flattens scene content/evidence, and appends a version or rejects with a conflict. `ProjectCatalogStore` serializes read–transition–atomic-write in process; this is not cross-process locking. Publishing a projected tree can persist target revision and pinned relation together. Candidate archival, unstar/representation archival, and ranking are distinct actions. Core compaction publication is a separate explicit command and uses a companion catalog.

**External ports:** `promotion-input` = candidate/evidence/map draft; `scene-save` = scene plus expected revision; `catalog` = representation snapshot; `projection-publication` = explicit projected-tree/relation command.

**Sources:** `application/studio/candidates/service.ts`; `src/features/studio/candidates/DiagramLineagePanel.tsx`; `src/features/studio/candidates/DiagramCandidateFeedbackDialog.tsx`; `domain/core/representations/projectCatalog.ts`; `domain/core/representations/catalogRules.ts`; `domain/core/representations/catalogCommands.ts`; `domain/core/diagrams/projectDiagramCanvas.ts`; `infrastructure/core/persistence/projectCatalogStore.ts`; `application/core/representations/service.ts`.

### D05 — Coordinates, revision identity, and evidence interaction

**Question:** How does a position in ASCII become a trustworthy evidence-bearing selection?

**Boundary:** Include shared grid/selection calculations, structural versus spatial indexes, map/hash validation, rendering overlays, and representation-scoped agent progress. Exclude document mutation history, evidence generation, source loading, and projection publication.

**Relationships:** ASCII, artifact identity/hash, and mappings build a `RepresentationIndex`: tree nodes have structural identity; diagram elements have character-grid spans. Shared geometry converts selection bounds into selected text and intersecting mappings. `DiagramView` suppresses mappings for wrong IDs/hashes and during editing, then emits source-reveal/reference actions from valid selections. Representation kind controls presentation; domain profile separately controls permitted commands. Work scopes resolve artifact/element/subtree/evidence targets against the same revision-bound index; progress validation rejects stale targets before rendering visited/current/completed/failed overlays. Partial-diff overlays preview changes without rewriting evidence. Keep scene offsets, diagram-local bounds, one-based source ranges, and index IDs explicitly distinct.

**External ports:** `mapping-input` = validated artifact map; `index` = revision-bound index; `selection` = evidence identities plus selected text; `scene-geometry` = shared grid operations; `progress` = scoped work state.

**Sources:** `domain/core/diagrams/lineGrid.ts`; `domain/core/diagrams/diagramSelection.ts`; `domain/core/diagrams/diagramMappings.ts`; `domain/core/diagrams/asciiTree.ts`; `domain/core/representations/representationIndex.ts`; `domain/core/agent-work/agentWork.ts`; `src/shared/diagrams/DiagramView.tsx`; `src/shared/diagrams/AsciiSelectionGrid.tsx`; `src/shared/diagrams/DraggableDiagramCanvas.tsx`.

### D06 — Corpus access, live source, and optional definitions

**Question:** How does source acquisition preserve corpus identity while supporting snapshots and live language-service navigation?

**Boundary:** Include corpus providers, directory listing, entity snippets versus full-file reads, path/project/hash checks, LSP startup/session lifetime, and cancellation. Exclude browser history, folds/scroll, and offline diagram parsing.

**Relationships:** Project corpus binding selects bounded filesystem access for Git or document corpora. Providers reject paths outside the corpus, including symlink traversal. Entity snippet reads can overlay captured `originalLines` onto corpus text; they are not always live-only views. Full project-source reads return current text, SHA-256, and LSP capability. A definition request carries project, path, UTF-16 position, and fetched hash; the language service validates freshness and returns normalized in-root locations. With explicit startup opt-in, the adapter lazily starts TypeScript language-server sessions, uses JSON-RPC document/definition calls, serializes requests, and disposes idle/closed sessions. Distinguish disabled service, stale input, multiple targets, and outside-root results.

**External ports:** `live-source` = full-file text/hash response; `snapshot-source` = evidence snippet; `definitions` = validated location response; `corpus` = source-reader interface.

**Sources:** `application/core/corpus/corpusAccess.ts`; `application/core/source/projectSource.ts`; `application/core/source/service.ts`; `application/core/source/languageService.ts`; `infrastructure/core/corpus/corpus.ts`; `infrastructure/core/language-services/projectLanguageService.ts`; `domain/core/source/sourceNavigation.ts`; `src/server/routes/core/routes.ts`; `src/shared/source/sourceDomPosition.ts`.

### D07 — Domain profiles and source/document presentation

**Question:** How does one application adapt its evidence vocabulary, views, commands, and rendering to source-code and document corpora?

**Boundary:** Include persisted profile resolution and its policy outputs, representation-kind metadata, shared source presentation, and Markdown rendering/navigation. Exclude generation prompt details, LSP, and page/pane state machines.

**Relationships:** `Project.domainProfileId` resolves to a built-in profile, with source-code fallback for legacy values. The profile supplies corpus kind, evidence schema, available tabs/views, permitted commands, wrapping, highlighting, Markdown behavior, and compaction policy. Source-code and document paths then choose appropriate shared rendering. Terminal Markdown passes through tokenization, heading/source-line anchors, repository-link decoration, and fenced-code highlighting into an iframe; iframe messages return file/section/source navigation to host callbacks. Representation kind comes from artifact metadata, independently of corpus profile. Do not imply that every helper in the Markdown directory is on the active render path.

**External ports:** `policy` = profile contributions; `content` = source/document text; `navigation` = host file/section callback; `preview` = embedded content consumer.

**Sources:** `domain/core/profiles/domainProfile.ts`; `domain/core/profiles/domainProfiles.ts`; `src/shared/source/SourceCodeView.tsx`; `src/shared/markdown/TerminalMarkdownView.tsx`; `src/shared/markdown/TerminalMarkdownContent.tsx`; `src/shared/markdown/MarkdownSectionsPanel.tsx`; `src/shared/markdown/render.ts`; `src/shared/markdown/links.ts`; `src/shared/markdown/toc.ts`; `src/shared/representations/representationPresentation.ts`.

### D08 — Evidence reuse through references and highlights

**Question:** How does selecting mapped content become temporary prompt context or a durable navigation bookmark?

**Boundary:** Include reference identity/provenance, scoped buffer, local/imported resolution, output sinks, and a separate persisted-highlight branch. Exclude prompt execution, import storage mechanics, and plans.

**Relationships:** Mapped selections produce typed entity/artifact/range references. The reducer deduplicates identities and clears them on scope change; the tray resolves local/imported records and reports unavailable references. Formatters emit prompt tokens, source locations, or full context through clipboard and host callbacks. The versioned browser event separately carries a structured `ReferenceEnvelope` of identities and project/session scope. In a parallel branch, highlight creation resolves an artifact bundle and index, captures evidence/revision/element identity and optional tree lineage/excerpt, persists it, then exposes it through workspace and highlight navigation. A highlight is not a stored reference-buffer entry; historical coordinates must not silently acquire a new meaning.

**External ports:** `mapped-references` = selected identities; `resolved-context` = explicit reference output; `artifact-bundle` = provenance-aware lookup; `highlight-navigation` = saved evidence destination.

**Sources:** `domain/core/references/refBuffer.ts`; `domain/core/references/referenceResolver.ts`; `domain/core/references/refFormatters.ts`; `src/shared/references/RefBufferContext.tsx`; `src/shared/references/RefBufferTray.tsx`; `src/shared/references/refOutputSinks.ts`; `application/core/highlights/service.ts`; `domain/core/highlights/highlights.ts`; `infrastructure/core/persistence/highlights.ts`; `src/shared/highlights/HighlightsTreePanel.tsx`.

### D09 — Plans as saved baselines and proposed changes

**Question:** How are proposed diagram and compaction changes persisted and previewed without applying them?

**Boundary:** Include plan input validation, captured selection/baseline snapshots, change variants, artifact persistence, preview projection, and legacy plan migration. Exclude generating a plan's contents, executing a plan, and editing source files.

**Relationships:** Plan API requests pass through `PlanService` and domain validation into repository persistence. A plan relates its selected snapshot to modified diagrams, added diagram drafts, and entity-compaction changes. Persistence materializes manifests, Markdown, selections, and per-change artifacts and validates their consistency. Plan updates can replace selection/changes and rewrite those snapshots; these are not catalog-style immutable revisions. Loading reconstructs the relationships. Pure preview functions apply patches to modified-diagram baselines and adjust mappings; added diagrams supply draft ASCII, while compaction changes supply structured before/after content. Plan panels use shared diagram/source/document renderers. The migration CLI supplies legacy records through an explicit conversion path. There is no implied apply-to-source or auto-generation edge after preview.

**External ports:** `plan-input` = explicit plan producer; `baseline` = selected artifact/evidence snapshot; `preview` = proposed content/mappings; `records` = plan repository.

**Sources:** `domain/core/plans/plans.ts`; `domain/core/records/domain.ts`; `application/core/plans/planService.ts`; `infrastructure/core/persistence/plans.ts`; `infrastructure/core/persistence/planMigration.ts`; `src/shared/plans/PlanPreview.tsx`; `src/shared/plans/PlansTreePanel.tsx`; `scripts/migrations/migrate-plans.ts`.

### D10 — Shared agent execution and accepted submissions

**Question:** Which common mechanisms let feature-owned workflows advance only after valid structured output?

**Boundary:** Include generic ordered steps, executor injection, submission acceptance/rejection, Pi runtime/session ownership, progress translation, and disposal. Exclude business prompts, batch scheduling, and feature persistence.

**Relationships:** `runAgentWorkflow` checks unique step IDs, invokes before/prompt/execute/validate in order, passes accepted previous output to the next step, and checks cancellation around asynchronous stages. Missing output stops the chain. A concrete executor owns session tools; `createValidatedSubmission` returns correction feedback for invalid output and retains accepted output for the executor. `PiAgentRuntime` lazily owns provider/model setup and registered sessions; progress mapping feeds feature event sinks. The actual generic-runner consumers are Studio artifact generation and Mapping two-pass compaction. Selection prompting uses its own adapter contract; chat uses a separate Codex process. Do not draw every LLM request through one universal executor.

**External ports:** `executor` = workflow step execution; `accepted-output` = validated submission; `progress` = feature event sink; `provider` = Pi model/session integration.

**Sources:** `application/core/agents/agentWorkflow.ts`; `infrastructure/core/agents/validatedSubmission.ts`; `infrastructure/core/agents/agentRuntime.ts`; `infrastructure/studio/agents/agentRuntime.ts`; `application/mapping/compaction/fileCompactionService.ts`.

### D11 — Evidence collection and materialized session creation

**Question:** How does a corpus request become a ready DiagramSet through either collection or supplied artifacts?

**Boundary:** Include creation preflight, corpus/profile matching, session creation, entity collection/validation/finalization, failure handling, and materialized input. Stop at initial-generation dispatch or successful materialized result.

**Relationships:** The creation route prepares input before starting NDJSON. Generated mode validates the target corpus/store, creates project/session records, snapshots collection criteria, records a run, and invokes entity collection with profile-appropriate readers/tools. Validation checks source ranges and entity fields, assigns durable identities, and captures `originalLines`; completing collection freezes evidence before initial generation. Failure records collection/run failure. Materialized mode validates caller-provided entities, ASCII, maps, and keys, creates the same record families, optionally promotes featured views, and returns key-to-ID mappings without collection/generation agents. Its cleanup moves a failed newly created set to trash.

**External ports:** `manifest` = generated/materialized request; `corpus` = bounded source access; `ready-evidence` = finalized evidence/session; `initial-generation` = generation dispatch; `records` = session repository.

**Sources:** `application/studio/collection/diagramSetWorkflow.ts`; `application/studio/collection/service.ts`; `application/studio/generation/codeEntityPrompt.ts`; `application/studio/generation/agent.ts`; `infrastructure/studio/agents/agentRuntime.ts`; `src/server/routes/studio/routes.ts`; `src/features/studio/api.ts`.

### D12 — Prompt compilation and permitted context

**Question:** What fixes exactly which instructions, evidence, and references an independent generation slot may use?

**Boundary:** Include browser drafts/derivative context, mutable named templates, immutable compiled configurations, reference inclusion, allowed-evidence closure, and auxiliary-view prerequisites. Exclude model execution and general reference-buffer internals.

**Relationships:** Generation controls and template settings supply target, model, count, instructions, and reference choices. Browser drafts are scoped to project/session/derivation; derivative helpers recover historical corrections and references. Compilation resolves template revisions, profile vocabulary, mentions and explicit inclusion choices, rejects ambiguous/unavailable targets, and expands referenced artifacts into allowed evidence. Call Graph requires a settled main Diagram; Directory View also requires a settled Call Graph. Their foundations are locked inputs. The result includes rendered prompt bodies, immutable provenance, and explicit allowed IDs/aliases; a batch persists and reloads that configuration before dispatch. Printed aliases are not persisted identities.

**External ports:** `allowed-context` = finalized evidence/library inputs; `reference-input` = explicit resolved reference choices; `settled-views` = catalog foundation lookup; `prompt-config` = immutable configuration and allowed outputs.

**Sources:** `domain/studio/generation/prompt.ts`; `domain/core/prompts/prompt.ts`; `application/studio/prompt-settings/service.ts`; `application/studio/generation/service.ts`; `src/features/studio/generation/GeneratorOptions.tsx`; `src/features/studio/generation/derivativePrompt.ts`; `src/features/studio/generation/generationPageDraft.ts`; `src/features/studio/prompt-settings/SystemPromptSettingsDialog.tsx`.

### D13 — Parallel generation, retry, and recovery

**Question:** How do independent candidate slots become one completed generation batch?

**Boundary:** Include per-set active-batch guard, persisted inputs/runs, parallel slots, per-slot turn order, validation/deduplication/retry, completion, and restart recovery. Exclude prompt expansion, candidate curation, and filesystem internals.

**Relationships:** A ready set and accepted request create one persisted config/batch and N run records. Parallel slots receive the same configuration with distinct execution identity. Each isolated generation session performs initial submission, optional reference refinement, and mandatory final evidence-mapping turn; that last turn must preserve artifact content. Validation checks allowed evidence, ASCII, and mappings. Duplicate/failed slots retry while accepted slots remain accepted. An incomplete batch is failed rather than passed to `completeBatch`; a complete accepted set publishes artifacts/maps and final workspace/result events. Progress updates run state. Recovery classifies interrupted runs and incomplete batches after restart; completion/failure releases the active guard. This is same-prompt candidate generation, not the independent per-brief generation requested for this atlas.

**External ports:** `batch-input` = persisted prompt configuration; `executor` = agent-session step boundary; `artifacts` = accepted artifacts/maps; `records` = batch/run repository; `recovery` = startup hook.

**Sources:** `application/studio/generation/service.ts`; `application/studio/generation/generationWorkflow.ts`; `infrastructure/studio/agents/agentRuntime.ts`; `application/studio/lifecycle/service.ts`; `src/features/studio/api.ts`; `src/features/studio/StudioPage.tsx`.

### D14 — Derived editing and component extraction

**Question:** How can manual, marker, and LLM edits or rectangular captures preserve their source artifact?

**Boundary:** Include edit-session creation, operation cursor/patch history, marker handling, LLM operations, finish/discard, and nested component capture. Exclude Mapping document history, source-file edits, catalog promotion, and automatic remapping.

**Relationships:** Artifact lookup opens a working-copy session with base/current ASCII and source provenance. Serialized manual changes create reversible patch operations; changing after undo truncates the redo branch. Marker operations track substituted characters and unresolved markers. LLM editing consumes the full working copy and marker context and returns another recorded patch. Finish checks applied changes and resolved markers, then publishes a new edited artifact with derivation/session links; discard retains session history without publishing an output. Capture crops a selected rectangle into a new component, retaining source-parent/bounds/evidence, and can repeat on nested components. UI operation and partial-diff views read history. A new edited copy does not automatically receive a newly validated evidence map.

**External ports:** `source-artifact` = local/imported artifact; `derived-artifact` = new edited/captured artifact; `executor` = editing adapter; `records` = session/artifact persistence.

**Sources:** `application/studio/editing/service.ts`; `domain/studio/editing/operations.ts`; `src/features/studio/editing/EditOperationsPanel.tsx`; `src/features/studio/editing/artifactPartialDiffs.ts`; `src/features/studio/StudioPage.tsx`; `infrastructure/studio/agents/agentRuntime.ts`.

### D15 — Remapping existing artifacts to source evidence

**Question:** How are verified source associations attached to an existing ASCII revision while independent targets succeed or fail separately?

**Boundary:** Include target preparation, active-target guards, bounded workers, mapping validation/storage, revision-scoped progress, and asynchronous browser merging. Exclude initial generation's mapping turn and the internals of representation indexing.

**Relationships:** Remapping actions produce unique artifact targets. Preparation resolves mapped-artifact bundles and finalized evidence, rejects unavailable/archived/evidence-less targets, and creates hash-scoped runs and progress. Bounded workers invoke mapping agents with unchanged artifact text and relevant evidence. Accepted mappings pass domain validation and persist as sidecars; completed progress uses the rebuilt index. Failure remains scoped to that target and does not discard successful siblings. NDJSON events update per-artifact jobs; `mergeMappingWorkspace` merges returned maps/runs/progress into current browser state. Rendering consumes only maps matching the artifact revision. The term mapping here means attaching evidence in Studio, not editing a Mapping canvas.

**External ports:** `remap-target` = existing artifact plus evidence; `index` = shared revision/index validator; `validated-map` = sidecar and progress; `records` = run/map storage.

**Sources:** `application/studio/evidence-mapping/service.ts`; `src/features/studio/StudioPage.tsx`; `src/features/studio/api.ts`; `infrastructure/studio/agents/agentRuntime.ts`; `domain/core/diagrams/diagramMapping.ts`; `domain/core/agent-work/agentWork.ts`.

### D16 — Controlled generation experiments and judgment

**Question:** How are prompt changes evaluated across controlled conditions and replicates?

**Boundary:** Include the offline experiment manifest, source evidence/configuration, generation conditions, blind judgments, metrics, prompt revision, resumable artifacts, and reports. Stop at persisted experiment output. Exclude viewer/dataset operations and interactive Studio batch records.

**Relationships:** `ExperimentRunner` reads finalized session evidence and templates and defines axes, iterations, values, and replicates. The shared prompt compiler creates per-condition configuration; `ExperimentRuntime` produces validated outputs and metrics. Existing outputs/judgments are reused on resume. Judging hides condition values behind rotated labels, compares across values and within replicates, and persists structured judgments. Aggregation combines ordering, signal/noise, distinguishability, and off-axis changes; an analyst's revised prompt feeds the next configured iteration. Manifests, configurations, generation records, judgments, and analysis retain the experimental provenance. Real execution delegates artifact generation to the Studio adapter; a fake runtime provides deterministic test behavior.

**External ports:** `source-evidence` = finalized session input; `prompt-compiler` = compiled condition configuration; `artifact-agent` = Studio generation adapter; `experiment-records` = persisted experimental outputs.

**Sources:** `tools/experiments/runner.ts`; `tools/experiments/runtime.ts`; `tools/experiments/metrics.ts`; `domain/studio/experiments/types.ts`; `domain/studio/experiments/experimentDomain.ts`; `domain/studio/generation/prompt.ts`.

### D17 — Experiment browsing and dataset provenance

**Question:** How does an experimental result become a curated, independently stored dataset example?

**Boundary:** Begin at persisted experiment artifacts; include catalog discovery, viewer selection, explicit dataset insertion, provenance snapshots, deduplication, labeling, and removal. Exclude running experiments, model training, and catalog promotion.

**Relationships:** `ExperimentCatalog` lists manifests and resolves selected axis/iteration/value/replicate artifacts through Studio read APIs. `ExperimentViewerPage` presents results and dataset actions. Explicit user selection enters `DatasetService.addFromExperiment`, which verifies the source against the catalog and copies full ASCII, evidence IDs, metrics, model, and prompt provenance into an item. `DiagramDatasetStore` deduplicates by source identity and persists the snapshot; labels can change independently. Dataset creation is not an automatic side effect of generation, and no training consumer should be invented.

**External ports:** `experiment-input` = persisted experiment artifacts; `curated-item` = independent labeled snapshot; `viewer` = experiment navigation host.

**Sources:** `infrastructure/studio/persistence/experiments/experimentCatalog.ts`; `application/studio/datasets/datasetService.ts`; `application/studio/datasets/repository.ts`; `infrastructure/studio/persistence/datasets/diagramDatasetStore.ts`; `domain/studio/datasets/datasetDomain.ts`; `src/features/studio/experiments/ExperimentViewerPage.tsx`; `src/server/routes/studio/routes.ts`.

### D18 — Diagram saves versus saved Mapping workspaces

**Question:** How do diagram revisions and the working session persist independently?

**Boundary:** Include page boot/open/create, per-document drafts, dirty guards, explicit diagram save, workspace capture/restore/import/export, schema validation, and workspace file persistence. Exclude catalog rules, gestures, and rendering internals.

**Relationships:** Catalog revisions hydrate scenes and draft documents. Open documents retain mounted state even when hidden; scene/name comparisons drive dirty guards. Diagram Save posts a scene and expected revision to `MappingDiagramService`, then adopts the returned revision as the saved baseline. Workspace Save captures all drafts, retained display/control state, conversations, current source-pane path/range-index/scroll checkpoints, and cameras into a separately validated snapshot and writes `mapping-workspace.json`. Source-pane back/forward visit history remains local React state. Restore checks project identity and codec invariants, upgrades older forms, and changes saved in-flight actions to interrupted/error state. Import/export uses the same snapshot contract. A saved workspace can preserve unsaved diagram drafts; it does not create their catalog revisions. Local undo history is not the same as either durable store.

**External ports:** `catalog-input` = project representations; `scene-save` = scene plus expected revision; `draft` = active document; `display-snapshot` = captured UI state; `mapping-guard` = dirty/leave decision.

**Sources:** `src/features/mapping/MappingPage.tsx`; `src/features/mapping/workspace/mappingProjectApi.ts`; `src/features/mapping/workspace/mappingWorkspaceRepository.ts`; `domain/mapping/workspace/mappingWorkspaceCodec.ts`; `domain/mapping/workspace/mappingWorkspace.ts`; `application/mapping/diagrams/diagramService.ts`; `application/mapping/workspace/workspaceService.ts`; `infrastructure/mapping/persistence/workspace/mappingWorkspaceStore.ts`.

### D19 — Mapping scene editing and retained state ownership

**Question:** How do canvas interactions change a document while selections, panes, and conversations retain independent ownership?

**Boundary:** Include pointer/keyboard/paste interaction, scene content/box hierarchy, document history, display ownership tree, selection controls, and render derivation. Exclude agent execution, catalog writes, projection algorithms, and the proposed 3D atlas renderer.

**Relationships:** Viewport transforms and character metrics convert pointer positions into scene hit tests and box-local selections. Scene boxes reference independent content and can group, move, collapse, or receive pasted diagrams. Shared layout/composition functions derive bounds and ASCII. Commit updates past/present/future document history and the page draft. Retaining a selection captures its box/content/revision/text/bounds into display state. Display nodes form a single-parent ownership tree; control surfaces attach to retained IDs or a transient draft selection. Geometry changes affect display layout; removal prunes descendants and controls. Accepted agent patches/new diagrams enter through the same undoable document commit. This display tree is distinct from shared `PaneLayoutState` in D02.

**External ports:** `document` = page-owned draft; `scene-geometry` = Core grid helpers; `selection` = retained mapped region; `commit` = accepted document change; `display-snapshot` = workspace capture.

**Sources:** `src/features/mapping/canvas/MappingCanvas.tsx`; `src/features/mapping/canvas/CanvasPasteMenu.tsx`; `src/features/mapping/canvas/pasteDiagram.ts`; `domain/mapping/workspace/mappingGrid.ts`; `domain/mapping/workspace/mappingDocument.ts`; `domain/mapping/workspace/displayModel.ts`; `src/shared/diagrams/DraggableDiagramCanvas.tsx`.

### D20 — Evidence-guided tree and compaction traversal

**Question:** How can selected evidence reveal related tree branches and source context, and which snapshots must still match?

**Boundary:** Include two clearly separated focus paths: Mapping's pinned catalog projection and Studio's session call-graph focus. Expand projection matching/filtering and navigation handoffs. Exclude projection publication, compaction generation, source fetching, and the session layer/recipe graph.

**Relationships:** In the Mapping lane, selected evidence and a pre-existing projection pass settled/current-revision and unsaved-scene checks. `projectSelection` OR-matches evidence links, selects target subtrees, and adds ancestors needed for display. Only matched/projected nodes—not display-only ancestors—feed `projectCompactions`; its next hop selects exact compaction rows and required ancestors without indiscriminate descendant expansion. Retained call-tree/compaction panes carry pinned revisions and saved result snapshots, then hand source metadata to a source pane. Later changes disable new dependent operations while retained historical content can remain visible. In the separate Studio lane, `callGraphFocus` validates selected entity provenance, session membership, and the settled call graph's foundation before filtering its tree for `CallGraphFocusTree`. It does not consume `ProjectProjectionRecord`.

**External ports:** `projection-input` = pinned catalog relation and evidence; `index` = structural identity; `source-pane` = selected file/snapshot metadata; `session-focus` = session artifact/evidence request.

**Sources:** `domain/core/diagrams/diagramProjection.ts`; `domain/core/representations/compactionProjection.ts`; `src/features/mapping/canvas/MappingCanvas.tsx`; `src/features/mapping/canvas/SelectionEffectsLayer.tsx`; `domain/mapping/workspace/projectedPaneLayout.ts`; `application/core/source/service.ts`; `domain/core/source/callGraphTree.ts`; `domain/core/source/callGraphFocus.ts`; `src/shared/call-graph/CallGraphFocusTree.tsx`.

### D21 — Source-pane navigation, freshness, and viewport state

**Question:** How does a source pane navigate live files while retaining projection context and avoiding scroll-driven workspace rerenders?

**Boundary:** Include cancellable file loads, projection-to-fold adaptation, hash mismatch behavior, file/definition navigation, back/forward visits, and live scroll/camera capture. Exclude backend corpus/LSP implementation and long-term workspace storage.

**Relationships:** Pane content selects a project source path; HTTP returns current lines/hash and LSP capability. Projection ranges adapt into folds/highlights only when their source hash still matches. Stale projections leave current source readable while disabling stale range-derived controls. Explorer navigation or Ctrl/Cmd-click/F12 moves through locations; multiple definition results use a chooser. Navigation captures path/range/scroll into local visit history without changing pane ownership. `SourcePaneViewState` binds live readers and per-document cameras outside the display React tree; explicit workspace capture samples them. Pruning and unmounting remove obsolete readers. The source service supplies data; the pane owns visit and viewport policy.

**External ports:** `pane-input` = projected file metadata; `live-source` = text/hash response; `definitions` = target locations; `display-snapshot` = sampled source/camera state.

**Sources:** `src/features/mapping/source-pane/SourceCodePane.tsx`; `src/features/mapping/source-pane/sourceCodePane.ts`; `src/features/mapping/source-pane/sourceCodeCompaction.ts`; `src/features/mapping/source-pane/sourcePaneViewState.ts`; `src/features/mapping/source-pane/SourcePaneViewStateContext.tsx`; `src/shared/source/SourceCodeView.tsx`; `src/shared/source/RepositoryFileExplorer.tsx`.

### D22 — Selection edits and generated sub-diagrams

**Question:** What limits an agent's output to an intended region and its allowed evidence?

**Boundary:** Include prompt UI, edit/generate fork, current-revision checks, source-context preparation, Pi submission validation, streamed result, and undoable browser application. Exclude Studio generation/edit sessions, source-file mutation, and diagram persistence.

**Relationships:** A source-covered selection plus instruction prepares a request; generation additionally supplies placement intent. The service validates input, project/base revision, and supplies project evidence/source-root context. `PiMappingAgentRuntime.promptDiagramSelection` calls `mappingPocSourceContextForSelection` to resolve exact excerpts, preferring captured source text when available. The adapter prompts against expected ASCII, selection identity, and row bounds. `submit_diagram_patch` either returns correction feedback or an accepted result. Editing replaces validated full rows, updates numeric revision/mapping positions, and relayouts content; generation validates a standalone artifact/evidence set and inserts a new scene box. Busy/stale guards protect the in-flight operation. The result remains an undoable browser draft until an explicit diagram save. Chat's historical-revision contract must not be substituted for this current-edit contract.

**External ports:** `selection` = selected region/current content; `source-context` = resolved immutable/live evidence excerpts; `patch` = accepted edit/new-diagram result; `executor` = selection-specific Pi adapter.

**Sources:** `src/features/mapping/canvas/MappingCanvas.tsx`; `src/features/mapping/api.ts`; `application/mapping/selection/selectionService.ts`; `application/mapping/selection/mappingPocSourceContext.ts`; `infrastructure/mapping/agents/selection/agentRuntime.ts`; `domain/mapping/selection/mappingPocPrompt.ts`; `domain/mapping/selection/mappingPocMappings.ts`; `src/server/routes/mapping/routes.ts`.

### D23 — Conversations anchored to frozen selections

**Question:** Why can a conversation continue discussing its original diagram even after the current diagram changes?

**Boundary:** Include selection/context capture, conversation display ownership, follow-up/retry, source snapshots, ephemeral Codex execution, cancellation, and explicit workspace-capture handoff. Exclude diagram editing, automatic catalog persistence, and provider protocol details.

**Relationships:** Starting a thread clones selected ASCII/revision/mappings/project context and anchors a conversation under retained selection state. Each turn sends that original context, prior eligible messages, current query, and verbosity. Preparation requires a valid historical revision belonging to the representation, not equality with its current revision. Existing source snapshots or resolved evidence are returned in a context event and retained for follow-ups. A fresh read-only Codex process answers each turn; progress/results update the thread, while disconnect/abort/shutdown cancel execution. Display policies choose compact/floating/docked presentation. `UiTestFramework` feeds the Mapping chat variant controls and can persist their settings in localStorage. Threads and drafts enter durable storage only through an explicit Mapping workspace snapshot, not diagram Save or an independent chat database.

**External ports:** `selection` = frozen context seed; `source-context` = evidence resolver contract; `display-snapshot` = conversation/context/control state; `codex` = read-only process integration.

**Sources:** `src/features/mapping/chat/LocalChatConvo.tsx`; `src/features/mapping/canvas/MappingCanvas.tsx`; `domain/mapping/chat/localChat.ts`; `domain/mapping/chat/localChatPrompt.ts`; `domain/mapping/chat/conversationPaneLayout.ts`; `application/mapping/chat/chatService.ts`; `infrastructure/mapping/agents/chat/localChatRuntime.ts`; `src/server/routes/mapping/chat/localChatRoutes.ts`; `packages/ui-test-framework/src/UiTestFramework.tsx`.

### D24 — Standalone compaction with two durable passes

**Question:** How does a single-file compaction run preserve accepted output and source provenance through failure or restart?

**Boundary:** Begin at external POST/GET compaction API calls; include source preparation, frozen bytes/hash, prompt/settings snapshots, compact/refine execution, pass/run files, stale-source reporting, cancellation, and interruption classification. Exclude a React entry action and automatic catalog publication: neither is implemented here.

**Relationships:** Preparation validates a source-code project and bounded UTF-8 file, captures bytes/hash and settings, then creates a durable running record and source snapshot. One session executes compact followed by refine using `runAgentWorkflow`; each accepted submission passes domain validation and saves text/JSON, prompt, model, and session metadata. Invalid submissions receive correction feedback. Completion rechecks the live source hash and reports `sourceStale` while preserving the original snapshot. Timeout/disconnect/shutdown cancels the session and records status; a loaded running record without an active controller is reported interrupted. The final artifacts can be consumed by an explicit external publication step, but this service does not write the Core compaction catalog or create projections.

**External ports:** `api-input` = one project file; `corpus` = bounded reader; `executor` = shared workflow/session contract; `run-artifacts` = stored source, passes, and run result.

**Sources:** `application/mapping/compaction/fileCompactionService.ts`; `application/mapping/compaction/fileCompactionWorkflow.ts`; `domain/mapping/compaction/validation.ts`; `domain/mapping/compaction/fileCompaction.ts`; `infrastructure/mapping/agents/compaction/fileCompactionRuntime.ts`; `infrastructure/mapping/agents/compaction/fileCompactionSettings.ts`; `infrastructure/mapping/agents/compaction/prompts.ts`; `infrastructure/mapping/persistence/compactionStore.ts`; `src/server/routes/mapping/compaction/fileCompactionRoutes.ts`.

### D25 — Session representation layers, recipes, and feedback

**Question:** How does a session relate artifact revisions at different information ranks and attach feedback to their relationships?

**Boundary:** Include `RepresentationGraphRecord`, layer and transition identity, recipe revisions, targeted feedback, graph validation, application persistence, and layer UI. Exclude project projection matching, catalog revisions as a storage mechanism, automatic regeneration, and atlas plane coordinates.

**Relationships:** A session graph references artifact revisions through layers with representation kinds and information ranks. Transitions must connect known layers in a DAG with increasing rank; evidence and recipe references qualify the relationships. Validation checks graph/session ownership, artifact availability, matching ASCII hash, kind, and recipe/feedback consistency. Saving persists the graph and returns workspace state. Layer UI uses topological/rank ordering, renders incoming transitions, and submits feedback targeted to a layer or transition. Versioned recipes can refer to incorporated feedback. Do not invent an automatic LLM regeneration loop from feedback. Spatial progress is separately checked against an artifact index/run and is not the graph's layout or the atlas's Z coordinate.

**External ports:** `artifact-revisions` = session/local-imported artifact references; `index` = shared revision/element validation; `graph-record` = persisted graph; `feedback` = explicit targeted comment.

**Sources:** `domain/core/representations/representationGraph.ts`; `application/studio/representations/service.ts`; `src/features/studio/candidates/RepresentationLayersPanel.tsx`; `src/features/studio/candidates/DiagramContextPanel.tsx`; `domain/core/representations/representationIndex.ts`; `domain/core/agent-work/agentWork.ts`.

### D26 — Standalone ASCII parser and independent evaluation

**Question:** How does the Python tool recover tree/graph structure and retain evidence about ambiguous or repaired input?

**Boundary:** Include tree and graph parsing stages, diagnostics/strict modes, original-versus-cleaned positions, CLI output, and the isolated generation/capture/oracle evaluation path. Exclude the TypeScript runtime index/parser and live application HTTP processing.

**Relationships:** Tree parsing normalizes/extracts rows, classifies prose/lists, cleans recognized routed-wire decorations, and iteratively builds a forest with original-line accounting. Graph parsing scans positioned spans/wires, partitions regions, parses local trees, straightens bounded drift, traces references, and returns original/cleaned text, repairs, and diagnostics. Strict modes report failures rather than treating uncertain interpretation as proven semantics. Separately, corpus generation records exact independent outputs/receipts; capture uses frozen parser versions and validation compares hashes, labels, and parent edges against independently reviewed expectations. Archived rounds are evidence artifacts, not current architecture. This standalone tool is not called by the application's TypeScript `RepresentationIndex` pipeline.

**External ports:** `ascii-input` = supplied/generated text; `parsed-output` = positioned structure and diagnostics; `evaluation-corpus` = frozen inputs and independent expectations.

**Sources:** `tools/diagram-parser/diagram_parser/tree_parser.py`; `tools/diagram-parser/diagram_parser/graph_parser.py`; `tools/diagram-parser/diagram_parser/generate_corpus.py`; `tools/diagram-parser/diagram_parser/capture_round.py`; `tools/diagram-parser/diagram_parser/validate_corpus.py`; `tools/diagram-parser/diagram_parser/test_tree_parser.py`; `tools/diagram-parser/diagram_parser/test_graph_parser.py`.

### D27 — Offline artifact preparation and explicit exchange

**Question:** How do external agents and preparation scripts turn source-backed artifacts into imported sessions and published projections?

**Boundary:** Include source evidence preparation, hashes/range checks, materialized manifests, explicit import/promotion/revision/projection stages, receipts, and reusable artifact bundles. Distinguish direct-store scripts from HTTP clients. Exclude executing generation agents and treating historical snapshots as current code evidence.

**Relationships:** The Mapping-screen preparer derives structural source outlines and selected ranges from TypeScript, emits hashed evidence and a materialized manifest, and prepares projection links. Its importer checks source hashes/project identity, uses explicit Studio/Core/Mapping APIs, records returned IDs/revisions in a receipt, and verifies persisted content and selected links. Refresh preserves identity through explicit new revisions. Other scripts prepare curated domain/transcript artifacts or write projected trees through `ProjectCatalogStore`; they are not all routed through HTTP. Artifact-bundle export/import resolves required dependencies and preserves provenance. The installed repository skill describes the public session-creation entry; its installer copies skill assets, not application code. Historical compactions/curated inputs must be regenerated before being represented as current source.

**External ports:** `manifest` = source-backed session input; `projection-publication` = explicit relation/tree command; `artifact-bundle` = artifact with evidence dependencies; `source-files` = verified source snapshots.

**Sources:** `examples/mapping-screen/prepare.ts`; `examples/mapping-screen/import.ts`; `examples/mapping-screen/refresh.ts`; `scripts/diagrams/import-projection.ts`; `scripts/diagrams/map-compositional-domain.ts`; `scripts/diagrams/bootstrap-transcript-diagram.mjs`; `scripts/diagrams/generate-prompt-call-tree.mjs`; `scripts/diagrams/validate-compactions.mjs`; `application/core/imports/service.ts`; `skills/new-diagram/SKILL.md`; `install-skill`.

### D28 — Verification boundaries and disposable fixtures

**Question:** Which independent checks establish ownership rules, data invariants, and observable browser behavior?

**Boundary:** Include TypeScript/build checks, import-boundary tests, colocated unit/integration tests, fake runtime composition, browser fixtures, source performance/navigation checks, UI variant controls, and standalone Python tests. Exclude a node per test file, invented CI services, and claims that tests are production call paths.

**Relationships:** TypeScript validates included source; Vite builds the browser. The architecture test resolves imports and checks layer/feature ownership, treating `src/server` as backend. Unit/integration tests exercise pure rules and adapters, including revision conflicts. Browser runners create disposable corpus/store fixtures, start real HTTP composition with explicit fake agents where applicable, drive public interactions through an external local CDP helper, and assert saved/reloaded state. Performance checks measure source navigation/scroll scenarios separately. UI variant controls feed Mapping's real component inputs, enabling display comparisons without substituting for behavior tests. Python tests/oracles cover the standalone parser separately. Fixture builders and archived benchmark outputs are producers/evidence, not product services.

**External ports:** `runtime-under-test` = composed app/API; `domain-contracts` = pure rules; `browser-scenarios` = public UI transitions; `parser-under-test` = standalone parser; `fixtures` = disposable corpus/store.

**Sources:** `package.json`; `tsconfig.json`; `vitest.config.ts`; `tests/architecture/dependencies.test.ts`; `tests/browser/support/browser-mapping-fixture.mjs`; `tests/browser/mapping/browser-project-mapping-check.mjs`; `tests/browser/core/browser-domain-profiles-check.mjs`; `tests/performance/browser-source-pane-performance.mjs`; `scripts/fixtures/create-source-pane-performance-fixture.mjs`; `packages/ui-test-framework/src/UiTestFramework.tsx`.

## Placement in 3D space

All diagrams occupy equal rectangles on parallel XY planes. There are **five columns, two rows, and three Z levels**, with 10, 10, and 8 diagrams respectively. One row in the following table describes a **vertical stack at one fixed grid location**, not a row of diagrams on one plane.

| Grid `(x,y)` | Shared concern | Plane 0: `z=0` | Plane 1: `z=1` | Plane 2: `z=2` |
| --- | --- | --- | --- | --- |
| `(0,0)` | Application platform | D01 Runtime composition | D02 App and pane navigation | D07 Profiles and presentation |
| `(1,0)` | Studio production | D11 Collection/materialization | D12 Prompt compilation | D13 Parallel generation |
| `(2,0)` | Durable working state | D18 Two kinds of save | D03 Record ownership/assembly | D04 Curation and catalog revisions |
| `(3,0)` | Mapping interaction | D19 Canvas state and gestures | D05 Coordinates and evidence | D22 Selection editing/generation |
| `(4,0)` | Evidence inspection | D20 Tree/compaction traversal | D21 Source-pane state | D06 Corpus/source/LSP |
| `(0,1)` | Development and artifact tools | D27 Preparation/exchange | D26 Python parser/evaluation | D28 Verification |
| `(1,1)` | Studio refinement | D14 Editing and extraction | D15 Evidence remapping | D25 Layer graph/feedback |
| `(2,1)` | Evidence reuse and proposals | D08 References/highlights | D09 Plan snapshots/previews | Empty |
| `(3,1)` | Contextual agent work | D23 Frozen-context chat | D24 Two-pass compaction | D10 Shared agent execution |
| `(4,1)` | Experimental evaluation | D16 Controlled experiments | D17 Viewer/dataset curation | Empty |

**Why these placements:** The middle column contains shared durable resources between Studio and Mapping, emphasizing the catalog as their integration point. Mapping interaction is beside evidence inspection, making selection-to-source links short. Each feature's production/interaction stack sits above a related refinement/agent stack in the same column. Offline preparation, parsing, and verification share a development stack, while controlled evaluation and dataset curation share another. The latter two stacks have some common concerns but implement separate pipelines.

Vertical alignment expresses the **named concern in this table**, rather than claiming a universal layer hierarchy. For example, D18/D03/D04 compare three distinct state authorities; they are not nested storage objects. D23/D24/D10 compare agent work and common execution machinery; chat does not thereby acquire a `runAgentWorkflow` dependency. Plane number provides a repeatable browsing order through complementary views. It is not the existing `informationRank`, an API call order, or a requirement for direct dependency between aligned diagrams.

**Coordinate convention:** `(x,y,z)` in the table is an integer grid address. Tile centers in renderer space are:

`position = (1360*x, -960*y, 1000*z)`

Every tile is 1200 units wide and 800 high, centered at that position, with zero rotation and normal along positive Z. X points right, renderer Y points up, and increasing Z selects the next plane. This gives 160-unit horizontal/vertical gutters. Logical dimensions and plane separation are a proposed rendering convention, not a property of current application data. Empty cells `(2,1,2)` and `(4,1,2)` remain unused.

**Cross-diagram connections:** Diagrams retain independent local layouts. A generator returns local positions for the brief's stable ports; a renderer transforms these by the tile center and attaches cross-diagram connections there. Same-plane connections can run in gutters; cross-plane connections can use Z segments in those gutters. When hiding a plane, retain an endpoint badge naming the off-plane diagram. Show only connections relevant to the selected diagram by default, so the complete atlas does not become a wall of lines. These are proposed presentation rules, not implemented UI behavior.

The accompanying `diagram-atlas-layout.json` gives every diagram's position, title, ports, source anchors, and selected typed cross-diagram relationships. The connections are a curated navigation graph, not an exhaustive import graph. `data` edges indicate movement/availability of an artifact; `uses` edges identify a consumed contract; `verification` edges describe checks rather than product execution. Conditions such as explicit save or promotion remain attached to the connection.

Important connections to preserve:

| From | To | Meaning/condition |
| --- | --- | --- |
| D11 → D12 → D13 | Evidence → prompt → batch | Generated creation path; materialized creation bypasses the agents. |
| D13 → D04 | Accepted artifacts → catalog | Only through explicit curation/promotion; generation itself does not mean settled. |
| D04 → D18 → D19 | Catalog → draft → canvas | Opened revision hydrates an editable document. |
| D18 → D04 | Diagram Save → revision | Expected-revision check; workspace Save follows a separate path. |
| D14 → D15 → D05 | Edited artifact → remap → interaction | Remapping is an explicit subsequent action; valid maps must match revision/hash. |
| D19 → D22 → D19 | Selection → proposal → draft commit | Acceptance changes browser scene/history; persistence still requires Save. |
| D19 → D23 → D18 | Selection → conversation → workspace | Frozen context; capture occurs on explicit workspace Save. |
| D04 → D20 → D21, D06 → D21 | Catalog projection → pane, live source → pane | Projection data and live source meet under freshness checks. |
| D05 → D08, D08 → D12 | Mapped selection → reusable references → generation | Reference insertion/inclusion is explicit. |
| D16 → D17 | Experiment files → catalog/curation | Dataset insertion is an explicit viewer action. |
| D27 → D11 / D04 | Manifest / projection → public application entry | Preparation and publication are separate stages. |
| D13 / D24 → D10 | Feature workflow → shared executor contract | Does not include Codex chat as a generic-runner consumer. |

Do **not** add automatic edges from D24 to Core compaction publication, from D26 to the live TypeScript parser/index, from D25 feedback to regeneration, or from D09 preview to source mutation. No such integration was found in the reviewed implementation.

## Coverage and reading guidance

| Source area | Primary explanations |
| --- | --- |
| `src/main.tsx`, `src/app/`, global styles | D01, D02, D07; styles support these views, with no standalone logic diagram. |
| `src/server/` | D01 plus each owning workflow's HTTP boundary. Bootstrap is the concrete integration owner. |
| `src/features/studio/`, `application/studio/`, `domain/studio/`, `infrastructure/studio/` | D04, D11–D17, D25. |
| `src/features/mapping/`, `application/mapping/`, `domain/mapping/`, `infrastructure/mapping/` | D18–D24, with shared contracts in D04–D06/D10. |
| `domain/core/records/`, persistence/aggregate ports and workspace assembly | D03, with workflow-specific transitions in their individual briefs. |
| Core catalog, projections, graph/index, diagrams, agent-work | D04, D05, D20, D25. |
| Core corpus/source/language services and shared source components | D06, D07, D20, D21. |
| Core references, imports, highlights, plans, profiles, prompts | D03, D07–D09, D12, D27. |
| Shared panes, representations, rendering, Markdown, browser HTTP | D01, D02, D04, D05, D07–D09; feature briefs name their consumer boundaries. |
| Core agent helpers and integration contracts | D10; distinct consumers in D13, D22–D24. |
| `tools/experiments/` | D16, D17. |
| `tools/diagram-parser/` | D26, D28; frozen rounds are evaluation data. |
| `scripts/`, `examples/mapping-screen/`, `skills/new-diagram/`, installer | D01, D03, D09, D27, D28. |
| `packages/ui-test-framework/` | D23 and D28; actual Mapping UI input, not a separate production service. |
| Colocated tests, `tests/`, fixtures and benchmark artifacts | D28 plus evidence for the invariant owned by each diagram. |
| Historical docs, `.diagrams*`, `artifacts/`, external repositories and dependencies | Context/input/output boundaries only. No claim that stored old source coordinates describe this baseline. |

Start with D01, D18, D03, and D04 to understand the system and its state authorities. Then follow the named concern stacks or explicit connections. Diagram IDs stay fixed if a future presentation moves tiles; moving a tile must not change its code boundary or imply a new relationship.
