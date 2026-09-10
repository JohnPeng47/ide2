import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  SCHEMA_VERSION,
  type CodeEntityCategory,
  type CodeEntityRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramElementMappingDraft,
  type DiagramRecord
} from "../src/core/domain";
import { validateDiagramMappings } from "../server/core/diagramMapping";
import { DiagramStore, discoverRepository } from "../server/core/store";

const SET_NAME = "Compositional Domain Architecture";
const DIAGRAM_ID = "diagram-compositional-domain-architecture-mapped";
const LEGACY_IMPORTED_DIAGRAM_ID = "diagram-compositional-domain-architecture";
const INITIAL_PROMPT = "Map the compositional domain architecture to MARKDOWN.md.";

const ASCII = `COMPOSITIONAL DOMAIN ARCHITECTURE
  |
  +--> DiagramSet selected
  |    |
  |    +--> resolve DomainProfile
  |    |    +--> missing profile -> source-code compatibility default
  |    |    \`--> compose registered services
  |    |         |
  |    |         +--> CorpusProvider
  |    |         |    +--> git-worktree
  |    |         |    \`--> filesystem-documents
  |    |         |
  |    |         +--> EvidenceSchema
  |    |         |    +--> source code: state, structure, operation
  |    |         |    \`--> documents: section, topic, claim, event
  |    |         |
  |    |         +--> RepresentationRecipe[]
  |    |         |    +--> code: architecture, call graph, directory
  |    |         |    \`--> docs: overview, outline, detail tree
  |    |         |
  |    |         \`--> WorkspaceSurfaceProfile
  |    |              +--> code: Diagram Files + Diagram Sets
  |    |              \`--> docs: Diagram Files + Highlights
  |    |
  |    \`--> activate shared application core
  |         +--> generation and feedback
  |         +--> mappings and references
  |         +--> editing and candidates
  |         +--> persistence
  |         \`--> pane and layout infrastructure
  |
  +--> Content access
  |    |
  |    +--> CorpusBinding
  |    |    \`--> provider lists and reads addressable resources
  |    |
  |    +--> resource content
  |    |    \`--> ContentAnchor
  |    |         +--> evidence ranges
  |    |         +--> saved snapshots
  |    |         \`--> source reveal
  |    |
  |    \`--> ContentPresentationResolver
  |         +--> code -> highlighted, unwrapped, compactable
  |         \`--> document -> wrapped, plain text, exact ranges
  |
  +--> Evidence flow
  |    |
  |    +--> existing CodeEntityRecord
  |    |    \`--> compatibility adapter -> EvidenceEntity
  |    |
  |    +--> active EvidenceSchema
  |    |    +--> builds collection prompt
  |    |    +--> validates anchors through CorpusProvider
  |    |    \`--> applies domain-specific compaction policy
  |    |
  |    \`--> EvidenceEntity[]
  |         \`--> shared generation and mapping pipeline
  |
  +--> Representation flow
  |    |
  |    +--> selected recipe
  |    |    \`--> generate RepresentationLayer
  |    |
  |    +--> RepresentationGraph
  |    |    +--> expands -> higher detail rank
  |    |    +--> refines -> same-rank alternative
  |    |    \`--> grounds -> corpus evidence
  |    |
  |    +--> branching examples
  |    |    +--> architecture -> call graph | directory view
  |    |    \`--> overview -> outline -> detail tree
  |    |
  |    \`--> generated artifact
  |         \`--> RepresentationElementIndex
  |              +--> stable nodes, groups, edges, and labels
  |              \`--> targets evidence, content, or another layer
  |
  +--> Interaction flow
  |    |
  |    +--> selected stable element
  |    |    \`--> active recipe contributes commands
  |    |
  |    +--> command branch
  |    |    +--> reveal evidence
  |    |    +--> collapse subtree
  |    |    +--> toggle highlight
  |    |    +--> drill down
  |    |    \`--> buffer reference
  |    |
  |    \`--> HighlightRecord
  |         +--> stable representation lineage
  |         \`--> anchored evidence snapshots
  |
  +--> Agent activity
  |    |
  |    +--> AgentRun declares AgentWorkScope
  |    |    +--> layer or artifact
  |    |    +--> element subtree
  |    |    \`--> evidence entities or anchors
  |    |
  |    \`--> shared UI projects run state
  |         +--> queued
  |         +--> active
  |         +--> verified
  |         \`--> failed
  |
  \`--> Migration guardrails
       |
       +--> characterize existing code and document behavior
       +--> preserve legacy DiagramSets through compatibility adapters
       +--> move line-based interactions onto stable element IDs
       +--> verify profile switching without reload
       \`--> remove legacy view branching only after acceptance passes`;

