import { MAPPING_POC_GRAPH_A, type MappingPocNodeHead } from "./mappingPoc";

export interface MappingPocASection {
  id: string;
  label: string;
  startLine: number;
  endLine: number;
  anchorToken: string;
}

export interface MappingPocDetailOverlay {
  id: string;
  label: string;
  sectionId: string;
  anchorToken: string;
  ascii: string;
}

export interface MappingPocOverlayPlacement {
  overlayId: string;
  sectionId: string;
  originLine: number;
  originColumn: number;
  aAnchor: MappingPocNodeHead;
  overlayAnchor: MappingPocNodeHead;
}

export const MAPPING_POC_A_SECTIONS: readonly MappingPocASection[] = [
  { id: "setup", label: "Source, manifest, and prompt", startLine: 1, endLine: 15, anchorToken: "[P] finalized source DiagramSetRecord + CodeEntitiesSetRecord" },
  { id: "generation", label: "Generation pipeline", startLine: 16, endLine: 31, anchorToken: "[R] generate" },
  { id: "evaluation", label: "Judgment and aggregation", startLine: 32, endLine: 47, anchorToken: "[R] judgeCross" },
  { id: "analysis", label: "Analysis and feedback", startLine: 48, endLine: 57, anchorToken: "[R] analyze" },
  { id: "curation", label: "Catalog, viewer, and curation", startLine: 58, endLine: 70, anchorToken: "[R] ExperimentCatalog.list/artifact" }
];

export const MAPPING_POC_DETAIL_OVERLAYS: readonly MappingPocDetailOverlay[] = [
  {
    id: "setup",
    label: "Setup detail",
    sectionId: "setup",
    anchorToken: "[P] finalized source DiagramSetRecord + CodeEntitiesSetRecord",
    ascii: `[P] finalized source DiagramSetRecord + CodeEntitiesSetRecord
      | readiness="ready"        | status="finalized"
      +--------------------------+--------------------------+
                                 |
                                 v
[P] SystemPromptTemplateRecord(id="default", version)
                                 |
                                 v
[R] ExperimentRunner.initialize()
                                 |
       +-------------------------+-------------------------+
       |                         |                         |
       v                         v                         v
read templates JSON      read experiment.json      resolve sourceRoot
       |                         |                         |
       +-------------------------+-------------------------+
                                 |
                    +------------+------------+
                    |                         |
                    v                         v
           resume compatible run      create ExperimentManifest
                    |                 axes + iterations + model
                    +------------+------------+
                                 |
                                 v
                   atomic write: temp -> rename
                                 |
                                 v
[R] promptFor(axis, iteration)
       +--> i1: axis.baselinePrompt
       \`--> i2: prior analysis.revisedPromptBlock`
  },
  {
    id: "generation",
    label: "Generation detail",
    sectionId: "generation",
    anchorToken: "[R] generate",
    ascii: `[R] generate
      |
      +--> source(axis)
      |      +--> diagram-set.json
      |      \`--> code-entities.json
      |                 |
      |                 v
      |         assert generation-ready
      |
      +--> values.flatMap(replicates) -> GenerationTask[*]
      |                                  |
      |                                  v
      |                         mapLimit(concurrency)
      |                                  |
      |            +---------------------+---------------------+
      |            |                                           |
      |            v                                           v
      |   resume existing record                    renderAxisPrompt(value)
      |                                                        |
      |                                                        v
      |                                  createGenerationPromptConfig()
      |                                  config + allowed aliases/entities
      |                                                        |
      |                                                        v
      \`--------------------------> SolExperimentRuntime.generate()
                                                               |
                                                               v
                                  PiDiagramAgentRuntime.generateArtifact()
                                                               |
                                      +------------------------+----------------+
                                      |                                         |
                                      v                                         v
                             createAgentSession()                    submit_diagram tool
                                      |                                         |
                                      +------------------------+----------------+
                                                               |
                                                               v
                                                       session.prompt()
                                                               |
                                                               v
                                                   GeneratedArtifactDraft
                                                               |
                            normalize -> ASCII gate -> entity gate -> metrics
                                                               |
                                                               v
                                                     GenerationRecord JSON`
  },
  {
    id: "evaluation",
    label: "Evaluation detail",
    sectionId: "evaluation",
    anchorToken: "[R] judgeCross",
    ascii: `[R] judgeCross                         [R] judgeWithin
      |                                               |
      v                                               v
build value windows                         group same-value replicates
i1: [0,.5,1]                                [r1,r2,r3]
i2: [0,.5,1] + [.25,.5,.75]                          |
      |                                               |
      v                                               v
rotate blinded labels A/B/C                rotate blinded labels A/B/C
      |                                               |
      +-----------------------+-----------------------+
                              |
                              v
               SolExperimentRuntime.structured()
                              |
       +----------------------+----------------------+
       |                      |                      |
       v                      v                      v
fixed model/auth       structured submit tool    agent session
       |                      |                      |
       +----------------------+----------------------+
                              |
                              v
                 CrossJudgment / WithinJudgment
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
   validate low-to-high order             measure spread
             |                                 |
             v                                 v
 StoredCrossJudgment[*]             StoredWithinJudgment[*]
             +----------------+----------------+
                              |
                              v
                     aggregateScores()
                              |
       signal - within noise - off-axis penalty
                              |
                              v
                        AggregateScore`
  },
  {
    id: "analysis",
    label: "Analysis detail",
    sectionId: "analysis",
    anchorToken: "[R] analyze",
    ascii: `[R] analyze
      |
      +--> read existing analysis -> resume
      |
      +--> persist aggregate.json
      |
      +--> iteration 2 reads iteration 1 aggregate
      |
      +--> judgeSummary(cross + within rationale)
      |
      v
SolExperimentRuntime.analyze()
      |
      v
structured prompt-analysis session
      |
      v
[P] PromptAnalysis
    hypothesis / evidence / risks
    revisedPromptBlock with literal {{value}}
      |
      v
validate placeholder + 180/240 word limit
      |
      v
[P] StoredAnalysis -> analysis.json
      |
      +-------------------------> promptFor(iteration 2)
      |
      v
writeReport()
      |
      v
REPORT.md + completed ExperimentManifest`
  },
  {
    id: "curation",
    label: "Curation detail",
    sectionId: "curation",
    anchorToken: "[R] ExperimentCatalog.list/artifact",
    ascii: `[R] ExperimentCatalog.list/artifact
      |
      +--> directories()
      |      filter safe catalog IDs
      |
      +--> summarize(catalogId)
      |      +--> manifest + project
      |      +--> axes + iteration analyses
      |      \`--> generation summaries
      |
      \`--> artifact(axis, iteration, value, replicate)
             validate coordinates -> read GenerationRecord
                              |
                              v
[P] ExperimentSummary + ExperimentDiagramArtifact
                              |
                              v
[R] ExperimentViewerPage
      select experiment / axis / iteration / value / replicate
                              |
                              v
                     DiagramCard + inspector
                              |
                              v
              POST /diagram-datasets/:id/items
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
 validate source coordinates          catalog.artifact()
             |                                 |
             +----------------+----------------+
                              |
                              v
[R] DiagramDatasetStore.addItem()
      snapshot ASCII / entities / metrics / model / prompt
                              |
                              v
[P] DiagramDatasetItemRecord + labels + provenance
                              |
                              v
          list() / updateLabels() / removeItem()`
  }
];

