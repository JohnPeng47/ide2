import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  ExperimentCatalogSnapshot,
  ExperimentDiagramArtifact,
  ExperimentDiagramSummary,
  ExperimentIterationSummary,
  ExperimentSummary
} from "../../../../domain/studio/experiments/experimentDomain";
import type { ExperimentManifest, GenerationRecord, StoredAnalysis } from "../../../../domain/studio/experiments/types";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertCatalogId(value: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(value)) throw new Error(`invalid experiment id: ${value}`);
}

function assertAxisId(value: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(value)) throw new Error(`invalid experiment axis: ${value}`);
}

function valueDirectory(value: number): string {
  return `value-${value.toFixed(2)}`;
}

export class ExperimentCatalog {
  readonly root: string;

  constructor(datasetRoot: string) {
    this.root = resolve(datasetRoot);
  }

  private async directories(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]{0,127}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  private experimentRoot(catalogId: string): string {
    assertCatalogId(catalogId);
    return join(this.root, catalogId);
  }

  private async summarize(catalogId: string): Promise<ExperimentSummary | undefined> {
    const root = this.experimentRoot(catalogId);
    const manifest = await readJsonIfExists<ExperimentManifest>(join(root, "experiment.json"));
    if (!manifest) return undefined;
    const project = await readJsonIfExists<{ id: string; name: string; repositoryIdentity: string }>(
      join(manifest.sourceRoot, ".diagrams", "project.json")
    );
    const axes = await Promise.all(manifest.axes.map(async (axis) => {
      const diagramSet = await readJsonIfExists<{ name: string }>(join(
        manifest.sourceRoot,
        ".diagrams",
        "diagram-sets",
        axis.diagramSetId,
        "diagram-set.json"
      ));
      const iterations = await Promise.all(manifest.iterations.map(async (spec): Promise<ExperimentIterationSummary> => {
        const iterationRoot = join(root, "axes", axis.id, `iteration-${spec.number}`);
        const storedAnalysis = await readJsonIfExists<StoredAnalysis>(join(iterationRoot, "analysis.json"));
        const diagrams: ExperimentDiagramSummary[] = [];
        for (const value of spec.values) {
          for (let replicate = 1;replicate <= spec.replicates;replicate += 1) {
            const record = await readJsonIfExists<GenerationRecord>(join(
              iterationRoot,
              "generations",
              valueDirectory(value),
              `replicate-${replicate}.json`
            ));
            if (!record) continue;
            diagrams.push({
              axisId: axis.id,
              iteration: spec.number,
              value,
              replicate,
              name: record.artifact.name,
              generatedAt: record.generatedAt,
              metrics: record.metrics
            });
          }
        }
        return {
          number: spec.number,
          values: spec.values,
          replicates: spec.replicates,
          aggregate: storedAnalysis?.aggregate,
          analysis: storedAnalysis?.analysis,
          diagrams
        };
      }));
      return {
        id: axis.id,
        label: axis.label,
        lowEndpoint: axis.lowEndpoint,
        highEndpoint: axis.highEndpoint,
        controls: axis.controls,
        diagramSetId: axis.diagramSetId,
        diagramSetName: diagramSet?.name ?? axis.diagramSetId,
        iterations
      };
    }));
    return {
      catalogId,
      id: manifest.id,
      status: manifest.status,
      modelId: manifest.modelId,
      project: project ?? {
        id: `project-${catalogId}`,
        name: basename(manifest.sourceRoot),
        repositoryIdentity: manifest.sourceRoot
      },
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      axes
    };
  }

  async list(): Promise<ExperimentCatalogSnapshot> {
    const summaries = await Promise.all((await this.directories()).map((catalogId) => this.summarize(catalogId)));
    return {
      experiments: summaries
        .filter((summary): summary is ExperimentSummary => Boolean(summary))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    };
  }

  async artifact(input: {
    catalogId: string;
    axisId: string;
    iteration: number;
    value: number;
    replicate: number;
  }): Promise<ExperimentDiagramArtifact> {
    assertCatalogId(input.catalogId);
    assertAxisId(input.axisId);
    if (!Number.isInteger(input.iteration) || input.iteration < 1 || input.iteration > 100) throw new Error("invalid experiment iteration");
    if (!Number.isFinite(input.value) || input.value < 0 || input.value > 1) throw new Error("invalid experiment value");
    if (!Number.isInteger(input.replicate) || input.replicate < 1 || input.replicate > 100) throw new Error("invalid experiment replicate");
    const record = await readJson<GenerationRecord>(join(
      this.experimentRoot(input.catalogId),
      "axes",
      input.axisId,
      `iteration-${input.iteration}`,
      "generations",
      valueDirectory(input.value),
      `replicate-${input.replicate}.json`
    ));
    return {
      axisId: record.axis,
      iteration: record.iteration,
      value: record.value,
      replicate: record.replicate,
      name: record.artifact.name,
      generatedAt: record.generatedAt,
      metrics: record.metrics,
      artifact: record.artifact,
      promptConfigId: record.promptConfigId,
      modelId: record.modelId
    };
  }
}
