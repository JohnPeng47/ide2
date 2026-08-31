# Compositional Domain Architecture Plan

After reviewing the earlier proposal, I would replace it with a more compositional design. The previous plan made `DomainMode` responsible for too much and incorrectly treated “linear versus graph” as a property of the source material. Source files and transcripts are both line-addressable content; the graph structure comes from their semantic relationships and representations.

## Key changes from the previous plan

| Previous idea | Better approach |
|---|---|
| One large `DomainMode` interface | A small `DomainProfile` that composes independent services |
| `repository-graph` versus `linear-documents` | Corpus storage is separate from semantic topology |
| Strict `L1 → L2 → L3` stack | A representation graph with ordered detail ranks |
| Mode-specific progress projection | Agent runs declare stable spatial work scopes |
| Mode selects React components | Mode contributes declarative surface and command IDs |
| Rename `CodeEntity` immediately | Introduce a neutral evidence facade and migrate gradually |
| Parse all hierarchy from rendered ASCII | Persist stable representation elements and use ASCII only as rendering |

## New architectural plan

### 1. Separate the system into five independent concepts

```text
DomainProfile
   |
   +--> Corpus binding
   +--> Evidence schema
   +--> Representation recipes
   +--> Workspace surface profile
   `--> Available commands

Shared application core
   |
   +--> generation and feedback
   +--> mappings and references
   +--> editing and candidates
   +--> persistence
   +--> agent runs
   `--> pane/layout infrastructure
```

A domain profile only selects implementations. It does not implement their behavior itself.

```ts
export type DomainProfileId = "source-code" | "document";

export interface DomainProfile {
  id: DomainProfileId;
  label: string;

  corpusProviderId: string;
  evidenceSchemaId: string;

  representationRecipeIds: string[];
  workspaceSurfaceProfileId: string;
}
```

Avoid a generic `capabilities: Record<string, boolean>`. Features should appear through registered recipes, commands, and explorer contributions.

### 2. Put the profile on each DiagramSet

The same filesystem or Git repository might contain both code and document workflows, so the profile belongs to a `DiagramSet`, not the whole project.

```ts
export interface DiagramSetRecord {
  // Existing fields
  domainProfileId?: DomainProfileId;
  corpusBinding?: CorpusBinding;
  representationGraphId?: string;
}
```

Compatibility rule:

```ts
domainProfileId ?? "source-code"
```

CLI:

```text
npm run diagram -- create ... --domain source-code
npm run diagram -- create ... --domain document
```

A legacy set continues to work identically without migration.

### 3. Introduce a generic corpus boundary

The corpus boundary is responsible only for finding and reading addressable content. It says nothing about whether the content’s meaning is linear, hierarchical, or graph-like.

```ts
export interface CorpusBinding {
  providerId: string;
  root: string;
  revision?: string;
  options?: Record<string, unknown>;
}

export interface CorpusResource {
  id: string;
  path: string;
  title: string;
  mediaType: string;
  parentId?: string;
}

export interface TextPosition {
  line: number;
  column?: number;
}

export interface ContentAnchor {
  resourceId: string;
  start: TextPosition;
  end: TextPosition;
  symbol?: string;
}

export interface ContentSlice {
  resource: CorpusResource;
  startLine: number;
  lines: string[];
}

export interface CorpusProvider {
  describe(binding: CorpusBinding): Promise<CorpusResource[]>;
  list(binding: CorpusBinding, parentId?: string): Promise<CorpusResource[]>;
  read(binding: CorpusBinding, resourceId: string): Promise<ContentSlice>;
  snapshot(binding: CorpusBinding, anchor: ContentAnchor): Promise<string[]>;
  validate(binding: CorpusBinding, anchor: ContentAnchor): Promise<void>;
}
```

Initial providers:

- `git-worktree`
  - Existing repository discovery
  - Git revision
  - Lazy directory listing
  - Source-file reading
- `filesystem-documents`
  - One or more text documents
  - Optional directory hierarchy
  - No Git requirement
  - Plaintext/Markdown/transcript support

Existing fields such as `sourceCheckoutRoot` and `gitRevision` can synthesize a `git-worktree` binding until persisted records are migrated.

### 4. Put a neutral evidence facade over CodeEntity

The current `CodeEntity` infrastructure is one of the most reusable parts. Do not rewrite it first.

Introduce a neutral interface:

```ts
export interface EvidenceEntity {
  id: string;
  schemaId: string;
  type: string;
  label: string;
  summary: string;
  anchors: ContentAnchor[];
  relationships?: EvidenceRelationship[];
}

export interface EvidenceRelationship {
  type: string;
  targetEntityId: string;
}
```

Then adapt existing records:

```ts
function evidenceFromCodeEntity(entity: CodeEntityRecord): EvidenceEntity;
function legacyCodeEntityFromEvidence(entity: EvidenceEntity): CodeEntityRecord;
```

Initial evidence schemas:

```text
source-code:
  state
  interface-data-struct
  operation

document:
  section
  topic
  claim
  event
  participant
```

The schema owns:

```ts
export interface EvidenceSchema {
  id: string;
  entityTypes: EvidenceTypeDefinition[];
  buildCollectionPrompt(context: CollectionContext): string;
  validate(entity: EvidenceEntity, corpus: CorpusProvider): Promise<void>;
  compactionPolicy?: EvidenceCompactionPolicy;
}
```

Code compaction remains available only through the source-code schema. Document evidence uses exact text ranges without code-style compaction.

### 5. Replace fixed view kinds with representation recipes

`diagram`, `call-graph`, and `dir-view` are currently both UI tab IDs and domain concepts. A representation recipe should define how a particular kind of representation is generated and operated.

```ts
export interface RepresentationRecipe {
  id: string;
  label: string;
  rendererId: string;
  promptBindingId: string;

  defaultDetailRank: number;
  inputKinds: Array<"corpus" | "evidence" | "representation-selection">;

  artifactCommands: string[];
  elementCommands: string[];
}
```

Initial source-code recipes:

```text
architecture
call-graph
directory-view
diagram-component
```

Initial document recipes:

```text
document-overview
document-outline
document-detail-tree
```

The existing generation pipeline remains shared. It receives a recipe instead of branching directly on `DiagramViewKind`.

For compatibility:

```text
diagram     -> architecture
call-graph -> call-graph
dir-view   -> directory-view
```

### 6. Model layers as a representation graph

A strict stack is too restrictive for code. Architecture may expand into both a call graph and a directory view at the same detail level.

Use a directed graph whose nodes carry an information/detail rank:

```ts
export interface RepresentationGraphRecord {
  id: string;
  diagramSetId: string;
  layers: RepresentationLayerRecord[];
  transitions: RepresentationTransitionRecord[];
}

export interface RepresentationLayerRecord {
  id: string;
  recipeId: string;
  label: string;

  detailRank: number;
  artifactIds: string[];

  status: "planned" | "generating" | "ready" | "failed";
  createdAt: string;
}

export interface RepresentationTransitionRecord {
  id: string;
  fromLayerId: string;
  toLayerId: string;

  relationship: "expands" | "refines" | "grounds";
  selectedElementIds?: string[];

  userInstruction?: string;
  generationBatchId?: string;
  createdAt: string;
}
```

Rules:

- `expands` must increase `detailRank`.
- `refines` normally remains at the same rank.
- `grounds` connects a representation to corpus anchors.
- Multiple layers may share a rank.
- Layers may branch from a selected subtree rather than always expanding the complete artifact.

Document example:

```text
Overview · rank 10
    |
    `--> Thematic outline · rank 20
             |
             `--> Detailed segment tree · rank 30
                        |
                        `--> transcript anchors
```

Source-code example:

```text
Architecture · rank 10
    |
    +--> Call graph · rank 20
    |       `--> source anchors
    |
    `--> Directory view · rank 20
            `--> source anchors
```

This preserves the information-ordering requirement while supporting non-linear layer relationships.

### 7. Persist stable representation elements

Before implementing arbitrary layers or spatial progress, stop treating ASCII line numbers as semantic node identities.

```ts
export interface RepresentationElementIndex {
  artifactId: string;
  rendererId: string;
  elements: RepresentationElement[];
}

export interface RepresentationElement {
  id: string;
  kind: "node" | "group" | "edge" | "label";

  label: string;
  parentId?: string;
  order?: number;

  bounds: DiagramSelectionBounds;
  targets: RepresentationTarget[];
}

export type RepresentationTarget =
  | {
      kind: "evidence";
      entityId: string;
      anchorIndex?: number;
    }
  | {
      kind: "representation";
      layerId: string;
      artifactId: string;
      elementId?: string;
    }
  | {
      kind: "content";
      anchor: ContentAnchor;
    };
```

This index becomes the shared source for:

- Click-to-reveal
- Collapse/expand
- Highlights
- Tree lineage
- Cross-layer drill-down
- Rectangular selection
- Spatial progress
- Stable state after ASCII regeneration

Current diagrams can receive transitional indexes from:

- Existing `DiagramElementMapping` records
- `asciiTree.ts`
- Deterministic IDs derived from artifact ID plus semantic path

New document-mode agents should eventually submit structured elements alongside ASCII.

### 8. Turn tree operations into commands

`AsciiSelectionGrid.tsx` should render commands supplied by the active recipe instead of knowing about document highlights directly.

```ts
export interface ElementCommandContribution {
  id: string;
  marker: string;
  selectedMarker?: string;
  title: string;
}

export interface ElementCommandContext {
  diagramSetId: string;
  layerId: string;
  artifactId: string;
  element: RepresentationElement;
}

export interface ElementCommandHandler {
  canExecute(context: ElementCommandContext): boolean;
  execute(context: ElementCommandContext): Promise<void> | void;
}
```

Shared commands:

```text
reveal-evidence
collapse-subtree
toggle-highlight
drill-down
buffer-reference
```

Profiles select commands through their recipes:

```text
source-code mapped element:
  reveal-evidence
  buffer-reference

document parent node:
  collapse-subtree

document grounded leaf:
  toggle-highlight
  reveal-evidence
  drill-down, when a lower representation exists
```

This preserves current functionality without applying document controls to every code diagram.

### 9. Make explorer composition declarative

`App.tsx` should not contain domain checks or fixed tab arrays.

```ts
export interface WorkspaceSurfaceProfile {
  id: string;
  explorerViews: ExplorerViewContribution[];
  contextViews: ContextViewContribution[];
}

export interface ExplorerViewContribution {
  id: string;
  label: string;
  providerId:
    | "artifact-resources"
    | "corpus-resources"
    | "diagram-sets"
    | "highlights";
}
```

UI registry:

```text
artifact-resources -> existing FileExplorerPanel
diagram-sets       -> existing DiagramSetTreePanel
highlights         -> existing HighlightsTreePanel
```

Profiles:

```text
source-code:
  Diagram Files
  Diagram Sets

document:
  Diagram Files
  Highlights
```

If Diagram Set switching is still needed in document mode, move it to a shared workspace selector rather than forcing it into the document explorer.

Switching between DiagramSets with different profiles should recompose the tabs without reloading the application.

### 10. Split content rendering from code presentation

Refactor `SourceCodeView.tsx` into:

```text
ContentView
    |
    +--> LineViewport
    +--> CodePresentation
    `--> TextPresentation
```

Presentation resolver:

```ts
export interface ContentPresentation {
  rendererId: "syntax-code" | "plain-text";
  wrap: boolean;
  showLineNumbers: boolean;
  allowCompaction: boolean;
  showSymbols: boolean;
}

export interface ContentPresentationResolver {
  resolve(
    profile: DomainProfile,
    resource: CorpusResource
  ): ContentPresentation;
}
```

Source-code defaults:

```text
syntax highlighting: on
wrapping: off
line numbers: on
code compaction: on
```

Document defaults:

```text
syntax highlighting: off
wrapping: on
line numbers: on
code compaction: off
```

This also allows Markdown rendering later without changing mappings or evidence records.

### 11. Generalize highlights

Replace transcript-specific persistence with a generic evidence snapshot.

```ts
export interface HighlightRecord {
  id: string;
  diagramSetId: string;

  representation: {
    layerId: string;
    artifactId: string;
    elementId: string;
    lineage: HighlightLineageNode[];
  };

  evidence: {
    entityId?: string;
    anchors: ContentAnchor[];
    snapshots: ContentSnapshot[];
  };

  createdAt: string;
}

export interface ContentSnapshot {
  resourceId: string;
  path: string;
  startLine: number;
  endLine: number;
  lines: string[];
}
```

Existing `transcript` fields migrate to `evidence.snapshots[0]`.

The feature remains generically available, but only the document profile initially contributes the highlight command and explorer tab.

### 12. Make spatial progress a property of agent work

The previous proposal used a mode-specific progress projector. That would duplicate logic across modes.

Instead, every run should declare where it is working:

```ts
export interface AgentWorkScope {
  representationGraphId: string;
  layerId: string;
  artifactId?: string;
  elementIds?: string[];
  evidenceEntityIds?: string[];
  anchors?: ContentAnchor[];
}

