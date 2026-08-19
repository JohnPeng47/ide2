import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  SCHEMA_VERSION,
  assertSafeId,
  type AgentRunRecord,
  type CodeEntitiesSetRecord,
  type CodeEntityRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type GenerationBatchRecord,
  type ProjectRecord,
  type WorkspaceSnapshot
} from "../src/domain";

const execFileAsync = promisify(execFile);

export interface RepositoryLocation {
  checkoutRoot: string;
  repositoryIdentity: string;
  gitRevision?: string;
}

export async function discoverRepository(inputPath: string): Promise<RepositoryLocation> {
  const resolved = path.resolve(inputPath);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`repository path is not a directory: ${resolved}`);
  const git = async (...args: string[]) => {
    const result = await execFileAsync("git", ["-C", resolved, ...args], { encoding: "utf8" });
    return result.stdout.trim();
  };
  const checkoutRoot = path.resolve(await git("rev-parse", "--show-toplevel"));
  const commonDirRaw = await git("rev-parse", "--git-common-dir");
  const repositoryIdentity = path.resolve(checkoutRoot, commonDirRaw);
  const gitRevision = await git("rev-parse", "HEAD").catch(() => undefined);
  return { checkoutRoot, repositoryIdentity, gitRevision };
}

export function projectIdFor(repositoryIdentity: string): string {
  const digest = createHash("sha256").update(repositoryIdentity).digest("hex").slice(0, 12);
  return `project-${digest}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function readJson<T>(filePath: string): Promise<T> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as T & { schemaVersion?: number };
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported schema in ${filePath}`);
  }
  return parsed;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export class DiagramStore {
  readonly storeRoot: string;

  constructor(readonly checkoutRoot: string) {
    this.checkoutRoot = path.resolve(checkoutRoot);
    this.storeRoot = path.join(this.checkoutRoot, ".diagrams");
  }

  private projectPath(): string {
    return path.join(this.storeRoot, "project.json");
  }

  private setRoot(setId: string): string {
    assertSafeId(setId, "DiagramSet id");
    return path.join(this.storeRoot, "diagram-sets", setId);
  }

  private setPath(setId: string): string {
    return path.join(this.setRoot(setId), "diagram-set.json");
  }

  private entitiesPath(setId: string): string {
    return path.join(this.setRoot(setId), "code-entities.json");
  }

  private diagramPath(setId: string, diagramId: string): string {
    assertSafeId(diagramId, "Diagram id");
    return path.join(this.setRoot(setId), "diagrams", `${diagramId}.json`);
  }

  private batchPath(setId: string, batchId: string): string {
    assertSafeId(batchId, "GenerationBatch id");
    return path.join(this.setRoot(setId), "generation-batches", `${batchId}.json`);
  }

  private runPath(setId: string, runId: string): string {
    assertSafeId(runId, "AgentRun id");
    return path.join(this.setRoot(setId), "runs", `${runId}.json`);
  }

  async ensureProject(location: RepositoryLocation): Promise<ProjectRecord> {
    const existing = await readJsonIfExists<ProjectRecord>(this.projectPath());
    if (existing) {
      if (existing.repositoryIdentity !== location.repositoryIdentity) {
        throw new Error(".diagrams belongs to a different repository identity");
      }
      return existing;
    }
    const timestamp = nowIso();
    const project: ProjectRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: projectIdFor(location.repositoryIdentity),
      name: path.basename(location.checkoutRoot),
      repositoryIdentity: location.repositoryIdentity,
      canonicalRepoRoot: location.checkoutRoot,
      diagramSetIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await writeJsonAtomic(this.projectPath(), project);
    return project;
  }

  async createDiagramSet(input: {
    project: ProjectRecord;
    name: string;
    initialPrompt: string;
    location: RepositoryLocation;
  }): Promise<{ diagramSet: DiagramSetRecord; codeEntities: CodeEntitiesSetRecord }> {
    const timestamp = nowIso();
    const setId = makeId("set");
    const entitySetId = makeId("entities");
    const diagramSet: DiagramSetRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: setId,
      projectId: input.project.id,
      name: input.name.trim(),
      initialPrompt: input.initialPrompt.trim(),
      sourceCheckoutRoot: input.location.checkoutRoot,
      gitRevision: input.location.gitRevision,
      codeEntitiesSetId: entitySetId,
      diagramIds: [],
      generationBatchIds: [],
      agentRunIds: [],
      readiness: "collecting",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const codeEntities: CodeEntitiesSetRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: entitySetId,
      diagramSetId: setId,
      revision: 1,
      status: "collecting",
      entities: []
    };
    await writeJsonAtomic(this.entitiesPath(setId), codeEntities);
    await writeJsonAtomic(this.setPath(setId), diagramSet);
    const project = {
      ...input.project,
      diagramSetIds: [...input.project.diagramSetIds, setId],
      updatedAt: timestamp
    };
    await writeJsonAtomic(this.projectPath(), project);
    return { diagramSet, codeEntities };
  }

  async loadProject(): Promise<ProjectRecord | null> {
    return readJsonIfExists<ProjectRecord>(this.projectPath());
  }

  async loadDiagramSet(setId: string): Promise<DiagramSetRecord> {
    return readJson<DiagramSetRecord>(this.setPath(setId));
  }

  async loadCodeEntities(setId: string): Promise<CodeEntitiesSetRecord> {
    return readJson<CodeEntitiesSetRecord>(this.entitiesPath(setId));
  }

  async loadDiagram(setId: string, diagramId: string): Promise<DiagramRecord> {
    return readJson<DiagramRecord>(this.diagramPath(setId, diagramId));
  }

  async renameDiagram(setId: string, diagramId: string, name: string): Promise<DiagramRecord> {
    const diagram = await this.loadDiagram(setId, diagramId);
    const renamed = { ...diagram, name };
    await writeJsonAtomic(this.diagramPath(setId, diagramId), renamed);
    return renamed;
  }

  async archiveDiagram(setId: string, diagramId: string): Promise<DiagramRecord> {
    const diagram = await this.loadDiagram(setId, diagramId);
    if (diagram.archivedAt) return diagram;
    const archived = { ...diagram, archivedAt: nowIso() };
    await writeJsonAtomic(this.diagramPath(setId, diagramId), archived);
    return archived;
  }

  async saveRun(run: AgentRunRecord): Promise<void> {
    await writeJsonAtomic(this.runPath(run.diagramSetId, run.id), run);
  }

  async saveBatch(batch: GenerationBatchRecord): Promise<void> {
    await writeJsonAtomic(this.batchPath(batch.diagramSetId, batch.id), batch);
  }

  async attachRun(setId: string, runId: string): Promise<DiagramSetRecord> {
    const set = await this.loadDiagramSet(setId);
    if (set.agentRunIds.includes(runId)) return set;
    const updated = { ...set, agentRunIds: [...set.agentRunIds, runId], updatedAt: nowIso() };
    await writeJsonAtomic(this.setPath(setId), updated);
    return updated;
  }

  async completeCollection(setId: string, entities: CodeEntityRecord[]): Promise<void> {
    const current = await this.loadCodeEntities(setId);
    if (current.status === "finalized") throw new Error("CodeEntitiesSet is immutable after finalization");
    const updatedEntities: CodeEntitiesSetRecord = {
      ...current,
      status: "awaiting-approval",
      entities,
      error: undefined
    };
    await writeJsonAtomic(this.entitiesPath(setId), updatedEntities);
    const set = await this.loadDiagramSet(setId);
    await writeJsonAtomic(this.setPath(setId), {
      ...set,
      readiness: "awaiting-approval",
      updatedAt: nowIso(),
      error: undefined
    });
  }

  async failCollection(setId: string, message: string): Promise<void> {
    const entities = await this.loadCodeEntities(setId);
    if (entities.status !== "finalized") {
      await writeJsonAtomic(this.entitiesPath(setId), { ...entities, status: "failed", error: message });
    }
    const set = await this.loadDiagramSet(setId);
    await writeJsonAtomic(this.setPath(setId), {
      ...set,
      readiness: "failed",
      updatedAt: nowIso(),
      error: message
    });
  }

  async finalizeCodeEntities(setId: string, actor: string): Promise<CodeEntitiesSetRecord> {
    const entities = await this.loadCodeEntities(setId);
    if (entities.status === "finalized") return entities;
    if (entities.status !== "awaiting-approval" || entities.entities.length === 0) {
      throw new Error("CodeEntitiesSet is not ready for finalization");
    }
    const timestamp = nowIso();
    const finalized: CodeEntitiesSetRecord = {
      ...entities,
      status: "finalized",
      finalizedAt: timestamp,
      finalizedBy: actor
    };
    await writeJsonAtomic(this.entitiesPath(setId), finalized);
    const set = await this.loadDiagramSet(setId);
    await writeJsonAtomic(this.setPath(setId), {
      ...set,
      readiness: "ready",
      updatedAt: timestamp,
      error: undefined
    });
    return finalized;
  }

  async beginBatch(batch: GenerationBatchRecord, runs: AgentRunRecord[]): Promise<void> {
    const entities = await this.loadCodeEntities(batch.diagramSetId);
    if (entities.status !== "finalized" || entities.revision !== batch.codeEntitiesRevision) {
      throw new Error("generation batch is not pinned to the finalized CodeEntitiesSet");
    }
    for (const run of runs) await this.saveRun(run);
    await this.saveBatch(batch);
    const set = await this.loadDiagramSet(batch.diagramSetId);
    await writeJsonAtomic(this.setPath(batch.diagramSetId), {
      ...set,
      generationBatchIds: [...set.generationBatchIds, batch.id],
      agentRunIds: [...set.agentRunIds, ...runs.map((run) => run.id)],
      updatedAt: nowIso()
    });
  }

  async completeBatch(
    batch: GenerationBatchRecord,
    runs: AgentRunRecord[],
    diagrams: DiagramRecord[]
  ): Promise<void> {
    const entities = await this.loadCodeEntities(batch.diagramSetId);
    if (entities.status !== "finalized" || entities.revision !== batch.codeEntitiesRevision) {
      throw new Error("CodeEntitiesSet changed before the generation batch committed");
    }
    for (const diagram of diagrams) {
      await writeJsonAtomic(this.diagramPath(diagram.diagramSetId, diagram.id), diagram);
    }
    for (const run of runs) await this.saveRun(run);
    await this.saveBatch(batch);
    const set = await this.loadDiagramSet(batch.diagramSetId);
    await writeJsonAtomic(this.setPath(batch.diagramSetId), {
      ...set,
      diagramIds: [...set.diagramIds, ...diagrams.map((diagram) => diagram.id)],
      updatedAt: nowIso()
    });
  }

  async loadWorkspace(): Promise<WorkspaceSnapshot> {
    const project = await this.loadProject();
    if (!project) {
      return {
        project: null,
        diagramSets: [],
        codeEntitySets: {},
        diagrams: {},
        generationBatches: {},
        agentRuns: {}
      };
    }
    const diagramSets = await Promise.all(project.diagramSetIds.map((id) => this.loadDiagramSet(id)));
    const codeEntitySets: Record<string, CodeEntitiesSetRecord> = {};
    const diagrams: Record<string, DiagramRecord> = {};
    const generationBatches: Record<string, GenerationBatchRecord> = {};
    const agentRuns: Record<string, AgentRunRecord> = {};
    for (const set of diagramSets) {
      codeEntitySets[set.codeEntitiesSetId] = await this.loadCodeEntities(set.id);
      for (const id of set.diagramIds) diagrams[id] = await this.loadDiagram(set.id, id);
      for (const id of set.generationBatchIds) {
        generationBatches[id] = await readJson<GenerationBatchRecord>(this.batchPath(set.id, id));
      }
      for (const id of set.agentRunIds) {
        agentRuns[id] = await readJson<AgentRunRecord>(this.runPath(set.id, id));
      }
    }
    return { project, diagramSets, codeEntitySets, diagrams, generationBatches, agentRuns };
  }

  ids = {
    set: () => makeId("set"),
    run: () => makeId("run"),
    batch: () => makeId("batch"),
    diagram: () => makeId("diagram")
  };
}
