# Corpus, Evidence, and Representation Interaction Plan

Status: ready for diagram generation

Repository snapshot: `worktree/transcripts` at merge commit `4caa91d`

## User model

The system has three central abstractions viewed through user interaction:

- Corpus is what the user browses, reads, and verifies.
- Evidence is the grounded semantic layer the user inspects, selects,
  references, and saves.
- Representation is the visual structure the user navigates and manipulates.

The primary investigation loop is:

1. Open a Representation.
2. Inspect its visual structure.
3. Select a mapped element.
4. Resolve that element to Evidence.
5. Inspect the Evidence label, summary, and source ranges.
6. Reveal the authoritative Corpus passage.
7. Verify the visual claim against the content.
8. Return through pane navigation history.

A Representation-initiated source reveal must always follow
`Representation -> Evidence -> Corpus`. Direct Workspace-to-Corpus access is
allowed only for explicit browsing, such as opening a file or Markdown section.

## C1 - Corpus Interaction

### Purpose

Explain how users browse, read, and verify authoritative content, and how
Corpus navigation connects to Evidence.

### User-facing surfaces

The Corpus interaction surface is contributed by the active DomainProfile.

The source-code profile exposes Diagram Files and Diagram Sets. Source content
is syntax highlighted, unwrapped, and may contain expandable compacted ranges.

The document profile exposes Diagram Files, Markdown Sections, and Highlights.
Markdown content is wrapped and rendered in the terminal reader. Plain text is
shown without syntax semantics.

Relevant configuration:

- `src/domainProfile.ts`: `ContentPresentation`, `WorkspaceSurfaceProfile`, and
  `WorkspaceSurfaceContribution`.
- `src/domainProfiles.ts`: source-code and document profile contributions.
- `src/App.tsx`: `explorerPaneTabs`, `paneViews`, and active profile selection.

### File exploration

`FileExplorerPanel` shows the live corpus paths referenced by the active
artifact's Evidence. It derives its filter from the artifact's declared
Evidence IDs and the active project's provenance.

The user may:

- expand and collapse directories;
- select a referenced file;
- inspect the Evidence count associated with the file;
- expand the file into Evidence handles; and
- select an Evidence handle to open its exact source range.

Relevant code:

- `src/components/FileExplorerPanel.tsx`: `FileExplorerPanel`,
  `loadDirectory`, `diagramFileFilter`, and `revealEntity`.
- `src/fileTree.ts`: `buildFileTree`, `diagramFileFilter`, and
  `flattenFileTree`.
- `src/api.ts`: `fetchRepositoryDirectory`.
- `server/application.ts`: `listRepositoryDirectory`.

### Markdown section navigation

When a Markdown document is open, `TerminalMarkdownView` reports its parsed
outline and active section to `StudioPage`. `MarkdownSectionsPanel` renders the
outline as a navigable tree.

Selecting a section creates a source-location jump containing its path, target
line, and section range. `PaneNavigationApi` activates the source context,
scrolls to the section, highlights it, and records the destination in jump
history.

Relevant code:

- `src/components/TerminalMarkdownView.tsx`: terminal reader and outline
  callbacks.
- `src/components/MarkdownSectionsPanel.tsx`: section tree and history UI.
- `src/terminalMarkdown/toc.ts`: outline and section contracts.
- `src/App.tsx`: `jumpToMarkdownSection` and
  `handleMarkdownActiveSectionChange`.
- `src/panes/navigation.ts`: `PaneNavigationApi`.

### Source presentation

`CodeEntitiesPanel` resolves an Evidence source range through
`fetchSourceSnippet`. It then chooses a renderer from the active content
presentation policy.

`SourceCodeView` provides syntax highlighting, compacted source, expandable
omitted sections, and semantic call-graph nodes. `TerminalMarkdownView`
provides rendered Markdown, headings, links, sidenotes, and highlighted code
fences.

Relevant code:

- `src/components/CodeEntitiesPanel.tsx`: range selection and content loading.
- `src/components/SourceCodeView.tsx`: source presentation.
- `src/components/TerminalMarkdownView.tsx`: Markdown presentation.
- `src/terminalMarkdown/render.ts`: Markdown rendering and outline parsing.
- `server/application.ts`: `sourceSnippet`.

### Highlights as Corpus entry points

`HighlightsTreePanel` lets a user reopen saved mapped context. A highlight
retains the artifact and Evidence identity plus an anchored document excerpt or
tree lineage. Revealing it restores the associated Representation/Evidence
context and opens the supporting content.

Relevant code:

- `src/components/HighlightsTreePanel.tsx`.
- `src/highlights.ts`.
- `src/App.tsx`: `revealHighlight` and `removeHighlight`.

### Required interactions

The Corpus diagram must show:

- DomainProfile contributing explorer and renderer policy.
- File Explorer browsing a live Corpus hierarchy.
- A file expanding into associated Evidence handles.
- Markdown Sections navigating within the active document.
- Evidence-mediated source reveal through `CodeEntitiesPanel`.
- Direct section browsing versus Representation-initiated Evidence reveal.
- SourceCodeView and TerminalMarkdownView as alternative presentations.
- PaneNavigationApi providing reversible jumps.
- Highlights restoring saved context.

### Exclusions

Do not depict evidence collection agents, prompt construction, Representation
generation, mapping follow-up prompts, or persistence layout.

## E1 - Evidence Interaction

### Purpose

Explain how Evidence connects visual elements, grounded source passages,
references, highlights, file associations, and focused views.

### Evidence as the interaction hinge

Evidence answers both of the user's grounding questions:

- Which source supports this visual element?
- Which visual or navigational operations can reuse this source-backed concept?

The domain-neutral `EvidenceEntity` contains a stable identity, handle, label,
kind, summary, and `SourceRange` anchors. Persistence and several APIs still
use `CodeEntityRecord` and `CodeEntitiesSetRecord`; `EvidenceSchema` adapts
those records into the user-facing Evidence model.

Relevant code:

- `src/domainProfile.ts`: `EvidenceEntity` and `EvidenceSchema`.
- `src/domainProfiles.ts`: `evidenceSchema` and `fromCodeEntity`.
- `src/domain.ts`: `SourceRange`, `CodeEntityRecord`, and
  `CodeEntitiesSetRecord`.

### Representation-to-Evidence reveal

`AsciiSelectionGrid` associates visible text spans with
`DiagramElementMapping` records. Hovering a mapping shows the Evidence summary.
Clicking it calls `revealCodeEntity`, switches the context to Code Entities,
selects the requested Evidence range, and records a pane jump.

Relevant code:

- `src/components/AsciiSelectionGrid.tsx`: mapping hover and activation.
- `src/domain.ts`: `DiagramElementMapping`.
- `src/App.tsx`: `revealCodeEntity`.
- `src/components/CodeEntitiesPanel.tsx`: `CodeEntityReveal` handling.

### Evidence inspection

`CodeEntitiesPanel` lets the user:

- inspect the Evidence label, summary, and category;
- move among multiple source ranges;
- reveal the selected Corpus passage;
- view original snapshots or compacted source; and
- select Evidence for another workspace action.

The active range may be addressed by stable `sourceRangeId` or by the legacy
range index.

Relevant code:

- `src/components/CodeEntitiesPanel.tsx`.
- `src/api.ts`: `fetchSourceSnippet`.
- `server/application.ts`: `sourceSnippet`.
- `src/referenceResolver.ts`: stable reference resolution.

### Reference buffering

Rectangle selection over a Representation intersects visual mappings and
resolves them to Evidence ranges. The pending selection is committed to the
DiagramSet-scoped reference buffer.

The user may copy exact source locations, insert typed `@entity/` references
into a prompt, dispatch the selection to another consumer, remove one entry, or
clear the buffer.

Relevant code:

- `src/refBuffer.ts`.
- `src/ref-buffer/RefBufferContext.tsx`.
- `src/ref-buffer/RefBufferTray.tsx`.
- `src/ref-buffer/refFormatters.ts`.
- `src/ref-buffer/refOutputSinks.ts`.

### Evidence-backed highlights

Toggling a mapped highlight stores the artifact revision, Representation
element, Evidence identity, source range, source excerpt, and tree lineage when
available. The Highlights explorer later uses this record as a durable entry
point back into the investigation.

Relevant code:

- `src/highlights.ts`: `HighlightRecordV2` and validation.
- `src/App.tsx`: `toggleHighlight`.
- `server/application.ts`: `addHighlight` and `deleteHighlight`.

### Focused Representation

Selected Evidence can focus a companion call graph. The request preserves
Evidence and artifact provenance, validates that selected entities belong to
both the source Diagram and featured Call Graph, and returns a filtered tree.

Relevant code:

- `src/callGraphFocus.ts`.
- `server/callGraphTree.ts`.
- `server/application.ts`: `callGraphFocus`.
- `src/call-graph-tree/CallGraphFocusTree.tsx`.

### Current interaction gap

Representation can reveal Evidence, and the underlying RepresentationIndex can
resolve Evidence identities back to visual elements. The Evidence panel does
not yet expose a universal action to show every occurrence of one Evidence
entity across all Representations. The diagram should identify this as a
future interaction, not current behavior.

### Required interactions

The Evidence diagram must show:

- A mapped Representation element resolving to Evidence.
- CodeEntitiesPanel inspecting labels, summaries, and ranges.
- Evidence resolving to authoritative Corpus content.
- Rectangle selection adding Evidence to the reference buffer.
- Evidence-backed persistent highlights.
- File paths grouping related Evidence.
- Selected Evidence focusing a related call graph.
- The Evidence-to-CodeEntity compatibility boundary.
- The missing universal Evidence-to-all-Representations navigation action.

