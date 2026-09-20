# Diagram-owned source context

A Project identifies a workspace and its catalog. It does not identify a repository.
Each Diagram owns its content and source context; several repositories can share a canvas.

```text
Project
|
+-- id / name / defaultDomainProfileId (a creation preference)
+-- representation catalog
|   `-- immutable revisions
|       +-- Diagram, or a canvas containing several Diagrams
|       `-- ASCII / mappings / evidence export (derived for existing consumers)
|
`-- MappingGridDocument
    +-- scene: LineGridScene
    |   +-- root: GridBox
    |   |   `-- placement, containment, natural-size push-right layout
    |   `-- contents[id]: Diagram
    |       +-- id / revision
    |       +-- content: DiagramContent
    |       |   `-- ASCII, hash, revisioned parsed tree
    |       `-- sourceContext: DiagramSourceContext
    |           +-- contentHash
    |           +-- binding? (absent for conceptual diagrams)
    |           |   `-- sourceId / repositoryIdentity / corpus / domainProfileId
    |           +-- mappings[] (diagram-local coordinates)
    |           `-- evidence (captured source ranges)
    `-- sections

MappingCanvasState
+-- diagramViews[displayNodeId] (revision-scoped subtree folds)
+-- display (FloatingBoxes, pixel placement)
`-- controls
```

`createDiagram` builds and validates content and source context together. There are
no stored selection nodes or document-wide evidence tables. `diagramSelectionNodes`
derives selection annotations on demand through `diagramSource`.

## Source resolution

```text
diagramSource(diagram)                 domain/core/diagrams/diagram.ts
+-- mappings() / entries()
+-- forSelection(rect)
`-- search(query)                      joins mappings and captured evidence

resolveDiagramSource(store, reference, corpus, liveDiagram?)
application/core/source/diagramSource.ts
|
+-- validate project and diagram/revision membership
+-- select contentId within a multi-diagram representation
+-- or find an explicitly named sourceId
|   `-- omitted sourceId succeeds only for one unambiguous registered source
+-- validate a captured live Diagram when provided by a selection/chat
`-- return the same mapping query + binding() / readText() / listFiles()
    +-- ProjectSourceService           browse / source / definitions
    +-- SelectionService               selected diagram's source and mappings
    +-- LocalChatService               retained diagram source for follow-ups
    `-- FileCompactionService          chosen source, never Project.corpus
```

Source reads use the live checkout. Captured evidence remains revision-pinned.
Generation sessions retain their own source binding and copy it into promoted
Diagrams. New generation sessions may use different repositories or domains in
the same Project.

## API and persistence

- MCP `draw_diagram` and `nodes.draw/replace` accept optional `source` alongside
  ASCII, structure kind, mappings and evidence. Replacement retains the binding
  unless a new one is supplied. `node.diagram` contains the complete domain object.
- `diagram-search` retains text, node, code-reference and full saved/live read
  operations. Code-reference search uses each Diagram's own context.
- Source/files HTTP reads accept `sourceId`; definitions and compaction requests
  accept it in the request body. The source is resolved from saved diagrams or
  generation sessions. Ambiguous project-only requests fail explicitly.
- Compaction identity and active lookup keys include `sourceId` and path. Source
  pane requests, directory caches and viewport state also carry source identity.
- Catalog evidence IDs remain unchanged when unambiguous. Conflicting local IDs
  are qualified by Diagram ID in the flattened export. Local mappings stay intact.
- A projected Diagram selects evidence from one source. Use separate projected
  Diagrams for separate repositories; their canvas can still combine them.
- GridBox layout, FloatingBox anchoring and fold behavior retain their existing
  geometry rules. Content/source edits and saves share Diagram validation.

## One-time migration

`scripts/migrations/migrate-diagram-sources.ts` takes an explicit diagram-directory
path and checks for `representation-b697fd11-5c8d-49e7-a6b5-b12030f2f79a`. It prepares
and validates the conversion, backs up the directory alongside the original, then
moves the legacy project binding and mappings into Diagrams. It removes stored
selection nodes. It does not scan or automatically migrate other projects.
