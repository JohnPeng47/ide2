import type { ExperimentCatalogSnapshot, ExperimentDiagramArtifact } from "../../../domain/studio/experiments/experimentDomain";

export interface ExperimentRepository {
  readonly root: string;
  list(): Promise<ExperimentCatalogSnapshot>;
  artifact(input: {
    catalogId: string;
    axisId: string;
    iteration: number;
    value: number;
    replicate: number;
  }): Promise<ExperimentDiagramArtifact>;
}
