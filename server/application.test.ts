import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentProgress,
  ArtifactEditDraft,
  CodeEntityDraft,
  DiagramElementMappingDraft,
  GeneratedArtifactDraft
} from "../src/domain";
import type {
  ArtifactGenerationRequest,
  ArtifactEditRequest,
  ArtifactEntityMappingRequest,
  DiagramAgentRuntime,
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
  requestedModels: string[] = [];
  requestedPromptConfigIds: string[] = [];
  requestedSystemPrompts: string[] = [];
  mappingDrafts?: DiagramElementMappingDraft[];
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

  async generateArtifact(request: ArtifactGenerationRequest): Promise<GeneratedArtifactDraft> {
    this.requestedModels.push(request.promptConfig.modelId);
    this.requestedPromptConfigIds.push(request.promptConfig.id);
    this.requestedSystemPrompts.push(request.promptConfig.systemPrompt.rendered);
    this.active += 1;
    this.started += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.started === request.total) this.release();
    await this.gate;
    this.active -= 1;
    return {
      name: `Worker ${request.slot}`,
      ascii: `[worker ${request.slot}]`,
      codeEntityIds: request.allowedCodeEntityIds.slice(0, 1)
    };
  }

  async editArtifact(request: ArtifactEditRequest): Promise<ArtifactEditDraft> {
    let ascii = request.currentAscii;
    for (const marker of request.markers) ascii = ascii.replace(marker.character, marker.originalCharacter);
    return { ascii: `${ascii}\n[edited]` };
  }

  async mapArtifactEntities(
    request: ArtifactEntityMappingRequest
  ): Promise<DiagramElementMappingDraft[]> {
    if (this.mappingDrafts) return this.mappingDrafts;
    const entity = request.codeEntities[0];
    const lineIndex = request.ascii.split("\n").findIndex((line) => line.includes("worker"));
    if (!entity || lineIndex < 0) return [];
    const startColumn = request.ascii.split("\n")[lineIndex].indexOf("worker") + 1;
    return [{
      entityId: entity.id,
      sourceRangeIndex: 0,
      line: lineIndex + 1,
      startColumn,
      endColumn: startColumn + "worker".length - 1
    }];
  }

  dispose(): void {}
}

