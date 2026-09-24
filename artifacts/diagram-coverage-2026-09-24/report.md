# Diagram coverage audit — 2026-09-24

The current saved diagrams provide **338 unique, verifiable source lines out of 17,143 (1.97%)** in the main application. This is a conservative source-evidence coverage measure, not test coverage or a judgment that only 2% of the architecture is explained. The diagrams reference **21 existing files out of 184 (11.41%)**, but often only a declaration or a type within those files.

The linked **PersistentLayer** diagram contributes **99 verifiable lines (0.58% of the application; 29.29% of all verified diagram coverage)**. Its saved references touch **8 existing files (4.35% of the application; 38.10% of the 21 referenced files)**. Shared source is deduplicated in each denominator.

## Scope and method

- Read the running application's MCP tools at http://localhost:5190, paginated all 328 search hits, and retrieved the current revisions of both settled saved representations in project `project-4971c06b-83d5-49eb-998d-043d5fc2dca4`.
- Those two saved canvas documents contain six substantive diagrams: the canvas-model overview and four expansions, plus PersistentLayer. Collapsed summaries add no mappings.
- Inspected both open live documents as well. Neither diagram text set differs from its saved counterpart, but the live canvas-model source mappings are empty. Consequently saved and live mapping coverage are reported separately.
- Denominator: current production TS/TSX/JS/JSX/MJS/CJS/CSS files under `src`, `domain`, `application`, and `infrastructure`; exclude tests and declaration-only files. Includes comments, blank lines, embedded sample data, and existing uncommitted changes.
- Excludes the nested tldraw checkout in `softwarez`, dependencies/build output, test infrastructure, scripts/tools, examples, documentation, generated artifacts, and the separate 3D prototype. These numbers describe the main application, not every file in this repository.
- Follow only evidence ranges actually referenced by diagram mappings. Union overlapping `(path, line)` pairs; do not count a class name as coverage of its entire body or a file reference as coverage of its whole file.
- A current range is verified when its stored `originalLines` exactly match either its original position or one unique contiguous position elsewhere in the same file. Changed text, removed files, ambiguous matches, and moves between files remain unverified. Unverified does not necessarily mean the diagram's concept is wrong.
- Saved source evidence is historical. Nominal saved line counts below union recorded coordinates without rebasing; they are not verified coverage of today's source, and different snapshot dates may affect overlap.

## Results

| Measure | All saved diagrams | PersistentLayer | PersistentLayer share of all diagram coverage |
|---|---:|---:|---:|
| Existing files referenced | 21 / 184 = 11.41% | 8 / 184 = 4.35% | 8 / 21 = 38.10% |
| Current source lines verified | 338 / 17,143 = 1.97% | 99 / 17,143 = 0.58% | 99 / 338 = 29.29% |
| Nominal historical mapped lines | 653 | 219 | 219 / 653 = 33.54% |

The canvas-model document has 67 mappings to 46 entities; PersistentLayer has 25 mappings to 22 entities. Repeated references are not extra coverage. Individually the canvas-model document verifies 252 lines and PersistentLayer verifies 99; their 13-line overlap produces the 338-line union.

Saved references mention 23 unique paths, of which two no longer exist: `src/shared/diagrams/DiagramView.tsx` and `src/shared/diagrams/AsciiSelectionGrid.tsx`. All 21 existing referenced files together contain 2,402 lines (14.01% of the application), but attributing their entire contents to the diagrams would overstate coverage.

## Mapping freshness and live discrepancy

| Saved document | Ranges matching original position | Exact ranges relocated within file | Ranges requiring review |
|---|---:|---:|---:|
| Canvas domain model | 29 | 5 | 12 |
| PersistentLayer | 7 | 4 | 11 |

These counts are per document; shared evidence can appear in both. Examples needing review include the controller transaction/undo APIs, MappingPage draft/capture state, project/diagram-set records, and the catalog-store operations. `ProjectCatalogStore` is now a compatibility facade extending `CanvasCatalogStore`; the current persistence flow also uses diagram revisions and services absent from this saved overview. PersistentLayer's SearchArtifact branch explicitly says PROPOSED and has no mappings, so it receives no implemented-source credit.

The live canvas-model document exposes **zero mappings across all five diagrams**, while the saved revision retains 67. PersistentLayer's live document retains its 25 mappings. Using only the currently exposed live mappings therefore yields 99 verified lines (0.58%) and makes PersistentLayer 100% of the live mapped source. This is a mapping-state discrepancy, not evidence that the canvas-model diagrams explain nothing. Diagnose why the live context lacks these mappings before using live-only metrics. No documents were edited during this audit.

## What to cover next

