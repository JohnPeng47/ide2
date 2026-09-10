export type ExperimentAxisId = string;
export type ExperimentMetricKey =
  | "pairwiseOrderingAccuracy"
  | "exactOrderingAccuracy"
  | "distinguishabilityScore";

export interface ExperimentDiagramMetrics {
  rows: number;
  columns: number;
  nonWhitespaceRatio: number;
  boxJunctions: number;
  arrows: number;
  implementationTokens: number;
  branchTerms: number;
}

export interface ExperimentAggregate {
  prompt: string;
  generations: number;
  crossComparisons: number;
  withinComparisons: number;
  pairwiseOrderingAccuracy: number;
  exactOrderingAccuracy: number;
  meanJudgeConfidence: number;
  meanGapSignal: number;
  meanGapBalance: number;
  meanWithinValueSpread: number;
  distinguishabilityScore: number;
  meanOffAxisChange: number;
  invalidDiagramCount: number;
  metricMeansByValue: Record<string, ExperimentDiagramMetrics>;
}

export interface ExperimentPromptAnalysis {
  revisedPromptBlock: string;
  hypothesis: string;
  evidence: string;
  risks: string;
}

export interface ExperimentDiagramSummary {
  axisId: ExperimentAxisId;
  iteration: number;
  value: number;
  replicate: number;
  name: string;
  generatedAt: string;
  metrics: ExperimentDiagramMetrics;
}

export interface ExperimentIterationSummary {
  number: number;
  values: number[];
  replicates: number;
  aggregate?: ExperimentAggregate;
  analysis?: ExperimentPromptAnalysis;
  diagrams: ExperimentDiagramSummary[];
}

export interface ExperimentAxisSummary {
  id: ExperimentAxisId;
  label: string;
  lowEndpoint: string;
  highEndpoint: string;
  controls: string;
  diagramSetId: string;
  diagramSetName: string;
  iterations: ExperimentIterationSummary[];
}

export interface ExperimentSummary {
  catalogId: string;
  id: string;
  status: "running" | "complete";
  modelId: string;
  project: {
    id: string;
    name: string;
    repositoryIdentity: string;
  };
  createdAt: string;
  updatedAt: string;
  axes: ExperimentAxisSummary[];
}

export interface ExperimentCatalogSnapshot {
  experiments: ExperimentSummary[];
}

export interface ExperimentDiagramArtifact extends ExperimentDiagramSummary {
  artifact: {
    name: string;
    ascii: string;
    codeEntityIds: string[];
  };
  promptConfigId: string;
  modelId: string;
}