### Exclusions

Do not depict evidence collection agents, prompt-template construction,
parallel generation, mapping prompts, or persistence layout.

## R1 - Representation Interaction

### Purpose

Explain what users can select, inspect, navigate, and manipulate after a
Representation appears in the workspace.

### Representation selection and lineage

The user selects a DiagramSet and then navigates its artifact lineage.
`DiagramLineagePanel` groups generation runs, candidate batches, Diagram
variants, Call Graphs, Directory Views, Components, edits, derivatives, and
global imports.

The user may choose a candidate, rename it, archive it, rank its candidate
batch, star a preferred view, inspect immutable prompt provenance, or navigate
to a related component.

Relevant code:

- `src/components/DiagramSetTreePanel.tsx`.
- `src/components/DiagramLineagePanel.tsx`.
- `src/components/DiagramCandidateFeedbackDialog.tsx`.
- `src/components/PromptConfigDialog.tsx`.
- `src/App.tsx`: DiagramSet, Diagram, component, and view selection.

### Visual interaction

`DiagramView` renders the active artifact through `AsciiSelectionGrid`. A
revision-scoped RepresentationIndex gives stable identities to tree nodes or
mapped diagram elements.

The user may hover a mapped element, click it, select a rectangular region,
collapse a tree branch, view mapped/highlighted state, or observe spatial agent
progress.

Relevant code:

- `src/components/DiagramView.tsx`.
- `src/components/AsciiSelectionGrid.tsx`.
- `src/components/DiagramSelectionOverlay.tsx`.
- `src/representationIndex.ts`.
- `src/representationPresentation.ts`.
- `src/asciiTree.ts`.
- `src/agentWork.ts`.

### Element commands

The active DomainProfile contributes commands appropriate to the
Representation kind. Current commands are reveal Evidence, collapse subtree,
toggle highlight, and buffer reference.

Reveal follows `Representation -> Evidence -> Corpus`. Collapse changes only
presentation. Highlight stores durable grounded context. Buffer Reference adds
the mapped Evidence to the temporary reference tray.

Relevant code:

- `src/domainProfile.ts`: `ElementCommandId` and command contributions.
- `src/domainProfiles.ts`: profile-specific commands.
- `src/App.tsx`: reveal and highlight handlers.

### Progressive disclosure

Tree Representations may be collapsed by stable subtree identity. Selected
Evidence may open a focused Call Graph in a transient pane. Representation
layers order related artifacts by information rank and accept feedback on a
layer or transition.

Relevant code:

- `src/representationIndex.ts`: tree lineage and subtree operations.
- `src/callGraphFocus.ts` and `src/call-graph-tree/CallGraphFocusTree.tsx`.
- `src/representationGraph.ts`.
- `src/components/RepresentationLayersPanel.tsx`.

### Artifact manipulation

Advanced user actions include capturing a rectangular DiagramComponent,
opening an edit session, placing markers, applying manual or LLM edits,
undoing/redoing operations, and publishing a new immutable lineage child.

These actions should appear as destinations from the active Representation,
without expanding the agent or persistence mechanics.

Relevant code:

- `src/diagramSelection.ts`.
- `src/components/EditOperationsPanel.tsx`.
- edit and capture handlers in `src/App.tsx`.

### Required interactions

The Representation diagram must show:

- DiagramSet and lineage selection leading to the active artifact.
- DiagramView and AsciiSelectionGrid as the interaction surface.
- RepresentationIndex providing stable visual elements.
- Hover and click resolving mapped Evidence.
- Reveal Evidence, collapse subtree, toggle highlight, and buffer reference.
- Call-graph focus and Representation layers as progressive disclosure.
- Component capture and edit mode as advanced actions.
- Reversible pane navigation to Evidence and Corpus.
- `Representation -> Evidence -> Corpus` as the only grounding path.

### Exclusions

Do not depict evidence collection, agent generation, reference follow-up,
mapping prompt execution, or persistence layout.

## Generation plan

Create three separate DiagramSets:

1. Corpus Interaction, using only the C1 section as its logical brief.
2. Evidence Interaction, using only the E1 section as its logical brief.
3. Representation Interaction, using only the R1 section as its logical brief.

Each create operation produces three parallel candidate variants. Every
candidate runs the persisted default template's reference-diagram follow-up and
then its mandatory Evidence mapping pass.

## Acceptance criteria

- Each DiagramSet contains exactly one logical interaction brief and three
  variants.
- Diagrams describe user behavior rather than generation internals.
- Labels include concise source file or symbol references where useful.
- Corpus is the verification surface.
- Evidence is the interaction hinge.
- Representation is the orientation and manipulation surface.
- Representation-initiated source reveal always passes through Evidence.
- Pane navigation makes cross-layer movement reversible.
- Every semantic visual label maps to an exact range in this document.
