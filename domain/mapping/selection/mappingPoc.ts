export const MAPPING_POC_GRAPH_A = `CurrentLLMPromptStack
 |
 +-- persistedPromptProfiles
 |   |
 |   +-- system-prompt-templates.json
 |   |   |
 |   |   +-- artifact-generation
 |   |   |   +-- domain-specific system instruction
 |   |   |   +-- generate exactly one artifact
 |   |   |   +-- require 7-bit ASCII
 |   |   |   +-- require submit_diagram exactly once
 |   |   |
 |   |   +-- diagram-reference
 |   |   |   +-- preserve source-backed meaning
 |   |   |   +-- apply referenced visual grammar
 |   |   |   +-- return a complete replacement
 |   |   |
 |   |   +-- diagram-mapping
 |   |       +-- preserve final artifact unchanged
 |   |       +-- map visible labels to CodeEntities
 |   |       +-- require exact, non-overlapping spans
 |   |
 |   +-- code-entity-prompt-templates.json
 |       +-- identificationCriteria
 |       |   +-- decide which source evidence matters
 |       |   +-- require exact file/range provenance
 |       +-- compactionCriteria
 |           +-- retain/collapse evidence presentation
 |           +-- preserve exact evidence-node mappings
 |
 +-- DiagramSet
 |   +-- name
 |   +-- initialPrompt                         [original user request]
 |   +-- sourceCheckoutRoot
 |   +-- codeEntitiesSetId
 |   +-- readiness
 |   |
 |   +-- CodeEntityPromptConfigRecord          [immutable collection snapshot]
 |       +-- template profile + revision
 |       +-- identification prompt
 |       +-- compaction prompt
 |       +-- rendered collection context
 |
 +-- evidenceCollection
 |   +-- codeEntityCollectionPrompt()
 |   |   +-- DiagramSet name
 |   |   +-- original request
 |   |   +-- identificationCriteria
 |   |   +-- compactionCriteria
 |   |   +-- expected structured fields
 |   |   +-- submission/retry contract
 |   |
 |   +-- PiDiagramAgentRuntime.collectEntities()
 |       +-- system prompt
 |       |   +-- inspect repository documents
 |       |   +-- collect only relevant evidence
 |       |   +-- cite exact source ranges
 |       +-- user prompt
 |       |   +-- rendered collection context
 |       +-- available tools
 |       |   +-- corpus inspection
 |       |   +-- submit_code_entities
 |       +-- validation
 |           +-- files and ranges must exist
 |           +-- structured result must be complete
 |           +-- accepted entities become finalized evidence
 |
 +-- runtimeGenerationRequest
 |   +-- instruction
 |   +-- selectedCodeEntityIds[]
 |   +-- count
 |   +-- outputKind
 |   +-- viewKind
 |   +-- modelId
 |   +-- promptProfileId
 |   +-- selected references[]
 |   +-- referenceInstruction?
 |   +-- derivationCorrection?
 |   |
 |   +-- generateArtifacts()                   [browser -> NDJSON HTTP]
 |       +-- generation route
 |           +-- parse and validate request
 |           +-- bound candidate count
 |           +-- validate model/output/view kinds
 |           +-- stream progress and final workspace
 |
 +-- StudioApplication.generate()
 |   +-- validate
 |   |   +-- evidence set is finalized
 |   |   +-- selected entity IDs are allowed
 |   |   +-- referenced artifacts exist
 |   |
 |   +-- createGenerationPromptConfig()
 |   |   +-- resolve selected templates
 |   |   +-- resolve @entity / @diagram / @component mentions
 |   |   +-- reject unknown or ambiguous references
 |   |   +-- include referenced artifact entity coverage
 |   |   +-- create request-local readable aliases
 |   |   |
 |   |   +-- GenerationPromptConfigRecord       [immutable model handoff]
 |   |       +-- domainProfileId
 |   |       +-- outputKind + viewKind
 |   |       +-- modelId
 |   |       +-- instruction
 |   |       +-- selectedCodeEntityIds[]
 |   |       +-- includedReferences[]
 |   |       +-- omittedReferences[]
 |   |       +-- systemPrompt
 |   |       |   +-- template id + revision
 |   |       |   +-- fully rendered instruction
 |   |       +-- contextPrompt                  [initial generation turn]
 |   |       +-- referencePrompt?               [optional restyle turn]
 |   |       +-- mappingPrompt                  [mandatory final turn]
 |   |
 |   +-- beginBatch()
 |       +-- persist prompt config
 |       +-- persist GenerationBatch
 |       +-- create one AgentRun per slot
 |       +-- invoke candidates concurrently
 |
 +-- PiDiagramAgentRuntime.generateArtifact()
 |   +-- isolatedAgentSession
 |   |   +-- selected OpenAI Codex model
 |   |   +-- rendered systemPrompt
 |   |   +-- submit_diagram tool only
 |   |
 |   +-- turn 1: generate
 |   |   +-- contextPrompt
 |   |   |   +-- DiagramSet name
 |   |   |   +-- original request
 |   |   |   +-- runtime instruction
 |   |   |   +-- selected evidence summaries
 |   |   |   +-- exact source ranges
 |   |   |   +-- referenced artifacts
 |   |   +-- runtime additions
 |   |       +-- candidate slot / total
 |   |       +-- readable entity aliases
 |   |       +-- artifact allowlists
 |   |
 |   +-- turn 2: apply reference              [optional]
 |   |   +-- previous candidate
 |   |   +-- referenceInstruction
 |   |   +-- serialized reference diagrams/components
 |   |   +-- preserve meaning and entity coverage
 |   |   +-- submit complete replacement
 |   |
 |   +-- turn 3: map final artifact            [mandatory]
 |       +-- final name + numbered ASCII
 |       +-- allowed CodeEntities
 |       +-- evidence source ranges
 |       +-- preserve artifact unchanged
 |       +-- attach exact visible-text mappings
 |
 +-- submissionValidation
 |   +-- resolve readable aliases -> persisted entity IDs
 |   +-- require nonblank artifact name
 |   +-- require 7-bit ASCII
 |   +-- reject unselected entities
 |   +-- require final mappings
 |   +-- verify sourceRangeIndex
 |   +-- verify visible, in-bounds spans
 |   +-- reject overlapping spans
 |   +-- mapping turn may not change name, ASCII, or entity list
 |
 +-- persistedOutputs
     +-- DiagramRecord | DiagramComponentRecord
     |   +-- promptConfigId
     |   +-- agentRunId
     |   +-- derivation lineage
     |   +-- normalized ASCII
     |
     +-- DiagramCodeEntityMapRecord
     |   +-- artifact hash
     |   +-- entityId
     |   +-- sourceRangeIndex
     |   +-- exact ASCII span
     |
     +-- completeBatch()
         +-- deduplicate accepted candidates
         +-- persist artifacts and mappings
         +-- complete AgentRuns
         +-- update DiagramSet artifact IDs
         +-- return updated workspace`;

