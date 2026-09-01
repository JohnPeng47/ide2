import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentProgress,
  ArtifactEditDraft,
  CodeEntityRecord,
  CodeEntityDraft,
  DiagramRecord,
  DiagramElementMappingDraft,
  GeneratedArtifactDraft
} from "../src/domain";
import type { CallGraphFocusRequest } from "../src/callGraphFocus";
import { generationPromptBindings } from "../src/prompt";
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
  requestedCodeEntityPromptConfigIds: string[] = [];
  requestedPromptConfigIds: string[] = [];
  requestedSystemPrompts: string[] = [];
  mappingDrafts?: DiagramElementMappingDraft[];
  entityDrafts?: CodeEntityDraft[];
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });

  async collectEntities(
    request: EntityCollectionRequest,
    _onProgress?: (progress: AgentProgress) => void
  ): Promise<CodeEntityDraft[]> {
    this.requestedCodeEntityPromptConfigIds.push(request.promptConfig.id);
    if (this.entityDrafts) return this.entityDrafts;
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
      codeEntityIds: request.allowedCodeEntityAliases.slice(0, 1).map(({ id }) => id),
      mappings: request.allowedCodeEntityAliases.slice(0, 1).map(({ id }) => ({
        entityId: id,
        sourceRangeIndex: 0,
        line: 1,
        startColumn: 2,
        endColumn: 7
      }))
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

class BatchMappingRuntime extends ParallelRuntime {
  activeMappings = 0;
  maxActiveMappings = 0;
  startedMappings = 0;
  private readonly releaseMappingGate: () => void;
  private readonly mappingGate: Promise<void>;

  constructor(
    private readonly simultaneousStarts: number,
    private readonly failingCall?: number
  ) {
    super();
    let release!: () => void;
    this.mappingGate = new Promise<void>((resolve) => { release = resolve; });
    this.releaseMappingGate = release;
  }

  override async mapArtifactEntities(
    request: ArtifactEntityMappingRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<DiagramElementMappingDraft[]> {
    this.activeMappings += 1;
    this.startedMappings += 1;
    const call = this.startedMappings;
    this.maxActiveMappings = Math.max(this.maxActiveMappings, this.activeMappings);
    onProgress?.({ status: "generating", message: `mapping ${request.artifactHandle}` });
    if (this.startedMappings === this.simultaneousStarts) this.releaseMappingGate();
    try {
      await this.mappingGate;
      if (call === this.failingCall) throw new Error("synthetic mapping failure");
      return await super.mapArtifactEntities(request);
    } finally {
      this.activeMappings -= 1;
    }
  }
}

async function createCallGraphFocusFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "new-diagram-call-graph-focus-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root]);
  await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
  execFileSync("git", ["-C", root, "add", "fixture.ts"]);
  execFileSync("git", [
    "-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com",
    "commit", "-qm", "fixture"
  ]);
  const store = new DiagramStore(root);
  const application = new DiagramApplication(store, new ParallelRuntime());
  const set = await application.createDiagramSet({ path: root, name: "Focus", prompt: "Focus" });
  const foreignEntity: CodeEntityRecord = {
    id: store.ids.codeEntity(),
    origin: {
      projectId: "project-foreign",
      diagramSetId: "set-foreign",
      codeEntitiesSetId: "entities-foreign"
    },
    handle: "foreign-worker",
    label: "Foreign worker",
    category: "operation",
    summary: "Runs foreign work.",
    sourceRanges: []
  };
  await store.addImportedCodeEntity(foreignEntity);
  const createdAt = new Date().toISOString();
  const recordOrigin = { projectId: set.projectId, diagramSetId: set.id };
  const source: DiagramRecord = {
    schemaVersion: 1,
    id: store.ids.diagram(),
    recordOrigin,
    diagramSetId: set.id,
    viewKind: "diagram",
    handle: "source",
    name: "Source",
    ascii: "source",
    codeEntityIds: [foreignEntity.id],
    origin: "generated",
    derivedFromDiagramIds: [],
    createdAt
  };
  await store.addDiagram(source);
  const callGraph: DiagramRecord = {
    schemaVersion: 1,
    id: store.ids.diagram(),
    recordOrigin,
    diagramSetId: set.id,
    viewKind: "call-graph",
    basedOnDiagramId: source.id,
    handle: "call-graph",
    name: "Call Graph",
    ascii: [
      "root",
      "+--> foreign_worker()",
      "|    [entity-foreign-worker]",
      "|    `--> internal step",
      "`--> unrelated sibling"
    ].join("\n"),
    codeEntityIds: [foreignEntity.id],
    origin: "generated",
    derivedFromDiagramIds: [],
    createdAt
  };
  await store.addDiagram(callGraph);
  await store.setFeaturedView(set.id, "call-graph", callGraph.id);
  const request: CallGraphFocusRequest = {
    version: 1,
    diagramSetId: set.id,
    sourceDiagram: { kind: "diagram", targetId: source.id, origin: recordOrigin },
    selectedCodeEntities: [{
      kind: "code-entity",
      targetId: foreignEntity.id,
      origin: foreignEntity.origin!
    }]
  };
  return { application, store, set, source, callGraph, foreignEntity, request };
}

describe("DiagramApplication", () => {
  it("materializes supplied ASCII only when every Diagram includes supplied CodeEntities", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-materialized-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), [
      "export function worker() {",
      "  return true;",
      "}"
    ].join("\n"), "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", [
      "-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com",
      "commit", "-qm", "fixture"
    ]);
    const runtime = new ParallelRuntime();
    const application = new DiagramApplication(new DiagramStore(root), runtime);

    const result = await application.createMaterializedDiagramSet({
      creationMode: "materialized",
      path: root,
      name: "Materialized",
      codeEntities: [{
        key: "worker",
        handle: "worker",
        label: "Worker",
        category: "operation",
        summary: "Runs one job.",
        sourceRanges: [{
          key: "worker-function",
          path: "fixture.ts",
          startLine: 1,
          endLine: 3,
          symbol: "worker"
        }]
      }],
      diagrams: [{
        key: "worker-flow",
        name: "Worker flow",
        ascii: "[worker]",
        codeEntityKeys: ["worker"],
        mappings: [{
          entityKey: "worker",
          sourceRangeKey: "worker-function",
          line: 1,
          startColumn: 2,
          endColumn: 7
        }]
      }],
      featuredViews: { diagram: "worker-flow" }
    });

    const set = result.workspace.diagramSets.find((candidate) => candidate.id === result.diagramSetId)!;
    const entitySet = result.workspace.codeEntitySets[set.codeEntitiesSetId];
    const diagram = result.workspace.diagrams[result.diagramIdsByKey["worker-flow"]];
    const mapping = result.workspace.codeEntityMaps[diagram.id];
    expect(set).toMatchObject({ creationMode: "materialized", readiness: "ready" });
    expect(set.featuredViewIds.diagram).toBe(diagram.id);
    expect(entitySet.status).toBe("finalized");
    expect(entitySet.promptConfigId).toBeUndefined();
    expect(entitySet.entities[0].sourceRanges[0].originalLines).toEqual([
      "export function worker() {", "  return true;", "}"
    ]);
    expect(diagram).toMatchObject({ origin: "materialized", codeEntityIds: [entitySet.entities[0].id] });
    expect(mapping).toMatchObject({ origin: "materialized", artifactId: diagram.id });
    expect(mapping.producedByRunId).toBeUndefined();
    expect(runtime.started).toBe(0);
    expect(result.workspace.agentRuns).toEqual({});
    expect(result.workspace.generationBatches).toEqual({});
  });

  it("rejects materialized ASCII without included CodeEntities", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-materialized-required-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());

    await expect(application.createMaterializedDiagramSet({
      creationMode: "materialized",
      path: root,
      name: "Missing entities",
      codeEntities: [],
      diagrams: [{ key: "empty", name: "Empty", ascii: "empty", codeEntityKeys: [] }]
    })).rejects.toThrow("requires at least one CodeEntity");
  });

  it("lists one live repository directory without exposing metadata or traversing links", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-file-listing-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await mkdir(path.join(root, "src", "nested"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(path.join(root, ".plan.toml"), "name = 'fixture'\n", "utf8");
    await writeFile(path.join(root, "ignored.txt"), "ignored but visible\n", "utf8");
    await writeFile(path.join(root, "src", "worker.ts"), "export const worker = true;\n", "utf8");
    await symlink("src", path.join(root, "linked-src"));
    execFileSync("git", ["-C", root, "add", ".gitignore", ".plan.toml", "src/worker.ts"]);
    execFileSync("git", [
      "-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com",
      "commit", "-qm", "fixture"
    ]);
    const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());
    const set = await application.createDiagramSet({ path: root, name: "Files", prompt: "Show files" });

    const rootListing = await application.listRepositoryDirectory(set.id, "");
    expect(rootListing.entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ["src", "directory"],
      [".gitignore", "file"],
      [".plan.toml", "file"],
      ["ignored.txt", "file"],
      ["linked-src", "file"]
    ]);
    expect(rootListing.entries.map((entry) => entry.name)).not.toContain(".git");
    expect(rootListing.entries.map((entry) => entry.name)).not.toContain(".diagrams");
    await expect(application.listRepositoryDirectory(set.id, "src"))
      .resolves.toMatchObject({
        directory: "src",
        entries: [
          { path: "src/nested", name: "nested", kind: "directory" },
          { path: "src/worker.ts", name: "worker.ts", kind: "file" }
        ]
      });
    await expect(application.listRepositoryDirectory(set.id, "linked-src"))
      .rejects.toThrow(/symbolic-link directories/);
    await expect(application.listRepositoryDirectory(set.id, "src/worker.ts"))
      .rejects.toThrow(/not a directory/);
    await expect(application.listRepositoryDirectory(set.id, "../src"))
      .rejects.toThrow(/invalid/);
    await expect(application.listRepositoryDirectory(set.id, root))
      .rejects.toThrow(/must be relative/);
  });

  it("creates and collects document evidence from an ordinary non-git directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-document-"));
    roots.push(root);
    await writeFile(path.join(root, "interview.txt"), "first claim\nsecond claim\n", "utf8");
    const runtime = new ParallelRuntime();
    runtime.entityDrafts = [{
      handle: "second-claim",
      label: "Second claim",
      category: "state",
      summary: "The interview makes a second claim.",
      sourceRanges: [{ path: "interview.txt", startLine: 2, endLine: 2 }]
    }];
    const application = new DiagramApplication(new DiagramStore(root), runtime, "document");
    const set = await application.createDiagramSet({
      path: root,
      name: "Interview",
      prompt: "Map the claims",
      domainProfileId: "document"
    });

    await application.collectCodeEntities(set.id);
    const workspace = await application.workspace();

    expect(workspace.project).toMatchObject({
      domainProfileId: "document",
      corpus: { kind: "filesystem-documents", root }
    });
    expect(workspace.codeEntitySets[set.codeEntitiesSetId].entities[0].sourceRanges[0])
      .toMatchObject({ path: "interview.txt", originalLines: ["second claim"] });
    const promptConfigId = workspace.codeEntitySets[set.codeEntitiesSetId].promptConfigId!;
    expect(workspace.codeEntityPromptConfigs[promptConfigId].contextPrompt.rendered)
      .toContain("Inspect the documents");
    await expect(application.generate(set.id, {
      prompt: "Show a repository tree",
      selectedCodeEntityIds: [],
      count: 1,
      outputKind: "diagram",
      viewKind: "dir-view"
    })).rejects.toThrow(/not available in the document domain/);
  });

  it("focuses a featured call graph using qualified imported CodeEntity identities", async () => {
    const { application, set, source, callGraph, foreignEntity, request } =
      await createCallGraphFocusFixture();

    await expect(application.callGraphFocus(request)).resolves.toEqual({
      version: 1,
      diagramSetId: set.id,
      sourceDiagram: request.sourceDiagram,
      callGraph: {
        kind: "diagram",
        targetId: callGraph.id,
        origin: callGraph.recordOrigin
      },
      callGraphName: callGraph.name,
      roots: [{
        id: "call-graph-line-1",
        label: "root",
        children: [{
          id: "call-graph-line-2",
          label: "foreign_worker()",
          codeEntity: {
            kind: "code-entity",
            targetId: foreignEntity.id,
            origin: foreignEntity.origin
          },
          children: [{ id: "call-graph-line-4", label: "internal step", children: [] }]
        }]
      }]
    });
  });

  it("validates call-graph focus versions, provenance, and artifact membership", async () => {
    const { application, store, set, source, callGraph, request, foreignEntity } =
      await createCallGraphFocusFixture();
    await expect(application.callGraphFocus({ ...request, version: 2 }))
      .rejects.toThrow(/unsupported call-graph focus request version/);
    await expect(application.callGraphFocus({
      ...request,
      sourceDiagram: { ...request.sourceDiagram, origin: { ...request.sourceDiagram.origin, projectId: "wrong" } }
    })).rejects.toThrow(/source Diagram provenance/);
    await expect(application.callGraphFocus({
      ...request,
      selectedCodeEntities: [{
        ...request.selectedCodeEntities[0],
        origin: { ...foreignEntity.origin!, codeEntitiesSetId: "wrong" }
      }]
    })).rejects.toThrow(/selected CodeEntity provenance/);

    await expect(application.callGraphFocus({
      ...request,
      sourceDiagram: { ...request.sourceDiagram, targetId: callGraph.id }
    })).rejects.toThrow(/source Diagram must have diagram viewKind/);

    await store.setFeaturedView(set.id, "call-graph", source.id);
    await expect(application.callGraphFocus(request)).rejects.toThrow(/call-graph viewKind/);

    await store.setFeaturedView(set.id, "call-graph");
    await expect(application.callGraphFocus(request)).rejects.toThrow(/no featured call graph/);
  });

  it("rejects a featured call graph based on another Diagram and selections outside its context", async () => {
    const { application, store, set, source, callGraph, request } = await createCallGraphFocusFixture();
    const otherSource: DiagramRecord = {
      ...source,
      id: store.ids.diagram(),
      handle: "other-source",
      name: "Other source"
    };
    await store.addDiagram(otherSource);
    const wrongBase: DiagramRecord = {
      ...callGraph,
      id: store.ids.diagram(),
      handle: "wrong-base",
      name: "Wrong base",
      basedOnDiagramId: otherSource.id
    };
    await store.addDiagram(wrongBase);
    await store.setFeaturedView(set.id, "call-graph", wrongBase.id);
    await expect(application.callGraphFocus(request)).rejects.toThrow(/based on another Diagram/);

    const absentEntity: CodeEntityRecord = {
      id: store.ids.codeEntity(),
      origin: {
        projectId: "project-absent",
        diagramSetId: "set-absent",
        codeEntitiesSetId: "entities-absent"
      },
      handle: "absent",
      label: "Absent",
      category: "operation",
      summary: "Not declared by these artifacts.",
      sourceRanges: []
    };
    await store.addImportedCodeEntity(absentEntity);
    await store.setFeaturedView(set.id, "call-graph", callGraph.id);
    await expect(application.callGraphFocus({
      ...request,
      selectedCodeEntities: [{ kind: "code-entity", targetId: absentEntity.id, origin: absentEntity.origin! }]
    })).rejects.toThrow(/not declared by the source Diagram/);

    const expandedSource: DiagramRecord = {
      ...source,
      id: store.ids.diagram(),
      handle: "expanded-source",
      name: "Expanded source",
      codeEntityIds: [request.selectedCodeEntities[0].targetId, absentEntity.id]
    };
    await store.addDiagram(expandedSource);
    const narrowGraph: DiagramRecord = {
      ...callGraph,
      id: store.ids.diagram(),
      handle: "narrow-graph",
      name: "Narrow graph",
      basedOnDiagramId: expandedSource.id
    };
    await store.addDiagram(narrowGraph);
    await store.setFeaturedView(set.id, "call-graph", narrowGraph.id);
    await expect(application.callGraphFocus({
      ...request,
      sourceDiagram: { ...request.sourceDiagram, targetId: expandedSource.id },
      selectedCodeEntities: [{ kind: "code-entity", targetId: absentEntity.id, origin: absentEntity.origin! }]
    })).rejects.toThrow(/not declared by the featured call graph/);
  });

  it("generates and independently stars call-graph and directory-view candidates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-aux-views-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
    const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());
    const set = await application.createDiagramSet({ path: root, name: "Aux views", prompt: "Show worker flow" });
    await application.collectCodeEntities(set.id);
    const entities = (await application.workspace()).codeEntitySets[set.codeEntitiesSetId].entities;

    await expect(application.generate(set.id, {
      prompt: "Show calls",
      selectedCodeEntityIds: entities.map((entity) => entity.id),
      count: 1,
      outputKind: "diagram",
      viewKind: "call-graph"
    })).rejects.toThrow(/star a main Diagram/);

    let workspace = await application.generate(set.id, {
      prompt: "Show architecture",
      selectedCodeEntityIds: entities.map((entity) => entity.id),
      count: 1,
      outputKind: "diagram",
      viewKind: "diagram"
    });
    const mainId = workspace.diagramSets[0].diagramIds[0];
    workspace = await application.setStarredDiagram(set.id, mainId, true);

    await expect(application.generate(set.id, {
      prompt: "Show files",
      selectedCodeEntityIds: entities.map((entity) => entity.id),
      count: 1,
      outputKind: "diagram",
      viewKind: "dir-view"
    })).rejects.toThrow(/star a Call Graph/);

    workspace = await application.generate(set.id, {
      prompt: "Show calls",
      selectedCodeEntityIds: entities.map((entity) => entity.id),
      count: 1,
      outputKind: "diagram",
      viewKind: "call-graph"
    });
    const callGraph = Object.values(workspace.diagrams).find((diagram) => diagram.viewKind === "call-graph")!;
    expect(callGraph).toMatchObject({ basedOnDiagramId: mainId, derivedFromDiagramIds: [] });
    const callConfig = workspace.generationPromptConfigs[callGraph.generationPromptConfigId!];
    expect(callConfig.references).toEqual([expect.objectContaining({ targetId: mainId })]);
    workspace = await application.setStarredDiagram(set.id, callGraph.id, true);

    workspace = await application.generate(set.id, {
      prompt: "Show files",
      selectedCodeEntityIds: entities.map((entity) => entity.id),
      count: 1,
      outputKind: "diagram",
      viewKind: "dir-view"
    });
    const dirView = Object.values(workspace.diagrams).find((diagram) => diagram.viewKind === "dir-view")!;
    const dirConfig = workspace.generationPromptConfigs[dirView.generationPromptConfigId!];
    expect(dirConfig.references.map((reference) => reference.targetId)).toEqual([mainId, callGraph.id]);
    workspace = await application.setStarredDiagram(set.id, dirView.id, true);
    expect(workspace.diagramSets[0].featuredViewIds).toEqual({
      diagram: mainId,
      "call-graph": callGraph.id,
      "dir-view": dirView.id
    });
    workspace = await application.archiveDiagram(set.id, callGraph.id);
    expect(workspace.diagramSets[0].featuredViewIds).toEqual({
      diagram: mainId,
      "dir-view": dirView.id
    });
  });

  it("blocks deletion during collection and removes a ready Diagram Set", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-delete-set-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
    const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());
    const set = await application.createDiagramSet({
      path: root,
      name: "Delete me",
      prompt: "Show the worker"
    });

    await expect(application.deleteDiagramSet(set.id)).rejects.toThrow(/collection is running/);
    await application.collectCodeEntities(set.id);
    const workspace = await application.deleteDiagramSet(set.id);
    expect(workspace.diagramSets).toEqual([]);
  });

  it("deletes built-in prompt templates and preserves a generation fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-delete-prompt-template-"));
    roots.push(root);
    const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());

    await application.deleteSystemPromptTemplate("default");
    expect((await application.systemPromptTemplates()).map((template) => template.id))
      .not.toContain("default");
    await expect(application.resolveSystemPromptTemplate()).resolves.toMatchObject({
      id: "structure-first"
    });

    await application.deleteSystemPromptTemplate("flow-first");
    await application.deleteSystemPromptTemplate("compact");
    expect((await application.systemPromptTemplates()).map((template) => template.id))
      .toEqual(["structure-first"]);
    await expect(application.deleteSystemPromptTemplate("structure-first"))
      .rejects.toThrow(/at least one system prompt template is required/);
  });

  it("manages CodeEntity criteria templates through the prompt-template interface", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-code-entity-prompts-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());
    await application.createDiagramSet({ path: root, name: "Prompt settings", prompt: "Map prompts" });
    const builtIn = (await application.codeEntityPromptTemplates())[0];

    let workspace = await application.saveCodeEntityPromptTemplate({
      label: "Focused entities",
      description: "A custom criteria pair",
      prompts: {
        "code-entity-identification": "Concepts with public boundaries.",
        "code-entity-compaction": "Continuous source with explicit outputs."
      }
    });
    expect(workspace.codeEntityPromptTemplates["focused-entities"]).toMatchObject({
      builtIn: false,
      version: 1
    });

    workspace = await application.saveCodeEntityPromptTemplate({
      id: builtIn.id,
      label: builtIn.label,
      description: builtIn.description,
      prompts: {
        ...builtIn.prompts,
        "code-entity-compaction": "Temporarily changed criteria."
      }
    });
    expect(workspace.codeEntityPromptTemplates[builtIn.id].version).toBe(2);
    workspace = await application.resetCodeEntityPromptTemplate(builtIn.id);
    expect(workspace.codeEntityPromptTemplates[builtIn.id]).toMatchObject({
      builtIn: true,
      version: 3,
      prompts: {
        "code-entity-compaction": expect.stringContaining("values = point.values")
      }
    });

    workspace = await application.deleteCodeEntityPromptTemplate("focused-entities");
    expect(Object.keys(workspace.codeEntityPromptTemplates)).toEqual([builtIn.id]);
    await expect(application.deleteCodeEntityPromptTemplate(builtIn.id))
      .rejects.toThrow(/at least one CodeEntity prompt template is required/);
  });

  it("clips EOF-spanning entity ranges to the captured source", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-source-range-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
    const runtime = new ParallelRuntime();
    runtime.entityDrafts = [{
      handle: "worker",
      label: "Worker",
      category: "operation",
      summary: "Runs one job.",
      sourceRanges: [{ path: "fixture.ts", startLine: 1, endLine: 99, symbol: "worker" }]
    }];
    const application = new DiagramApplication(new DiagramStore(root), runtime);
    const set = await application.createDiagramSet({ path: root, name: "Range", prompt: "Show it" });

    await application.collectCodeEntities(set.id);

    const entity = (await application.workspace()).codeEntitySets[set.codeEntitiesSetId].entities[0];
    expect(entity.sourceRanges[0]).toMatchObject({ startLine: 1, endLine: 2 });
    expect(entity.sourceRanges[0].originalLines).toEqual(["export const worker = true;", ""]);
  });

  it("generates three initial diagrams immediately after collection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-initialize-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
    const runtime = new ParallelRuntime();
    const application = new DiagramApplication(new DiagramStore(root), runtime);
    await expect(application.resolveSystemPromptTemplate("missing-template"))
      .rejects.toThrow(/available templates: default, structure-first, flow-first, compact/);
    const set = await application.createDiagramSet({
      path: root,
      name: "Initial worker flow",
      prompt: "Show the worker"
    });

    await application.collectCodeEntities(set.id);
    let workspace = await application.generateInitialDiagrams(set.id, {
      promptTemplateId: "flow-first",
      runReferencePrompt: true
    });

    expect(workspace.codeEntitySets[set.codeEntitiesSetId].status).toBe("finalized");
    const codeEntityPromptConfigId = workspace.codeEntitySets[set.codeEntitiesSetId].promptConfigId!;
    expect(runtime.requestedCodeEntityPromptConfigIds).toEqual([codeEntityPromptConfigId]);
    expect(workspace.codeEntityPromptConfigs[codeEntityPromptConfigId]).toMatchObject({
      template: { profileId: "default-code-entities", profileVersion: 1 },
      identificationCriteria: { rendered: expect.stringContaining("A useful CodeEntity") },
      compactionCriteria: { rendered: expect.stringContaining("values = point.values") }
    });
    expect(workspace.codeEntityPromptTemplates["default-code-entities"].prompts)
      .toHaveProperty("code-entity-compaction");
    expect(workspace.diagramSets[0].readiness).toBe("ready");
    expect(workspace.diagramSets[0].diagramIds).toHaveLength(3);
    expect(workspace.diagramSets[0].diagramIds.every((id) => (
      workspace.codeEntityMaps[id]?.producedByRunId === workspace.diagrams[id].producedByRunId
    ))).toBe(true);
    const initialBatch = workspace.generationBatches[workspace.diagramSets[0].generationBatchIds[0]];
    const initialPromptConfig = workspace.generationPromptConfigs[initialBatch.promptConfigId];
    expect(initialPromptConfig.systemPrompt)
      .toMatchObject({ profileId: "flow-first", profileVersion: 1 });
    expect(initialPromptConfig.referencePrompt).toMatchObject({ instruction: "", references: [] });
    expect(initialPromptConfig.mappingPrompt.template).toContain("system-managed final artifact");
    expect(runtime.requestedModels).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-sol",
      "gpt-5.6-sol"
    ]);
    const styleDiagram = workspace.diagrams[workspace.diagramSets[0].diagramIds[0]];
    workspace = await application.generate(set.id, {
      prompt: "Show another worker view",
      referencePrompt: `Use the visual style of @diagram/${styleDiagram.handle}`,
      selectedCodeEntityIds: [workspace.codeEntitySets[set.codeEntitiesSetId].entities[0].id],
      count: 1,
      outputKind: "diagram",
      modelId: "gpt-5.6-sol",
      promptProfileId: "flow-first"
    });
    const referenceBatchId = workspace.diagramSets[0].generationBatchIds.at(-1)!;
    const referenceConfig = workspace.generationPromptConfigs[
      workspace.generationBatches[referenceBatchId].promptConfigId
    ];
    expect(referenceConfig.references).toEqual([]);
    expect(referenceConfig.referencePrompt).toMatchObject({
      instruction: `Use the visual style of @diagram/${styleDiagram.handle}`,
      references: [expect.objectContaining({ targetId: styleDiagram.id })]
    });
    const generatedWithReference = workspace.diagramSets[0].diagramIds.at(-1)!;
    expect(workspace.codeEntityMaps[generatedWithReference]?.producedByRunId)
      .toBe(workspace.diagrams[generatedWithReference].producedByRunId);
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
    workspace = await application.importArtifact({
      artifactKind: "diagram",
      name: "Base flow",
      ascii: "[base]"
    });
    const sourceId = workspace.globalImports.diagramIds[0];

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

  it("imports Diagrams and DiagramComponents into the global artifact library", async () => {
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
    workspace = await application.importArtifact({
      artifactKind: "diagram",
      name: "Pursuer update",
      ascii: "+----------+\n| Pursuer  |\n+----------+\n"
    });
    const diagramId = workspace.globalImports.diagramIds[0];
    expect(workspace.diagramSets[0].diagramIds).toEqual([]);
    expect(workspace.diagrams[diagramId]).toMatchObject({
      name: "Pursuer update",
      handle: "pursuer-update",
      ascii: "+----------+\n| Pursuer  |\n+----------+",
      origin: "imported",
      diagramSetId: "global-imports",
      codeEntityIds: [],
      derivedFromDiagramIds: []
    });
    expect(workspace.diagrams[diagramId].producedByRunId).toBeUndefined();

    workspace = await application.importArtifact({
      artifactKind: "diagram-component",
      name: "Pursuer update",
      ascii: "dynamics -- updates --> Pursuer"
    });
    const componentId = workspace.globalImports.diagramComponentIds[0];
    expect(workspace.diagramComponents[componentId]).toMatchObject({
      handle: "pursuer-update",
      origin: "imported",
      codeEntityIds: [],
      derivedFromDiagramIds: [],
      derivedFromDiagramComponentIds: []
    });

    workspace = await application.importArtifact({
      artifactKind: "diagram",
      name: "Pursuer update",
      ascii: "[second]"
    });
    const secondDiagramId = workspace.globalImports.diagramIds[1];
    expect(workspace.diagrams[secondDiagramId].handle).toBe("pursuer-update-2");
    workspace = await application.setStarredDiagram(set.id, diagramId, true);
    expect(workspace.diagramSets[0].featuredViewIds.diagram).toBe(diagramId);
    const persistedSet = JSON.parse(await readFile(path.join(
      root, ".diagrams", "diagram-sets", set.id, "diagram-set.json"
    ), "utf8")) as { featuredViewIds?: { diagram?: string } };
    expect(persistedSet.featuredViewIds?.diagram).toBe(diagramId);
    workspace = await application.setStarredDiagram(set.id, secondDiagramId, true);
    expect(workspace.diagramSets[0].featuredViewIds.diagram).toBe(secondDiagramId);
    workspace = await application.setStarredDiagram(set.id, diagramId, false);
    expect(workspace.diagramSets[0].featuredViewIds.diagram).toBe(secondDiagramId);
    workspace = await application.setStarredDiagram(set.id, secondDiagramId, false);
    expect(workspace.diagramSets[0].featuredViewIds.diagram).toBeUndefined();
    await expect(application.setStarredDiagram(set.id, "diagram-missing", true))
      .rejects.toThrow(/unknown diagram/);
    await expect(readFile(path.join(
      root, ".diagrams", "imports", "diagrams", `${diagramId}.json`
    ), "utf8")).resolves.toContain('"origin": "imported"');
    await expect(readFile(path.join(
      root, ".diagrams", "imports", "diagram-components", `${componentId}.json`
    ), "utf8")).resolves.toContain('"origin": "imported"');

    const selectedCodeEntityIds = workspace.codeEntitySets[set.codeEntitiesSetId].entities
      .map((entity) => entity.id);
    workspace = await application.generate(set.id, {
      prompt: "Use @diagram/pursuer-update as the visual reference.",
      selectedCodeEntityIds,
      count: 1,
      outputKind: "diagram"
    });
    const batchId = workspace.diagramSets[0].generationBatchIds.at(-1)!;
    const config = workspace.generationPromptConfigs[workspace.generationBatches[batchId].promptConfigId];
    expect(config.references).toContainEqual(expect.objectContaining({
      kind: "diagram",
      targetId: diagramId,
      handle: "pursuer-update"
    }));
    expect(workspace.diagrams[workspace.generationBatches[batchId].outputDiagramIds[0]]
      .derivedFromDiagramIds).toEqual([diagramId]);

    workspace = await application.generate(set.id, {
      prompt: "Preserve this history mention: @diagram/pursuer-update",
      selectedCodeEntityIds,
      count: 1,
      outputKind: "diagram",
      referenceSelections: [{
        kind: "diagram",
        targetId: diagramId,
        token: "@diagram/pursuer-update",
        handle: "pursuer-update",
        included: false
      }],
      derivation: {
        sourceArtifactKind: "diagram",
        sourceArtifactId: diagramId,
        promptCorrection: "Reduce the imported detail."
      }
    });
    const omittedBatchId = workspace.diagramSets[0].generationBatchIds.at(-1)!;
    const omittedBatch = workspace.generationBatches[omittedBatchId];
    const omittedConfig = workspace.generationPromptConfigs[omittedBatch.promptConfigId];
    expect(omittedConfig.references).toEqual([]);
    expect(omittedConfig.omittedReferences).toContainEqual(expect.objectContaining({
      kind: "diagram",
      targetId: diagramId
    }));
    expect(omittedConfig.derivation).toBeUndefined();
    expect(workspace.diagrams[omittedBatch.outputDiagramIds[0]].derivedFromDiagramIds).toEqual([]);

    await expect(application.importArtifact({
      artifactKind: "diagram",
      name: "Unicode",
      ascii: "└─ Pursuer"
    })).rejects.toThrow(/7-bit ASCII/);

    workspace = await application.renameImportedDiagram(diagramId, "Renamed global diagram");
    expect(workspace.diagrams[diagramId].name).toBe("Renamed global diagram");
    workspace = await application.setStarredDiagram(set.id, diagramId, true);
    workspace = await application.archiveImportedDiagram(diagramId);
    expect(workspace.diagrams[diagramId].archivedAt).toBeTruthy();
    expect(workspace.diagramSets[0].featuredViewIds.diagram).toBeUndefined();
    await expect(application.setStarredDiagram(set.id, diagramId, true))
      .rejects.toThrow(/archived diagrams/);
    workspace = await application.archiveImportedDiagramComponent(componentId);
    expect(workspace.diagramComponents[componentId].archivedAt).toBeTruthy();
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
    await writeFile(
      path.join(root, "fixture.ts"),
      "export const worker = () => false;\nexport const surrounding = true;\n",
      "utf8"
    );
    await expect(application.sourceSnippet(set.id, entitySet.entities[0].id, 0))
      .resolves.toMatchObject({
        startLine: 1,
        lines: [
          "export const worker = () => true;",
          "export const surrounding = true;",
          ""
        ]
      });
    const flowTemplate = workspace.systemPromptTemplates["flow-first"];
    const diagramPrompts = generationPromptBindings("diagram");
    workspace = await application.saveSystemPromptTemplate({
      id: flowTemplate.id,
      label: flowTemplate.label,
      description: "A persisted test edit",
      prompts: {
        ...flowTemplate.prompts,
        [diagramPrompts.system]: { template: "CUSTOM SYSTEM MAP." },
        "future-higher-system": { template: "Generate a higher-level view." }
      }
    });
    expect(workspace.systemPromptTemplates["flow-first"]).toMatchObject({
      version: 2,
      description: "A persisted test edit"
    });
    expect(workspace.systemPromptTemplates["flow-first"].prompts[diagramPrompts.mapping])
      .toEqual(flowTemplate.prompts[diagramPrompts.mapping]);
    expect(workspace.systemPromptTemplates["flow-first"].prompts["future-higher-system"])
      .toEqual({ template: "Generate a higher-level view." });
    expect((await new DiagramStore(root).loadWorkspace()).systemPromptTemplates["flow-first"])
      .toMatchObject({ version: 2, description: "A persisted test edit" });
    workspace = await application.generate(set.id, {
      prompt: "Show @entity/worker",
      selectedCodeEntityIds: [entitySet.entities[0].id],
      count: 3,
      outputKind: "diagram",
      modelId: "gpt-5.6-sol",
      promptProfileId: "flow-first"
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
      systemPrompt: { profileId: "flow-first" }
    });
    expect(promptConfig.systemPrompt).toMatchObject({ profileVersion: 2 });
    expect(promptConfig.systemPrompt.rendered).toBe(
      "CUSTOM SYSTEM MAP.\n\nSystem-managed output requirements (read-only):\nReturn exactly one Diagram.\nFinish this turn by calling submit_diagram exactly once."
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
    ), "utf8")).resolves.toContain('"profileId": "flow-first"');
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
    expect(batch.diagramCandidateBatchId).toBeTruthy();
    const candidateBatchId = batch.diagramCandidateBatchId!;
    expect(workspace.diagramCandidateBatches[candidateBatchId]).toMatchObject({
      generationBatchId: batch.id,
      diagramIds: workspace.diagramSets[0].diagramIds,
      rankings: {}
    });
    await expect(application.rankDiagramCandidates(set.id, candidateBatchId, [
      { diagramId, rank: 1 }
    ])).rejects.toThrow(/rank every diagram candidate/);
    await expect(application.rankDiagramCandidates(set.id, candidateBatchId,
      workspace.diagramSets[0].diagramIds.map((id) => ({ diagramId: id, rank: 0 }))))
      .rejects.toThrow(/positive integers/);
    workspace = await application.rankDiagramCandidates(set.id, candidateBatchId,
      workspace.diagramSets[0].diagramIds.map((id, index) => ({
        diagramId: id,
        rank: index < 2 ? 1 : 2
      })));
    expect(workspace.diagramCandidateBatches[candidateBatchId].rankings).toEqual({
      [workspace.diagramSets[0].diagramIds[0]]: 1,
      [workspace.diagramSets[0].diagramIds[1]]: 1,
      [workspace.diagramSets[0].diagramIds[2]]: 2
    });
    expect((await new DiagramStore(root).loadWorkspace()).diagramCandidateBatches[candidateBatchId]
      .rankings).toEqual(workspace.diagramCandidateBatches[candidateBatchId].rankings);
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
    const mappingRun = Object.values(workspace.agentRuns)
      .find((run) => run.kind === "map-code-entities")!;
    expect(workspace.spatialProgress?.[mappingRun.id]).toMatchObject({
      status: "complete",
      scope: {
        representationKind: "diagram",
        revision: { artifactId: diagramId },
        target: { kind: "artifact" }
      }
    });
    expect(workspace.spatialProgress?.[mappingRun.id].completedElementIds).toHaveLength(1);

    workspace = await application.addHighlight({
      diagramSetId: set.id,
      artifactKind: "diagram",
      artifactId: diagramId,
      mappingId: workspace.codeEntityMaps[diagramId].mappings[0].id
    });
    expect(workspace.highlights?.[0]).toMatchObject({
      schemaVersion: 2,
      representationKind: "diagram",
      artifactId: diagramId,
      mappingId: workspace.codeEntityMaps[diagramId].mappings[0].id,
      evidence: { evidenceId: entitySet.entities[0].id },
      documentExcerpt: { path: "fixture.ts" }
    });

    const secondDiagramId = workspace.diagramSets[0].diagramIds[1];
    workspace = await application.saveRepresentationGraph(set.id, {
      id: "graph-main",
      projectId: set.projectId,
      diagramSetId: set.id,
      layers: [diagramId, secondDiagramId].map((artifactId, index) => ({
        id: `layer-${index + 1}`,
        label: `Layer ${index + 1}`,
        informationRank: index,
        representationKind: "diagram" as const,
        artifactRevision: {
          artifactId,
          asciiSha256: createHash("sha256").update(workspace.diagrams[artifactId].ascii).digest("hex")
        }
      })),
      transitions: [{ id: "transition-main", fromLayerId: "layer-1", toLayerId: "layer-2" }]
    });
    expect(workspace.representationGraphs?.[set.id].layers.map((layer) => layer.id))
      .toEqual(["layer-1", "layer-2"]);
    workspace = await application.addRepresentationFeedback(set.id, {
      target: { kind: "transition", transitionId: "transition-main" },
      comment: "Keep the intermediate layer more compact."
    });
    expect(workspace.representationGraphs?.[set.id].feedback?.[0].comment)
      .toContain("intermediate layer");
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
    expect(workspace.diagramCandidateBatches[candidateBatchId].rankings[diagramId]).toBe(1);
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

  it("maps an artifact batch with bounded concurrency and isolates failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-map-batch-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
    execFileSync("git", ["-C", root, "add", "fixture.ts"]);
    execFileSync("git", [
      "-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com",
      "commit", "-qm", "fixture"
    ]);
    const runtime = new BatchMappingRuntime(2, 2);
    const application = new DiagramApplication(new DiagramStore(root), runtime);
    const set = await application.createDiagramSet({
      path: root,
      name: "Mapping batch",
      prompt: "Show the worker"
    });
    await application.collectCodeEntities(set.id);
    const entities = (await application.workspace()).codeEntitySets[set.codeEntitiesSetId].entities;
    const generated = await application.generate(set.id, {
      prompt: "Show the worker",
      selectedCodeEntityIds: entities.map((entity) => entity.id),
      count: 3,
      outputKind: "diagram"
    });
    const diagramIds = generated.diagramSets[0].diagramIds;
    const targets = diagramIds.map((artifactId) => ({
      artifactKind: "diagram" as const,
      artifactId
    }));
    const progressEvents: Array<{ artifactId?: string; status?: string }> = [];

    const result = await application.mapCodeEntitiesBatch(
      set.id,
      targets,
      2,
      (event) => {
        if (event.type === "progress") progressEvents.push(event);
      }
    );

    expect(runtime.maxActiveMappings).toBe(2);
    expect(result.results.map((item) => item.status)).toEqual([
      "complete", "failed", "complete"
    ]);
    expect(result.results[1].error).toBe("synthetic mapping failure");
    expect(progressEvents.filter((event) => event.status === "generating")
      .map((event) => event.artifactId)).toEqual(diagramIds);
    expect(Object.keys(result.workspace.codeEntityMaps)).toEqual(expect.arrayContaining([
      diagramIds[0], diagramIds[2]
    ]));
    expect(result.workspace.codeEntityMaps[diagramIds[1]]).toBeDefined();
    const preservedRun = result.workspace.agentRuns[
      result.workspace.codeEntityMaps[diagramIds[1]].producedByRunId!
    ];
    expect(preservedRun.kind).toBe("generate-one-diagram");
    const mappingRuns = Object.values(result.workspace.agentRuns)
      .filter((run) => run.kind === "map-code-entities");
    expect(mappingRuns).toHaveLength(3);
    expect(mappingRuns.map((run) => run.status).sort()).toEqual([
      "complete", "complete", "failed"
    ]);
    const attachedRunIds = result.workspace.diagramSets[0].agentRunIds;
    expect(mappingRuns.every((run) => attachedRunIds.includes(run.id))).toBe(true);
  });

  it("round-trips a mapped artifact with foreign CodeEntity dependencies", async () => {
    const prepare = async (prefix: string) => {
      const root = await mkdtemp(path.join(tmpdir(), prefix));
      roots.push(root);
      execFileSync("git", ["init", "-q", root]);
      await writeFile(path.join(root, "fixture.ts"), "export const worker = () => true;\n", "utf8");
      execFileSync("git", ["-C", root, "add", "fixture.ts"]);
      execFileSync("git", [
        "-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com",
        "commit", "-qm", "fixture"
      ]);
      const application = new DiagramApplication(new DiagramStore(root), new ParallelRuntime());
      const set = await application.createDiagramSet({ path: root, name: prefix, prompt: "Show worker" });
      await application.collectCodeEntities(set.id);
      return { application, set };
    };

    const source = await prepare("new-diagram-bundle-source-");
    const sourceEntities = (await source.application.workspace())
      .codeEntitySets[source.set.codeEntitiesSetId].entities;
    let sourceWorkspace = await source.application.generate(source.set.id, {
      prompt: "Show worker",
      selectedCodeEntityIds: sourceEntities.map((entity) => entity.id),
      count: 1,
      outputKind: "diagram"
    });
    const sourceDiagramId = sourceWorkspace.diagramSets[0].diagramIds[0];
    sourceWorkspace = await source.application.mapCodeEntities(
      source.set.id,
      "diagram",
      sourceDiagramId
    );
    const bundle = await source.application.mappedArtifactBundle(
      source.set.id,
      "diagram",
      sourceDiagramId
    );
    expect(bundle.codeEntities[0]).toMatchObject({
      id: expect.stringMatching(/^entity-[0-9a-f-]{36}$/),
      origin: {
        projectId: source.set.projectId,
        diagramSetId: source.set.id,
        codeEntitiesSetId: source.set.codeEntitiesSetId
      }
    });
    expect(bundle.codeEntities[0].sourceRanges[0].id).toMatch(/^range-[0-9a-f-]{36}$/);
    expect(bundle.codeEntityMap?.artifactId).toBe(sourceDiagramId);

    const target = await prepare("new-diagram-bundle-target-");
    const imported = await target.application.importArtifact({
      artifactKind: "diagram",
      name: bundle.artifact.name,
      ascii: bundle.artifact.ascii,
      bundle
    });
    expect(imported.globalImports.diagramIds).toContain(sourceDiagramId);
    expect(imported.diagrams[sourceDiagramId]).toMatchObject({
      diagramSetId: "global-imports",
      recordOrigin: bundle.artifact.recordOrigin,
      codeEntityIds: [bundle.codeEntities[0].id]
    });
    expect(imported.importedCodeEntities[bundle.codeEntities[0].id]).toEqual(bundle.codeEntities[0]);
    expect(imported.codeEntityMaps[sourceDiagramId]).toEqual(sourceWorkspace.codeEntityMaps[sourceDiagramId]);

    await expect(target.application.importArtifact({
      artifactKind: "diagram",
      name: "Stale foreign map",
      ascii: bundle.artifact.ascii,
      bundle: {
        ...bundle,
        codeEntityMap: { ...bundle.codeEntityMap!, asciiSha256: "0".repeat(64) }
      }
    })).rejects.toThrow(/stale ASCII mapping bounds/);

    await expect(target.application.importArtifact({
      artifactKind: "diagram",
      name: "Invalid foreign map",
      ascii: bundle.artifact.ascii,
      bundle: {
        ...bundle,
        codeEntityMap: {
          ...bundle.codeEntityMap!,
          mappings: [{
            ...bundle.codeEntityMap!.mappings[0],
            sourceRangeIndex: 999
          }]
        }
      }
    })).rejects.toThrow(/unavailable source range/);

    const invalidCoordinates = structuredClone(bundle);
    invalidCoordinates.codeEntityMap!.mappings[0].line = 999;
    await expect(target.application.importArtifact({
      artifactKind: "diagram",
      name: "Invalid coordinates",
      ascii: invalidCoordinates.artifact.ascii,
      bundle: invalidCoordinates
    })).rejects.toThrow(/outside the ASCII/);

    const duplicateIds = structuredClone(bundle);
    duplicateIds.codeEntityMap!.mappings.push({ ...duplicateIds.codeEntityMap!.mappings[0] });
    await expect(target.application.importArtifact({
      artifactKind: "diagram",
      name: "Duplicate mapping ids",
      ascii: duplicateIds.artifact.ascii,
      bundle: duplicateIds
    })).rejects.toThrow(/duplicate mapping ids/);

    const nonCanonical = structuredClone(bundle);
    nonCanonical.artifact.ascii = `${nonCanonical.artifact.ascii}\r\n`;
    nonCanonical.codeEntityMap!.asciiSha256 = createHash("sha256")
      .update(nonCanonical.artifact.ascii).digest("hex");
    await expect(target.application.importArtifact({
      artifactKind: "diagram",
      name: "Non-canonical ASCII",
      ascii: nonCanonical.artifact.ascii,
      bundle: nonCanonical
    })).rejects.toThrow(/stale ASCII mapping bounds/);
  });
});
