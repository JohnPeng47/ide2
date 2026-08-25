import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiagramDatasetStore } from "./diagramDatasetStore";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DiagramDatasetStore", () => {
  it("creates a dataset, snapshots one source once, and edits labels", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "diagram-dataset-store-"));
    roots.push(root);
    const store = new DiagramDatasetStore(root);
    const dataset = await store.create("Routing examples");
    const draft = {
      name: "Retry mesh",
      labels: ["topology=high", "accepted"],
      source: {
        catalogId: "experiment-one",
        experimentId: "axis-controls",
        projectId: "project-one",
        projectName: "Project One",
        axisId: "topology",
        axisLabel: "Topology",
        iteration: 2,
        value: 1,
        replicate: 1
      },
      metrics: { rows: 3, columns: 10, nonWhitespaceRatio: 0.5, boxJunctions: 2, arrows: 4, implementationTokens: 0, branchTerms: 1 },
      ascii: "A +--> B",
      codeEntityIds: ["entity-a"],
      modelId: "gpt-5.6-sol",
      promptConfigId: "prompt-one",
      testedPrompt: "Topology = 1"
    };
    const added = await store.addItem(dataset.id, draft);
    const duplicate = await store.addItem(dataset.id, { ...draft, labels: [] });
    expect(added.added).toBe(true);
    expect(duplicate.added).toBe(false);
    expect((await store.list()).datasets[0].itemCount).toBe(1);

    const updated = await store.updateLabels(dataset.id, added.item.id, ["reviewed", "reviewed"]);
    expect(updated.items[0].labels).toEqual(["reviewed"]);
    expect((await store.item(dataset.id, added.item.id)).ascii).toBe("A +--> B");
    expect(await readFile(path.join(root, dataset.id, "dataset.json"), "utf8")).toContain('"topology"');

    expect((await store.removeItem(dataset.id, added.item.id)).itemCount).toBe(0);
  });
});