export const MAPPING_POC_GRAPH_A_LINE_COUNT = MAPPING_POC_GRAPH_A.split("\n").length;

const MAPPING_POC_B_SECTION_DEFINITIONS = [
  {
    id: "inputs",
    label: "Inputs and run entry",
    ascii: `== INPUTS AND RUN ENTRY =========================================================
[P] DiagramSetRecord              [P] CodeEntitiesSetRecord
    id / name / source root           status / revision / entities[*]
             \                              /
              +----------------------------+
                           |
[P] SystemPromptTemplateRecord    [P] AXES + ITERATIONS
    default profile/version           values / replicates / controls
             \                              /
              +----------------------------+
                           |
                           v
[R] ExperimentRunner.constructor(options)
    resolve roots / clamp concurrency / retain runtime
                           |
                           v
[R] ExperimentRunner.run(through=2)`
  },
  {
    id: "initialize",
    label: "Initialization and manifest",
    ascii: `== INITIALIZATION AND MANIFEST =================================================
[R] ExperimentRunner.initialize()
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
[R] manifestPath()  [R] readPromptTemplates()  [R] findDefaultProfile()
 experiment.json      system-prompt-templates       id="default"
          |                |                |
          +----------------+----------------+
                           |
                           v
[R] readJsonIfExists<ExperimentManifest>()
                           |
              +------------+------------+
              |                         |
              v                         v
[X] validateExistingManifest()   [R] renderArtifactSystemPrompt()
    fixed model + sourceRoot             |
              |                          v
              |                 [P] defaultPromptProfile
              |                          |
              +------------+-------------+
                           |
                           v
[P] ExperimentManifest
    status="running" / modelId / axes / iterations / timestamps
                           |
                           v
[R] writeJsonAtomic(experiment.json)
    mkdir -> temporary file -> rename`
  },
  {
    id: "prompt-selection",
    label: "Iteration and prompt selection",
    ascii: `== ITERATION AND PROMPT SELECTION ==============================================
[R] runIterationAxisLoops()
    for iteration <= through
    for axis in AXES
                           |
                           v
[R] ExperimentRunner.promptFor(axis, iteration)
                           |
              +------------+------------+
              |                         |
              v                         v
[P] axis.baselinePrompt       [R] readPriorAnalysis()
    iteration 1                   iteration-1/analysis.json
              |                         |
              |                         v
              |              [P] analysis.revisedPromptBlock
              +------------+------------+
                           |
                           v
[P] activeAxisPrompt
    literal {{value}} placeholder`
  },
  {
    id: "generation-plan",
    label: "Generation planning",
    ascii: `== GENERATION PLANNING =========================================================
[R] ExperimentRunner.generate(axis, iteration, prompt)
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
[P] iterationSpec  [R] ExperimentRunner.source(axis)  [R] buildGenerationTasks()
 values/replicates              |                    value x replicate
                                v
                  [R] readDiagramSetRecord()
                                |
                  [R] readCodeEntitiesSetRecord()
                                |
                  [X] assertGenerationReady()
                                |
          +---------------------+---------------------+
                           |
                           v
[P] GenerationTask[*] { value, replicate }
                           |
                           v
[R] mapLimit(tasks, concurrency)
                           |
                           v
[R] generationPath(axis, iteration, value, replicate)
                           |
                           v
[R] readExistingGeneration()
                           |
              +------------+------------+
              |                         |
              v                         v
[P] resumed GenerationRecord   [R] renderAxisPrompt(prompt, value)
                                        |
                                        v
                              [P] renderedInstruction`
  },
  {
    id: "prompt-config",
    label: "Generation prompt configuration",
    ascii: `== GENERATION PROMPT CONFIGURATION =============================================
[R] createGenerationPromptConfig()
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
[X] finalized gate  [R] indexCodeEntities()  [R] resolvePromptBindings()
                           |                system/reference/mapping
                           v
                  [R] prompt.resolveDomainProfile()
                           |
                           v
                  [R] buildPromptOptions()
                           |
                           v
[P] GenerationPromptBuildResult
    config / allowed entities / IDs / aliases
                           |
                           v
[R] readStoredPromptConfig()
                           |
              +------------+------------+
              |                         |
              v                         v
[P] existing config             [P] StoredPromptConfig
                                          |
                                          v
                                [R] writePromptConfigJson()`
  },
  {
    id: "model-generation",
    label: "Model generation session",
    ascii: `== MODEL GENERATION SESSION ====================================================
[R] SolExperimentRuntime.generate(request)
                           |
[X] assertFixedGenerationModel()
                           |
                           v
[R] PiDiagramAgentRuntime.generateArtifact(request)
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
[R] resolveModel()  [R] agent.resolveDomainProfile()  [P] artifactMode
                                               diagram/component
                           |
                           v
[X] defineSubmitArtifactTool()
    submit_diagram / submit_diagram_component
                           |
                           v
[R] resolveCodeEntityPromptAliases()
                           |
                           v
[P] GeneratedArtifactCandidate
    name / ASCII / codeEntityIds / mappings
                           |
                           v
[R] validateArtifactSubmission()
    unchanged artifact + mapping validation
                           |
                           v
[X] SettingsManager.inMemory()
                           |
                           v
[X] DefaultResourceLoader.reload()
    source cwd / explicit system prompt / no extensions
                           |
                           v
[X] createAgentSession()
    fixed model / medium thinking / in-memory session
                           |
                           v
[X] subscribeAgentProgress()
                           |
                           v
[R] runGenerationPromptTurns()
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
[X] initialPrompt()  [X] optionalReferenceTurn()  [X] mappingTurn()
          |                |                |
          +----------------+----------------+
                           |
                           v
[X] session.prompt()
                           |
                           v
[X] submitArtifactTool.execute()
                           |
                           v
[P] GeneratedArtifactDraft
                           |
                           v
[X] unsubscribeAndDisposeSession()`
  },
  {
    id: "artifact-record",
    label: "Artifact validation and persistence",
    ascii: `== ARTIFACT VALIDATION AND PERSISTENCE =========================================
[R] normalizeAscii(draft.ascii)
                           |
                           v
[R] assertSevenBitAscii(ascii)
                           |
                           v
[X] rejectUnknownCodeEntityIds()
                           |
                           v
[R] deduplicateCodeEntityIds()
                           |
                           v
[R] diagramMetrics(ascii)
                           |
 +-----------+-----------+-----------+-----------+
 |           |           |           |           |
 v           v           v           v           v
rows      columns      density     junctions    arrows
                         |                        |
                         +-----------+------------+
                                     |
                                     v
                         implementationTokens / branchTerms
                                     |
                                     v
[P] DiagramMetrics
                                     |
                                     v
[P] GenerationRecord
    axis / iteration / value / replicate / modelId
    promptConfigId / generatedAt / artifact / metrics
                                     |
                                     v
[R] writeGenerationRecordJson()`
  },
  {
    id: "judgment-orchestration",
    label: "Blind judgment orchestration",
    ascii: `== BLIND JUDGMENT ORCHESTRATION ===============================================
[R] ExperimentRunner.judge(axis, iteration, generations)
                                     |
                    +----------------+----------------+
                    |                                 |
                    v                                 v
[R] buildCrossValueWindows()             [R] buildWithinValueTasks()
 i1: [0,.5,1]                            each value / replicates 1..3
 i2: [0,.5,1] + [.25,.5,.75]                        |
                    |                                 |
                    v                                 v
[P] CrossJudgmentTask[*]                  [P] WithinJudgmentTask[*]
                    |                                 |
                    v                                 v
[R] mapLimitCrossJudgments()              [R] mapLimitWithinJudgments()
                    |                                 |
                    v                                 v
[R] labeledCrossDiagrams()                [R] labeledWithinDiagrams()
 rotate A/B/C + hide values               rotate A/B/C + hide replicate
                    |                                 |
                    v                                 v
[R] readExistingCrossJudgment()           [R] readExistingWithinJudgment()
                    |                                 |
                    v                                 v
[R] SolExperimentRuntime.judgeCross()     [R] SolExperimentRuntime.judgeWithin()
                    |                                 |
                    v                                 v
[R] validateRanking()                     [P] WithinJudgment record
                    |                     perceived/off-axis spread
                    v                                 |
[P] CrossJudgment record                           |
 order / confidence / gaps / off-axis              |
                    |                                 |
                    v                                 v
[P] StoredCrossJudgment record           [P] StoredWithinJudgment record
                    |                                 |
                    v                                 v
[R] writeCrossJudgmentJson()             [R] writeWithinJudgmentJson()`
  },
  {
    id: "structured-judge",
    label: "Structured judge session",
    ascii: `== STRUCTURED JUDGE SESSION ====================================================
[R] SolExperimentRuntime.structured()
                                     |
                    +----------------+----------------+
                    |                                 |
                    v                                 v
[R] configuredModelRuntime()              [X] defineStructuredSubmitTool()
                    |                                 |
                    v                                 |
[X] ModelRuntime.create()                             |
                    |                                 |
                    v                                 |
[R] getFixedModel()                                  |
                    |                                 |
                    v                                 |
[R] assertConfiguredAuth()                           |
                    +----------------+----------------+
                                     |
                                     v
[X] createStructuredSession()
    in-memory settings/resources/session
                                     |
                                     v
[X] structuredSession.prompt()
                                     |
                                     v
[X] captureStructuredSubmission()
                                     |
                                     v
[X] disposeStructuredSession()`
  },
  {
    id: "aggregation",
    label: "Score aggregation",
    ascii: `== SCORE AGGREGATION ===========================================================
[R] aggregateScores(input)
                                     |
 +-------------------+---------------+---------------+-------------------+
 |                   |               |               |                   |
 v                   v               v               v                   v
[R] correctPairs() [R] meanGapSignal() [R] meanWithinNoise() [R] meanOffAxis() [R] groupMetricsByValue()
 |                   |               |               |                   |
 +-------------------+---------------+---------------+-------------------+
                                     |
                                     v
[P] AggregateScore
    pairwiseOrderingAccuracy / exactOrderingAccuracy
    meanJudgeConfidence / meanGapSignal / meanGapBalance
    meanWithinValueSpread / distinguishabilityScore
    meanOffAxisChange / invalidDiagramCount / metricMeansByValue
                                     |
                                     v
[R] writeAggregateJson()`
  },
  {
    id: "analysis",
    label: "Prompt analysis and feedback",
    ascii: `== PROMPT ANALYSIS AND FEEDBACK ================================================
[R] ExperimentRunner.analyze()
                                     |
[R] readExistingAnalysis()
                                     |
                    +----------------+----------------+
                    |                                 |
                    v                                 v
[P] resumed StoredAnalysis               [R] readPreviousAggregate()
                                         iteration 2 only
                                                      |
                                                      v
                                           [R] judgeSummary()
                                                      |
                                                      v
                                  [R] SolExperimentRuntime.analyze()
                                                      |
                                                      v
                                      [X] promptAnalysisSession()
                                                      |
                                                      v
                                           [P] PromptAnalysis
                                           revisedPromptBlock
                                           hypothesis / evidence / risks
                                                      |
                                                      v
                                  [X] validatePlaceholderAndWordLimit()
                                                      |
                                                      v
                                           [P] StoredAnalysis
                                           aggregate / analysis / analyzedAt
                                                      |
                                                      v
                                           [R] writeAnalysisJson()
                                                      |
                                                      v
                             revisedPromptBlock feeds next iteration`
  },
  {
    id: "report-output",
    label: "Report and output filesystem",
    ascii: `== REPORT AND OUTPUT FILESYSTEM ================================================
[R] ExperimentRunner.writeReport()
                                     |
          +--------------------------+--------------------------+
          |                          |                          |
          v                          v                          v
[R] readAllAnalyses()       [R] compareIterationScores()  [R] renderAxisSections()
          |                          |                          |
          +--------------------------+--------------------------+
                                     |
                                     v
[P] REPORT.md
                                     |
                                     v
[P] ExperimentManifest status="complete"
                                     |
                                     v
[R] writeCompletedManifest()
                                     |
                                     v
[X] ExperimentRuntime.dispose()
                                     |
                                     v
[P] ExperimentOutputFilesystem
    experiment.json / REPORT.md
    axes/{axis}/iteration-{n}/prompt-config.json
    generations/value-{v}/replicate-{r}.json
    judgments/*.json / aggregate.json / analysis.json`
  },
  {
    id: "catalog",
    label: "Experiment catalog",
    ascii: `== EXPERIMENT CATALOG ==========================================================
[R] ExperimentCatalog.constructor(datasetRoot)
                                     |
                                     v
[R] ExperimentCatalog.directories()
                                     |
          +--------------------------+--------------------------+
          |                          |                          |
          v                          v                          v
[R] readdirRoot()           [R] filterCatalogIds()       [R] sortCatalogIds()
 ENOENT -> []                directories + safe names
                                     |
                                     v
[R] ExperimentCatalog.list()
                                     |
                                     v
[R] ExperimentCatalog.summarize(catalogId)
                                     |
 +-------------------+---------------+---------------+-------------------+
 |                   |               |               |                   |
 v                   v               v               v                   v
[R] readManifest() [R] readProject() [R] readDiagramSet() [R] readAnalysis() [R] scanGenerations()
 |                   |               |               |                   |
 +-------------------+---------------+---------------+-------------------+
                                     |
                                     v
[P] ExperimentSummary
    project / axes / iterations / aggregates / analyses / diagrams
                                     |
                                     v
[R] ExperimentCatalog.artifact(coordinates)
                                     |
                                     v
[X] validateArtifactCoordinates()
                                     |
                                     v
[R] readGenerationRecord()
                                     |
                                     v
[P] ExperimentDiagramArtifact
    ASCII / codeEntityIds / modelId / promptConfigId / metrics`
  },
  {
    id: "viewer",
    label: "Experiment viewer",
    ascii: `== EXPERIMENT VIEWER ===========================================================
[R] ExperimentViewerPage
                                     |
          +--------------------------+--------------------------+
          |                          |                          |
          v                          v                          v
[R] loadCatalogSnapshot()    [R] loadDatasetCatalog()    [R] locateSelection()
          |                          |                          |
          +--------------------------+--------------------------+
                                     |
                                     v
[R] selectExperimentCoordinates()
    catalog / axis / iteration / value / replicate
                                     |
                                     v
[R] loadExperimentArtifact()
                                     |
                                     v
[P] DiagramCard
    ASCII / metrics / model / prompt
                                     |
                    +----------------+----------------+
                    |                                 |
                    v                                 v
[R] replicateNavigation()                 [R] openAddToDatasetDialog()
                                                      |
                                                      v
[P] selected artifact + labels`
  },
  {
    id: "curation",
    label: "Dataset curation",
    ascii: `== DATASET CURATION ============================================================
POST /api/studio/diagram-datasets/:datasetId/items
                                     |
          +--------------------------+--------------------------+
          |                          |                          |
          v                          v                          v
[X] validateDatasetId()      [X] validateSourceCoordinates() [R] catalog.artifact()
          |                          |                          |
          +--------------------------+--------------------------+
                                     |
                                     v
[R] DiagramDatasetStore.addItem()
                                     |
                                     v
[R] readDatasetRecord()
                                     |
                                     v
[R] snapshotArtifactProvenance()
                                     |
 +-------------------+---------------+---------------+-------------------+
 |                   |               |               |                   |
 v                   v               v               v                   v
ASCII            codeEntityIds   source coords    metrics          model/prompt
 |                   |               |               |                   |
 +-------------------+---------------+---------------+-------------------+
                                     |
                                     v
[P] DiagramDatasetItemRecord
    id / name / addedAt / labels / immutable artifact snapshot
                                     |
                                     v
[R] appendAndPersistDatasetItem()
                                     |
                                     v
[P] DiagramDatasetRecord
                                     |
          +--------------------------+--------------------------+
          |                          |                          |
          v                          v                          v
[R] DiagramDatasetStore.list() [R] updateLabels()        [R] removeItem()
          |                          |                          |
          +--------------------------+--------------------------+
                                     |
                                     v
[P] DiagramDatasetCatalogSnapshot`
  }
] as const;