1. **Repair the existing baseline first.** Investigate the missing live mappings and refresh the ranges flagged in `metrics.json`. Update PersistentLayer to trace the actual save/load/revision flow through `CanvasCatalogStore`, `DiagramRevisionStore`, `RevisionedDiagramService`, persistence helpers, and catalog rules. Eight currently unreferenced files in this persistence/history implementation contain 1,017 lines; these are a candidate scope, not promised coverage gained.
2. **Diagram canvas interaction behavior.** `src/features/mapping/canvas/` contains 10 files / 1,934 lines with no saved source references, including the 1,334-line `MappingCanvas.tsx`. Trace pointer selection and drag/paste actions through coordinate conversion, controller updates, projection, retained panes, and rendering. This is the largest coherent UI gap adjacent to the existing model diagrams.
3. **Diagram selection-to-source resolution.** Cover `representationIndex.ts` (342 lines), `diagramProjection.ts` (222), and `SourceCodeView.tsx` (517), all currently unreferenced, plus the relevant selection functions. Focus on range matching, evidence lookup, projected source panes, and source rendering. Do not prioritize `mappingPoc.ts` solely for its 1,301-line size: much of it is embedded sample diagrams and fixture definitions.
4. **Diagram the change-session lifecycle.** The application/domain/infrastructure/UI change-session directories contain 13 files / 1,090 lines with no saved references. Trace baseline capture, isolated edits, version/request-ID handling, diff generation, validation, readiness, and undo/redo/reset. This adds an entire implemented workflow missing from the saved diagrams.

For each new diagram, map the specific implementation ranges explaining its behavior and report the incremental union of verified source lines. Keep file reach and mapping freshness alongside line coverage; a single percentage cannot measure conceptual completeness.

## Reproduction

`python3 artifacts/diagram-coverage-2026-09-24/audit.py`

This compares the captured saved mappings in `saved-mappings.json` against the working tree when run and rewrites `metrics.json`. It does not fetch later diagram edits. `snapshot-metadata.json` records the project, HEAD, and observed live mapping counts. The audit used the working tree, including pre-existing uncommitted changes, so HEAD alone is insufficient to reproduce the exact result.

## Source lines per node

Using unique mapped source lines divided by parsed tree-node count (excluding blank connectors and collapsed summaries):

| Scope | Parsed nodes | Historical source lines / node | Verified current source lines / node |
|---|---:|---:|---:|
| Canvas model and expansions | 139 | 452 / 139 = 3.25 | 252 / 139 = 1.81 |
| PersistentLayer | 99 | 219 / 99 = 2.21 | 99 / 99 = 1.00 |
| Combined | 238 | 653 / 238 = 2.74 | 338 / 238 = 1.42 |

These are coverage-density ratios across all parsed nodes, including nodes without source mappings; they are not the mean length of individual source snippets. Nine canvas-model mappings target free text not recognized as parsed nodes. For PersistentLayer, all 25 mappings correspond to distinct parsed nodes: its unique-coverage ratio restricted to those nodes is 219 / 25 = 8.76 historical or 99 / 25 = 3.96 verified lines per mapped node. Counting shared source separately for every referencing node gives a literal mean snippet coverage of 10.20 historical or 4.40 verified lines per mapped PersistentLayer node.

## Restriction to files touched in the last 12 commits

Commit range: `785f42f` through `653684f`, inclusive (the 12 commits returned by `git rev-list --max-count=12 HEAD`). Count the union of paths touched in each commit, including changes subsequently reverted; retain only existing production source files under the original audit scope. The resulting scope is 115 files / 11,566 current working-tree lines. Deleted files are excluded. This counts mapped source ranges anywhere in these files, not only added/edited lines.

Keep all parsed diagram nodes as the denominator for comparison with the previous table:

| Scope | All nodes | Recorded lines | Verified lines | Recorded lines/node | Verified lines/node |
|---|---:|---:|---:|---:|---:|
| Canvas domain model - implemented at 4f2ba39 | 139 | 401 | 203 | 2.88 | 1.46 |
| PersistentLayer | 99 | 218 | 98 | 2.20 | 0.99 |
| Combined | 238 | 601 | 288 | 2.53 | 1.21 |

PersistentLayer has 24 mapped nodes pointing to this file scope: 218 / 24 = **9.08 recorded lines per mapped node**, and 98 / 24 = **4.08 verified lines per mapped node**. The excluded node references MappingWorkspaceStore, whose file was not touched by these commits. Shared source lines are counted once. Full paths, commits, and metrics are in `last-12-commits.json`.

## Diagram coverage of the recent-file scope

For the 115 existing production source files touched by the last 12 commits (11,566 current working-tree lines), all saved diagrams reference 17 files (**14.78%**) and verify 288 unique source lines (**2.49%**). PersistentLayer references 7 files (**6.09%**) and verifies 98 lines (**0.85%**); it contributes **34.03%** of verified diagram coverage within this scope. The canvas-model document references 13 files (**11.30%**) and verifies 203 lines (**1.76%**). Shared coverage is deduplicated in the combined result. This measures whole-file scope selected by commit history, not coverage of changed diff hunks or each historical commit's version.