function uniqueTokenHead(ascii: string, token: string, context: string): MappingPocNodeHead {
  const matches = ascii.split("\n").flatMap((line, index) => {
    const offset = line.indexOf(token);
    return offset < 0 ? [] : [{
      line: index + 1,
      startColumn: offset + 1,
      endColumn: offset + token.length
    }];
  });
  if (matches.length !== 1) {
    throw new Error(`${context} anchor must occur exactly once: ${token}`);
  }
  return matches[0];
}

export function parseOverlayPlacement(
  overlay: MappingPocDetailOverlay,
  graphA = MAPPING_POC_GRAPH_A
): MappingPocOverlayPlacement {
  const section = MAPPING_POC_A_SECTIONS.find((candidate) => candidate.id === overlay.sectionId);
  if (!section) throw new Error(`Unknown A section for overlay ${overlay.id}: ${overlay.sectionId}`);
  if (section.anchorToken !== overlay.anchorToken) {
    throw new Error(`Overlay ${overlay.id} anchor differs from section ${section.id}`);
  }
  const aAnchor = uniqueTokenHead(graphA, overlay.anchorToken, `Graph A/${section.id}`);
  const overlayAnchor = uniqueTokenHead(overlay.ascii, overlay.anchorToken, `Overlay/${overlay.id}`);
  if (aAnchor.line < section.startLine || aAnchor.line > section.endLine) {
    throw new Error(`Graph A anchor for ${overlay.id} falls outside section ${section.id}`);
  }
  return {
    overlayId: overlay.id,
    sectionId: section.id,
    originLine: aAnchor.line - overlayAnchor.line + 1,
    originColumn: aAnchor.startColumn - overlayAnchor.startColumn + 1,
    aAnchor,
    overlayAnchor
  };
}

export const MAPPING_POC_OVERLAY_PLACEMENTS: readonly MappingPocOverlayPlacement[] =
  MAPPING_POC_DETAIL_OVERLAYS.map((overlay) => parseOverlayPlacement(overlay));
