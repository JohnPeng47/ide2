# Mapping architecture atlas

Eight connected views describe the surviving application. These are documentation briefs, not live canvas changes. Each view should show inputs, state transitions, persistence boundaries, and failures, with source mappings to the listed entry points.

## M1: Composition and project identity

`src/server/app/bootstrap.ts`, `infrastructure/core/persistence/projects.ts`.

## M2: Catalog revisions and projections

`domain/core/representations/catalogRules.ts`, `infrastructure/core/persistence/projectCatalogStore.ts`.

## M3: Source access and navigation

`application/core/source/diagramSource.ts`, `src/features/mapping/source-pane/SourceCodePane.tsx`.

## M4: Canvas and editing

`domain/mapping/workspace/mappingDocumentController.ts`, `src/features/mapping/canvas/MappingCanvas.tsx`.

## M5: Workspace persistence

`application/mapping/workspace/workspaceService.ts`, `src/features/mapping/MappingPage.tsx`.

## M6: Agent sessions and proposals

`application/mapping/agent/sessionService.ts`, `application/mapping/changes/changeSessionService.ts`.

## M7: Selection, chat and compaction

`application/mapping/selection/selectionService.ts`, `application/mapping/compaction/fileCompactionService.ts`.

## M8: Parsing and validation

`domain/core/diagrams/diagram.ts`, `tests/architecture/dependencies.test.ts`.

Use a 2 × 2 grid on two planes. Proximity groups explanations; it does not imply a runtime dependency. Existing saved diagrams remain historical snapshots.
