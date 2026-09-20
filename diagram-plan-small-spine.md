# Small diagram plan: domain-model spine

The spine is one tree rooted at the actual `WorkspaceSnapshot` type. Object types and fields form the branches; diagram IDs annotate their coverage. The twelve briefs in [diagram-plan-small.md](diagram-plan-small.md) retain their boundaries.

- `-->` means a direct object relation: an actual field, union alternative, or ID reference. Field names and `ref:` labels distinguish containment from references.
- `..>` means an indirect relation through the named feature or operation. The target is a separate object model, not a field of the parent.
- `--x` means no established code relationship. This terminal mark keeps the standalone parser visible in the inventory without asserting an integration.

Read an arrow as “connected to,” not necessarily “calls next.” In particular, creation and promotion inputs are connected to their resulting records through operations; their placement does not reverse the operation's data flow. Repeated type names with `ref:` point back to an object already represented, rather than duplicating ownership. Selected scalar fields and optional markers are omitted for readability.

## Single object tree

```text
WorkspaceSnapshot                                                [SM-02]
|
|--> project: ProjectRecord                                      [SM-01]
|    |--> corpus: CorpusBinding
|    |--> domainProfileId: DomainProfileId
|    |--> diagramSetIds[]: ref: DiagramSetRecord
|    `..> FileCompactionRun                     (single-file compaction)
|         |--> projectId: ref: ProjectRecord
|         |--> sourceFile, sourceSha256, status, stage
|         `--> result: FileCompactionResult                      [see SM-09]
|
|--> diagramSets[]: DiagramSetRecord
|    |--> codeEntitiesSetId: ref: CodeEntitiesSetRecord
|    |--> diagramIds[]: ref: DiagramRecord
|    |--> diagramComponentIds[]: ref: DiagramComponentRecord
|    |--> generationBatchIds[]: ref: GenerationBatchRecord
|    |--> editSessionIds[]: ref: EditSessionRecord
|    |..> MaterializedDiagramSetInput           (materialized creation)
|    |    |                                                     [SM-10]
|    |    |--> codeEntities[]: MaterializedCodeEntityInput
|    |    `--> diagrams[]: MaterializedDiagramInput
|    `..> ExperimentCatalogSnapshot             (experiment run/review)
|         |                                                     [SM-11]
|         `--> experiments[]: ExperimentSummary
|              `--> axes[]: ExperimentAxisSummary
|                   |--> diagramSetId: ref: DiagramSetRecord
|                   `--> iterations[]: ExperimentIterationSummary
|                        |--> aggregate: ExperimentAggregate
|                        `--> diagrams[]: ExperimentDiagramSummary
|                             `..> DiagramDatasetCatalogSnapshot
|                                  |           (explicit dataset curation)
|                                  `--> datasets[]: DiagramDatasetSummary
|                                       `--> items[]: DiagramDatasetItemSummary
|                                            |--> source: DiagramDatasetSourceRef
|                                            |    `--> catalogId / axisId /
|                                            |         iteration / value / replicate
|                                            `..> DiagramDatasetItemRecord
|                                                 (dataset item detail lookup)
|
|--> codeEntitySets[id]: CodeEntitiesSetRecord                    [SM-03]
|    `--> entities[]: CodeEntityRecord
|         `--> sourceRanges[]: SourceRange
|              |--> path, startLine, endLine, originalLines[]
|              `--> compactedSource: CompactedSource
|
|--> generationBatches[id]: GenerationBatchRecord                 [SM-05]
|    |--> promptConfigId: ref: GenerationPromptConfigRecord
|    |--> childRunIds[]: ref: AgentRunRecord
|    `--> diagramCandidateBatchId: ref: DiagramCandidateBatchRecord
|--> generationPromptConfigs[id]: GenerationPromptConfigRecord
|--> agentRuns[id]: AgentRunRecord
|--> diagramCandidateBatches[id]: DiagramCandidateBatchRecord
|
|--> diagrams[id]: DiagramRecord
|    |--> codeEntityIds[]: ref: CodeEntityRecord
|    |--> derivedFromDiagramIds[]: ref: DiagramRecord
|    `..> PromoteProjectRepresentationInput     (explicit promotion)
|         |--> diagramId: ref: DiagramRecord
|         `..> ProjectRepresentationRevisionRecord                [see SM-02/10]
|              (published result; expanded under catalog below)
|--> diagramComponents[id]: DiagramComponentRecord
|--> codeEntityMaps[key]: DiagramCodeEntityMapRecord
|    |--> artifactId: ref: DiagramRecord / DiagramComponentRecord
|    `--> mappings[]: DiagramElementMapping
|         `--> entityId / sourceRangeId: ref: CodeEntityRecord / SourceRange
|
|--> editSessions[id]: EditSessionRecord                          [SM-06]
|    |--> sourceArtifactId: ref: DiagramRecord / DiagramComponentRecord
|    |--> baseAscii, workingAscii, operationCursor
|    `--> operations[]: EditOperationRecord
|         `--> patch: TextPatch
|--> plans[]: PlanRecord
|    `--> changes[]: PlanChange
|--> representationGraphs[key]: RepresentationGraphRecord
|    |--> layers[]: RepresentationLayerRecord
|    `--> transitions[]: RepresentationTransitionRecord
|
|--> representationCatalog: ProjectRepresentationCatalogRecord
|    |--> representations[id]: ProjectRepresentationRecord
|    |    `--> currentRevisionId / revisionIds[]: ref: revision records
|    |--> revisions[id]: ProjectRepresentationRevisionRecord
|    |    |--> provenance: { diagramSetId, artifactId }
|    |    |--> evidence[id]: ProjectRepresentationEvidenceRecord
|    |    |    `--> sourceRanges[]: ProjectRepresentationEvidenceRange
|    |    |         `--> compactionId: ref: ProjectFileCompactionRecord
|    |    |--> mappings[]: ProjectRepresentationMappingRecord
|    |    |--> content: ProjectDiagramContent
|    |    |    |--> kind="ascii": ascii
|    |    |    `--> kind="mapping-canvas": scene: LineGridScene
|    |    |         |--> root: GridBox
|    |    |         |    |--> kind="container": children[]: GridBox
|    |    |         |    `--> kind="diagram": contentId: ref: CanvasDiagram
|    |    |         `--> contents[id]: CanvasDiagram
|    |    `..> MappingWorkspaceSnapshot         (editor open/save/restore)
|    |         |                                                [SM-07]
|    |         |--> projectId: ref: ProjectRecord
|    |         `--> documents[]: MappingDocumentSnapshot
|    |              |--> representationId / revisionId: ref: catalog records
|    |              |--> document: MappingGridDocument
|    |              |    `--> scene: LineGridScene
|    |              `--> canvas: MappingCanvasState
|    |                   |--> controls: MappingControls          [SM-09]
|    |                   `--> display: DisplayState
|    |                        `--> nodes[id]: DisplayNode
|    |                             |--> SelectionRegion
|    |                             |--> ProjectedPane            [see SM-08]
|    |                             |--> ConversationPane
|    |                             |    `--> thread: LocalChatThread
|    |                             `--> DetailPane
|    `--> projections[id]: ProjectProjectionRecord               [SM-08]
|         |--> sourceRevisionId / targetRevisionId: ref: revision records
|         `--> links[]: { sourceEvidenceIds[], targetNodeIds[] }
|
|--> corpusCompactions: ProjectCorpusCompactionCatalogRecord
|    `--> compactions[id]: ProjectFileCompactionRecord
|         `--> compactedSource: CompactedSource
|--> globalImports: ImportedArtifactLibraryRecord
|
|..> PaneLayoutState                            (StudioPage composition)
|    |                                                          [SM-04]
|    |--> root: PaneNode
|    |    |--> PaneSplit: first / second: PaneNode
|    |    `--> PaneLeaf: paneId: ref: Pane
|    `--> panes[id]: Pane
|         `--> tabs[]: PaneTab
|
`--x GraphResult                                (standalone Python parser)
     |                                                          [SM-12]
     |--> nodes[]: GraphNode
     |    `--> tree: ParseResult
     |         `--> nodes[]: Node
     |              `--> children[]: ref: Node
     |--> references[]: Reference
     `--> diagnostics[]: Diagnostic