export interface AgentRunRecord {
  // Existing fields
  workScope?: AgentWorkScope;
}
```

The shared UI derives visual state directly:

```ts
export interface SpatialProgressState {
  layerId: string;
  artifactId?: string;
  elementId?: string;
  state: "queued" | "active" | "verified" | "failed";
  message?: string;
}
```

Renderers can then:

- Highlight the active subtree.
- Dim verified regions.
- Mark queued branches.
- Show progress totals on layer tabs.
- Preserve progress location after reload.
- Show different agents working in different spatial regions.

The generation workflow knows the work scope when it creates the run, so no domain-specific inference is necessary.

## Implementation plan

### Phase 0: Characterization

Before refactoring:

- Add browser fixtures for one source-code set and one document set.
- Lock down current code explorer, source viewer, generation, mapping, and reference behavior.
- Lock down document wrapping, collapse, reveal, highlights, lineage, and reload persistence.
- Add an acceptance matrix for switching between modes.

### Phase 1: Domain profile composition

- Add `domainProfileId` to `DiagramSetRecord`.
- Default missing values to `source-code`.
- Add `--domain` to the CLI and creation API.
- Introduce profile, recipe, command, and surface registries.
- Move tab selection and available element commands out of `App.tsx`.
- Keep existing persistence and components unchanged underneath.

This phase should already stop document behavior from leaking into code mode.

### Phase 2: Corpus facade

- Introduce `CorpusBinding`, `CorpusResource`, `ContentAnchor`, and `CorpusProvider`.
- Implement `git-worktree` using the existing repository logic.
- Implement `filesystem-documents`.
- Route file listing and source-snippet APIs through the corpus facade.
- Continue persisting existing `SourceRange` records.

### Phase 3: Evidence facade and prompts

- Introduce `EvidenceEntity` adapters around `CodeEntityRecord`.
- Add source-code and document evidence schemas.
- Move repository-specific collection wording into the source-code schema.
- Add document collection prompts.
- Preserve the existing generation/mapping agent protocols initially.

### Phase 4: Surface and viewer separation

- Make explorer tabs profile-driven.
- Split `ContentView` from syntax/text presentation.
- Enable document tree commands only for document recipes.
- Preserve the exact requested explorer surfaces:
  - Code: Diagram Files, Diagram Sets
  - Document: Diagram Files, Highlights

### Phase 5: Generic highlights

- Introduce `HighlightRecord` with content snapshots.
- Migrate current transcript highlights.
- Make the panel consume generic lineage and snapshots.
- Keep source-code highlights disabled until deliberately enabled.

### Phase 6: Representation graph

- Introduce recipe definitions, representation layers, and transitions.
- Adapt current `DiagramViewKind` values into recipes.
- Record user feedback when refining or expanding a layer.
- Add layer navigation without changing existing candidate-generation behavior.

### Phase 7: Stable element indexes

- Introduce `RepresentationElementIndex`.
- Bootstrap indexes for legacy artifacts.
- Move collapse, reveal, highlights, and drill-down from line numbers to element IDs.
- Extend artifact submission so agents can return structured elements.

### Phase 8: Spatial agent progress

- Add `workScope` to runs.
- Project run status onto layers and elements.
- Add generic renderer decorations for queued, active, verified, and failed areas.
- Verify multiple simultaneous scoped runs.

### Phase 9: Cleanup

Only after both modes work through the new interfaces:

- Rename `SourceCodeView` to `ContentView`.
- Consider migrating persisted `CodeEntity` naming.
- Remove legacy `DiagramViewKind` branching.
- Remove ASCII hierarchy inference where structured indexes exist.
- Version mapped artifact bundles if representation indexes are exported.

## Acceptance criteria

The refactor is complete when:

- A legacy set with no profile behaves exactly like the original source-code application.
- A source-code set does not show collapse/highlight controls intended for document trees.
- A document set shows exactly Diagram Files and Highlights in its explorer.
- Documents wrap and reveal exact saved ranges.
- Code remains syntax highlighted, unwrapped, and compactable.
- The same project can contain sets from both profiles.
- Switching sets recomposes the UI without reload.
- Representation layers can branch and carry user feedback.
- Every interactive representation node has a stable identity.
- Highlights survive representation re-rendering.
- Agent activity can be shown on the exact layer or subtree where work is occurring.

This approach gives us a small domain-profile boundary while retaining the existing generation, mapping, editing, persistence, pane, and reference systems.
