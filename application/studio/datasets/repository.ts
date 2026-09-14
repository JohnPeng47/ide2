import type { AddDiagramDatasetItemResult, DiagramDatasetCatalogSnapshot, DiagramDatasetItemRecord, DiagramDatasetSummary } from "../../../domain/studio/datasets/datasetDomain";

export interface DiagramDatasetRepository {
  readonly root: string;
  list(): Promise<DiagramDatasetCatalogSnapshot>;
  create(name: unknown): Promise<DiagramDatasetSummary>;
  item(datasetId: string, itemId: string): Promise<DiagramDatasetItemRecord>;
  addItem(datasetId: string, draft: Omit<DiagramDatasetItemRecord, "id" | "addedAt" | "labels"> & {
    labels: unknown;
  }): Promise<AddDiagramDatasetItemResult>;
  updateLabels(datasetId: string, itemId: string, labels: unknown): Promise<DiagramDatasetSummary>;
  removeItem(datasetId: string, itemId: string): Promise<DiagramDatasetSummary>;
}
