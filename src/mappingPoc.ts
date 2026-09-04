export const MAPPING_POC_GRAPH_A = `[P] finalized source DiagramSetRecord + CodeEntitiesSetRecord
[P] SystemPromptTemplateRecord
      |
      v
[R] ExperimentRunner.initialize
      |
      v
[P] ExperimentManifest
    axes + iterations + fixed model
      |
      v
[R] promptFor(axis, iteration)
      |
      +--> iteration 1: baseline control block
      \`--> iteration 2: prior analysis.revisedPromptBlock
      |
      v
[R] generate
    values x replicates, bounded by mapLimit
      |
      v
[R] SolExperimentRuntime.generate
      |
      \`--> [R] PiDiagramAgentRuntime.generateArtifact
                   |
                   v
                [X] model session
      |
      v
[P] GenerationRecord[*]
    artifact + promptConfigId + diagramMetrics
      |
      +----------------------------+
      |                            |
      v                            v
[R] judgeCross                 [R] judgeWithin
 blinded low/mid/high order        same-value stochastic spread
      |                            |
      v                            v
[P] StoredCrossJudgment[*]     [P] StoredWithinJudgment[*]
      +-------------+--------------+
                    |
                    v
             [R] aggregateScores
              signal - noise,
              ordering, off-axis,
              metric means
                    |
                    v
             [R] analyze
                    |
                    v
             [P] StoredAnalysis
                    |
                    \`---- revised prompt feeds next iteration

[P] experiment output
      |
      v
[R] ExperimentCatalog.list/artifact
      |
      v
[R] ExperimentViewerPage
      |
      +--> [R] DiagramDatasetStore.addItem
                    |
                    v
              [P] curated DiagramDatasetItemRecord
              artifact snapshot + labels + source coordinates +
              metrics/model/prompt proven`;

