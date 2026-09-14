import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import { ExperimentCatalog } from "../experimentCatalog";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ExperimentCatalog", () => {
  it("indexes completed axes and lazily returns diagram ASCII", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "diagram-experiment-catalog-"));
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const experimentRoot = path.join(root, "datasets", "experiment-one");
    await mkdir(path.join(sourceRoot, ".diagrams", "diagram-sets", "set-one"), { recursive: true });
    await mkdir(path.join(experimentRoot, "axes", "topology", "iteration-1", "generations", "value-0.00"), { recursive: true });
    await writeFile(path.join(sourceRoot, ".diagrams", "project.json"), JSON.stringify({ id: "project-one", name: "Project One", repositoryIdentity: "repo-one" }));
    await writeFile(path.join(sourceRoot, ".diagrams", "diagram-sets", "set-one", "diagram-set.json"), JSON.stringify({ name: "Set One" }));
    await writeFile(path.join(experimentRoot, "experiment.json"), JSON.stringify({
      schemaVersion: 1,
      id: "experiment-one",
      status: "complete",
      modelId: "gpt-5.6-sol",
      sourceRoot,
      defaultPromptProfile: { id: "default", version: 1, rendered: "prompt" },
      iterations: [{ number: 1, values: [0], replicates: 1 }],
      axes: [{ id: "topology", label: "Topology", lowEndpoint: "spine", highEndpoint: "mesh", controls: "routes", diagramSetId: "set-one", baselinePrompt: "value {{value}}" }],
      createdAt: "2026-08-22T00:00:00Z",
      updatedAt: "2026-08-22T01:00:00Z"
    }));
    const record = {
      schemaVersion: 1,
      axis: "topology",
      iteration: 1,
      value: 0,
      replicate: 1,
      modelId: "gpt-5.6-sol",
      promptConfigId: "prompt-one",
      generatedAt: "2026-08-22T00:30:00Z",
      artifact: { name: "One spine", ascii: "A --> B", codeEntityIds: [] },
      metrics: { rows: 1, columns: 7, nonWhitespaceRatio: 0.7, boxJunctions: 0, arrows: 1, implementationTokens: 0, branchTerms: 0 }
    };
    await writeFile(path.join(experimentRoot, "axes", "topology", "iteration-1", "generations", "value-0.00", "replicate-1.json"), JSON.stringify(record));

    const catalog = new ExperimentCatalog(path.join(root, "datasets"));
    const snapshot = await catalog.list();
    expect(snapshot.experiments[0]).toMatchObject({
      catalogId: "experiment-one",
      project: { name: "Project One" },
      axes: [{ diagramSetName: "Set One", iterations: [{ diagrams: [{ name: "One spine" }] }] }]
    });
    await expect(catalog.artifact({ catalogId: "experiment-one", axisId: "topology", iteration: 1, value: 0, replicate: 1 }))
      .resolves.toMatchObject({ artifact: { ascii: "A --> B" } });
  });
});
