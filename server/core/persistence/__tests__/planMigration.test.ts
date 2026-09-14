import {
  mkdir,
  mkdtemp,
  readFile,
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
import { SCHEMA_VERSION, type DiagramRecord } from "../../../../domain/core/records/domain";
import { migrateLegacyPlanBundles } from "../planMigration";
import { DiagramStore } from "../store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("legacy Plan bundle migration", () => {
  it("materializes legacy inline Diagram changes into the strict bundle format", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-plan-migration-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const location = { checkoutRoot: root, repositoryIdentity: path.join(root, ".git") };
    const project = await store.ensureProject(location);
    const { diagramSet } = await store.createDiagramSet({
      project,
      name: "Architecture",
      initialPrompt: "Show it",
      location,
      creationMode: "materialized"
    });
    const diagram: DiagramRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: "diagram-one",
      diagramSetId: diagramSet.id,
      viewKind: "diagram",
      handle: "diagram-one",
      name: "Diagram one",
      ascii: "before target after",
      representationKind: "diagram",
      codeEntityIds: [],
      origin: "materialized",
      derivedFromDiagramIds: [],
      createdAt: "2026-09-01T00:00:00.000Z"
    };
    await store.addDiagram(diagram);
    const planRoot = path.join(root, ".diagrams", "plans", "plan-one");
    await mkdir(planRoot, { recursive: true });
    await writeFile(path.join(planRoot, "plan.md"), "# Legacy Plan", "utf8");
    const legacy = {
      schemaVersion: SCHEMA_VERSION,
      id: "plan-one",
      projectId: project.id,
      title: "Legacy Plan",
      status: "active",
      markdownPath: "plan.md",
      changes: [{
        id: "change-one",
        kind: "diagram-modified",
        diagramSetId: diagram.diagramSetId,
        diagramId: diagram.id,
        label: diagram.name,
        baseAsciiSha256: asciiSha256(diagram.ascii),
        patch: { start: 7, deletedText: "target", insertedText: "output" }
      }],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };
    await writeFile(path.join(planRoot, "plan.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    await expect(store.loadPlan("plan-one")).rejects.toThrow("unsupported Plan selection path");
    await expect(migrateLegacyPlanBundles(store)).resolves.toEqual({
      migratedPlanIds: ["plan-one"],
      skippedPlanIds: []
    });

    const migrated = await store.loadPlan("plan-one");
    expect(migrated).toMatchObject({
      selection: { availability: "unavailable" },
      migration: { sourceFormat: "legacy-inline-plan" },
      changes: [{ mode: "partial", outputAscii: "before output after" }]
    });
    await expect(readFile(path.join(planRoot, "changes", "change-one", "base.txt"), "utf8"))
      .resolves.toBe(diagram.ascii);
    await expect(readFile(path.join(planRoot, "changes", "change-one", "output.txt"), "utf8"))
      .resolves.toBe("before output after");
    await expect(readFile(path.join(planRoot, "legacy-plan.json"), "utf8"))
      .resolves.toContain('"kind": "diagram-modified"');
    await expect(migrateLegacyPlanBundles(store)).resolves.toEqual({
      migratedPlanIds: [],
      skippedPlanIds: ["plan-one"]
    });
  });

  it("leaves the legacy manifest in place when its base cannot be reconstructed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-plan-migration-stale-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root);
    const project = await store.ensureProject({
      checkoutRoot: root,
      repositoryIdentity: path.join(root, ".git")
    });
    const planRoot = path.join(root, ".diagrams", "plans", "plan-stale");
    await mkdir(planRoot, { recursive: true });
    await writeFile(path.join(planRoot, "plan.md"), "# Stale", "utf8");
    const legacy = {
      schemaVersion: SCHEMA_VERSION,
      id: "plan-stale",
      projectId: project.id,
      title: "Stale",
      status: "active",
      markdownPath: "plan.md",
      changes: [{
        id: "change-stale",
        kind: "diagram-modified",
        diagramSetId: "set-missing",
        diagramId: "diagram-missing",
        label: "Missing",
        baseAsciiSha256: "missing",
        patch: { start: 0, deletedText: "", insertedText: "new" }
      }],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };
    const original = `${JSON.stringify(legacy, null, 2)}\n`;
    await writeFile(path.join(planRoot, "plan.json"), original, "utf8");

    await expect(migrateLegacyPlanBundles(store)).rejects.toThrow();
    await expect(readFile(path.join(planRoot, "plan.json"), "utf8")).resolves.toBe(original);
  });
});
