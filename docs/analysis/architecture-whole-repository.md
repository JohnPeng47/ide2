# Repository architectural analysis

Static source snapshot `snapshot:1afdca54913a42658f88f9af94125567522ca8b22b5326f348c596a9b6beaeda`, based on commit `9620266136dd6316259b8af65b52469e5903a8f8`.

[Persisted analysis JSON](artifacts/whole-repository.json.gz) contains every entity, relation, source range, uncertainty, partition and finding. Gzip is lossless; decompress it before using the JSON schema.

Analyzed **715 files**, with **8 resolution-only files**, **123967 entities** and **618244 relations**. The snapshot records 0 dirty inputs with content hashes.

## What these measurements mean

This is a static possibility graph. Calls are not an execution trace; source-level ownership means aliases, mutation capabilities and lifecycle evidence, not exclusive ownership. A crossing is a candidate for investigation, not a defect. No observed/runtime evidence is emitted.

The five views share source identities but keep their own relations. Only containment is required to be a tree. Recursive calls and reactive cycles remain in the graphs; SCC condensation and containment occurrences are derived views.

## Per-view coverage

| View | Status | Relations | Resolved sites | Unresolved sites |
|---|---|---:|---:|---:|
| containment | complete | 128259 | 96271 | 0 |
| lexical | complete | 232275 | 191476 | 0 |
| calls | partial | 54137 | 17434 | 35601 |
| ownership | partial | 32074 | 24683 | 7159 |
| dependencies | partial | 171499 | 114286 | 1505 |

Site counts count distinct source spans touched by an extraction rule. They are not recall estimates: unsupported language features can hide additional dependencies. Multiple facts can share a site.

## Cohesion, containment agreement and shuffled baselines

The universe is source declarations and value/definition/allocation entities in analyzed files, excluding modules, scopes, type-only and external entities. Each directed relation has unit weight; self-edges are excluded. Data, state and reactive layers overlap in relation kinds and must not be summed. Local def-use edges can dominate data cohesion, so call/state/reactive results are shown separately.

Cohesion is internal / (internal + between) among primary memberships. Coverage and overlap use unions of source lines, including nested declaration ranges, with physical analyzed lines as denominator. VI is in bits (lower means greater agreement), compared to the directory partition on the same entity universe. These full partitions have no uncovered members; diagram partitions can.

The null model shuffles group labels over the covered entity set while preserving group sizes. Excess cohesion is observed minus shuffled mean; this controls for a single giant group scoring 1. It does not control for degree distribution or prove near-decomposability under runtime workloads.

| Partition | Edge layer | Edges | Cohesion | Shuffled mean | Excess | VI vs directories |
|---|---|---:|---:|---:|---:|---:|
| directory | calls | 17882 | 55.48% | 2.30% | 53.18% | 0.0000 |
| directory | data | 145821 | 89.24% | 2.34% | 86.90% | 0.0000 |
| directory | state | 89337 | 97.59% | 2.36% | 95.23% | 0.0000 |
| directory | reactive | 1345 | 72.42% | 2.37% | 70.04% | 0.0000 |
| layer | calls | 17882 | 59.38% | 25.69% | 33.69% | 4.2156 |
| layer | data | 145821 | 91.27% | 25.87% | 65.41% | 4.2156 |
| layer | state | 89337 | 98.07% | 25.84% | 72.22% | 4.2156 |
| layer | reactive | 1345 | 89.67% | 25.79% | 63.87% | 4.2156 |
| custom | calls | 17882 | 100.00% | 100.00% | 0.00% | 6.1372 |
| custom | data | 145821 | 100.00% | 100.00% | 0.00% | 6.1372 |
| custom | state | 89337 | 100.00% | 100.00% | 0.00% | 6.1372 |
| custom | reactive | 1345 | 100.00% | 100.00% | 0.00% | 6.1372 |

**directory**: 167 groups; line coverage 87.84%, overlap 0.00%; baseline 32 shuffles, seed 1729.

**layer**: 8 groups; line coverage 87.84%, overlap 0.00%; baseline 32 shuffles, seed 1729.

