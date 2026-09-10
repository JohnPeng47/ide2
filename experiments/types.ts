import type { GenerationPromptConfigRecord, GeneratedArtifactDraft } from "../src/core/domain";

export type AxisId = "semantic_zoom" | "topology";
export type IterationNumber = 1 | 2;
export type DiagramLabel = "A" | "B" | "C";

export interface AxisDefinition {
  id: AxisId;
  label: string;
  lowEndpoint: string;
  highEndpoint: string;
  controls: string;
  diagramSetId: string;
  baselinePrompt: string;
}

export interface ExperimentManifest {
  schemaVersion: 1;
  id: string;
  status: "running" | "complete";
  modelId: "gpt-5.6-sol";
  sourceRoot: string;
  defaultPromptProfile: { id: string; version: number; rendered: string };
  iterations: Array<{ number: IterationNumber; values: number[]; replicates: number }>;
  axes: AxisDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerationRecord {
  schemaVersion: 1;
  axis: AxisId;
  iteration: IterationNumber;
  value: number;
  replicate: number;
  modelId: "gpt-5.6-sol";
  promptConfigId: string;
  generatedAt: string;
  artifact: GeneratedArtifactDraft;
  metrics: DiagramMetrics;
}

export interface StoredPromptConfig {
  schemaVersion: 1;
  axis: AxisId;
  iteration: IterationNumber;
  value: number;
  axisPrompt: string;
  generationPromptConfig: GenerationPromptConfigRecord;
}

export interface DiagramMetrics {
  rows: number;
  columns: number;
  nonWhitespaceRatio: number;
  boxJunctions: number;
  arrows: number;
  implementationTokens: number;
  branchTerms: number;
}

export interface LabeledDiagram {
  label: DiagramLabel;
  generationPath: string;
  axisValue: number;
  replicate: number;
  artifact: GeneratedArtifactDraft;
}

export interface CrossJudgment {
  orderLowToHigh: [DiagramLabel, DiagramLabel, DiagramLabel];
  confidence: number;
  gapLowMid: number;
  gapMidHigh: number;
  offAxisChange: number;
  invalidLabels: DiagramLabel[];
  rationale: string;
}

export interface WithinJudgment {
  perceivedSpread: number;
  offAxisSpread: number;
  invalidLabels: DiagramLabel[];
  rationale: string;
}

export interface StoredCrossJudgment {
  schemaVersion: 1;
  kind: "cross-value";
  axis: AxisId;
  iteration: IterationNumber;
  modelId: "gpt-5.6-sol";
  diagrams: LabeledDiagram[];
  judgment: CrossJudgment;
  judgedAt: string;
}

export interface StoredWithinJudgment {
  schemaVersion: 1;
  kind: "within-value";
  axis: AxisId;
  iteration: IterationNumber;
  modelId: "gpt-5.6-sol";
  diagrams: LabeledDiagram[];
  judgment: WithinJudgment;
  judgedAt: string;
}

export interface AggregateScore {
  axis: AxisId;
  iteration: IterationNumber;
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
  metricMeansByValue: Record<string, DiagramMetrics>;
}

export interface PromptAnalysis {
  revisedPromptBlock: string;
  hypothesis: string;
  evidence: string;
  risks: string;
}

export interface StoredAnalysis {
  schemaVersion: 1;
  axis: AxisId;
  iteration: IterationNumber;
  modelId: "gpt-5.6-sol";
  aggregate: AggregateScore;
  analysis: PromptAnalysis;
  analyzedAt: string;
}
