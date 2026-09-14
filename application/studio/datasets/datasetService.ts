import type { ExperimentRepository } from '../experiments/repository';
import type { DiagramDatasetRepository } from './repository';

export class DatasetService {
  constructor(private readonly datasets: DiagramDatasetRepository, private readonly experiments: ExperimentRepository) { }
  list() { return this.datasets.list(); }
  create(name: unknown) { return this.datasets.create(name); }
  item(datasetId: string, itemId: string) { return this.datasets.item(datasetId, itemId); }
  updateLabels(datasetId: string, itemId: string, labels: unknown) { return this.datasets.updateLabels(datasetId, itemId, labels); }
  removeItem(datasetId: string, itemId: string) { return this.datasets.removeItem(datasetId, itemId); }
  async addFromExperiment(datasetId: string, body: Record<string, unknown>) {
    const source = body.source as Record<string, unknown> | undefined;
    if (!source) throw new Error("diagram source is required");
    const catalogId = typeof source.catalogId === "string" ? source.catalogId : "";
    const axisId = typeof source.axisId === "string" ? source.axisId : "";
    const iteration = Number(source.iteration);
    const value = Number(source.value);
    const replicate = Number(source.replicate);
    const catalog = await this.experiments.list();
    const experiment = catalog.experiments.find((candidate) => candidate.catalogId === catalogId);
    const axis = experiment?.axes.find((candidate) => candidate.id === axisId);
    const iterationSummary = axis?.iterations.find((candidate) => candidate.number === iteration);
    if (!experiment || !axis || !iterationSummary) throw new Error("experiment source was not found");
    const artifact = await this.experiments.artifact({ catalogId, axisId, iteration, value, replicate });
    return this.datasets.addItem(datasetId, {
      name: artifact.name,
      labels: body.labels,
      source: {
        catalogId,
        experimentId: experiment.id,
        projectId: experiment.project.id,
        projectName: experiment.project.name,
        axisId,
        axisLabel: axis.label,
        iteration,
        value,
        replicate
      },
      metrics: artifact.metrics,
      ascii: artifact.artifact.ascii,
      codeEntityIds: artifact.artifact.codeEntityIds,
      modelId: artifact.modelId,
      promptConfigId: artifact.promptConfigId,
      testedPrompt: iterationSummary.aggregate?.prompt ?? ""
    });
  }
}