```

The direct ID references connect each indirect branch back to its actual source records: experiment axes reference DiagramSets; Mapping documents reference catalog representations and revisions; compaction runs reference projects. Dataset items copy content and retain experiment provenance. Pane state connects through the component that uses it alongside the workspace, without a domain foreign key.

`DiagramDatasetItemRecord` extends `DiagramDatasetItemSummary` in code. The dotted item-detail edge denotes loading the full record through the dataset feature; the inheritance relationship is distinct from that lookup. Experiment catalog summaries are assembled from separately stored runs and refer to their source project's DiagramSet, not necessarily the currently open project.

Save Revision publishes a successor revision; it does not turn the editable document into the same object as its base revision. Save Workspace captures separate browser state. A completed `FileCompactionRun` does not automatically create `ProjectFileCompactionRecord`. Studio's `PaneLayoutState` and Mapping's `DisplayState` remain different models. The parser's `--x` branch is inventory placement only.

The single tree supersedes the earlier separate-tree J1-J8 join notation. Diagram scopes and existing cell coordinates remain unchanged; the sections below retain the behavioral and spatial views.


## Same-layer relationships along the spine

This second view unfolds the same domain spine by plane and adds **lateral relationships between diagram cells on that plane**. The model branches above still define each cell's attachment. The vertical rail below registers the planes; it is not an execution sequence or an object-ownership edge.

`-->` denotes a directed handoff or dependency, `<-->` denotes labeled exchanges in both directions, and `...` denotes shared implementation or state rather than a direct invocation. Each full diagram label appears once in this view; `@SM-xx` refers back to that cell. Coordinates retain the original layout, including its empty cells. Tree indentation is schematic, not a replacement grid coordinate.

```text
DOMAIN-MODEL SPINE THROUGH THE PLANES
|
+-- Z1 EXTERNAL: source evidence / authored artifacts / publication
|   |
|   +-- [SM-10 Authoring and publication]                      R2 C1
|   |
|   `-- [SM-12 Parser and evaluation]                          R2 C2
|       No established handoff between these two cells.
|
+-- Z2 STUDIO: DiagramSet -> evidence / batches / artifacts
|   |
|   +-- [SM-05 Studio generation]                             R1 C1
|   |       |
|   |       +-- generated artifact / capture baseline ------> @SM-06
|   |       `... shared prompt compiler / runtime ........... @SM-11
|   |
|   +-- [SM-06 Derivation and proposals]                      R1 C2
|   |       `-- edits, components, lineage, saved proposals
|   |
|   `-- [SM-11 Experiments and datasets]                      R2 C2
|           `-- reads session evidence; owns experimental outputs
|
+-- Z3 MAPPING: catalog revision -> draft / selection / display
|   |
|   +-- [SM-09 Mapping agent actions]                         R1 C1
|   |       +<-- selected document / revision context ------- @SM-07
|   |       +-- edit proposal / chat state -----------------> @SM-07
|   |       `... retained selection / display ownership ..... @SM-08
|   |
|   +-- [SM-07 Editor and workspace]                          R1 C2
|   |       +-- scene / base revision / restored view -------> @SM-08
|   |       `<-- display / current source-view capture ------ @SM-08
|   |
|   `-- [SM-08 Selection and source]                          R2 C1
|           `-- projected children, retained context, navigation
|
`-- Z4 SHARED FOUNDATIONS: project / catalog / evidence / views
    |
    +-- [SM-01 Application lifecycle]                         R1 C1
    |       +-- repository / catalog composition ------------> @SM-02
    |       +-- corpus / language-service composition -------> @SM-03
    |       `-- browser composition / profile policy --------> @SM-04
    |
    +-- [SM-02 Artifacts and catalog]                         R1 C2
    |       +-- artifact / evidence / map records -----------> @SM-03
    |       `<-- validated maps / highlight write requests --- @SM-03
    |
    +-- [SM-03 Evidence and references]                       R2 C1
    |       +-- index / resolved source / highlights ---------> @SM-04
    |       `<-- reference / source / highlight actions ------- @SM-04
    |
    `-- [SM-04 Browser surfaces]                              R2 C2
            `-- diagram, source, Markdown, pane/navigation views
```

