# Mapping screen import

The supplied UI tree is preserved in [diagram.txt](diagram.txt). Sixteen labels are mapped to source across nine files; other labels remain ordinary ASCII text. Some preserved nodes describe older UI behavior, including chat placement, mock delay, and placement-hint controls. These are not claimed as current implemented entities.

[Open the imported Mapping canvas](http://127.0.0.1:5177/mapping?diagram=representation-9044402993fccf94debfaa08a438e767). Select a mapped label, press **N**, then choose **Open compaction**. Escape returns to the implementation tree; Escape again closes it.

```text
Supplied MappingScreen tree
  -> 16 selectively mapped code entities
  -> revision-pinned implementation branches
  -> exact compaction rows in 9 source-file snapshots
  -> one-based inclusive source ranges
```

The intermediate [implementation tree](implementation.txt) expresses file containment and handler ownership. It does not claim to be a runtime call graph, although the existing UI calls its projection viewer “call tree”. The 630-row compaction collection is generated from TypeScript declarations, local bindings, methods, hooks, and selected behavior summaries. It is a structural outline, not a complete statement-by-statement behavioral summary.

## Selected mappings

| Diagram label | Code entity | Source snapshot range |
| --- | --- | --- |
| MappingScreen | `MappingPocPage` | `src/features/mapping/MappingPage.tsx:41-182` |
| MappingSubmenu | `MappingSubmenu` | `src/features/mapping/workspace/MappingSubmenu.tsx:1-12` |
| NewDiagramAction | `create` | `src/features/mapping/MappingPage.tsx:113-122` |
| SaveDiagramAction | `save` | `src/features/mapping/MappingPage.tsx:98-112` |
| CanvasViewport | `DraggableDiagramCanvas` | `src/shared/diagrams/DraggableDiagramCanvas.tsx:44-299` |
| CenterAndReset | `resetCanvas` | `src/shared/diagrams/DraggableDiagramCanvas.tsx:80-93` |
| GridBox | `GridBox` | `domain/core/diagrams/lineGrid.ts:15-24` |
| Scene | `resolveScene` | `domain/core/diagrams/lineGrid.ts:61-100` |
| SelectionInteraction | `finishSelection` | `src/features/mapping/canvas/MappingCanvas.tsx:401-428` |
| GenerateSubDiagram | `generateAt` | `src/features/mapping/canvas/MappingCanvas.tsx:591-624` |
| PromptSelection | `submitPrompt` | `src/features/mapping/canvas/MappingCanvas.tsx:552-589` |
| ProjectionCompanion | `MappingPocSelectionCanvas: aside.mapping-poc-companion` | `src/features/mapping/canvas/MappingCanvas.tsx:1186-1245` |
| ProjectedCallTree | `projectSelection` | `domain/core/diagrams/diagramProjection.ts:159-225` |
| ProjectedSourceCompactions | `projectCompactions` | `domain/core/representations/compactionProjection.ts:62-99` |
| LocalConversation | `LocalChatConvo` | `src/features/mapping/chat/LocalChatConvo.tsx:17-108` |
| ProjectExplorer | `MappingDiagramExplorer` | `src/features/mapping/workspace/MappingDiagramExplorer.tsx:4-31` |

## Existing examples inspected

| Example in `docs/compactions/` | Useful pattern |
| --- | --- |
| `src-refBuffer.txt` + `.json` | Reducer action branches, identity deduplication, and selection bookkeeping, with source ranges outside the tree. |
| `src-referenceResolver.txt` + `.json` | Discriminated reference kinds, origin matching, resolution branches, and unavailable-source cases. |
| `server-agentRuntime.txt` + `.json` | Runtime methods, session state, tool validation, error handling, and cleanup. |

These are historical snapshots using paths from before the Studio/Mapping/Core reorganization. Their row coordinates and source hashes should not be relabeled to the new paths. This import generates fresh snapshots in [compactions](compactions/) from the current files. The existing behavioral examples are richer than a declaration outline and are useful models when deeper summaries are needed.

## Projection behavior

First-hop evidence links use OR semantics. Selected target branches include descendants and ancestors needed to render the tree. Only matched branches feed the second hop; display-only ancestors cannot expose unrelated source files. The second hop selects exact compaction rows plus their ancestors, without implicitly expanding descendants. This bundle explicitly lists each selected entity's relevant declaration subtree.

Source and target diagram revisions are pinned. Unsaved edits and newer saved revisions block an old projection. Compactions are immutable file snapshots; current source changes do not automatically update them. The import script checks file hashes and source bounds, because projection persistence validates snapshot structure and ASCII hashes but does not load the original source file to establish its SHA or line-count limit.

Projection snapshots are embedded in this projection, separate from the shared Core corpus-compaction catalog. Existing active corpus compactions were not replaced.

## Reproduce and verify

```sh
npx tsx examples/mapping-screen/prepare.ts
npx tsx examples/mapping-screen/import.ts http://127.0.0.1:5177
```

Preparation writes this example's snapshots and `prepared.json`. Import uses the public Studio, Mapping, and Core APIs in sequence and saves its progress in `receipt.json`. It verifies saved ASCII, mapping counts, projection node identities, and all 16 individual selections reaching their intended source file. Re-running an unchanged import uses the receipt; changed bundles or canvas revisions require inspecting the existing import before replacing it.

`projection.json` contains the import-ready request with project evidence IDs. `receipt.json` records the created set, source/target representations, pinned revision, projection, and URL. A browser check additionally verified all 16 overlays, the MappingScreen implementation/compaction path, Escape navigation, and reload. It made no document edits.

The reusable workflow is documented in [the local skill](../../.skills/map-diagram-sources/SKILL.md).

## Correcting source evidence

`ProjectionCompanion` now maps to the actual `<aside className="mapping-poc-companion">` JSX region in `MappingPocSelectionCanvas`, including the header and both body variants. It previously pointed to `callTreeProjection`, which computes projection data and does not render the wrapper. The preparer identifies the JSX node through its tag and class, avoiding fragile hard-coded line coordinates.

After preparing fresh artifacts, `npx tsx examples/mapping-screen/refresh.ts <server-url>` imports corrected evidence, appends revisions to the existing source and target representations, and keeps their URLs. The correction journal is `refresh-receipt.json`. Promotion now distinguishes evidence and mapping changes even when ASCII is unchanged, and uses an expected revision to avoid overwriting a newer canvas. Historical revisions remain available; existing chats retain their frozen source context, so start a new chat after reloading to use corrected evidence.
