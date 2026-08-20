import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiagramStore } from "./store";

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

  it("creates a set and makes CodeEntities immutable after finalization", async () => {
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
    await store.finalizeCodeEntities(diagramSet.id, "human");
    await expect(store.completeCollection(diagramSet.id, [entity])).rejects.toThrow(/immutable/);
    const workspace = await store.loadWorkspace();
    expect(workspace.diagramSets[0].readiness).toBe("ready");
    expect(workspace.codeEntitySets[diagramSet.codeEntitiesSetId].status).toBe("finalized");
  });
});