These are relationships between the *subjects of diagrams*. A solid arrow does not necessarily mean a direct import between two source modules. For example, SM-03's persistence requests use application/repository boundaries explained by SM-02, while SM-04's source actions use host callbacks and the relevant API boundary.

The important same-layer distinctions are:

- **Studio:** SM-05 supplies artifacts that SM-06 can derive from. SM-05 and SM-11 share generation implementations, but the experiment viewer does not invoke production batch execution. No automatic experiment-to-proposal or proposal-feedback-to-generation edge is established.
- **Mapping:** SM-07 and SM-09 exchange selected context and action results. A proposed edit enters history only after acceptance. SM-07 and SM-08 exchange scene/view state for exploration and workspace capture. SM-08 and SM-09 share retained selection and display ownership; that dotted connection does not mean projection execution launches an agent. Standalone compaction results do not automatically enter the editor or catalog.
- **Foundations:** SM-01 composes the capabilities. SM-02 and SM-03 connect persisted identities/maps to evidence operations; SM-03 and SM-04 connect source meaning to rendered interactions. Composition arrows can be muted while retaining the behavioral exchanges.
- **External:** SM-10 and SM-12 occupy the same plane but have no established producer/consumer connection. Their ASCII-related subject matter alone does not justify an integration arrow.