export const MAPPING_POC_GRAPH_A_LINE_COUNT = 70;

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
POST /api/diagram-datasets/:datasetId/items
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
  ...bNodes("src/domain.ts", 123, 173, [
    ["diagram-set-record", "[P] DiagramSetRecord"],
    ["code-entities-set-record", "[P] CodeEntitiesSetRecord"]
  ]),
  ...bNodes("src/domain.ts", 319, 319, [
    ["system-prompt-template", "[P] SystemPromptTemplateRecord"]
  ]),
  ...bNodes("experiments/runner.ts", 21, 50, [
    ["axes-iterations", "[P] AXES + ITERATIONS"]
  ]),
  ...bNodes("experiments/runner.ts", 121, 135, [
    ["runner-constructor", "[R] ExperimentRunner.constructor(options)"]
  ]),
  ...bNodes("experiments/runner.ts", 386, 405, [
    ["runner-run", "[R] ExperimentRunner.run(through=2)"],
    ["run-loops", "[R] runIterationAxisLoops()"]
  ]),
  ...bNodes("experiments/runner.ts", 137, 172, [
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
  ...bNodes("experiments/types.ts", 17, 28, [
    ["experiment-manifest", "[P] ExperimentManifest\n"]
  ]),
  ...bNodes("experiments/runner.ts", 182, 186, [
    ["runner-prompt-for", "[R] ExperimentRunner.promptFor(axis, iteration)"],
    ["baseline-prompt", "[P] axis.baselinePrompt"],
    ["read-prior-analysis", "[R] readPriorAnalysis()"],
    ["revised-prompt", "[P] analysis.revisedPromptBlock"],
    ["active-axis-prompt", "[P] activeAxisPrompt"]
  ]),
  ...bNodes("experiments/runner.ts", 188, 265, [
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
  ...bNodes("experiments/runner.ts", 174, 180, [
    ["runner-source", "[R] ExperimentRunner.source(axis)"],
    ["read-diagram-set", "[R] readDiagramSetRecord()"],
    ["read-code-entities", "[R] readCodeEntitiesSetRecord()"],
    ["assert-generation-ready", "[X] assertGenerationReady()"]
  ]),
  ...bNodes("experiments/runner.ts", 73, 82, [
    ["map-limit", "[R] mapLimit(tasks, concurrency)"]
  ]),
  ...bNodes("src/prompt.ts", 482, 680, [
    ["create-generation-config", "[R] createGenerationPromptConfig()"],
    ["prompt-finalized-gate", "[X] finalized gate"],
    ["index-code-entities", "[R] indexCodeEntities()"],
    ["resolve-prompt-bindings", "[R] resolvePromptBindings()"],
    ["resolve-domain-profile", "[R] prompt.resolveDomainProfile()"],
    ["build-prompt-options", "[R] buildPromptOptions()"],
    ["generation-prompt-result", "[P] GenerationPromptBuildResult"]
  ]),
  ...bNodes("experiments/types.ts", 43, 50, [
    ["stored-prompt-config", "[P] StoredPromptConfig"]
  ]),
  ...bNodes("experiments/runner.ts", 216, 232, [
    ["read-stored-prompt-config", "[R] readStoredPromptConfig()"],
    ["existing-prompt-config", "[P] existing config"],
    ["write-prompt-config", "[R] writePromptConfigJson()"]
  ]),
  ...bNodes("experiments/runtime.ts", 68, 71, [
    ["sol-generate", "[R] SolExperimentRuntime.generate(request)"],
    ["fixed-generation-model", "[X] assertFixedGenerationModel()"]
  ]),
  ...bNodes("server/agentRuntime.ts", 454, 607, [
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
  ...bNodes("experiments/runner.ts", 234, 262, [
    ["normalize-ascii", "[R] normalizeAscii(draft.ascii)"],
    ["assert-ascii", "[R] assertSevenBitAscii(ascii)"],
    ["reject-unknown-ids", "[X] rejectUnknownCodeEntityIds()"],
    ["dedupe-ids", "[R] deduplicateCodeEntityIds()"],
    ["write-generation-record", "[R] writeGenerationRecordJson()"]
  ]),
  ...bNodes("experiments/metrics.ts", 13, 30, [
    ["diagram-metrics", "[R] diagramMetrics(ascii)"],
    ["diagram-metrics-record", "[P] DiagramMetrics\n"]
  ]),
  ...bNodes("experiments/types.ts", 30, 41, [
    ["generation-record", "[P] GenerationRecord\n"]
  ]),
  ...bNodes("experiments/runner.ts", 267, 324, [
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
  ...bNodes("experiments/runtime.ts", 134, 167, [
    ["judge-cross", "[R] SolExperimentRuntime.judgeCross()"],
    ["judge-within", "[R] SolExperimentRuntime.judgeWithin()"]
  ]),
  ...bNodes("experiments/metrics.ts", 52, 61, [
    ["validate-ranking", "[R] validateRanking()"]
  ]),
  ...bNodes("experiments/types.ts", 52, 107, [
    ["cross-judgment", "[P] CrossJudgment record"],
    ["within-judgment", "[P] WithinJudgment record"],
    ["stored-cross", "[P] StoredCrossJudgment record"],
    ["stored-within", "[P] StoredWithinJudgment record"]
  ]),
  ...bNodes("experiments/runtime.ts", 73, 132, [
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
  ...bNodes("experiments/metrics.ts", 63, 102, [
    ["aggregate-scores", "[R] aggregateScores(input)"],
    ["correct-pairs", "[R] correctPairs()"],
    ["mean-gap", "[R] meanGapSignal()"],
    ["mean-noise", "[R] meanWithinNoise()"],
    ["mean-off-axis", "[R] meanOffAxis()"],
    ["group-metrics", "[R] groupMetricsByValue()"],
    ["aggregate-score", "[P] AggregateScore"],
    ["write-aggregate", "[R] writeAggregateJson()"]
  ]),
  ...bNodes("experiments/runner.ts", 326, 363, [
    ["runner-analyze", "[R] ExperimentRunner.analyze()"],
    ["read-analysis", "[R] readExistingAnalysis()"],
    ["resumed-analysis", "[P] resumed StoredAnalysis"],
    ["read-previous-aggregate", "[R] readPreviousAggregate()"],
    ["judge-summary", "[R] judgeSummary()"],
    ["validate-analysis", "[X] validatePlaceholderAndWordLimit()"],
    ["write-analysis", "[R] writeAnalysisJson()"]
  ]),
  ...bNodes("experiments/runtime.ts", 169, 190, [
    ["sol-analyze", "[R] SolExperimentRuntime.analyze()"],
    ["analysis-session", "[X] promptAnalysisSession()"]
  ]),
  ...bNodes("experiments/types.ts", 109, 143, [
    ["prompt-analysis", "[P] PromptAnalysis"],
    ["stored-analysis", "[P] StoredAnalysis\n"]
  ]),
  ...bNodes("experiments/runner.ts", 365, 405, [
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
  ...bNodes("server/experimentCatalog.ts", 41, 185, [
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
  ...bNodes("src/experimentDomain.ts", 71, 98, [
    ["experiment-summary", "[P] ExperimentSummary"],
    ["experiment-artifact", "[P] ExperimentDiagramArtifact"]
  ]),
  ...bNodes("src/components/ExperimentViewerPage.tsx", 376, 617, [
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
  ...bNodes("server/diagramDatasetStore.ts", 61, 168, [
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
  ...bNodes("src/datasetDomain.ts", 24, 43, [
    ["dataset-item", "[P] DiagramDatasetItemRecord"],
    ["dataset-snapshot", "[P] DiagramDatasetCatalogSnapshot"]
  ]),
  ...bNodes("server/diagramDatasetStore.ts", 12, 19, [
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
  aNode("a-source-input", "finalized source records", 1, "[P] finalized source DiagramSetRecord + CodeEntitiesSetRecord", 1, 1, [
    sourceRange("src/domain.ts", 123, 134), sourceRange("src/domain.ts", 151, 173)
  ]),
  aNode("a-system-prompt", "SystemPromptTemplateRecord", 2, "[P] SystemPromptTemplateRecord", 2, 2, [sourceRange("src/domain.ts", 319, 319)]),
  aNode("a-initialize", "ExperimentRunner.initialize", 5, "[R] ExperimentRunner.initialize", 5, 5, [sourceRange("experiments/runner.ts", 137, 172)]),
  aNode("a-manifest", "ExperimentManifest", 8, "[P] ExperimentManifest", 8, 9, [sourceRange("experiments/types.ts", 17, 28)]),
  aNode("a-prompt-for", "promptFor(axis, iteration)", 12, "[R] promptFor(axis, iteration)", 12, 15, [sourceRange("experiments/runner.ts", 182, 186)]),
  aNode("a-generate", "generate", 18, "[R] generate", 18, 19, [sourceRange("experiments/runner.ts", 188, 265)]),
  aNode("a-sol-runtime", "SolExperimentRuntime.generate", 22, "[R] SolExperimentRuntime.generate", 22, 22, [sourceRange("experiments/runtime.ts", 68, 71)]),
  aNode("a-pi-runtime", "PiDiagramAgentRuntime.generateArtifact", 24, "[R] PiDiagramAgentRuntime.generateArtifact", 24, 24, [sourceRange("server/agentRuntime.ts", 454, 607)]),
  aNode("a-model-session", "model session", 27, "[X] model session", 27, 27, [sourceRange("server/agentRuntime.ts", 528, 605)]),
  aNode("a-generation-record", "GenerationRecord[*]", 30, "[P] GenerationRecord[*]", 30, 31, [sourceRange("experiments/types.ts", 30, 41)]),
  aNode("a-judge-cross", "judgeCross", 36, "[R] judgeCross", 36, 37, [sourceRange("experiments/runtime.ts", 134, 151)]),
  aNode("a-judge-within", "judgeWithin", 36, "[R] judgeWithin", 36, 37, [sourceRange("experiments/runtime.ts", 153, 167)]),
  aNode("a-stored-cross", "StoredCrossJudgment[*]", 40, "[P] StoredCrossJudgment[*]", 40, 40, [sourceRange("experiments/types.ts", 87, 96)]),
  aNode("a-stored-within", "StoredWithinJudgment[*]", 40, "[P] StoredWithinJudgment[*]", 40, 40, [sourceRange("experiments/types.ts", 98, 107)]),
  aNode("a-aggregate", "aggregateScores", 44, "[R] aggregateScores", 44, 47, [sourceRange("experiments/metrics.ts", 63, 102)]),
  aNode("a-analyze", "analyze", 50, "[R] analyze", 50, 50, [sourceRange("experiments/runtime.ts", 169, 190)]),
  aNode("a-stored-analysis", "StoredAnalysis", 53, "[P] StoredAnalysis", 53, 55, [sourceRange("experiments/types.ts", 135, 143)]),
  aNode("a-experiment-output", "experiment output", 57, "[P] experiment output", 57, 57, [sourceRange("experiments/types.ts", 17, 143)]),
  aNode("a-catalog", "ExperimentCatalog.list/artifact", 60, "[R] ExperimentCatalog.list/artifact", 60, 60, [sourceRange("server/experimentCatalog.ts", 41, 185)]),
  aNode("a-viewer", "ExperimentViewerPage", 63, "[R] ExperimentViewerPage", 63, 63, [sourceRange("src/components/ExperimentViewerPage.tsx", 376, 617)]),
  aNode("a-dataset-store", "DiagramDatasetStore.addItem", 65, "[R] DiagramDatasetStore.addItem", 65, 65, [sourceRange("server/diagramDatasetStore.ts", 131, 144)]),
  aNode("a-curated-item", "curated DiagramDatasetItemRecord", 68, "[P] curated DiagramDatasetItemRecord", 68, 70, [sourceRange("src/datasetDomain.ts", 24, 30)])
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

export function projectASelectionToB(selectedANodeIds: readonly string[]): MappingPocProjection {
  const selectedA = [...new Set(selectedANodeIds)].map((id) => {
    const node = A_NODES_BY_ID.get(id);
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
  { aNodeIds: ["a-catalog"], expectedSectionIds: ["catalog"] },
  { aNodeIds: ["a-catalog", "a-viewer"], expectedSectionIds: ["catalog", "viewer"] },
  { aNodeIds: ["a-catalog", "a-viewer", "a-dataset-store"], expectedSectionIds: ["catalog", "viewer", "curation"] },
  { aNodeIds: ["a-catalog", "a-viewer", "a-dataset-store", "a-curated-item"], expectedSectionIds: ["catalog", "viewer", "curation"] }
] as const;