interface EntitySpec {
  key: string;
  label: string;
  startLine: number;
  endLine: number;
  category?: CodeEntityCategory;
}

const specs: EntitySpec[] = [
  { key: "architecture", label: "COMPOSITIONAL DOMAIN ARCHITECTURE", startLine: 1, endLine: 723, category: "interface-data-struct" },
  { key: "diagram-set", label: "DiagramSet selected", startLine: 59, endLine: 86, category: "state" },
  { key: "domain-profile", label: "resolve DomainProfile", startLine: 19, endLine: 58 },
  { key: "compatibility-default", label: "missing profile -> source-code compatibility default", startLine: 59, endLine: 86 },
  { key: "registered-services", label: "compose registered services", startLine: 19, endLine: 58 },
  { key: "corpus-provider", label: "CorpusProvider", startLine: 87, endLine: 148, category: "interface-data-struct" },
  { key: "git-worktree", label: "git-worktree", startLine: 134, endLine: 147 },
  { key: "filesystem-documents", label: "filesystem-documents", startLine: 134, endLine: 147 },
  { key: "evidence-schema", label: "EvidenceSchema", startLine: 149, endLine: 208, category: "interface-data-struct" },
  { key: "source-evidence-types", label: "source code: state, structure, operation", startLine: 179, endLine: 207 },
  { key: "document-evidence-types", label: "documents: section, topic, claim, event", startLine: 179, endLine: 207 },
  { key: "representation-recipes", label: "RepresentationRecipe[]", startLine: 209, endLine: 254, category: "interface-data-struct" },
  { key: "code-recipes", label: "code: architecture, call graph, directory", startLine: 228, endLine: 235 },
  { key: "document-recipes", label: "docs: overview, outline, detail tree", startLine: 237, endLine: 243 },
  { key: "surface-profile", label: "WorkspaceSurfaceProfile", startLine: 442, endLine: 487, category: "interface-data-struct" },
  { key: "code-surfaces", label: "code: Diagram Files + Diagram Sets", startLine: 472, endLine: 482 },
  { key: "document-surfaces", label: "docs: Diagram Files + Highlights", startLine: 472, endLine: 482 },
  { key: "shared-core", label: "activate shared application core", startLine: 19, endLine: 40 },
  { key: "generation-feedback", label: "generation and feedback", startLine: 30, endLine: 40 },
  { key: "mappings-references", label: "mappings and references", startLine: 30, endLine: 40 },
  { key: "editing-candidates", label: "editing and candidates", startLine: 30, endLine: 40 },
  { key: "persistence", label: "persistence", startLine: 30, endLine: 40 },
  { key: "pane-layout", label: "pane and layout infrastructure", startLine: 30, endLine: 40 },
  { key: "content-access", label: "Content access", startLine: 87, endLine: 148 },
  { key: "corpus-binding", label: "CorpusBinding", startLine: 87, endLine: 148, category: "interface-data-struct" },
  { key: "provider-access", label: "provider lists and reads addressable resources", startLine: 87, endLine: 148 },
  { key: "resource-content", label: "resource content", startLine: 99, endLine: 132, category: "state" },
  { key: "content-anchor", label: "ContentAnchor", startLine: 107, endLine: 123, category: "interface-data-struct" },
  { key: "evidence-ranges", label: "evidence ranges", startLine: 149, endLine: 208 },
  { key: "saved-snapshots", label: "saved snapshots", startLine: 539, endLine: 575 },
  { key: "source-reveal", label: "source reveal", startLine: 389, endLine: 440 },
  { key: "presentation-resolver", label: "ContentPresentationResolver", startLine: 488, endLine: 538, category: "interface-data-struct" },
  { key: "code-presentation", label: "code -> highlighted, unwrapped, compactable", startLine: 519, endLine: 526 },
  { key: "document-presentation", label: "document -> wrapped, plain text, exact ranges", startLine: 528, endLine: 537 },
  { key: "evidence-flow", label: "Evidence flow", startLine: 149, endLine: 208 },
  { key: "legacy-code-entity", label: "existing CodeEntityRecord", startLine: 149, endLine: 177, category: "interface-data-struct" },
  { key: "evidence-adapter", label: "compatibility adapter -> EvidenceEntity", startLine: 149, endLine: 177 },
  { key: "active-schema", label: "active EvidenceSchema", startLine: 195, endLine: 207 },
  { key: "collection-prompt", label: "builds collection prompt", startLine: 195, endLine: 207 },
  { key: "anchor-validation", label: "validates anchors through CorpusProvider", startLine: 195, endLine: 207 },
  { key: "compaction-policy", label: "applies domain-specific compaction policy", startLine: 195, endLine: 207 },
  { key: "evidence-entities", label: "EvidenceEntity[]", startLine: 153, endLine: 177, category: "interface-data-struct" },
  { key: "shared-pipeline", label: "shared generation and mapping pipeline", startLine: 209, endLine: 245 },
  { key: "representation-flow", label: "Representation flow", startLine: 209, endLine: 388 },
  { key: "selected-recipe", label: "selected recipe", startLine: 209, endLine: 245 },
  { key: "representation-layer", label: "generate RepresentationLayer", startLine: 255, endLine: 293 },
  { key: "representation-graph", label: "RepresentationGraph", startLine: 255, endLine: 328, category: "interface-data-struct" },
  { key: "expands", label: "expands -> higher detail rank", startLine: 295, endLine: 301 },
  { key: "refines", label: "refines -> same-rank alternative", startLine: 295, endLine: 301 },
  { key: "grounds", label: "grounds -> corpus evidence", startLine: 295, endLine: 301 },
  { key: "branching", label: "branching examples", startLine: 303, endLine: 325 },
  { key: "code-branch", label: "architecture -> call graph | directory view", startLine: 315, endLine: 325 },
  { key: "document-branch", label: "overview -> outline -> detail tree", startLine: 303, endLine: 313 },
  { key: "generated-artifact", label: "generated artifact", startLine: 329, endLine: 388 },
  { key: "element-index", label: "RepresentationElementIndex", startLine: 329, endLine: 388, category: "interface-data-struct" },
  { key: "stable-elements", label: "stable nodes, groups, edges, and labels", startLine: 329, endLine: 379 },
  { key: "element-targets", label: "targets evidence, content, or another layer", startLine: 340, endLine: 368 },
  { key: "interaction-flow", label: "Interaction flow", startLine: 389, endLine: 576 },
  { key: "stable-selection", label: "selected stable element", startLine: 329, endLine: 388 },
  { key: "recipe-commands", label: "active recipe contributes commands", startLine: 389, endLine: 440 },
  { key: "command-branch", label: "command branch", startLine: 389, endLine: 440 },
  { key: "reveal-evidence", label: "reveal evidence", startLine: 414, endLine: 438 },
  { key: "collapse-subtree", label: "collapse subtree", startLine: 414, endLine: 438 },
  { key: "toggle-highlight", label: "toggle highlight", startLine: 414, endLine: 438 },
  { key: "drill-down", label: "drill down", startLine: 414, endLine: 438 },
  { key: "buffer-reference", label: "buffer reference", startLine: 414, endLine: 438 },
  { key: "highlight-record", label: "HighlightRecord", startLine: 539, endLine: 575, category: "interface-data-struct" },
  { key: "highlight-lineage", label: "stable representation lineage", startLine: 539, endLine: 575 },
  { key: "highlight-snapshots", label: "anchored evidence snapshots", startLine: 539, endLine: 575 },
  { key: "agent-activity", label: "Agent activity", startLine: 577, endLine: 621 },
  { key: "agent-work-scope", label: "AgentRun declares AgentWorkScope", startLine: 577, endLine: 597, category: "interface-data-struct" },
  { key: "scope-layer", label: "layer or artifact", startLine: 583, endLine: 597 },
  { key: "scope-subtree", label: "element subtree", startLine: 583, endLine: 597 },
  { key: "scope-evidence", label: "evidence entities or anchors", startLine: 583, endLine: 597 },
  { key: "progress-projection", label: "shared UI projects run state", startLine: 599, endLine: 620 },
  { key: "queued", label: "queued", startLine: 599, endLine: 620, category: "state" },
  { key: "active", label: "active", startLine: 599, endLine: 620, category: "state" },
  { key: "verified", label: "verified", startLine: 599, endLine: 620, category: "state" },
  { key: "failed", label: "failed", startLine: 599, endLine: 620, category: "state" },
  { key: "migration", label: "Migration guardrails", startLine: 622, endLine: 723 },
  { key: "characterize", label: "characterize existing code and document behavior", startLine: 624, endLine: 631 },
  { key: "legacy-adapters", label: "preserve legacy DiagramSets through compatibility adapters", startLine: 633, endLine: 642 },
  { key: "stable-ids", label: "move line-based interactions onto stable element IDs", startLine: 683, endLine: 688 },
  { key: "profile-switching", label: "verify profile switching without reload", startLine: 707, endLine: 721 },
  { key: "legacy-cleanup", label: "remove legacy view branching only after acceptance passes", startLine: 697, endLine: 705 }
];

