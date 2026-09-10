import type { ExperimentDiagramMetrics } from "./experimentDomain";

export interface DiagramDatasetSourceRef {
  catalogId: string;
  experimentId: string;
  projectId: string;
  projectName: string;
  axisId: string;
  axisLabel: string;
  iteration: number;
  value: number;
  replicate: number;
}

export interface DiagramDatasetItemSummary {
  id: string;
  name: string;
  labels: string[];
  source: DiagramDatasetSourceRef;
  metrics: ExperimentDiagramMetrics;
  addedAt: string;
}

export interface DiagramDatasetItemRecord extends DiagramDatasetItemSummary {
  ascii: string;
  codeEntityIds: string[];
  modelId: string;
  promptConfigId: string;
  testedPrompt: string;
}

export interface DiagramDatasetSummary {
  id: string;
  name: string;
  itemCount: number;
  items: DiagramDatasetItemSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface DiagramDatasetCatalogSnapshot {
  datasets: DiagramDatasetSummary[];
}

export interface AddDiagramDatasetItemInput {
  source: Pick<DiagramDatasetSourceRef, "catalogId" | "axisId" | "iteration" | "value" | "replicate">;
  labels: string[];
}

export interface AddDiagramDatasetItemResult {
  dataset: DiagramDatasetSummary;
  item: DiagramDatasetItemSummary;
  added: boolean;
}