**custom**: 1 groups; line coverage 87.84%, overlap 0.00%; baseline 32 shuffles, seed 1729.

## Cross-view boundary evidence

The mismatch rule compares directory containment with architectural-layer membership: an edge can stay within a layer while crossing directory groups. Mutable captures and ownership relations provide additional views of the same endpoints. This is a concrete pair of partitions, not a claim that every possible tree mismatch has been found.

### Edges local to a layer but crossing directory groups

5327 findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.

- value-flow: local to an architectural layer, crossing directory containment groups. [runWorkspaceTask](../../src/features/mapping/workspace/runWorkspaceTask.ts#L4), [transfer](../../src/features/mapping/MappingPage.tsx#L668). Evidence: `finding:000a30a4bee1016410c41e1b39b33085d3816d394071e833d00c270b76917236` (1 relations).
- return: local to an architectural layer, crossing directory containment groups. [<callback:bdad135775f3>](../../src/server/routes/mapping/routes.ts#L44), [sendJson](../../src/server/http/http.ts#L6). Evidence: `finding:0014f6768f1621c35d4cf580b7bd74948397822f5a70db5825a6f613598899b1` (1 relations).
- return: local to an architectural layer, crossing directory containment groups. [evidenceForMapping](../../domain/core/representations/representationIndex.ts#L80), [sourceRangeId](../../domain/core/records/domain.ts#L110). Evidence: `finding:00339aaaf5c9e0d3849d500043855201803f3b7ee8bb9bfd6cd51dc6ff98f081` (1 relations).
- value-flow: local to an architectural layer, crossing directory containment groups. [diagram](../../domain/core/presentation/diagramRevisionProjection.ts#L21), [diagram](../../domain/core/diagrams/diagramRevisionEditor.ts#L16). Evidence: `finding:003f6ff924b33bb91d371c2b87f5bb5cd9eec9ad697bbe072f12e40a2815b576` (1 relations).
- reads: local to an architectural layer, crossing directory containment groups. [<callback:daa01f2a93d8>](../../domain/mapping/changes/canvasViewDiff.ts#L65), [textRange](../../domain/core/diagrams/diagramHighlight.ts#L17). Evidence: `finding:004052dc7099a68c0993773b09c574a37c94397a814f9b383715470a7d3fb030` (1 relations).
- return: local to an architectural layer, crossing directory containment groups. [<callback:3f82ad5a595e>](../../src/features/mapping/MappingPage.tsx#L1184), [busy](../../src/features/mapping/workspace/canvasWorkspace.ts#L15). Evidence: `finding:0057a48bd8fa997d4edeb885309933be3735398284936d3979ce72dc5596e5bd` (1 relations).
- calls: local to an architectural layer, crossing directory containment groups. [publishJson](../../infrastructure/core/persistence/immutableRecords.ts#L5), [createGeneration](../../infrastructure/core/integrations/pushIntegrationStore.ts#L40). Evidence: `finding:005a98369cf5787d53cb6cb75b31ce58bf187b260e21540c5226cfeac482e301` (1 relations).
- prop-flow: local to an architectural layer, crossing directory containment groups. [<callback:008b672a51bc>](../../src/features/mapping/MappingPage.tsx#L1213), [props](../../src/features/mapping/window-panel/WindowPanel.tsx#L146). Evidence: `finding:00647a159c35865aef8022e2ad4bbab8c4e96563c4e6536b68cfb3c289e690b2` (1 relations).
- calls: local to an architectural layer, crossing directory containment groups. [migrateLegacy](../../application/mapping/evals/evalRunService.ts#L336), [loadRepresentationCatalog](../../application/core/ports/projectCatalogRepository.ts#L29). Evidence: `finding:00677bbefd6187c8fe3af4a545f7394568df30542ec41723eadf447c01dfc4a5` (1 relations).
- value-flow: local to an architectural layer, crossing directory containment groups. [bottom](../../src/features/mapping/treemap/TreemapContent.tsx#L195), [height](../../src/features/mapping/changes/treemapLayout.ts#L1). Evidence: `finding:00865101c378e820f0c4489c93a12adeda1a09c4399b4852074535e26f965805` (1 relations).
- reads: local to an architectural layer, crossing directory containment groups. [<callback:fe3daecde073>](../../infrastructure/mapping/changes/__tests__/changeSessions.test.ts#L20), [floatingBefore](../../domain/mapping/changes/__tests__/floatingPaneDiffFixture.ts#L2). Evidence: `finding:0086f8e8e200a3edbd3acbee12609b3666c146b4608be0b77a51cc368d22a7e3` (1 relations).
- return: local to an architectural layer, crossing directory containment groups. [<callback:668faa2ebe07>](../../src/features/mapping/MappingPage.tsx#L961), [representationId](../../src/features/mapping/workspace/canvasWorkspace.ts#L14). Evidence: `finding:009cd622d33d3bb8e58100a1bfc8fff0e6e572f1d855c52507b7ff9d84cca43b` (1 relations).

### Cross-directory writes

41 findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.

- pointerCancel writes contacts across directory groups. [pointerCancel](../../src/features/mapping/canvas/CanvasSelectionLayer.tsx#L169), [contacts](../../domain/mapping/selection/selectionGesture.ts#L19). Evidence: `finding:026711df5ea697a679d2067b27bad2834b01051b5773bc59382de6d9c5a3234e` (1 relations).
- <callback:86f2eb5162f0> writes selectionTools across directory groups. [<callback:86f2eb5162f0>](../../src/features/mapping/tldraw/__tests__/selectionOwnership.test.ts#L77), [selectionTools](../../src/features/mapping/tldraw/SelectionTools.ts#L13). Evidence: `finding:0968172c4f723c8b9d4a37ea688197f9bc7cff64fc29a518bdf1836337460cc8` (1 relations).
- createMappingPocSession writes sessions across directory groups. [sessions](../../infrastructure/core/agents/agentRuntime.ts#L33), [createMappingPocSession](../../infrastructure/mapping/agents/selection/agentRuntime.ts#L72). Evidence: `finding:0b7c5803fc6366c3ce28ba2d1948db9333f76e4dad90d87ab7aeca82dfebd439` (1 relations).
- <callback:d7a6baf0c2f0> writes canEscape across directory groups. [<callback:d7a6baf0c2f0>](../../src/features/mapping/canvas/MappingCanvas.tsx#L1089), [canEscape](../../src/features/mapping/tldraw/CanvasRuntimeContext.tsx#L74). Evidence: `finding:0cbd97ec373e8ac0091d09347b294ca881ccb4d17ca149d927dac8e649e6c44a` (1 relations).
- scene writes scene across directory groups. [scene](../../domain/core/diagrams/__tests__/canvasTransferPlacement.test.ts#L6), [scene](../../domain/core/diagrams/canvasHistory.ts#L18). Evidence: `finding:19091a7954c08beacaccb9cefe203a08b39f64ea1d0ee074878972ccc977de10` (1 relations).
- disposeMappingPocSession writes sessions across directory groups. [sessions](../../infrastructure/core/agents/agentRuntime.ts#L33), [disposeMappingPocSession](../../infrastructure/mapping/agents/selection/agentRuntime.ts#L62). Evidence: `finding:244e9947f844de98e58c8b9a081081b5ae91bcc94f8b39fd397a1556f270c2d9` (1 relations).
- <callback:c35f0452d799> writes document across directory groups. [<callback:c35f0452d799>](../../src/features/mapping/tldraw/__tests__/editorCommands.test.ts#L12), [document](../../domain/mapping/workspace/mappingDocumentController.ts#L40). Evidence: `finding:28f5b4e8bb3bcbbe6737ece7e9a65ec0eec5311e60d880779f582fbeed48cb2f` (1 relations).
- <callback:17f44eda9a51> writes display across directory groups. [display](../../domain/mapping/workspace/mappingWorkspace.ts#L34), [<callback:17f44eda9a51>](../../domain/mapping/workspace/__tests__/mappingWorkspaceCodec.test.ts#L36). Evidence: `finding:2b040bb3fa2836e60da5782699a3afc1dca10aab6c7d0b4bff87d7a3d16e4dc3` (1 relations).
- down writes gestures across directory groups. [down](../../src/features/mapping/canvas/CanvasSelectionLayer.tsx#L78), [gestures](../../src/features/mapping/tldraw/CanvasRuntimeContext.tsx#L72). Evidence: `finding:307c93056f102bd371dd6db97b48ee0f82dd7b8890fe3e6cd639a49ee28b679e` (1 relations).
- down writes gestures across directory groups. [down](../../src/features/mapping/canvas/CanvasSelectionLayer.tsx#L78), [gestures](../../src/features/mapping/tldraw/CanvasRuntimeContext.tsx#L72). Evidence: `finding:3a19637251dda26307fec86b98a224f48298120b5b64b492b96217e9ae2c17a8` (1 relations).
- down writes gestures across directory groups. [down](../../src/features/mapping/canvas/CanvasSelectionLayer.tsx#L78), [gestures](../../src/features/mapping/tldraw/CanvasRuntimeContext.tsx#L72). Evidence: `finding:3d138740979926ad41ebf831e58b37d38dd0d3146b9fe1d18115daedf3ad096d` (1 relations).
- <callback:d7a6baf0c2f0> writes interaction across directory groups. [<callback:d7a6baf0c2f0>](../../src/features/mapping/canvas/MappingCanvas.tsx#L1089), [interaction](../../src/features/mapping/tldraw/CanvasRuntimeContext.tsx#L101). Evidence: `finding:4387d4b49ef48be4743bf40ababa62572bc6e8bb9de8443bd82b42058456c1fd` (1 relations).

### Mutable captures

578 findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.

- stopRestoring captures restoring with reassign access. [restoring](../../src/features/mapping/code-panel/CodePanel.tsx#L119), [stopRestoring](../../src/features/mapping/code-panel/CodePanel.tsx#L129). Evidence: `finding:0015e13d9d8b67e1da000a884e677a75dce4e655109f035a646929629dd4c693` (1 relations).
- <callback:47c6d03959d4> captures output with reassign access. [<callback:47c6d03959d4>](../../infrastructure/core/language-services/__tests__/lspStartup.test.ts#L42), [output](../../infrastructure/core/language-services/__tests__/lspStartup.test.ts#L42). Evidence: `finding:003b4a45e302870b8b419ebe1c57fae5566548e930609cadb69fd0d5013359a7` (1 relations).
- publishCamera captures last with reassign access. [publishCamera](../../src/features/mapping/tldraw/MappingEditorCanvas.tsx#L77), [last](../../src/features/mapping/tldraw/MappingEditorCanvas.tsx#L66). Evidence: `finding:00d29267d9330c045c40c67e8f12923a15bd6d6aaecf54664f1e7bea26d5fc5b` (1 relations).
- loseReply captures loseReply with reassign access. [loseReply](../../infrastructure/mapping/agent/__tests__/currentReads.test.ts#L90), [loseReply](../../infrastructure/mapping/agent/__tests__/currentReads.test.ts#L66). Evidence: `finding:01d754785c2f435325d60445dcb0e8b18cae8de8d7391118b8c446a329c1302f` (1 relations).
- <callback:5c9121afc2e3> captures observer with object-mutate access. [observer](../../src/features/mapping/tldraw/useLocalAnchors.ts#L10), [<callback:5c9121afc2e3>](../../src/features/mapping/tldraw/useLocalAnchors.ts#L39). Evidence: `finding:01e64a280864ac04c8cda9c2354b64486b0da9c82fdcbc140f081ac697b14972` (1 relations).
- onMiddleDown captures panRef with object-mutate access. [onMiddleDown](../../src/shared/diagrams/DraggableDiagramCanvas.tsx#L172), [panRef](../../src/shared/diagrams/DraggableDiagramCanvas.tsx#L66). Evidence: `finding:0211573b0c5fdecbed84906f9050d43c7bdead7f722431440427d527a11fb1d5` (1 relations).
- <callback:f175a5a45171> captures pointer with object-mutate access. [pointer](../../src/features/mapping/canvas/CursorCopyOverlay.tsx#L21), [<callback:f175a5a45171>](../../src/features/mapping/canvas/CursorCopyOverlay.tsx#L23). Evidence: `finding:02e13b953f7bb3b05d0e75f9110060db68279ab021c71b09fc7f61fe4d5eb556` (1 relations).
- <callback:dd10a9b2ddc8> captures resolve with reassign access. [<callback:dd10a9b2ddc8>](../../application/mapping/agent/liveCanvasService.ts#L61), [resolve](../../application/mapping/agent/liveCanvasService.ts#L60). Evidence: `finding:033fd915acd326e58f712979c3e9d7819c46025555f8e1fb0c9a1963c528783e` (1 relations).
- <callback:eb2e0b389ef1> captures frame with object-mutate access. [frame](../../src/features/mapping/tldraw/useLocalAnchors.ts#L11), [<callback:eb2e0b389ef1>](../../src/features/mapping/tldraw/useLocalAnchors.ts#L34). Evidence: `finding:041ebbaac8dedb3479ef92b2ee64eb5d16c5ddd91cc5cdf98c27fe33da62f80e` (1 relations).
- <callback:65da606f238e> captures placementPointerRef with object-mutate access. [placementPointerRef](../../src/features/mapping/canvas/MappingCanvas.tsx#L244), [<callback:65da606f238e>](../../src/features/mapping/canvas/MappingCanvas.tsx#L1127). Evidence: `finding:04a5dc80c34c55bfd90d9c67c890913583fa20d827f53599f91dde66c0df409d` (1 relations).
- send captures contextAllowance with reassign access. [contextAllowance](../../src/server/routes/mapping/liveCanvasRoutes.ts#L63), [send](../../src/server/routes/mapping/liveCanvasRoutes.ts#L64). Evidence: `finding:04d6260deb7a447289f99aac35f0db06b09fabcda067eb44c520b8c8c235ac44` (1 relations).
- <callback:14a0301d8ac3> captures response with object-mutate access. [<callback:14a0301d8ac3>](../../infrastructure/core/integrations/__tests__/pushHttpFlow.test.ts#L77), [response](../../infrastructure/core/integrations/__tests__/pushHttpFlow.test.ts#L76). Evidence: `finding:05038add9394b8ccfb4f648c6195731da8c3e7c3ea976726954f6394eac8e9a3` (1 relations).

### Widely shared state

565 findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.

- controller has 56 static readers/writers/subscribers and at least one write. [<callback:59d95147d125>](../../src/features/mapping/canvas/MappingCanvas.tsx#L1247), [<callback:0b24621a9a6b>](../../src/features/mapping/canvas/MappingCanvas.tsx#L235), [down](../../src/features/mapping/canvas/MappingCanvas.tsx#L827), [<callback:47b267381d29>](../../src/features/mapping/canvas/MappingCanvas.tsx#L1199), [selectHit](../../src/features/mapping/canvas/MappingCanvas.tsx#L529). Evidence: `finding:b698b096359e6022dc061ec50612e83bb2d106874b90301d5ef15d486725a1e7` (132 relations).
- record has 34 static readers/writers/subscribers and at least one write. [retainSelection](../../domain/core/diagrams/canvasHistory.ts#L234), [validateCheckpoint](../../domain/core/diagrams/canvasHistory.ts#L179), [openCanvasView](../../domain/core/diagrams/canvasHistory.ts#L278), [canRedo](../../domain/core/diagrams/canvasHistory.ts#L127), [persistenceChanges](../../domain/core/diagrams/canvasHistory.ts#L129). Evidence: `finding:348f9816fc9f824f016bc26447eb10f0c5c15f6ce8b25574665818a53aad0be2` (124 relations).
- activeId has 32 static readers/writers/subscribers and at least one write. [activeId](../../src/features/mapping/MappingPage.tsx#L166), [<callback:9d4f443ed78a>](../../src/features/mapping/MappingPage.tsx#L1251), [<callback:5da10769c50a>](../../src/features/mapping/MappingPage.tsx#L1246), [<callback:a920fb2d4a79>](../../src/features/mapping/MappingPage.tsx#L1170), [openAccepted](../../src/features/mapping/MappingPage.tsx#L561). Evidence: `finding:f8e0d51b795435c08f9ece206009f50c397c8dba6575b136b2017784828892c4` (84 relations).
- sessions has 26 static readers/writers/subscribers and at least one write. [<callback:6dd5b7470a0c>](../../application/mapping/agent-chat/agentChatService.ts#L277), [syncGeneration](../../application/mapping/agent-chat/agentChatService.ts#L292), [generations](../../application/mapping/agent-chat/agentChatService.ts#L328), [emit](../../application/mapping/agent-chat/agentChatService.ts#L480), [dispose](../../application/mapping/agent-chat/agentChatService.ts#L613). Evidence: `finding:dd9b563b497f375b8115472967287ba9a2bbeea5424c5b5cd470c92889184a50` (50 relations).
- error has 24 static readers/writers/subscribers and at least one write. [error](../../src/features/mapping/MappingPage.tsx#L170), [<callback:cb4d22ebb1d2>](../../src/features/mapping/MappingPage.tsx#L1268), [projectDiagrams](../../src/features/mapping/MappingPage.tsx#L724), [create](../../src/features/mapping/MappingPage.tsx#L922), [transfer](../../src/features/mapping/MappingPage.tsx#L668). Evidence: `finding:bb1a0064f7769349323c7e1b3af53abe879b33aac52c36644541031abab93fd6` (42 relations).
- store has 24 static readers/writers/subscribers and at least one write. [patch](../../src/features/mapping/prompt-composer/promptComposerCoordinator.ts#L42), [<callback:e6a361d60e9a>](../../src/features/mapping/prompt-composer/__tests__/promptComposerCoordinator.test.ts#L22), [open](../../src/features/mapping/prompt-composer/promptComposerCoordinator.ts#L46), [<callback:625323837850>](../../src/features/mapping/prompt-composer/__tests__/promptComposerCoordinator.test.ts#L146), [<callback:4852a84dddec>](../../src/features/mapping/MappingPage.tsx#L1079). Evidence: `finding:a3777a15c41edc7a74540326813ca16316cb4e827a0dea2c369e8b8c97671c44` (39 relations).
- context has 20 static readers/writers/subscribers and at least one write. [prepareTransfer](../../domain/mapping/workspace/mappingDocumentController.ts#L128), [retireTransactions](../../domain/mapping/workspace/mappingDocumentController.ts#L139), [updateSnapshot](../../domain/mapping/workspace/mappingDocumentController.ts#L197), [constructor](../../domain/mapping/workspace/mappingDocumentController.ts#L117), [undo](../../domain/mapping/workspace/mappingDocumentController.ts#L262). Evidence: `finding:9493c05e948179f0222dc4089eaa2a62caeaed6d4deca50bb9ae5abdfe5d7c04` (35 relations).
- snapshot has 19 static readers/writers/subscribers and at least one write. [<callback:a920fb2d4a79>](../../src/features/mapping/MappingPage.tsx#L1170), [openAccepted](../../src/features/mapping/MappingPage.tsx#L561), [projectDiagrams](../../src/features/mapping/MappingPage.tsx#L724), [create](../../src/features/mapping/MappingPage.tsx#L922), [<callback:bb187488ab25>](../../src/features/mapping/MappingPage.tsx#L252). Evidence: `finding:8c828a0a3ee266805f753982b1a951c9187d7ed293d40ce8412fe62fa10f6211` (51 relations).
- snapshot has 17 static readers/writers/subscribers and at least one write. [nodes](../../domain/mapping/workspace/mappingDocumentController.ts#L192), [getSnapshot](../../domain/mapping/workspace/mappingDocumentController.ts#L127), [updateSnapshot](../../domain/mapping/workspace/mappingDocumentController.ts#L197), [updateCanvas](../../domain/mapping/workspace/mappingDocumentController.ts#L248), [commitEditorGesture](../../domain/mapping/workspace/mappingDocumentController.ts#L280). Evidence: `finding:32f9fad29848dd516f50687a088947c78b53486c90ce3732d524f326b23b44d1` (67 relations).
- workspaceBusy has 16 static readers/writers/subscribers and at least one write. [<callback:a920fb2d4a79>](../../src/features/mapping/MappingPage.tsx#L1170), [projectDiagrams](../../src/features/mapping/MappingPage.tsx#L724), [<callback:4852a84dddec>](../../src/features/mapping/MappingPage.tsx#L1079), [transfer](../../src/features/mapping/MappingPage.tsx#L668), [handleAgentCommand](../../src/features/mapping/MappingPage.tsx#L279). Evidence: `finding:e418b10f44c3c94a416d2bf2b90c1fe0d4081cd4bce6caadc124f792e3efc845` (44 relations).
- document has 16 static readers/writers/subscribers and at least one write. [<callback:f1ba3ff53cdd>](../../domain/mapping/workspace/__tests__/diagramViewState.test.ts#L26), [<callback:36f5a031de34>](../../src/features/mapping/agent/diagramRevisionReceiver.ts#L27), [<callback:af71f5b22c48>](../../src/features/mapping/canvas/MappingCanvas.tsx#L420), [<callback:c35f0452d799>](../../src/features/mapping/tldraw/__tests__/editorCommands.test.ts#L12), [<callback:1a80d6dc5ff8>](../../src/features/mapping/tldraw/__tests__/editorCommands.test.ts#L88). Evidence: `finding:89981b289839f43e170b1232caa24f52f523fb3a1322b41d435ba7735402c790` (40 relations).
- nativeRuntime has 15 static readers/writers/subscribers and at least one write. [<callback:0b24621a9a6b>](../../src/features/mapping/canvas/MappingCanvas.tsx#L235), [<callback:fa71d9a00233>](../../src/features/mapping/canvas/MappingCanvas.tsx#L141), [selectHit](../../src/features/mapping/canvas/MappingCanvas.tsx#L529), [escapeSelection](../../src/features/mapping/canvas/MappingCanvas.tsx#L729), [<callback:d7a6baf0c2f0>](../../src/features/mapping/canvas/MappingCanvas.tsx#L1089). Evidence: `finding:bd773a0c9d4ba1e5c91a17cc2e5caab5f81eff896ffa45a8c92542194fe2200e` (44 relations).

## Cycles

| Layer | Nontrivial SCCs | Largest component |
|---|---:|---:|
| layer:calls | 2 | 2 |
| layer:data | 1099 | 66 |
| layer:state | 1110 | 35 |
| layer:reactive | 0 | 1 |

## Uncertainty and limitations

37837 unresolved/unsupported/ambiguous records, plus separately classified escape and diagnostic records. All retain source evidence in the artifact.

| View / classification / reason | Count |
|---|---:|
| calls / unresolved / computed-key | 2 |
| calls / unresolved / dynamic-dispatch | 1042 |
| calls / unresolved / external-body | 35288 |
| dependencies / unsupported / unsupported-syntax | 1505 |
| ownership / escape / escaped-reference | 7191 |

- External declarations identify signatures without modeling their bodies. Interface/union/computed dispatch is conservative and incomplete; dynamic JavaScript prevents a complete static call graph.
- Ownership is a local alias/capability approximation. Read-only facades restrict APIs shallowly; returned nested objects can remain mutable. Disposal sites do not prove that every allocation is disposed.
- Def-use uses structured local reaching definitions. Loops and exceptional/switch control flow are explicitly reported as unsupported for precise fixed-point analysis. Heap aliasing and interprocedural flow are partial.
- React captures and declared dependency arrays are separate facts; a mismatch alone is not an effect bug. Framework summaries recognize supported library identities and receiver shapes, not arbitrary custom hooks or wrappers.
- Static edge counts are not coupling frequencies. Tests and generated declarations can strongly affect layer/group sizes. Compare selected production scopes before making a refactoring decision.

## Diagram integration

Join diagram leaf mappings through snapshot-pinned source ranges to entity IDs, retaining overlapping memberships and explicit uncovered entities. Existing source-evidence IDs and source-range IDs can be stored on source joins. A stale snapshot must not silently match current code. Concept-tree occurrences remain distinct from source entity identities, allowing the same code to appear in several canvases. Metrics can evaluate those induced partitions with the same layer definitions.