For spatial rendering, route these lateral links in the plane at constant world depth. Their direction follows the connected cells, including diagonal pairs such as SM-07/SM-08 and SM-02/SM-03. The cross-plane anchor-registration rule does not constrain these same-plane links to parallel lines. Attach each link to a named internal endpoint, such as a selected revision, proposed edit, or source request; the diagram IDs above abbreviate those endpoints.

## Relationships that cross tree branches

These links connect the model branches, including the same-layer relationships expanded above and the cross-plane publication/persistence paths:

```text
Session artifact + entities + map
    -- explicit promotion [SM-10; write rules in SM-02] --> Catalog revision
    <-- revision provenance -----------------------------+

Session source ranges [SM-03]
    -- conversion/remapping on promotion --> Project evidence ranges [SM-02/03]
    (related evidence, not shared record instances)

Catalog revision [SM-02]
    -- open --> Mapping draft [SM-07]
    -- selection + pinned projection --> Retained display / source [SM-08]

Mapping draft [SM-07]
    -- Save Revision + expected revision --> New catalog revision [SM-02]
    -- selected context --> Agent action [SM-09]
    <-- proposed edit; acceptance is separate --+

Session artifact [SM-05/06]
    -- baseline capture --> Plan [SM-06]
    (proposal snapshot, not an applied source change)

Session evidence + generation compiler/runtime [SM-05]
    -- experimental reuse --> Experiment results -> Dataset snapshots [SM-11]

Standalone Python parser [SM-12]
    ... shared ASCII interpretation concern ... Browser surfaces [SM-04]
    (thematic relationship only; no runtime integration)
```

Generation and Mapping compaction also share `runAgentWorkflow`; Mapping chat and selection editing use their own runtime paths. Diagram proximity must not erase that distinction.

## Reading the spine through the existing planes

The original plan's cells remain an address book for this representation. The tree gives semantic attachment points; it does not assign tree indentation or line numbers to physical depth. `Z` below is the original plane index, not the world-coordinate depth.

