import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
import { asciiSha256 } from "../../../../domain/core/diagrams/asciiSha256";
import { SCHEMA_VERSION, type DiagramRecord, type PlanRecord } from "../../../../domain/core/records/domain";
import { generationPromptBindings, promptTemplate } from "../../../../domain/core/prompts/prompt";
import { DiagramStore } from "../store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DiagramStore", () => {
  it("persists Plan manifests separately from their Markdown documents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-plan-store-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const project = await store.ensureProject({
      checkoutRoot: root,
      repositoryIdentity: path.join(root, ".git")
    });
    const plan: PlanRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: "plan-one",
      projectId: project.id,
      title: "Plan one",
      status: "active",
      markdown: "# Plan one\n\nRead-only projections.",
      selection: {
        availability: "recorded",
        affectedCodeEntities: [],
        diagramCandidates: [],
        selectedDiagramIds: []
      },
      changes: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };

    await store.savePlan(plan);

    await expect(store.loadPlans()).resolves.toEqual([plan]);
    await expect(readFile(path.join(root, ".diagrams", "plans", "plan-one", "plan.md"), "utf8"))
      .resolves.toBe(plan.markdown);
    const manifest = await readFile(
      path.join(root, ".diagrams", "plans", "plan-one", "plan.json"),
      "utf8"
    );
    expect(manifest).toContain('"markdownPath": "plan.md"');
    expect(manifest).toContain('"selectionPath": "selection.json"');
    expect(manifest).not.toContain("Read-only projections.");
  });

  it("persists modified Diagram bases, outputs, and diffs as referenced Plan artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-plan-artifacts-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const project = await store.ensureProject({
      checkoutRoot: root,
      repositoryIdentity: path.join(root, ".git")
    });
    const baseAscii = "before target after";
    const baseDiagram: DiagramRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: "diagram-one",
      diagramSetId: "set-one",
      viewKind: "diagram",
      handle: "diagram-one",
      name: "Diagram one",
      ascii: baseAscii,
      representationKind: "diagram",
      codeEntityIds: [],
      origin: "materialized",
      derivedFromDiagramIds: [],
      createdAt: "2026-09-01T00:00:00.000Z"
    };
    const plan: PlanRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: "plan-artifacts",
      projectId: project.id,
      title: "Persisted proposal",
      status: "active",
      markdown: "# Persisted proposal",
      selection: {
        availability: "recorded",
        affectedCodeEntities: [],
        diagramCandidates: [{ diagramId: baseDiagram.id, decision: "include", reason: "Affected" }],
        selectedDiagramIds: [baseDiagram.id]
      },
      changes: [{
        id: "change-one",
        kind: "diagram-modified",
        mode: "partial",
        diagramSetId: baseDiagram.diagramSetId,
        diagramId: baseDiagram.id,
        label: baseDiagram.name,
        baseDiagram,
        baseAsciiSha256: asciiSha256(baseAscii),
        patch: { start: 7, deletedText: "target", insertedText: "output" },
        outputAscii: "before output after"
      }],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };

    await store.savePlan(plan);

    await expect(store.loadPlan(plan.id)).resolves.toEqual(plan);
    const planRoot = path.join(root, ".diagrams", "plans", plan.id);
    await expect(readFile(path.join(planRoot, "changes", "change-one", "base.txt"), "utf8"))
      .resolves.toBe(baseAscii);
    await expect(readFile(path.join(planRoot, "changes", "change-one", "output.txt"), "utf8"))
      .resolves.toBe("before output after");
    const manifest = await readFile(path.join(planRoot, "plan.json"), "utf8");
    expect(manifest).toContain('"path": "changes/change-one/change.json"');
    expect(manifest).not.toContain("before output after");
  });

  it("round-trips complete updates, added Diagrams, and CodeEntity compaction artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-plan-change-kinds-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const project = await store.ensureProject({
      checkoutRoot: root,
      repositoryIdentity: path.join(root, ".git")
    });
    const baseDiagram: DiagramRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: "diagram-complete",
      diagramSetId: "set-one",
      viewKind: "diagram",
      handle: "complete",
      name: "Complete",
      ascii: "old composition",
      representationKind: "diagram",
      codeEntityIds: ["entity-one"],
      origin: "materialized",
      derivedFromDiagramIds: [],
      createdAt: "2026-09-01T00:00:00.000Z"
    };
    const baseEntity = {
      id: "entity-one",
      handle: "entity-one",
      label: "Entity one",
      category: "operation" as const,
      summary: "Entity one",
      sourceRanges: [{ id: "range-one", path: "src/one.ts", startLine: 1, endLine: 5 }]
    };
    const compactedSource = {
      level: "high" as const,
      sections: [{
        kind: "collapsed-comment" as const,
        startLine: 1,
        endLine: 5,
        comment: "Implementation details"
      }]
    };
    const plan: PlanRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: "plan-all-change-kinds",
      projectId: project.id,
      title: "All change kinds",
      status: "active",
      markdown: "# All change kinds",
      selection: {
        availability: "recorded",
        affectedCodeEntities: [{ id: baseEntity.id, sourceRanges: ["src/one.ts:1-5"] }],
        diagramCandidates: [{ diagramId: baseDiagram.id, decision: "include", reason: "Affected" }],
        selectedDiagramIds: [baseDiagram.id]
      },
      changes: [{
        id: "complete-update",
        kind: "diagram-modified",
        mode: "complete",
        diagramSetId: baseDiagram.diagramSetId,
        diagramId: baseDiagram.id,
        label: baseDiagram.name,
        baseDiagram,
        baseAsciiSha256: asciiSha256(baseDiagram.ascii),
        patch: { start: 0, deletedText: baseDiagram.ascii, insertedText: "new composition" },
        outputAscii: "new composition"
      }, {
        id: "added-diagram",
        kind: "diagram-added",
        label: "New relationship",
        draft: {
          diagramSetId: "set-one",
          viewKind: "diagram",
          representationKind: "diagram",
          handle: "new-relationship",
          name: "New relationship",
          ascii: "new diagram",
          codeEntityIds: [baseEntity.id]
        }
      }, {
        id: "compaction-change",
        kind: "code-entity-compaction",
        diagramSetId: "set-one",
        codeEntityId: baseEntity.id,
        sourceRangeId: "range-one",
        label: baseEntity.label,
        baseEntity,
        compactedSource
      }],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };

    await store.savePlan(plan);

    await expect(store.loadPlan(plan.id)).resolves.toEqual(plan);
    const changesRoot = path.join(root, ".diagrams", "plans", plan.id, "changes");
    await expect(readFile(path.join(changesRoot, "complete-update", "output.txt"), "utf8"))
      .resolves.toBe("new composition");
    await expect(readFile(path.join(changesRoot, "added-diagram", "output.txt"), "utf8"))
      .resolves.toBe("new diagram");
    await expect(readFile(path.join(changesRoot, "compaction-change", "base.json"), "utf8"))
      .resolves.toContain('"compactedSource": null');
    await expect(readFile(path.join(changesRoot, "compaction-change", "output.json"), "utf8"))
      .resolves.toContain("Implementation details");
  });

  it("does not implicitly migrate unrelated legacy projects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-legacy-project-"));
    roots.push(root);
    await mkdir(path.join(root, ".diagrams"));
    await writeFile(path.join(root, ".diagrams", "project.json"), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      id: "project-legacy",
      name: "Legacy",
      repositoryIdentity: path.join(root, ".git"),
      canonicalRepoRoot: root,
      diagramSetIds: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }));

    await expect(new DiagramStore(root).loadProject()).resolves.toMatchObject({
      id: "project-legacy", canonicalRepoRoot: root
    });
  });

  it("persists a document profile and filesystem corpus for a non-git directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-document-project-"));
    roots.push(root);
    const store = new DiagramStore(root);
    const location = {
      checkoutRoot: root,
      repositoryIdentity: `filesystem-documents:${root}`,
      domainProfileId: "document" as const,
      corpus: { kind: "filesystem-documents" as const, root }
    };
    const project = await store.ensureProject(location);

    expect(project).toMatchObject({ defaultDomainProfileId: "document" });
    expect(project).not.toHaveProperty("corpus");
    await expect(readFile(path.join(root, ".diagrams", "project.json"), "utf8"))
      .resolves.toContain('"defaultDomainProfileId": "document"');
  });

  it("migrates an untouched source built-in prompt when a document project reads it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-document-prompt-"));
    roots.push(root);
    const store = new DiagramStore(root);
    await store.loadCodeEntityPromptTemplates("source-code");

    const [template] = await store.loadCodeEntityPromptTemplates("document");

    expect(template.label).toBe("Default Document Evidence");
    expect(template.prompts["code-entity-identification"]).toMatch(/supplied\s+documents/);
  });
  it("migrates runtime variables out of named prompt dictionaries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-named-prompt-migration-"));
    roots.push(root);
    await mkdir(path.join(root, ".diagrams"), { recursive: true });
    await writeFile(path.join(root, ".diagrams", "system-prompt-templates.json"), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      templates: [{
        schemaVersion: SCHEMA_VERSION,
        id: "named",
        label: "Named",
        description: "Named dictionary with old runtime variables",
        builtIn: false,
        version: 1,
        prompts: {
          "diagram-system": { template: "Generate {{outputKind}}." },
          "diagram-reference": {
            template: "Use {{referenceInstruction}} with {{referenceContext}}."
          },
          "diagram-mapping": { template: "Map {{mappingArtifact}} to {{mappingEntities}}." }
        },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z"
      }]
    }, null, 2));

    const [template] = await new DiagramStore(root).loadSystemPromptTemplates();
    expect(Object.values(template.prompts).every(({ template: body }) => !body.includes("{{")))
      .toBe(true);
    const persisted = await readFile(
      path.join(root, ".diagrams", "system-prompt-templates.json"),
      "utf8"
    );
    expect(persisted).not.toContain("{{");
  });

  it("migrates legacy generation profiles into named prompt dictionaries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-prompt-migration-"));
    roots.push(root);
    await mkdir(path.join(root, ".diagrams"), { recursive: true });
    const targetKinds = ["diagram", "call-graph", "dir-view", "diagram-component"] as const;
    await writeFile(path.join(root, ".diagrams", "system-prompt-templates.json"), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      templates: [{
        schemaVersion: SCHEMA_VERSION,
        id: "legacy",
        label: "Legacy",
        description: "Legacy shape",
        builtIn: false,
        version: 3,
        prompts: Object.fromEntries(targetKinds.map((kind) => [
          kind,
          `Generate {{outputKind}} for ${kind} through {{submissionTool}}.`
        ])),
        referencePrompts: Object.fromEntries(targetKinds.map((kind) => [
          kind,
          "Reference {{referenceContext}} and call {{submissionTool}}."
        ])),
        mappingPrompts: Object.fromEntries(targetKinds.map((kind) => [
          kind,
          "Map {{mappingArtifact}} to {{mappingEntities}} through {{submissionTool}}."
        ])),
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z"
      }]
    }, null, 2));

    const [template] = await new DiagramStore(root).loadSystemPromptTemplates();
    const bindings = generationPromptBindings("diagram");
    expect(promptTemplate(template, bindings.system)).toBe(
      "Generate artifact for diagram through the registered submission tool."
    );
    expect(promptTemplate(template, bindings.reference!))
      .toContain("the system-managed reference context below");
    expect(promptTemplate(template, bindings.mapping))
      .toContain("the system-managed final artifact below");
    const persisted = await readFile(
      path.join(root, ".diagrams", "system-prompt-templates.json"),
      "utf8"
    );
    expect(persisted).toContain('"diagram-system"');
    expect(persisted).not.toContain('"referencePrompts"');
    expect(persisted).not.toContain("{{");
  });

  it("moves a deleted Diagram Set to recoverable trash and updates the project index", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-store-trash-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const location = { checkoutRoot: root, repositoryIdentity: path.join(root, ".git") };
    const project = await store.ensureProject(location);
    const { diagramSet } = await store.createDiagramSet({
      project,
      name: "Disposable flow",
      initialPrompt: "Show it",
      location
    });

    const trashPath = await store.moveDiagramSetToTrash(diagramSet.id);

    expect((await store.loadProject())?.diagramSetIds).toEqual([]);
    await expect(store.loadDiagramSet(diagramSet.id)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(trashPath, "diagram-set.json"), "utf8"))
      .resolves.toContain('"name": "Disposable flow"');
    expect(await readdir(path.join(root, ".diagrams", "trash", "diagram-sets")))
      .toEqual([path.basename(trashPath)]);
  });

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
    expect(project.repositoryIdentity).toBeUndefined();
  });

  it("migrates legacy DiagramSet imports into the global imports directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-store-import-migration-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const location = { checkoutRoot: root, repositoryIdentity: path.join(root, ".git") };
    const project = await store.ensureProject(location);
    const { diagramSet } = await store.createDiagramSet({
      project,
      name: "Legacy imports",
      initialPrompt: "Show imports",
      location
    });
    const legacy: DiagramRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: "diagram-legacy-import",
      diagramSetId: diagramSet.id,
      viewKind: "diagram",
      handle: "legacy-import",
      name: "Legacy import",
      ascii: "[legacy]",
      codeEntityIds: ["entity-project-only"],
      origin: "imported",
      derivedFromDiagramIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    };
    await store.addDiagram(legacy);

    const workspace = await store.loadWorkspace();

    expect(workspace.diagramSets[0].diagramIds).toEqual([]);
    expect(workspace.globalImports.diagramIds).toEqual([legacy.id]);
    expect(workspace.diagrams[legacy.id]).toMatchObject({
      diagramSetId: "global-imports",
      handle: "legacy-import",
      codeEntityIds: []
    });
    await expect(readFile(path.join(
      root,
      ".diagrams",
      "imports",
      "diagrams",
      `${legacy.id}.json`
    ), "utf8")).resolves.toContain('"diagramSetId": "global-imports"');
    expect((await store.loadWorkspace()).globalImports.diagramIds).toEqual([legacy.id]);
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
    expect(workspace.codeEntitySets[diagramSet.codeEntitiesSetId].entities[0]).toMatchObject({
      id: "entity-worker",
      origin: {
        projectId: project.id,
        diagramSetId: diagramSet.id,
        codeEntitiesSetId: diagramSet.codeEntitiesSetId
      },
      sourceRanges: [{ id: expect.stringMatching(/^range-[a-f0-9]{32}$/) }]
    });
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
      viewKind: "diagram",
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
    expect(batch.diagramCandidateBatchId).toMatch(/^candidate-batch-/);
    expect(workspace.diagramCandidateBatches[batch.diagramCandidateBatchId!]).toMatchObject({
      generationBatchId: batch.id,
      diagramIds: [diagram.id],
      rankings: {}
    });
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
    await expect(readFile(path.join(
      setRoot,
      "diagram-candidate-batches",
      `${batch.diagramCandidateBatchId}.json`
    ), "utf8")).resolves.toContain(`"generationBatchId": "${batch.id}"`);
    await expect(store.saveGenerationPromptConfig({
      ...config,
      instruction: "mutated"
    })).rejects.toThrow(/immutable/);
  });
});
