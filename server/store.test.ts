import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiagramStore } from "./store";
import { SCHEMA_VERSION, type DiagramRecord } from "../src/domain";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DiagramStore", () => {
  it("writes to a caller-selected diagrams directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-store-root-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root, ".new_diagrams");
    const location = { checkoutRoot: root, repositoryIdentity: path.join(root, ".git") };
    await store.ensureProject(location);

    expect(store.storeRoot).toBe(path.join(root, ".new_diagrams"));
    const project = JSON.parse(await readFile(
      path.join(root, ".new_diagrams", "project.json"),
      "utf8"
    )) as { repositoryIdentity: string };
    expect(project.repositoryIdentity).toBe(location.repositoryIdentity);
  });

  it("finalizes collected CodeEntities and makes them immutable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-store-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const location = { checkoutRoot: root, repositoryIdentity: path.join(root, ".git") };
    const project = await store.ensureProject(location);
    const { diagramSet } = await store.createDiagramSet({
      project,
      name: "Worker flow",
      initialPrompt: "Show worker flow",
      location
    });
    const entity = {
      id: "entity-worker",
      handle: "worker",
      label: "Worker",
      category: "operation" as const,
      summary: "Consumes jobs",
      sourceRanges: [{ path: "src/worker.ts", startLine: 1, endLine: 4 }]
    };
    await store.completeCollection(diagramSet.id, [entity]);
    await expect(store.completeCollection(diagramSet.id, [entity])).rejects.toThrow(/immutable/);
    const workspace = await store.loadWorkspace();
    expect(workspace.diagramSets[0].readiness).toBe("ready");
    expect(workspace.codeEntitySets[diagramSet.codeEntitiesSetId].status).toBe("finalized");
  });

  it("migrates legacy duplicated batch prompts into one prompt-config record", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-store-migration-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const location = { checkoutRoot: root, repositoryIdentity: path.join(root, ".git") };
    const project = await store.ensureProject(location);
    const { diagramSet } = await store.createDiagramSet({
      project,
      name: "Legacy flow",
      initialPrompt: "Show it",
      location
    });
    await store.completeCollection(diagramSet.id, [{
      id: "entity-worker",
      handle: "worker",
      label: "Worker",
      category: "operation",
      summary: "Consumes jobs",
      sourceRanges: [{ path: "src/worker.ts", startLine: 1, endLine: 4 }]
    }]);
    const diagram: DiagramRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: "diagram-legacy",
      diagramSetId: diagramSet.id,
      handle: "legacy-flow",
      name: "Legacy flow",
      ascii: "[worker]",
      codeEntityIds: ["entity-worker"],
      origin: "generated",
      producedByRunId: "run-legacy",
      derivedFromDiagramIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    };
    await store.addDiagram(diagram);
    const setRoot = path.join(root, ".diagrams", "diagram-sets", diagramSet.id);
    const setPath = path.join(setRoot, "diagram-set.json");
    const storedSet = JSON.parse(await readFile(setPath, "utf8")) as Record<string, unknown>;
    await writeFile(setPath, `${JSON.stringify({
      ...storedSet,
      generationBatchIds: ["batch-legacy"]
    }, null, 2)}\n`, "utf8");
    await mkdir(path.join(setRoot, "generation-batches"), { recursive: true });
    await writeFile(path.join(setRoot, "generation-batches", "batch-legacy.json"), `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      id: "batch-legacy",
      diagramSetId: diagramSet.id,
      requestedCount: 1,
      outputKind: "diagram",
      modelId: "gpt-5.6-sol",
      userPrompt: "Show @entity/worker",
      selectedCodeEntityIds: ["entity-worker"],
      promptReferences: [{
        kind: "code-entity",
        targetId: "entity-worker",
        token: "@entity/worker",
        handle: "worker"
      }],
      resolvedPrompt: "legacy rendered context",
      codeEntitiesRevision: 1,
      childRunIds: [],
      outputDiagramIds: [diagram.id],
      outputDiagramComponentIds: [],
      status: "complete",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }, null, 2)}\n`, "utf8");

    const workspace = await store.loadWorkspace();
    const batch = workspace.generationBatches["batch-legacy"];
    const config = workspace.generationPromptConfigs[batch.promptConfigId];
    expect(config).toMatchObject({
      instruction: "Show @entity/worker",
      modelId: "gpt-5.6-sol",
      references: [{
        targetId: "entity-worker",
        promptRepresentation: expect.stringContaining("CodeEntity @entity/worker")
      }],
      contextPrompt: { rendered: "legacy rendered context" },
      systemPrompt: { profileId: "default" }
    });
    expect(workspace.diagrams[diagram.id].generationPromptConfigId).toBe(config.id);
    const migratedBatch = await readFile(
      path.join(setRoot, "generation-batches", "batch-legacy.json"),
      "utf8"
    );
    expect(migratedBatch).not.toContain('"userPrompt"');
    expect(migratedBatch).not.toContain('"resolvedPrompt"');
    await expect(readFile(
      path.join(setRoot, "generation-prompts", `${config.id}.json`),
      "utf8"
    )).resolves.toContain('"legacy rendered context"');
    await expect(store.saveGenerationPromptConfig({
      ...config,
      instruction: "mutated"
    })).rejects.toThrow(/immutable/);
  });
});