describe("DiagramApplication", () => {
  it("generates three initial diagrams immediately after collection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-initialize-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
    const runtime = new ParallelRuntime();
    const application = new DiagramApplication(new DiagramStore(root), runtime);
    const set = await application.createDiagramSet({
      path: root,
      name: "Initial worker flow",
      prompt: "Show the worker"
    });

    await application.collectCodeEntities(set.id);
    const workspace = await application.generateInitialDiagrams(set.id);

    expect(workspace.codeEntitySets[set.codeEntitiesSetId].status).toBe("finalized");
    expect(workspace.diagramSets[0].readiness).toBe("ready");
    expect(workspace.diagramSets[0].diagramIds).toHaveLength(3);
    expect(runtime.requestedModels).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-sol",
      "gpt-5.6-sol"
    ]);
  });

  it("persists reversible edit sessions and publishes edited copies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-edit-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
    const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());
    const set = await application.createDiagramSet({ path: root, name: "Edits", prompt: "Edit it" });
    await application.collectCodeEntities(set.id);
    let workspace = await application.workspace();
    workspace = await application.importArtifact(workspace.project!.id, {
      diagramSetId: set.id,
      artifactKind: "diagram",
      name: "Base flow",
      ascii: "[base]"
    });
    const sourceId = workspace.diagramSets[0].diagramIds[0];

    workspace = await application.createEditSession(set.id, "diagram", sourceId);
    const sessionId = workspace.diagramSets[0].editSessionIds[0];
    workspace = await application.manualEdit(set.id, sessionId, "[manual]");
    expect(workspace.editSessions[sessionId]).toMatchObject({
      workingAscii: "[manual]",
      operationCursor: 1,
      status: "active"
    });
    const marked = await application.placeEditMarker(set.id, sessionId, 1, 2);
    expect(marked.markerToken).toBe("@`");
    expect(marked.workspace.editSessions[sessionId].workingAscii).toBe("[`anual]");
    workspace = await application.undoEdit(set.id, sessionId);
    expect(workspace.editSessions[sessionId].workingAscii).toBe("[manual]");
    workspace = await application.redoEdit(set.id, sessionId);
    expect(workspace.editSessions[sessionId].workingAscii).toBe("[`anual]");
    workspace = await application.llmEdit(set.id, sessionId, "Finish near @`", "gpt-5.6-sol");
    expect(workspace.editSessions[sessionId].workingAscii).toBe("[manual]\n[edited]");
    expect(workspace.editSessions[sessionId].operations.at(-1)?.modelId).toBe("gpt-5.6-sol");

    workspace = await application.finishEdit(set.id, sessionId);
    const session = workspace.editSessions[sessionId];
    const output = workspace.diagrams[session.outputArtifactId!];
    expect(session.status).toBe("committed");
    expect(output).toMatchObject({
      origin: "edited",
      editSessionId: sessionId,
      derivedFromDiagramIds: [sourceId],
      ascii: "[manual]\n[edited]"
    });
    expect(workspace.diagrams[sourceId].ascii).toBe("[base]");
  });

  it("imports Diagrams and DiagramComponents into a Project DiagramSet", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-import-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
    const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());
    const set = await application.createDiagramSet({
      path: root,
      name: "Imported artifacts",
      prompt: "Show imported state"
    });
    await application.collectCodeEntities(set.id);
    let workspace = await application.workspace();
    const projectId = workspace.project!.id;
    const entityId = workspace.codeEntitySets[set.codeEntitiesSetId].entities[0].id;

    workspace = await application.importArtifact(projectId, {
      diagramSetId: set.id,
      artifactKind: "diagram",
      name: "Pursuer update",
      ascii: "+----------+\n| Pursuer  |\n+----------+\n",
      codeEntityIds: [entityId]
    });
    const diagramId = workspace.diagramSets[0].diagramIds[0];
    expect(workspace.diagrams[diagramId]).toMatchObject({
      name: "Pursuer update",
      handle: "pursuer-update",
      ascii: "+----------+\n| Pursuer  |\n+----------+",
      origin: "imported",
      codeEntityIds: [entityId],
      derivedFromDiagramIds: []
    });
    expect(workspace.diagrams[diagramId].producedByRunId).toBeUndefined();

    workspace = await application.importArtifact(projectId, {
      diagramSetId: set.id,
      artifactKind: "diagram-component",
      name: "Pursuer update",
      ascii: "dynamics -- updates --> Pursuer"
    });
    const componentId = workspace.diagramSets[0].diagramComponentIds[0];
    expect(workspace.diagramComponents[componentId]).toMatchObject({
      handle: "pursuer-update",
      origin: "imported",
      codeEntityIds: [],
      derivedFromDiagramIds: [],
      derivedFromDiagramComponentIds: []
    });

    workspace = await application.importArtifact(projectId, {
      diagramSetId: set.id,
      artifactKind: "diagram",
      name: "Pursuer update",
      ascii: "[second]"
    });
    const secondDiagramId = workspace.diagramSets[0].diagramIds[1];
    expect(workspace.diagrams[secondDiagramId].handle).toBe("pursuer-update-2");
    await expect(readFile(path.join(
      root, ".diagrams", "diagram-sets", set.id, "diagrams", `${diagramId}.json`
    ), "utf8")).resolves.toContain('"origin": "imported"');
    await expect(readFile(path.join(
      root, ".diagrams", "diagram-sets", set.id, "diagram-components", `${componentId}.json`
    ), "utf8")).resolves.toContain('"origin": "imported"');

    await expect(application.importArtifact(projectId, {
      diagramSetId: set.id,
      artifactKind: "diagram",
      name: "Unicode",
      ascii: "└─ Pursuer"
    })).rejects.toThrow(/7-bit ASCII/);
    await expect(application.importArtifact(projectId, {
      diagramSetId: set.id,
      artifactKind: "diagram",
      name: "Unknown entity",
      ascii: "Pursuer",
      codeEntityIds: ["entity-elsewhere"]
    })).rejects.toThrow(/unavailable CodeEntity/);
    await expect(application.importArtifact("project-elsewhere", {
      diagramSetId: set.id,
      artifactKind: "diagram",
      name: "Wrong project",
      ascii: "Pursuer"
    })).rejects.toThrow(/unknown Project/);
  });

  it("collects and generates one diagram per parallel agent", async () => {
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
    let workspace = await application.workspace();
    const entitySet = workspace.codeEntitySets[set.codeEntitiesSetId];
    expect(entitySet.entities[0].sourceRanges[0].originalLines).toEqual([
      "export const worker = () => true;"
    ]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => false;\n", "utf8");
    await expect(application.sourceSnippet(set.id, entitySet.entities[0].id, 0))
      .resolves.toMatchObject({ lines: ["export const worker = () => true;"] });
    workspace = await application.generate(set.id, {
      prompt: "Show @entity/worker",
      selectedCodeEntityIds: [entitySet.entities[0].id],
      count: 3,
      outputKind: "diagram",
      modelId: "gpt-5.6-sol",
      promptProfileId: "flowFirst"
    });
    expect(runtime.maxActive).toBe(3);
    expect(runtime.requestedModels).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-sol",
      "gpt-5.6-sol"
    ]);
    const batch = workspace.generationBatches[workspace.diagramSets[0].generationBatchIds[0]];
    const promptConfig = workspace.generationPromptConfigs[batch.promptConfigId];
    expect(promptConfig).toMatchObject({
      modelId: "gpt-5.6-sol",
      instruction: "Show @entity/worker",
      systemPrompt: { profileId: "flowFirst" }
    });
    expect(promptConfig.systemPrompt.rendered).toContain(
      "Emphasize directional control and data flow."
    );
    expect(runtime.requestedPromptConfigIds).toEqual([
      promptConfig.id,
      promptConfig.id,
      promptConfig.id
    ]);
    expect(runtime.requestedSystemPrompts).toEqual([
      promptConfig.systemPrompt.rendered,
      promptConfig.systemPrompt.rendered,
      promptConfig.systemPrompt.rendered
    ]);
    expect(workspace.diagramSets[0].diagramIds).toHaveLength(3);
    expect(Object.values(workspace.agentRuns).filter((run) => run.kind === "generate-one-diagram"))
      .toHaveLength(3);
    const diagramId = workspace.diagramSets[0].diagramIds[0];
    expect(workspace.diagramSets[0].diagramIds.map(
      (id) => workspace.diagrams[id].generationPromptConfigId
    )).toEqual([promptConfig.id, promptConfig.id, promptConfig.id]);
    await expect(readFile(path.join(
      root,
      ".diagrams",
      "diagram-sets",
      set.id,
      "generation-prompts",
      `${promptConfig.id}.json`
    ), "utf8")).resolves.toContain('"profileId": "flowFirst"');
    const batchJson = await readFile(path.join(
      root,
      ".diagrams",
      "diagram-sets",
      set.id,
      "generation-batches",
      `${batch.id}.json`
    ), "utf8");
    expect(batchJson).toContain(`"promptConfigId": "${promptConfig.id}"`);
    expect(batchJson).not.toContain('"userPrompt"');
    expect(batchJson).not.toContain('"resolvedPrompt"');
    expect(batchJson).not.toContain('"promptReferences"');
    const diagramJson = await readFile(path.join(
      root,
      ".diagrams",
      "diagram-sets",
      set.id,
      "diagrams",
      `${diagramId}.json`
    ), "utf8");
    expect(diagramJson).toContain(`"generationPromptConfigId": "${promptConfig.id}"`);
    expect(diagramJson).not.toContain('"promptReferences"');
    const originalHandle = workspace.diagrams[diagramId].handle;
    workspace = await application.mapCodeEntities(set.id, "diagram", diagramId);
    expect(workspace.codeEntityMaps[diagramId]).toMatchObject({
      artifactKind: "diagram",
      artifactId: diagramId,
      mappings: [{
        entityId: entitySet.entities[0].id,
        sourceRangeIndex: 0,
        line: 1,
        startColumn: 2,
        endColumn: 7
      }]
    });
    expect(workspace.codeEntityMaps[diagramId].asciiSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(workspace.agentRuns).filter((run) => run.kind === "map-code-entities"))
      .toHaveLength(1);
    runtime.mappingDrafts = [{
      entityId: entitySet.entities[0].id,
      sourceRangeIndex: 0,
      line: 1,
      startColumn: 2,
      endColumn: 999
    }];
    await expect(application.mapCodeEntities(set.id, "diagram", diagramId))
      .rejects.toThrow(/outside the ASCII/);
    expect((await application.workspace()).codeEntityMaps[diagramId].mappings).toHaveLength(1);
    workspace = await application.captureDiagramComponent(set.id, diagramId, {
      startLine: 1,
      endLine: 1,
      startColumn: 1,
      endColumn: 10
    });
    const componentId = workspace.diagramSets[0].diagramComponentIds[0];
    const component = workspace.diagramComponents[componentId];
    expect(component).toMatchObject({
      ascii: "[worker 1]",
      origin: "selection",
      sourceDiagramId: diagramId,
      derivedFromDiagramIds: [diagramId]
    });
    workspace = await application.generate(set.id, {
      prompt: `Vary @component/${component.handle}`,
      selectedCodeEntityIds: [],
      count: 2,
      outputKind: "diagram-component"
    });
    expect(workspace.diagramSets[0].diagramIds).toHaveLength(3);
    expect(workspace.diagramSets[0].diagramComponentIds).toHaveLength(3);
    const generatedComponent = workspace.diagramComponents[
      workspace.diagramSets[0].diagramComponentIds[1]
    ];
    expect(generatedComponent.derivedFromDiagramComponentIds).toEqual([componentId]);
    expect(runtime.requestedModels.slice(-2)).toEqual(["gpt-5.6-sol", "gpt-5.6-sol"]);
    await expect(application.generate(set.id, {
      prompt: "Bad model",
      selectedCodeEntityIds: [],
      count: 1,
      outputKind: "diagram",
      modelId: "gpt-unknown"
    })).rejects.toThrow(/unsupported generation model/);
    workspace = await application.captureNestedDiagramComponent(set.id, componentId, {
      startLine: 1,
      endLine: 1,
      startColumn: 2,
      endColumn: 9
    });
    const nestedComponentId = workspace.diagramSets[0].diagramComponentIds.at(-1)!;
    expect(workspace.diagramComponents[nestedComponentId]).toMatchObject({
      ascii: "worker 1",
      origin: "selection",
      sourceDiagramId: diagramId,
      sourceDiagramComponentId: componentId,
      derivedFromDiagramIds: [diagramId],
      derivedFromDiagramComponentIds: [componentId]
    });
    workspace = await application.archiveDiagramComponent(set.id, componentId);
    expect(workspace.diagramComponents[componentId].archivedAt).toBeTruthy();
    const archivedComponentArtifact = JSON.parse(await readFile(path.join(
      root,
      ".diagrams",
      "diagram-sets",
      set.id,
      "diagram-components",
      `${componentId}.json`
    ), "utf8")) as { id: string; archivedAt?: string };
    expect(archivedComponentArtifact).toMatchObject({
      id: componentId,
      archivedAt: workspace.diagramComponents[componentId].archivedAt
    });
    await expect(application.captureNestedDiagramComponent(set.id, componentId, {
      startLine: 1,
      endLine: 1,
      startColumn: 1,
      endColumn: 1
    })).rejects.toThrow(/archived DiagramComponents/);
    await expect(application.generate(set.id, {
      prompt: `Use @component/${component.handle}`,
      selectedCodeEntityIds: [],
      count: 1,
      outputKind: "diagram-component"
    })).rejects.toThrow(/unknown prompt reference/);
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
      count: 1,
      outputKind: "diagram"
    })).rejects.toThrow(/unknown prompt reference/);
  });
});