export const MAPPING_POC_GRAPH_B = MAPPING_POC_B_SECTION_DEFINITIONS
  .map((section) => section.ascii)
  .join("\n\n");

export const MAPPING_POC_GRAPH_B_LINE_COUNT = MAPPING_POC_GRAPH_B.split("\n").length;

export function logicalLineCount(ascii: string): number {
  return ascii.split("\n").length;
}

export interface MappingPocNodeExtent {
  startLine: number;
  endLine: number;
}

export interface MappingPocNodeHead {
  line: number;
  startColumn: number;
  endColumn: number;
}

export interface MappingPocSourceRange {
  path: string;
  startLine: number;
  endLine: number;
}

export interface MappingPocBNode {
  id: string;
  entityId: string;
  label: string;
  head: MappingPocNodeHead;
  sourceRanges: readonly MappingPocSourceRange[];
}

export interface MappingPocBSection {
  id: string;
  label: string;
  startLine: number;
  endLine: number;
}

export interface MappingPocANode {
  id: string;
  label: string;
  head: MappingPocNodeHead;
  extent: MappingPocNodeExtent;
  selectableBecause: "mapped" | "important-code-entity";
  sourceRanges: readonly MappingPocSourceRange[];
  mappedBNodeIds: readonly string[];
}

export interface MappingPocProjection {
  selectedANodeIds: string[];
  mappedANodeIds: string[];
  directlyMappedBNodeIds: string[];
  selectedBNodeIds: string[];
  mappedBRange: MappingPocNodeExtent | null;
  alignedBRange: MappingPocNodeExtent | null;
  alignedSectionIds: string[];
  /** Backward-compatible display range; identical to alignedBRange. */
  bRange: MappingPocNodeExtent | null;
  bBounds: MappingPocGridRect | null;
  bAscii: string;
}