function locateLabel(label: string): { line: number; startColumn: number; endColumn: number } {
  const matches = ASCII.split("\n").flatMap((line, index) => {
    const start = line.indexOf(label);
    if (start < 0) return [];
    const marker = line.lastIndexOf("--> ");
    const visibleLabel = marker < 0 ? line.trim() : line.slice(marker + 4);
    return visibleLabel === label
      ? [{ line: index + 1, startColumn: start + 1, endColumn: start + label.length }]
      : [];
  });
  if (matches.length !== 1) {
    throw new Error(`expected one ASCII occurrence for ${JSON.stringify(label)}, found ${matches.length}`);
  }
  return matches[0];
}

async function main(): Promise<void> {
  const checkoutRoot = process.cwd();
  const markdownPath = path.join(checkoutRoot, "MARKDOWN.md");
  const markdownLines = (await readFile(markdownPath, "utf8")).split(/\r?\n/);
  const store = new DiagramStore(checkoutRoot, ".diagrams");
  const project = await store.loadProject();
  if (!project) throw new Error("the server workspace has no .diagrams/project.json");

  for (const setId of project.diagramSetIds) {
    const existing = await store.loadDiagramSet(setId);
    if (existing.name === SET_NAME) {
      const entities = (await store.loadCodeEntities(setId)).entities;
      const library = await store.loadImportedArtifactLibrary();
      if (library.diagramIds.includes(LEGACY_IMPORTED_DIAGRAM_ID)) {
        await store.archiveImportedDiagram(LEGACY_IMPORTED_DIAGRAM_ID);
      }
      let diagram: DiagramRecord;
      if (existing.diagramIds.includes(DIAGRAM_ID)) {
        diagram = await store.loadDiagram(setId, DIAGRAM_ID);
      } else {
        diagram = {
          schemaVersion: SCHEMA_VERSION,
          id: DIAGRAM_ID,
          recordOrigin: { projectId: project.id, diagramSetId: setId },
          diagramSetId: setId,
          viewKind: "call-graph",
          handle: "compositional-domain-architecture",
          name: SET_NAME,
          ascii: ASCII,
          codeEntityIds: entities.map((entity) => entity.id),
          origin: "generated",
          derivedFromDiagramIds: [],
          createdAt: new Date().toISOString()
        };
        await store.addDiagram(diagram);
      }
      const mappings = validateDiagramMappings(ASCII, specs.map((spec) => ({
        entityId: `entity-compositional-${spec.key}`,
        sourceRangeIndex: 0,
        ...locateLabel(spec.label)
      })), entities);
      const timestamp = new Date().toISOString();
      await store.saveCodeEntityMap({
        schemaVersion: SCHEMA_VERSION,
        diagramSetId: setId,
        artifactKind: "diagram",
        artifactId: diagram.id,
        asciiSha256: createHash("sha256").update(diagram.ascii).digest("hex"),
        mappings,
        producedByRunId: "run-import-compositional-domain",
        createdAt: timestamp
      });
      await store.setFeaturedView(setId, "call-graph", diagram.id);
      console.log(JSON.stringify({
        status: existing.featuredViewIds["call-graph"] === diagram.id ? "already-present" : "repaired",
        setId,
        diagramId: diagram.id,
        mappedElements: mappings.length,
        source: "MARKDOWN.md"
      }, null, 2));
      return;
    }
  }

  const location = await discoverRepository(checkoutRoot);
  if (location.repositoryIdentity !== project.repositoryIdentity) {
    throw new Error("the open diagram project belongs to a different Git repository");
  }

  const { diagramSet, codeEntities } = await store.createDiagramSet({
    project,
    name: SET_NAME,
    initialPrompt: INITIAL_PROMPT,
    location
  });

  const entities: CodeEntityRecord[] = specs.map((spec) => ({
    id: `entity-compositional-${spec.key}`,
    origin: {
      projectId: project.id,
      diagramSetId: diagramSet.id,
      codeEntitiesSetId: codeEntities.id
    },
    handle: `compositional-${spec.key}`,
    label: spec.label,
    category: spec.category ?? "operation",
    summary: `${spec.label} in the compositional domain architecture.`,
    sourceRanges: [{
      id: `range-compositional-${spec.key}`,
      path: "MARKDOWN.md",
      startLine: spec.startLine,
      endLine: spec.endLine,
      symbol: spec.label,
      originalLines: markdownLines.slice(spec.startLine - 1, spec.endLine)
    }]
  }));
  await store.completeCollection(diagramSet.id, entities);

  const timestamp = new Date().toISOString();
  const diagram: DiagramRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: DIAGRAM_ID,
    recordOrigin: { projectId: project.id, diagramSetId: diagramSet.id },
    diagramSetId: diagramSet.id,
    viewKind: "call-graph",
    handle: "compositional-domain-architecture",
    name: SET_NAME,
    ascii: ASCII,
    codeEntityIds: entities.map((entity) => entity.id),
    origin: "generated",
    derivedFromDiagramIds: [],
    createdAt: timestamp
  };
  await store.addDiagram(diagram);

  const drafts: DiagramElementMappingDraft[] = specs.map((spec) => ({
    entityId: `entity-compositional-${spec.key}`,
    sourceRangeIndex: 0,
    ...locateLabel(spec.label)
  }));
  const mappings = validateDiagramMappings(ASCII, drafts, entities);
  const mappingRecord: DiagramCodeEntityMapRecord = {
    schemaVersion: SCHEMA_VERSION,
    diagramSetId: diagramSet.id,
    artifactKind: "diagram",
    artifactId: diagram.id,
    asciiSha256: createHash("sha256").update(ASCII).digest("hex"),
    mappings,
    producedByRunId: "run-import-compositional-domain",
    createdAt: timestamp
  };
  await store.saveCodeEntityMap(mappingRecord);
  await store.setFeaturedView(diagramSet.id, "call-graph", diagram.id);

  console.log(JSON.stringify({
    status: "created",
    setId: diagramSet.id,
    diagramId: diagram.id,
    mappedElements: mappings.length,
    source: "MARKDOWN.md"
  }, null, 2));
}

await main();
