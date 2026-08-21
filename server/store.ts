import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  CodeEntity,
  DEFAULT_DIAGRAM_MODEL_ID,
  Diagram,
  DiagramComponent,
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
  type GenerationOutputKind,
  type GenerationPromptConfigRecord,
  type SystemPromptTemplateRecord,
  type PromptReference,
  type ProjectRecord,
  type WorkspaceSnapshot
} from "../src/domain";
import {
  createBuiltInSystemPromptTemplates,
  renderArtifactSystemPrompt
} from "../src/prompt";

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

  private systemPromptTemplatesPath(): string {
    return path.join(this.storeRoot, "system-prompt-templates.json");
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

  private promptConfigPath(setId: string, promptConfigId: string): string {
    assertSafeId(promptConfigId, "GenerationPromptConfig id");
    return path.join(this.setRoot(setId), "generation-prompts", `${promptConfigId}.json`);
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

  async moveDiagramSetToTrash(setId: string): Promise<string> {
    assertSafeId(setId, "DiagramSet id");
    const project = await this.loadProject();
    if (!project || !project.diagramSetIds.includes(setId)) {
      throw new Error(`unknown DiagramSet: ${setId}`);
    }
    await this.loadDiagramSet(setId);
    const deletedAt = nowIso();
    const activeRoot = this.setRoot(setId);
    const trashRoot = path.join(
      this.storeRoot,
      "trash",
      "diagram-sets",
      `${setId}-${deletedAt.replace(/[:.]/g, "-")}`
    );
    await mkdir(path.dirname(trashRoot), { recursive: true });
    const updatedProject = {
      ...project,
      diagramSetIds: project.diagramSetIds.filter((id) => id !== setId),
      updatedAt: deletedAt
    };
    await writeJsonAtomic(this.projectPath(), updatedProject);
    try {
      await rename(activeRoot, trashRoot);
    } catch (error) {
      await writeJsonAtomic(this.projectPath(), project).catch(() => undefined);
      throw error;
    }
    return trashRoot;
  }

  async loadProject(): Promise<ProjectRecord | null> {
    return readJsonIfExists<ProjectRecord>(this.projectPath());
  }

  async loadSystemPromptTemplates(): Promise<SystemPromptTemplateRecord[]> {
    const stored = await readJsonIfExists<{
      schemaVersion: typeof SCHEMA_VERSION;
      templates: SystemPromptTemplateRecord[];
    }>(this.systemPromptTemplatesPath());
    if (stored) return stored.templates;
    const templates = createBuiltInSystemPromptTemplates(nowIso());
    await writeJsonAtomic(this.systemPromptTemplatesPath(), {
      schemaVersion: SCHEMA_VERSION,
      templates
    });
    return templates;
  }

  async saveSystemPromptTemplates(templates: SystemPromptTemplateRecord[]): Promise<void> {
    await writeJsonAtomic(this.systemPromptTemplatesPath(), {
      schemaVersion: SCHEMA_VERSION,
      templates
    });
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
    const stored = await readJson<DiagramRecord & {
      origin?: DiagramRecord["origin"];
      promptReferences?: PromptReference[];
    }>(
      this.diagramPath(setId, diagramId)
    );
    if (stored.origin && !Array.isArray(stored.promptReferences)) return stored as DiagramRecord;
    const { promptReferences: _promptReferences, ...artifact } = stored;
    const normalized: DiagramRecord = { ...artifact, origin: stored.origin ?? "generated" };
    await writeJsonAtomic(this.diagramPath(setId, diagramId), normalized);
    return normalized;
  }

  async loadDiagramComponent(setId: string, componentId: string): Promise<DiagramComponentRecord> {
    const stored = await readJson<DiagramComponentRecord & {
      promptReferences?: PromptReference[];
    }>(this.diagramComponentPath(setId, componentId));
    if (!Array.isArray(stored.promptReferences)) return stored;
    const { promptReferences: _promptReferences, ...component } = stored;
    await writeJsonAtomic(this.diagramComponentPath(setId, componentId), component);
    return component;
  }

  async loadGenerationPromptConfig(
    setId: string,
    promptConfigId: string
  ): Promise<GenerationPromptConfigRecord> {
    return readJson<GenerationPromptConfigRecord>(this.promptConfigPath(setId, promptConfigId));
  }

  async saveGenerationPromptConfig(config: GenerationPromptConfigRecord): Promise<void> {
    const filePath = this.promptConfigPath(config.diagramSetId, config.id);
    const existing = await readJsonIfExists<GenerationPromptConfigRecord>(filePath);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(config)) {
        throw new Error(`GenerationPromptConfig is immutable: ${config.id}`);
      }
      return;
    }
    await writeJsonAtomic(filePath, config);
  }

  private async legacyPromptRepresentation(
    setId: string,
    reference: PromptReference
  ): Promise<string> {
    try {
      if (reference.kind === "code-entity") {
        const entities = await this.loadCodeEntities(setId);
        const entity = entities.entities.find((candidate) => candidate.id === reference.targetId);
        if (entity) return new CodeEntity(entity).prompt_str();
      } else if (reference.kind === "diagram") {
        return new Diagram(await this.loadDiagram(setId, reference.targetId)).prompt_str();
      } else {
        return new DiagramComponent(
          await this.loadDiagramComponent(setId, reference.targetId)
        ).prompt_str();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return `Unavailable historical reference: ${reference.token}`;
  }

  async loadGenerationBatch(setId: string, batchId: string): Promise<GenerationBatchRecord> {
    type LegacyGenerationBatch = Omit<GenerationBatchRecord, "promptConfigId"> & {
      promptConfigId?: string;
      outputKind?: GenerationOutputKind;
      modelId?: unknown;
      userPrompt?: string;
      selectedCodeEntityIds?: string[];
      promptReferences?: PromptReference[];
      resolvedPrompt?: string;
      outputDiagramComponentIds?: string[];
    };
    const stored = await readJson<LegacyGenerationBatch>(this.batchPath(setId, batchId));
    if (stored.promptConfigId) {
      const {
        outputKind: _outputKind,
        modelId: _modelId,
        userPrompt: _userPrompt,
        selectedCodeEntityIds: _selectedCodeEntityIds,
        promptReferences: _promptReferences,
        resolvedPrompt: _resolvedPrompt,
        ...batchFields
      } = stored;
      const normalized: GenerationBatchRecord = {
        ...batchFields,
        promptConfigId: stored.promptConfigId,
        outputDiagramComponentIds: stored.outputDiagramComponentIds ?? []
      };
      if (!Array.isArray(stored.outputDiagramComponentIds)
        || _outputKind !== undefined
        || _modelId !== undefined
        || _userPrompt !== undefined
        || _selectedCodeEntityIds !== undefined
        || _promptReferences !== undefined
        || _resolvedPrompt !== undefined) {
        await writeJsonAtomic(this.batchPath(setId, batchId), normalized);
      }
      return normalized;
    }

    const outputKind = stored.outputKind ?? "diagram";
    const modelId = isDiagramModelId(stored.modelId)
      ? stored.modelId
      : DEFAULT_DIAGRAM_MODEL_ID;
    const references = await Promise.all((stored.promptReferences ?? []).map(async (reference) => ({
      ...reference,
      promptRepresentation: await this.legacyPromptRepresentation(setId, reference)
    })));
    const promptConfigId = `prompt-${createHash("sha256").update(stored.id).digest("hex").slice(0, 16)}`;
    const config: GenerationPromptConfigRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: promptConfigId,
      diagramSetId: setId,
      outputKind,
      modelId,
      instruction: stored.userPrompt ?? "",
      selectedCodeEntityIds: stored.selectedCodeEntityIds ?? [],
      references,
      contextPrompt: {
        templateVersion: 1,
        rendered: stored.resolvedPrompt ?? ""
      },
      systemPrompt: {
        templateId: "artifact-generation",
        templateVersion: 1,
        profileId: "default",
        profileVersion: 1,
        rendered: renderArtifactSystemPrompt({
          outputKind,
          template: createBuiltInSystemPromptTemplates(stored.createdAt)[0]
        })
      },
      createdAt: stored.createdAt
    };
    await this.saveGenerationPromptConfig(config);

    for (const diagramId of stored.outputDiagramIds) {
      const diagram = await readJsonIfExists<DiagramRecord>(this.diagramPath(setId, diagramId));
      if (diagram && diagram.generationPromptConfigId !== promptConfigId) {
        await writeJsonAtomic(this.diagramPath(setId, diagramId), {
          ...diagram,
          generationPromptConfigId: promptConfigId
        });
      }
    }
    for (const componentId of stored.outputDiagramComponentIds ?? []) {
      const component = await readJsonIfExists<DiagramComponentRecord>(
        this.diagramComponentPath(setId, componentId)
      );
      if (component && component.generationPromptConfigId !== promptConfigId) {
        await writeJsonAtomic(this.diagramComponentPath(setId, componentId), {
          ...component,
          generationPromptConfigId: promptConfigId
        });
      }
    }

    const {
      outputKind: _outputKind,
      modelId: _modelId,
      userPrompt: _userPrompt,
      selectedCodeEntityIds: _selectedCodeEntityIds,
      promptReferences: _promptReferences,
      resolvedPrompt: _resolvedPrompt,
      ...batchFields
    } = stored;
    const normalized: GenerationBatchRecord = {
      ...batchFields,
      promptConfigId,
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

  async beginBatch(
    promptConfig: GenerationPromptConfigRecord,
    batch: GenerationBatchRecord,
    runs: AgentRunRecord[]
  ): Promise<void> {
    const entities = await this.loadCodeEntities(batch.diagramSetId);
    if (entities.status !== "finalized" || entities.revision !== batch.codeEntitiesRevision) {
      throw new Error("generation batch is not pinned to the finalized CodeEntitiesSet");
    }
    if (promptConfig.id !== batch.promptConfigId
      || promptConfig.diagramSetId !== batch.diagramSetId) {
      throw new Error("generation batch does not reference its prompt config");
    }
    await this.saveGenerationPromptConfig(promptConfig);
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
        generationPromptConfigs: {},
        systemPromptTemplates: {},
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
    const generationPromptConfigs: Record<string, GenerationPromptConfigRecord> = {};
    const systemPromptTemplates = Object.fromEntries(
      (await this.loadSystemPromptTemplates()).map((template) => [template.id, template])
    );
    const generationBatches: Record<string, GenerationBatchRecord> = {};
    const agentRuns: Record<string, AgentRunRecord> = {};
    const editSessions: Record<string, EditSessionRecord> = {};
    const codeEntityMaps: Record<string, DiagramCodeEntityMapRecord> = {};
    for (const set of diagramSets) {
      codeEntitySets[set.codeEntitiesSetId] = await this.loadCodeEntities(set.id);
      for (const id of set.generationBatchIds) {
        const batch = await this.loadGenerationBatch(set.id, id);
        generationBatches[id] = batch;
        generationPromptConfigs[batch.promptConfigId] = await this.loadGenerationPromptConfig(
          set.id,
          batch.promptConfigId
        );
      }
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
      generationPromptConfigs,
      systemPromptTemplates,
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
    promptConfig: () => makeId("prompt"),
    diagram: () => makeId("diagram"),
    diagramComponent: () => makeId("component"),
    editSession: () => makeId("edit"),
    editOperation: () => makeId("operation")
  };
}