| Diagram | Primary spine attachment | Existing cell |
| --- | --- | --- |
| SM-01 | `ProjectRecord`, `CorpusBinding`, profile identity | Z4 R1 C1 |
| SM-02 | `WorkspaceSnapshot` and its catalog fields | Z4 R1 C2 |
| SM-03 | `CodeEntitiesSetRecord`, source ranges, artifact maps | Z4 R2 C1 |
| SM-04 | `PaneLayoutState`; content components consume separate model inputs | Z4 R2 C2 |
| SM-05 | `GenerationBatchRecord` and its DiagramSet references | Z2 R1 C1 |
| SM-06 | `EditSessionRecord`, artifacts, `PlanRecord`, `RepresentationGraphRecord` | Z2 R1 C2 |
| SM-07 | `MappingWorkspaceSnapshot` and document records | Z3 R1 C2 |
| SM-08 | `ProjectProjectionRecord`; `ProjectedPane` references | Z3 R2 C1 |
| SM-09 | `MappingControls`, chat records, separate `FileCompactionRun` | Z3 R1 C1 |
| SM-10 | `MaterializedDiagramSetInput`, promotion and import inputs | Z1 R2 C1 |
| SM-11 | `ExperimentCatalogSnapshot` and `DiagramDatasetCatalogSnapshot` | Z2 R2 C2 |
| SM-12 | Python `GraphResult` and `ParseResult` | Z1 R2 C2 |

In a stacked rendering, a model anchor continues through the planes where it actually occurs. The diagram's internal explanation branches off that anchor. For example:

```text
Published revision anchor
    |
    +-- Z1: SM-10 -- creates/publishes the revision
    |
    +-- Z2:         no published-revision anchor required in this cell
    |
    +-- Z3: SM-07 -- opens it, edits a draft, explicitly saves a successor
    |       SM-08 -- consumes pinned revisions for projection/navigation
    |
    `-- Z4: SM-02 -- defines, validates, and persists the revision
```

SM-08 occupies a different row from SM-07: its attachment is lateral, not another occupant of SM-07's cell. A single vertical line cannot represent every relationship in this branching model. Use registered anchor lines within a stack and explicit lateral branches between stacks.

Keep the small plan's existing normalized anchor positions for exact shared types. Corresponding anchors in the same row/column align along depth; corresponding anchors in different cells have the constant lateral offset between those cells. Model transitions, such as a session entity becoming project evidence, need labeled conversion edges rather than an identity line. The model spine organizes the atlas; it is not the application's `ProjectProjectionRecord` or session representation graph.

## Source basis

The diagram scopes and cell addresses come from [diagram-plan-small.md](diagram-plan-small.md). The central object relationships were checked against:

- [Session, project, entity, and artifact records](domain/core/records/domain.ts).
- [Project catalog, revisions, and evidence](domain/core/representations/projectCatalog.ts).
- [Scene, grid boxes, and canvas contents](domain/core/diagrams/lineGrid.ts).
- [Revision-pinned projection records](domain/core/diagrams/diagramProjection.ts).
- [Mapping workspace records](domain/mapping/workspace/mappingWorkspace.ts) and [display records](domain/mapping/workspace/displayModel.ts).
- [Experiment catalog types](domain/studio/experiments/experimentDomain.ts) and [catalog assembly](infrastructure/studio/persistence/experiments/experimentCatalog.ts).
- [Dataset records](domain/studio/datasets/datasetDomain.ts).
- [Compaction runs](domain/mapping/compaction/compactionRun.ts).
- [Pane model](src/shared/panes/model.ts) and [Studio composition](src/features/studio/StudioPage.tsx).
- [Python graph objects](tools/diagram-parser/diagram_parser/graph_parser.py) and [tree objects](tools/diagram-parser/diagram_parser/tree_parser.py).

No new diagram is introduced. All twelve retain their original complete briefs and density requirements.
