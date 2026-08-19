import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentProgress,
  CodeEntityDraft,
  DiagramDraft
} from "../src/domain";
import type {
  DiagramAgentRuntime,
  DiagramGenerationRequest,
  EntityCollectionRequest
} from "./agentRuntime";
import { DiagramApplication } from "./application";
import { DiagramStore } from "./store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class ParallelRuntime implements DiagramAgentRuntime {
  active = 0;
  maxActive = 0;
  started = 0;
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });

  async collectEntities(
    _request: EntityCollectionRequest,
    _onProgress?: (progress: AgentProgress) => void
  ): Promise<CodeEntityDraft[]> {
    return [{
      handle: "worker",
      label: "Worker",
      category: "operation",
      summary: "Runs one job.",
      sourceRanges: [{ path: "fixture.ts", startLine: 1, endLine: 1, symbol: "worker" }]
    }];
  }

  async generateDiagram(request: DiagramGenerationRequest): Promise<DiagramDraft> {
    this.active += 1;
    this.started += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.started === request.total) this.release();
    await this.gate;
    this.active -= 1;
    return {
      name: `Worker ${request.slot}`,
      ascii: `[worker ${request.slot}]`,
      codeEntityIds: request.allowedCodeEntityIds.slice(0, 1),
      derivedFromDiagramIds: []
    };
  }

  dispose(): void {}
}

describe("DiagramApplication", () => {
  it("collects, finalizes, and generates one diagram per parallel agent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-app-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
    const runtime = new ParallelRuntime();
    const application = new DiagramApplication(new DiagramStore(root), runtime);
    const set = await application.createDiagramSet({
      path: root,
      name: "Worker flow",
      prompt: "Show the worker"
    });
    await application.collectCodeEntities(set.id);
    let workspace = await application.finalizeCodeEntities(set.id);
    const entitySet = workspace.codeEntitySets[set.codeEntitiesSetId];
    workspace = await application.generate(set.id, {
      prompt: "Show @entity/worker",
      selectedCodeEntityIds: [entitySet.entities[0].id],
      count: 3
    });
    expect(runtime.maxActive).toBe(3);
    expect(workspace.diagramSets[0].diagramIds).toHaveLength(3);
    expect(Object.values(workspace.agentRuns).filter((run) => run.kind === "generate-one-diagram"))
      .toHaveLength(3);
    const diagramId = workspace.diagramSets[0].diagramIds[0];
    const originalHandle = workspace.diagrams[diagramId].handle;
    workspace = await application.renameDiagram(set.id, diagramId, "Renamed worker flow");
    expect(workspace.diagrams[diagramId].name).toBe("Renamed worker flow");
    expect(workspace.diagrams[diagramId].handle).toBe(originalHandle);
    await expect(application.renameDiagram(set.id, diagramId, "   ")).rejects.toThrow(/name is required/);
    workspace = await application.archiveDiagram(set.id, diagramId);
    expect(workspace.diagrams[diagramId].archivedAt).toBeTruthy();
    const archivedArtifact = JSON.parse(await readFile(path.join(
      root,
      ".diagrams",
      "diagram-sets",
      set.id,
      "diagrams",
      `${diagramId}.json`
    ), "utf8")) as { id: string; archivedAt?: string };
    expect(archivedArtifact).toMatchObject({ id: diagramId, archivedAt: workspace.diagrams[diagramId].archivedAt });
    await expect(application.renameDiagram(set.id, diagramId, "Hidden rename"))
      .rejects.toThrow(/archived diagrams/);
    await expect(application.generate(set.id, {
      prompt: `Use @diagram/${originalHandle}`,
      selectedCodeEntityIds: [],
      count: 1
    })).rejects.toThrow(/unknown prompt reference/);
  });
});
