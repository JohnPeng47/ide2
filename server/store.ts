import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_DIAGRAM_MODEL_ID,
  SCHEMA_VERSION,
  assertSafeId,
  isDiagramModelId,
  type AgentRunRecord,
  type CodeEntitiesSetRecord,
  type CodeEntityRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type EditSessionRecord,
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
  readonly checkoutRoot: string;
  readonly storeRoot: string;

  constructor(checkoutRoot: string, diagramsDirectory = ".diagrams") {
    this.checkoutRoot = path.resolve(checkoutRoot);
    this.storeRoot = path.resolve(this.checkoutRoot, diagramsDirectory);
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

  private diagramComponentPath(setId: string, componentId: string): string {
    assertSafeId(componentId, "DiagramComponent id");
    return path.join(this.setRoot(setId), "diagram-components", `${componentId}.json`);
  }

  private batchPath(setId: string, batchId: string): string {
    assertSafeId(batchId, "GenerationBatch id");
    return path.join(this.setRoot(setId), "generation-batches", `${batchId}.json`);
  }

  private runPath(setId: string, runId: string): string {
    assertSafeId(runId, "AgentRun id");
    return path.join(this.setRoot(setId), "runs", `${runId}.json`);
  }

  private editSessionPath(setId: string, sessionId: string): string {
    assertSafeId(sessionId, "EditSession id");
    return path.join(this.setRoot(setId), "edit-sessions", `${sessionId}.json`);
  }

  private codeEntityMapPath(setId: string, artifactId: string): string {
    assertSafeId(artifactId, "artifact id");
    return path.join(this.setRoot(setId), "code-entity-maps", `${artifactId}.json`);
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
      diagramComponentIds: [],
      generationBatchIds: [],
      agentRunIds: [],
      editSessionIds: [],
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
    const stored = await readJson<DiagramSetRecord & {
      diagramComponentIds?: string[];
      editSessionIds?: string[];
    }>(this.setPath(setId));
    if (Array.isArray(stored.diagramComponentIds) && Array.isArray(stored.editSessionIds)) {
      return stored as DiagramSetRecord;
    }
    const normalized: DiagramSetRecord = {
      ...stored,
      diagramComponentIds: stored.diagramComponentIds ?? [],
      editSessionIds: stored.editSessionIds ?? []
    };
    await writeJsonAtomic(this.setPath(setId), normalized);
    return normalized;
  }

  async loadCodeEntities(setId: string): Promise<CodeEntitiesSetRecord> {
    return readJson<CodeEntitiesSetRecord>(this.entitiesPath(setId));
  }

  async loadDiagram(setId: string, diagramId: string): Promise<DiagramRecord> {
    const stored = await readJson<DiagramRecord & { origin?: DiagramRecord["origin"] }>(
      this.diagramPath(setId, diagramId)
    );
    if (stored.origin) return stored as DiagramRecord;
    const normalized: DiagramRecord = { ...stored, origin: "generated" };
    await writeJsonAtomic(this.diagramPath(setId, diagramId), normalized);
    return normalized;
  }

  async loadDiagramComponent(setId: string, componentId: string): Promise<DiagramComponentRecord> {
    return readJson<DiagramComponentRecord>(this.diagramComponentPath(setId, componentId));
  }

  async loadGenerationBatch(setId: string, batchId: string): Promise<GenerationBatchRecord> {
    const stored = await readJson<GenerationBatchRecord & {
      outputKind?: GenerationBatchRecord["outputKind"];
      outputDiagramComponentIds?: string[];
      modelId?: GenerationBatchRecord["modelId"];
    }>(this.batchPath(setId, batchId));
    if (stored.outputKind && Array.isArray(stored.outputDiagramComponentIds)
      && isDiagramModelId(stored.modelId)) {
      return stored as GenerationBatchRecord;
    }
    const normalized: GenerationBatchRecord = {
      ...stored,
      outputKind: stored.outputKind ?? "diagram",
      modelId: stored.modelId ?? DEFAULT_DIAGRAM_MODEL_ID,
      outputDiagramComponentIds: stored.outputDiagramComponentIds ?? []
    };
    await writeJsonAtomic(this.batchPath(setId, batchId), normalized);
    return normalized;
  }

  async saveDiagramComponent(component: DiagramComponentRecord): Promise<void> {
    await writeJsonAtomic(
      this.diagramComponentPath(component.diagramSetId, component.id),
      component
    );
  }

  async addDiagram(diagram: DiagramRecord): Promise<void> {
    await writeJsonAtomic(this.diagramPath(diagram.diagramSetId, diagram.id), diagram);
    const set = await this.loadDiagramSet(diagram.diagramSetId);
    await writeJsonAtomic(this.setPath(diagram.diagramSetId), {
      ...set,
      diagramIds: [...set.diagramIds, diagram.id],
      updatedAt: nowIso()
    });
  }

  async addDiagramComponent(component: DiagramComponentRecord): Promise<void> {
    await this.saveDiagramComponent(component);
    const set = await this.loadDiagramSet(component.diagramSetId);
    await writeJsonAtomic(this.setPath(component.diagramSetId), {
      ...set,
      diagramComponentIds: [...set.diagramComponentIds, component.id],
      updatedAt: nowIso()
    });
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

  async archiveDiagramComponent(
    setId: string,
    componentId: string
  ): Promise<DiagramComponentRecord> {
    const component = await this.loadDiagramComponent(setId, componentId);
    if (component.archivedAt) return component;
    const archived = { ...component, archivedAt: nowIso() };
    await writeJsonAtomic(this.diagramComponentPath(setId, componentId), archived);
    return archived;
  }

  async saveRun(run: AgentRunRecord): Promise<void> {
    await writeJsonAtomic(this.runPath(run.diagramSetId, run.id), run);
  }

  async saveBatch(batch: GenerationBatchRecord): Promise<void> {
    await writeJsonAtomic(this.batchPath(batch.diagramSetId, batch.id), batch);
  }

  async loadEditSession(setId: string, sessionId: string): Promise<EditSessionRecord> {
    return readJson<EditSessionRecord>(this.editSessionPath(setId, sessionId));
  }

  async saveEditSession(session: EditSessionRecord): Promise<void> {
    await writeJsonAtomic(this.editSessionPath(session.diagramSetId, session.id), session);
  }

  async loadCodeEntityMap(
    setId: string,
    artifactId: string
  ): Promise<DiagramCodeEntityMapRecord | null> {
    return readJsonIfExists<DiagramCodeEntityMapRecord>(
      this.codeEntityMapPath(setId, artifactId)
    );
  }

  async saveCodeEntityMap(mapping: DiagramCodeEntityMapRecord): Promise<void> {
    await writeJsonAtomic(
      this.codeEntityMapPath(mapping.diagramSetId, mapping.artifactId),
      mapping
    );
  }

  async addEditSession(session: EditSessionRecord): Promise<void> {
    await this.saveEditSession(session);
    const set = await this.loadDiagramSet(session.diagramSetId);
    await writeJsonAtomic(this.setPath(session.diagramSetId), {
      ...set,
      editSessionIds: [...set.editSessionIds, session.id],
      updatedAt: nowIso()
    });
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
    const timestamp = nowIso();
    const updatedEntities: CodeEntitiesSetRecord = {
      ...current,
      status: "finalized",
      entities,
      finalizedAt: timestamp,
      error: undefined
    };
    await writeJsonAtomic(this.entitiesPath(setId), updatedEntities);
    const set = await this.loadDiagramSet(setId);
    await writeJsonAtomic(this.setPath(setId), {
      ...set,
      readiness: "ready",
      updatedAt: timestamp,
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
    diagrams: DiagramRecord[],
    components: DiagramComponentRecord[]
  ): Promise<void> {
    const entities = await this.loadCodeEntities(batch.diagramSetId);
    if (entities.status !== "finalized" || entities.revision !== batch.codeEntitiesRevision) {
      throw new Error("CodeEntitiesSet changed before the generation batch committed");
    }
    for (const diagram of diagrams) {
      await writeJsonAtomic(this.diagramPath(diagram.diagramSetId, diagram.id), diagram);
    }
    for (const component of components) await this.saveDiagramComponent(component);
    for (const run of runs) await this.saveRun(run);
    await this.saveBatch(batch);
    const set = await this.loadDiagramSet(batch.diagramSetId);
    await writeJsonAtomic(this.setPath(batch.diagramSetId), {
      ...set,
      diagramIds: [...set.diagramIds, ...diagrams.map((diagram) => diagram.id)],
      diagramComponentIds: [
        ...set.diagramComponentIds,
        ...components.map((component) => component.id)
      ],
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
        diagramComponents: {},
        generationBatches: {},
        agentRuns: {},
        editSessions: {},
        codeEntityMaps: {}
      };
    }
    const diagramSets = await Promise.all(project.diagramSetIds.map((id) => this.loadDiagramSet(id)));
    const codeEntitySets: Record<string, CodeEntitiesSetRecord> = {};
    const diagrams: Record<string, DiagramRecord> = {};
    const diagramComponents: Record<string, DiagramComponentRecord> = {};
    const generationBatches: Record<string, GenerationBatchRecord> = {};
    const agentRuns: Record<string, AgentRunRecord> = {};
    const editSessions: Record<string, EditSessionRecord> = {};
    const codeEntityMaps: Record<string, DiagramCodeEntityMapRecord> = {};
    for (const set of diagramSets) {
      codeEntitySets[set.codeEntitiesSetId] = await this.loadCodeEntities(set.id);
      for (const id of set.diagramIds) {
        diagrams[id] = await this.loadDiagram(set.id, id);
        const mapping = await this.loadCodeEntityMap(set.id, id);
        if (mapping) codeEntityMaps[id] = mapping;
      }
      for (const id of set.diagramComponentIds) {
        diagramComponents[id] = await this.loadDiagramComponent(set.id, id);
        const mapping = await this.loadCodeEntityMap(set.id, id);
        if (mapping) codeEntityMaps[id] = mapping;
      }
      for (const id of set.generationBatchIds) {
        generationBatches[id] = await this.loadGenerationBatch(set.id, id);
      }
      for (const id of set.agentRunIds) {
        agentRuns[id] = await readJson<AgentRunRecord>(this.runPath(set.id, id));
      }
      for (const id of set.editSessionIds) {
        editSessions[id] = await this.loadEditSession(set.id, id);
      }
    }
    return {
      project,
      diagramSets,
      codeEntitySets,
      diagrams,
      diagramComponents,
      generationBatches,
      agentRuns,
      editSessions,
      codeEntityMaps
    };
  }

  ids = {
    set: () => makeId("set"),
    run: () => makeId("run"),
    batch: () => makeId("batch"),
    diagram: () => makeId("diagram"),
    diagramComponent: () => makeId("component"),
    editSession: () => makeId("edit"),
    editOperation: () => makeId("operation")
  };
}