export interface MappingPocGridRect {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

function headAt(ascii: string, line: number, token: string): MappingPocNodeHead {
  const text = ascii.split("\n")[line - 1];
  const offset = text?.indexOf(token) ?? -1;
  if (offset < 0) throw new Error(`Mapping POC token not found at line ${line}: ${token}`);
  return { line, startColumn: offset + 1, endColumn: offset + token.length };
}

function headContaining(ascii: string, token: string): MappingPocNodeHead {
  const exactLine = token.endsWith("\n");
  const needle = exactLine ? token.slice(0, -1) : token;
  const matches = ascii.split("\n").flatMap((line, index) => {
    const offset = exactLine && line.trim() !== needle ? -1 : line.indexOf(needle);
    return offset < 0 ? [] : [{ line: index + 1, startColumn: offset + 1, endColumn: offset + needle.length }];
  });
  if (matches.length !== 1) throw new Error(`Mapping POC token must occur once: ${needle}`);
  return matches[0];
}

function sourceRange(path: string, startLine: number, endLine: number): MappingPocSourceRange {
  return { path, startLine, endLine };
}

function bNode(
  id: string,
  entityId: string,
  label: string,
  token: string,
  sourceRanges: readonly MappingPocSourceRange[]
): MappingPocBNode {
  return {
    id,
    entityId,
    label,
    head: headContaining(MAPPING_POC_GRAPH_B, token),
    sourceRanges
  };
}

function bNodes(
  path: string,
  startLine: number,
  endLine: number,
  specs: ReadonlyArray<readonly [id: string, token: string, label?: string]>
): MappingPocBNode[] {
  return specs.map(([id, token, label]) => bNode(
    `b-${id}`,
    `poc-${id}`,
    label ?? token.replace(/^\[[PRX]\]\s*/, "").replace(/\(\)$/, ""),
    token,
    [sourceRange(path, startLine, endLine)]
  ));
}

let sectionStartLine = 1;
export const MAPPING_POC_B_SECTIONS: readonly MappingPocBSection[] = MAPPING_POC_B_SECTION_DEFINITIONS.map(
  (section, index) => {
    const lineCount = logicalLineCount(section.ascii);
    const result = {
      id: section.id,
      label: section.label,
      startLine: sectionStartLine,
      endLine: sectionStartLine + lineCount - 1
    };
    sectionStartLine += lineCount + (index < MAPPING_POC_B_SECTION_DEFINITIONS.length - 1 ? 1 : 0);
    return result;
  }
);

// B nodes are grounded to the source ranges represented by their ASCII heads.
export const MAPPING_POC_B_NODES: readonly MappingPocBNode[] = [
  ...bNodes("domain/core/records/domain.ts", 123, 172, [
    ["diagram-set-record", "[P] DiagramSetRecord"],
    ["code-entities-set-record", "[P] CodeEntitiesSetRecord"]
  ]),
  ...bNodes("domain/core/records/domain.ts", 319, 319, [
    ["system-prompt-template", "[P] SystemPromptTemplateRecord"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 21, 50, [
    ["axes-iterations", "[P] AXES + ITERATIONS"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 121, 135, [
    ["runner-constructor", "[R] ExperimentRunner.constructor(options)"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 386, 405, [
    ["runner-run", "[R] ExperimentRunner.run(through=2)"],
    ["run-loops", "[R] runIterationAxisLoops()"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 137, 172, [
    ["runner-initialize", "[R] ExperimentRunner.initialize()"],
    ["manifest-path", "[R] manifestPath()"],
    ["read-prompt-templates", "[R] readPromptTemplates()"],
    ["find-default-profile", "[R] findDefaultProfile()"],
    ["read-manifest", "[R] readJsonIfExists<ExperimentManifest>()"],
    ["validate-existing-manifest", "[X] validateExistingManifest()"],
    ["render-system-prompt", "[R] renderArtifactSystemPrompt()"],
    ["default-prompt-profile", "[P] defaultPromptProfile"],
    ["write-manifest", "[R] writeJsonAtomic(experiment.json)"]
  ]),
  ...bNodes("domain/studio/experiments/types.ts", 17, 28, [
    ["experiment-manifest", "[P] ExperimentManifest\n"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 182, 186, [
    ["runner-prompt-for", "[R] ExperimentRunner.promptFor(axis, iteration)"],
    ["baseline-prompt", "[P] axis.baselinePrompt"],
    ["read-prior-analysis", "[R] readPriorAnalysis()"],
    ["revised-prompt", "[P] analysis.revisedPromptBlock"],
    ["active-axis-prompt", "[P] activeAxisPrompt"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 188, 265, [
    ["runner-generate", "[R] ExperimentRunner.generate(axis, iteration, prompt)"],
    ["iteration-spec", "[P] iterationSpec"],
    ["build-generation-tasks", "[R] buildGenerationTasks()"],
    ["generation-task", "[P] GenerationTask[*]"],
    ["generation-path", "[R] generationPath(axis, iteration, value, replicate)"],
    ["read-existing-generation", "[R] readExistingGeneration()"],
    ["resumed-generation", "[P] resumed GenerationRecord"],
    ["render-axis-prompt", "[R] renderAxisPrompt(prompt, value)"],
    ["rendered-instruction", "[P] renderedInstruction"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 174, 180, [
    ["runner-source", "[R] ExperimentRunner.source(axis)"],
    ["read-diagram-set", "[R] readDiagramSetRecord()"],
    ["read-code-entities", "[R] readCodeEntitiesSetRecord()"],
    ["assert-generation-ready", "[X] assertGenerationReady()"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 73, 82, [
    ["map-limit", "[R] mapLimit(tasks, concurrency)"]
  ]),
  ...bNodes("domain/studio/generation/prompt.ts", 72, 269, [
    ["create-generation-config", "[R] createGenerationPromptConfig()"],
    ["prompt-finalized-gate", "[X] finalized gate"],
    ["index-code-entities", "[R] indexCodeEntities()"],
    ["resolve-prompt-bindings", "[R] resolvePromptBindings()"],
    ["resolve-domain-profile", "[R] prompt.resolveDomainProfile()"],
    ["build-prompt-options", "[R] buildPromptOptions()"],
    ["generation-prompt-result", "[P] GenerationPromptBuildResult"]
  ]),
  ...bNodes("domain/studio/experiments/types.ts", 43, 50, [
    ["stored-prompt-config", "[P] StoredPromptConfig"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 216, 232, [
    ["read-stored-prompt-config", "[R] readStoredPromptConfig()"],
    ["existing-prompt-config", "[P] existing config"],
    ["write-prompt-config", "[R] writePromptConfigJson()"]
  ]),
  ...bNodes("tools/experiments/runtime.ts", 68, 71, [
    ["sol-generate", "[R] SolExperimentRuntime.generate(request)"],
    ["fixed-generation-model", "[X] assertFixedGenerationModel()"]
  ]),
  ...bNodes("infrastructure/studio/agents/agentRuntime.ts", 98, 460, [
    ["pi-generate", "[R] PiDiagramAgentRuntime.generateArtifact(request)"],
    ["resolve-model", "[R] resolveModel()"],
    ["agent-domain-profile", "[R] agent.resolveDomainProfile()"],
    ["artifact-mode", "[P] artifactMode"],
    ["define-submit-tool", "[X] defineSubmitArtifactTool()"],
    ["resolve-aliases", "[R] resolveCodeEntityPromptAliases()"],
    ["artifact-candidate", "[P] GeneratedArtifactCandidate"],
    ["validate-artifact", "[R] validateArtifactSubmission()"],
    ["generation-settings", "[X] SettingsManager.inMemory()"],
    ["generation-resources", "[X] DefaultResourceLoader.reload()"],
    ["create-agent-session", "[X] createAgentSession()"],
    ["agent-progress", "[X] subscribeAgentProgress()"],
    ["generation-turns", "[R] runGenerationPromptTurns()"],
    ["initial-prompt", "[X] initialPrompt()"],
    ["reference-turn", "[X] optionalReferenceTurn()"],
    ["mapping-turn", "[X] mappingTurn()"],
    ["model-session", "[X] session.prompt()"],
    ["submit-artifact", "[X] submitArtifactTool.execute()"],
    ["artifact-draft", "[P] GeneratedArtifactDraft"],
    ["dispose-generation-session", "[X] unsubscribeAndDisposeSession()"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 234, 262, [
    ["normalize-ascii", "[R] normalizeAscii(draft.ascii)"],
    ["assert-ascii", "[R] assertSevenBitAscii(ascii)"],
    ["reject-unknown-ids", "[X] rejectUnknownCodeEntityIds()"],
    ["dedupe-ids", "[R] deduplicateCodeEntityIds()"],
    ["write-generation-record", "[R] writeGenerationRecordJson()"]
  ]),
  ...bNodes("tools/experiments/metrics.ts", 13, 30, [
    ["diagram-metrics", "[R] diagramMetrics(ascii)"],
    ["diagram-metrics-record", "[P] DiagramMetrics\n"]
  ]),
  ...bNodes("domain/studio/experiments/types.ts", 30, 41, [
    ["generation-record", "[P] GenerationRecord\n"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 267, 324, [
    ["runner-judge", "[R] ExperimentRunner.judge(axis, iteration, generations)"],
    ["cross-windows", "[R] buildCrossValueWindows()"],
    ["within-tasks", "[R] buildWithinValueTasks()"],
    ["cross-task", "[P] CrossJudgmentTask[*]"],
    ["within-task", "[P] WithinJudgmentTask[*]"],
    ["map-cross", "[R] mapLimitCrossJudgments()"],
    ["map-within", "[R] mapLimitWithinJudgments()"],
    ["labeled-cross", "[R] labeledCrossDiagrams()"],
    ["labeled-within", "[R] labeledWithinDiagrams()"],
    ["read-cross", "[R] readExistingCrossJudgment()"],
    ["read-within", "[R] readExistingWithinJudgment()"],
    ["write-cross", "[R] writeCrossJudgmentJson()"],
    ["write-within", "[R] writeWithinJudgmentJson()"]
  ]),
  ...bNodes("tools/experiments/runtime.ts", 134, 167, [
    ["judge-cross", "[R] SolExperimentRuntime.judgeCross()"],
    ["judge-within", "[R] SolExperimentRuntime.judgeWithin()"]
  ]),
  ...bNodes("tools/experiments/metrics.ts", 52, 61, [
    ["validate-ranking", "[R] validateRanking()"]
  ]),
  ...bNodes("domain/studio/experiments/types.ts", 52, 107, [
    ["cross-judgment", "[P] CrossJudgment record"],
    ["within-judgment", "[P] WithinJudgment record"],
    ["stored-cross", "[P] StoredCrossJudgment record"],
    ["stored-within", "[P] StoredWithinJudgment record"]
  ]),
  ...bNodes("tools/experiments/runtime.ts", 73, 132, [
    ["structured", "[R] SolExperimentRuntime.structured()"],
    ["configured-runtime", "[R] configuredModelRuntime()"],
    ["model-runtime", "[X] ModelRuntime.create()"],
    ["get-model", "[R] getFixedModel()"],
    ["assert-auth", "[R] assertConfiguredAuth()"],
    ["structured-submit", "[X] defineStructuredSubmitTool()"],
    ["structured-session", "[X] createStructuredSession()"],
    ["structured-prompt", "[X] structuredSession.prompt()"],
    ["capture-submission", "[X] captureStructuredSubmission()"],
    ["dispose-structured", "[X] disposeStructuredSession()"]
  ]),
  ...bNodes("tools/experiments/metrics.ts", 63, 102, [
    ["aggregate-scores", "[R] aggregateScores(input)"],
    ["correct-pairs", "[R] correctPairs()"],
    ["mean-gap", "[R] meanGapSignal()"],
    ["mean-noise", "[R] meanWithinNoise()"],
    ["mean-off-axis", "[R] meanOffAxis()"],
    ["group-metrics", "[R] groupMetricsByValue()"],
    ["aggregate-score", "[P] AggregateScore"],
    ["write-aggregate", "[R] writeAggregateJson()"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 326, 363, [
    ["runner-analyze", "[R] ExperimentRunner.analyze()"],
    ["read-analysis", "[R] readExistingAnalysis()"],
    ["resumed-analysis", "[P] resumed StoredAnalysis"],
    ["read-previous-aggregate", "[R] readPreviousAggregate()"],
    ["judge-summary", "[R] judgeSummary()"],
    ["validate-analysis", "[X] validatePlaceholderAndWordLimit()"],
    ["write-analysis", "[R] writeAnalysisJson()"]
  ]),
  ...bNodes("tools/experiments/runtime.ts", 169, 190, [
    ["sol-analyze", "[R] SolExperimentRuntime.analyze()"],
    ["analysis-session", "[X] promptAnalysisSession()"]
  ]),
  ...bNodes("domain/studio/experiments/types.ts", 109, 143, [
    ["prompt-analysis", "[P] PromptAnalysis"],
    ["stored-analysis", "[P] StoredAnalysis\n"]
  ]),
  ...bNodes("tools/experiments/runner.ts", 365, 405, [
    ["write-report", "[R] ExperimentRunner.writeReport()"],
    ["read-all-analyses", "[R] readAllAnalyses()"],
    ["compare-scores", "[R] compareIterationScores()"],
    ["render-axis-sections", "[R] renderAxisSections()"],
    ["report", "[P] REPORT.md"],
    ["completed-manifest", "[P] ExperimentManifest status=\"complete\""],
    ["write-completed-manifest", "[R] writeCompletedManifest()"],
    ["runtime-dispose", "[X] ExperimentRuntime.dispose()"],
    ["output-filesystem", "[P] ExperimentOutputFilesystem"]
  ]),
  ...bNodes("infrastructure/studio/persistence/experiments/experimentCatalog.ts", 44, 180, [
    ["catalog-constructor", "[R] ExperimentCatalog.constructor(datasetRoot)"],
    ["catalog-directories", "[R] ExperimentCatalog.directories()"],
    ["catalog-readdir", "[R] readdirRoot()"],
    ["filter-catalog-ids", "[R] filterCatalogIds()"],
    ["sort-catalog-ids", "[R] sortCatalogIds()"],
    ["catalog-list", "[R] ExperimentCatalog.list()"],
    ["catalog-summarize", "[R] ExperimentCatalog.summarize(catalogId)"],
    ["read-catalog-manifest", "[R] readManifest()"],
    ["read-project", "[R] readProject()"],
    ["read-catalog-diagram-set", "[R] readDiagramSet()"],
    ["read-catalog-analysis", "[R] readAnalysis()"],
    ["scan-generations", "[R] scanGenerations()"],
    ["catalog-artifact", "[R] ExperimentCatalog.artifact(coordinates)"],
    ["validate-coordinates", "[X] validateArtifactCoordinates()"],
    ["read-generation-record", "[R] readGenerationRecord()"]
  ]),
  ...bNodes("domain/studio/experiments/experimentDomain.ts", 71, 97, [
    ["experiment-summary", "[P] ExperimentSummary"],
    ["experiment-artifact", "[P] ExperimentDiagramArtifact"]
  ]),
  ...bNodes("src/features/studio/experiments/ExperimentViewerPage.tsx", 377, 617, [
    ["experiment-viewer", "[R] ExperimentViewerPage"],
    ["load-catalog", "[R] loadCatalogSnapshot()"],
    ["load-dataset-catalog", "[R] loadDatasetCatalog()"],
    ["locate-selection", "[R] locateSelection()"],
    ["select-coordinates", "[R] selectExperimentCoordinates()"],
    ["load-artifact", "[R] loadExperimentArtifact()"],
    ["diagram-card", "[P] DiagramCard"],
    ["replicate-navigation", "[R] replicateNavigation()"],
    ["open-add-dialog", "[R] openAddToDatasetDialog()"],
    ["selected-artifact-labels", "[P] selected artifact + labels"]
  ]),
  ...bNodes("infrastructure/studio/persistence/datasets/diagramDatasetStore.ts", 73, 172, [
    ["validate-dataset-id", "[X] validateDatasetId()"],
    ["validate-source-coordinates", "[X] validateSourceCoordinates()"],
    ["dataset-catalog-artifact", "[R] catalog.artifact()"],
    ["dataset-add-item", "[R] DiagramDatasetStore.addItem()"],
    ["read-dataset-record", "[R] readDatasetRecord()"],
    ["snapshot-provenance", "[R] snapshotArtifactProvenance()"],
    ["append-item", "[R] appendAndPersistDatasetItem()"],
    ["dataset-list", "[R] DiagramDatasetStore.list()"],
    ["update-labels", "[R] updateLabels()"],
    ["remove-item", "[R] removeItem()"]
  ]),
  ...bNodes("domain/studio/datasets/datasetDomain.ts", 24, 42, [
    ["dataset-item", "[P] DiagramDatasetItemRecord"],
    ["dataset-snapshot", "[P] DiagramDatasetCatalogSnapshot"]
  ]),
  ...bNodes("infrastructure/studio/persistence/datasets/diagramDatasetStore.ts", 17, 24, [
    ["dataset-record", "[P] DiagramDatasetRecord"]
  ])
];

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function sourceRangesOverlap(
  left: MappingPocSourceRange,
  right: MappingPocSourceRange
): boolean {
  return normalizedPath(left.path) === normalizedPath(right.path)
    && left.startLine <= right.endLine
    && right.startLine <= left.endLine;
}

function bNodesForSourceRanges(sourceRanges: readonly MappingPocSourceRange[]): MappingPocBNode[] {
  return MAPPING_POC_B_NODES.filter((node) => node.sourceRanges.some(
    (bRange) => sourceRanges.some((aRange) => sourceRangesOverlap(aRange, bRange))
  ));
}

function aNode(
  id: string,
  label: string,
  line: number,
  token: string,
  startLine = line,
  endLine = line,
  sourceRanges: readonly MappingPocSourceRange[] = []
): MappingPocANode {
  const mappedBNodeIds = bNodesForSourceRanges(sourceRanges).map((node) => node.id);
  return {
    id,
    label,
    head: headAt(MAPPING_POC_GRAPH_A, line, token),
    extent: { startLine, endLine },
    selectableBecause: mappedBNodeIds.length ? "mapped" : "important-code-entity",
    sourceRanges,
    mappedBNodeIds
  };
}

export const MAPPING_POC_A_NODES: readonly MappingPocANode[] = [
  aNode("a-prompt-stack", "Current LLM prompt stack", 1, "CurrentLLMPromptStack", 1, 183, [
    sourceRange("domain/studio/generation/prompt.ts", 72, 513), sourceRange("infrastructure/studio/agents/agentRuntime.ts", 51, 545)
  ]),
  aNode("a-system-templates", "system prompt templates", 5, "system-prompt-templates.json", 5, 21, [
    sourceRange("domain/core/records/domain.ts", 319, 319), sourceRange(".diagrams/system-prompt-templates.json", 1, 47)
  ]),
  aNode("a-artifact-generation", "artifact generation template", 7, "artifact-generation", 7, 11, [sourceRange(".diagrams/system-prompt-templates.json", 1, 47)]),
  aNode("a-diagram-reference", "diagram reference template", 13, "diagram-reference", 13, 16, [sourceRange(".diagrams/system-prompt-templates.json", 1, 47)]),
  aNode("a-diagram-mapping", "diagram mapping template", 18, "diagram-mapping", 18, 21, [sourceRange(".diagrams/system-prompt-templates.json", 1, 47)]),
  aNode("a-code-entity-templates", "code entity prompt templates", 23, "code-entity-prompt-templates.json", 23, 29, [sourceRange(".diagrams/code-entity-prompt-templates.json", 1, 19)]),
  aNode("a-diagram-set", "DiagramSet", 31, "DiagramSet", 31, 42, [sourceRange("domain/core/records/domain.ts", 123, 172)]),
  aNode("a-code-entity-config", "CodeEntityPromptConfigRecord", 38, "CodeEntityPromptConfigRecord", 38, 42, [sourceRange("application/studio/generation/codeEntityPrompt.ts", 81, 112)]),
  aNode("a-evidence-collection", "evidence collection", 44, "evidenceCollection", 44, 66, [sourceRange("application/studio/generation/codeEntityPrompt.ts", 9, 112)]),
  aNode("a-collection-prompt", "code entity collection prompt", 45, "codeEntityCollectionPrompt()", 45, 51, [sourceRange("application/studio/generation/codeEntityPrompt.ts", 9, 48)]),
  aNode("a-collect-entities", "collect entities agent", 53, "PiDiagramAgentRuntime.collectEntities()", 53, 66, [sourceRange("infrastructure/studio/agents/agentRuntime.ts", 98, 460)]),
  aNode("a-runtime-request", "runtime generation request", 68, "runtimeGenerationRequest", 68, 85, [sourceRange("src/features/studio/StudioPage.tsx", 1018, 1085)]),
  aNode("a-generate-artifacts", "generation HTTP client", 80, "generateArtifacts()", 80, 85, [sourceRange("src/features/studio/api.ts", 636, 689), sourceRange("server/routes/studio/routes.ts", 160, 740)]),
  aNode("a-application-generate", "application generation orchestration", 87, "StudioApplication.generate()", 87, 119, [sourceRange("application/studio/application.ts", 173, 188)]),
  aNode("a-create-config", "create generation prompt config", 93, "createGenerationPromptConfig()", 93, 113, [sourceRange("domain/studio/generation/prompt.ts", 72, 513)]),
  aNode("a-generation-config", "GenerationPromptConfigRecord", 100, "GenerationPromptConfigRecord", 100, 113, [sourceRange("domain/core/records/domain.ts", 237, 286)]),
  aNode("a-begin-batch", "begin generation batch", 115, "beginBatch()", 115, 119, [sourceRange("infrastructure/core/persistence/store.ts", 172, 188)]),
  aNode("a-generate-artifact", "generate artifact agent", 121, "PiDiagramAgentRuntime.generateArtifact()", 121, 152, [sourceRange("infrastructure/studio/agents/agentRuntime.ts", 98, 545)]),
  aNode("a-turn-one", "initial generation turn", 127, "turn 1: generate", 127, 138, [sourceRange("infrastructure/studio/agents/agentRuntime.ts", 51, 85)]),
  aNode("a-turn-two", "reference restyle turn", 140, "turn 2: apply reference", 140, 145, [sourceRange("infrastructure/studio/agents/agentRuntime.ts", 51, 85)]),
  aNode("a-turn-three", "final mapping turn", 147, "turn 3: map final artifact", 147, 152, [sourceRange("infrastructure/studio/agents/agentRuntime.ts", 51, 85)]),
  aNode("a-submission-validation", "submission validation", 154, "submissionValidation", 154, 163, [
    sourceRange("infrastructure/studio/agents/agentRuntime.ts", 98, 460), sourceRange("domain/core/diagrams/diagramMapping.ts", 3, 67), sourceRange("application/studio/generation/service.ts", 403, 413)
  ]),
  aNode("a-persisted-outputs", "persisted outputs", 165, "persistedOutputs", 165, 183, [sourceRange("application/studio/application.ts", 173, 188)]),
  aNode("a-complete-batch", "complete generation batch", 178, "completeBatch()", 178, 183, [sourceRange("infrastructure/core/persistence/store.ts", 174, 174)])
];

const A_NODES_BY_ID = new Map(MAPPING_POC_A_NODES.map((node) => [node.id, node]));

export function selectANodesInRect(rect: MappingPocGridRect): MappingPocANode[] {
  const startLine = Math.min(rect.startLine, rect.endLine);
  const endLine = Math.max(rect.startLine, rect.endLine);
  const startColumn = Math.min(rect.startColumn, rect.endColumn);
  const endColumn = Math.max(rect.startColumn, rect.endColumn);
  return MAPPING_POC_A_NODES.filter((node) => (
    node.head.line >= startLine
    && node.head.line <= endLine
    && node.head.startColumn <= endColumn
    && node.head.endColumn >= startColumn
  ));
}

export function alignBRangeToSections(mappedRange: MappingPocNodeExtent | null): {
  range: MappingPocNodeExtent | null;
  sectionIds: string[];
} {
  if (!mappedRange) return { range: null, sectionIds: [] };
  const sections = MAPPING_POC_B_SECTIONS.filter((section) => (
    section.startLine <= mappedRange.endLine && mappedRange.startLine <= section.endLine
  ));
  if (!sections.length) return { range: mappedRange, sectionIds: [] };
  return {
    range: {
      startLine: Math.min(mappedRange.startLine, sections[0].startLine),
      endLine: Math.max(mappedRange.endLine, sections[sections.length - 1].endLine)
    },
    sectionIds: sections.map((section) => section.id)
  };
}

export function projectASelectionToB(
  selectedANodeIds: readonly string[],
  diagramNodes?: readonly MappingPocANode[]
): MappingPocProjection {
  const nodesById = diagramNodes ? new Map(diagramNodes.map((node) => [node.id, node])) : A_NODES_BY_ID;
  const selectedA = [...new Set(selectedANodeIds)].map((id) => {
    const node = nodesById.get(id);
    if (!node) throw new Error(`Unknown Graph A node: ${id}`);
    return node;
  }).sort((left, right) => left.head.line - right.head.line || left.head.startColumn - right.head.startColumn);
  const directlyMappedB = MAPPING_POC_B_NODES.filter((node) => selectedA.some((aNode) => (
    aNode.sourceRanges.some((aRange) => node.sourceRanges.some((bRange) => sourceRangesOverlap(aRange, bRange)))
  )));
  const startLine = directlyMappedB.length
    ? Math.min(...directlyMappedB.map((node) => node.head.line))
    : null;
  const endLine = directlyMappedB.length
    ? Math.max(...directlyMappedB.map((node) => node.head.line))
    : null;
  const mappedBRange = startLine === null || endLine === null ? null : { startLine, endLine };
  const aligned = alignBRangeToSections(mappedBRange);
  const alignedBRange = aligned.range;
  const selectedB = alignedBRange
    ? MAPPING_POC_B_NODES.filter((node) => node.head.line >= alignedBRange.startLine && node.head.line <= alignedBRange.endLine)
    : [];
  const graphBLines = MAPPING_POC_GRAPH_B.split("\n");
  const rawSlice = alignedBRange ? graphBLines.slice(alignedBRange.startLine - 1, alignedBRange.endLine) : [];
  const nonEmptyColumns = rawSlice.flatMap((line) => {
    const first = line.search(/\S/);
    return first < 0 ? [] : [{ start: first + 1, end: line.trimEnd().length }];
  });
  const startColumn = nonEmptyColumns.length ? Math.min(...nonEmptyColumns.map((item) => item.start)) : null;
  const endColumn = nonEmptyColumns.length ? Math.max(...nonEmptyColumns.map((item) => item.end)) : null;
  const bBounds = alignedBRange && startColumn !== null && endColumn !== null
    ? { ...alignedBRange, startColumn, endColumn }
    : null;
  return {
    selectedANodeIds: selectedA.map((node) => node.id),
    mappedANodeIds: selectedA.filter((node) => node.mappedBNodeIds.length).map((node) => node.id),
    directlyMappedBNodeIds: directlyMappedB.map((node) => node.id),
    selectedBNodeIds: selectedB.map((node) => node.id),
    mappedBRange,
    alignedBRange,
    alignedSectionIds: aligned.sectionIds,
    bRange: alignedBRange,
    bBounds,
    bAscii: bBounds
      ? rawSlice.map((line) => line.slice(bBounds.startColumn - 1, bBounds.endColumn)).join("\n")
      : ""
  };
}

export const MAPPING_POC_PROGRESSIVE_SELECTIONS = [
  { aNodeIds: ["a-system-templates"], expectedSectionIds: ["inputs"] },
  { aNodeIds: ["a-system-templates", "a-diagram-set"], expectedSectionIds: ["inputs"] },
  { aNodeIds: ["a-system-templates", "a-diagram-set", "a-create-config"], expectedSectionIds: ["inputs", "initialize", "prompt-selection", "generation-plan", "prompt-config"] },
  { aNodeIds: ["a-system-templates", "a-diagram-set", "a-create-config", "a-generate-artifact"], expectedSectionIds: ["inputs", "initialize", "prompt-selection", "generation-plan", "prompt-config", "model-generation"] }
] as const;
