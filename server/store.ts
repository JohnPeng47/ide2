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
  GLOBAL_IMPORTS_DIAGRAM_SET_ID,
  SCHEMA_VERSION,
  assertSafeId,
  isDiagramModelId,
  type AgentRunRecord,
  type CodeEntityPromptConfigRecord,
  type CodeEntityPromptTemplateRecord,
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
  type ImportedArtifactLibraryRecord,
  type SystemPromptTemplateRecord,
  type PromptReference,
  type ProjectRecord,
  type WorkspaceSnapshot
} from "../src/domain";
import {
  createBuiltInCodeEntityPromptTemplates,
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

  private codeEntityPromptTemplatesPath(): string {
    return path.join(this.storeRoot, "code-entity-prompt-templates.json");
  }

  private importsRoot(): string {
    return path.join(this.storeRoot, "imports");
  }

  private importsIndexPath(): string {
    return path.join(this.importsRoot(), "library.json");
  }

  private importedDiagramPath(diagramId: string): string {
    assertSafeId(diagramId, "Diagram id");
    return path.join(this.importsRoot(), "diagrams", `${diagramId}.json`);
  }

  private importedDiagramComponentPath(componentId: string): string {
    assertSafeId(componentId, "DiagramComponent id");
    return path.join(this.importsRoot(), "diagram-components", `${componentId}.json`);
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

  private codeEntityPromptConfigPath(setId: string, promptConfigId: string): string {
    assertSafeId(promptConfigId, "CodeEntityPromptConfig id");
    return path.join(this.setRoot(setId), "code-entity-prompts", `${promptConfigId}.json`);
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

  async loadImportedArtifactLibrary(): Promise<ImportedArtifactLibraryRecord> {
    const stored = await readJsonIfExists<ImportedArtifactLibraryRecord>(this.importsIndexPath());
    if (stored) return stored;
    const timestamp = nowIso();
    return {
      schemaVersion: SCHEMA_VERSION,
      diagramIds: [],
      diagramComponentIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private async saveImportedArtifactLibrary(
    library: ImportedArtifactLibraryRecord
  ): Promise<void> {
    await writeJsonAtomic(this.importsIndexPath(), library);
  }

  async loadImportedDiagram(diagramId: string): Promise<DiagramRecord> {
    return readJson<DiagramRecord>(this.importedDiagramPath(diagramId));
  }

  async loadImportedDiagramComponent(componentId: string): Promise<DiagramComponentRecord> {
    return readJson<DiagramComponentRecord>(this.importedDiagramComponentPath(componentId));
  }

  async addImportedDiagram(diagram: DiagramRecord): Promise<void> {
    if (diagram.diagramSetId !== GLOBAL_IMPORTS_DIAGRAM_SET_ID || diagram.origin !== "imported") {
      throw new Error("global imported Diagram has invalid ownership");
    }
    const library = await this.loadImportedArtifactLibrary();
    if (library.diagramIds.includes(diagram.id)) throw new Error(`duplicate Diagram: ${diagram.id}`);
    await writeJsonAtomic(this.importedDiagramPath(diagram.id), diagram);
    await this.saveImportedArtifactLibrary({
      ...library,
      diagramIds: [...library.diagramIds, diagram.id],
      updatedAt: nowIso()
    });
  }

  async addImportedDiagramComponent(component: DiagramComponentRecord): Promise<void> {
    if (component.diagramSetId !== GLOBAL_IMPORTS_DIAGRAM_SET_ID
      || component.origin !== "imported") {
      throw new Error("global imported DiagramComponent has invalid ownership");
    }
    const library = await this.loadImportedArtifactLibrary();
    if (library.diagramComponentIds.includes(component.id)) {
      throw new Error(`duplicate DiagramComponent: ${component.id}`);
    }
    await writeJsonAtomic(this.importedDiagramComponentPath(component.id), component);
    await this.saveImportedArtifactLibrary({
      ...library,
      diagramComponentIds: [...library.diagramComponentIds, component.id],
      updatedAt: nowIso()
    });
  }

  async renameImportedDiagram(diagramId: string, name: string): Promise<DiagramRecord> {
    const library = await this.loadImportedArtifactLibrary();
    if (!library.diagramIds.includes(diagramId)) throw new Error(`unknown imported Diagram: ${diagramId}`);
    const diagram = await this.loadImportedDiagram(diagramId);
    const renamed = { ...diagram, name };
    await writeJsonAtomic(this.importedDiagramPath(diagramId), renamed);
    await this.saveImportedArtifactLibrary({ ...library, updatedAt: nowIso() });
    return renamed;
  }

  async archiveImportedDiagram(diagramId: string): Promise<DiagramRecord> {
    const library = await this.loadImportedArtifactLibrary();
    if (!library.diagramIds.includes(diagramId)) throw new Error(`unknown imported Diagram: ${diagramId}`);
    const diagram = await this.loadImportedDiagram(diagramId);
    if (diagram.archivedAt) return diagram;
    const archived = { ...diagram, archivedAt: nowIso() };
    await writeJsonAtomic(this.importedDiagramPath(diagramId), archived);
    await this.saveImportedArtifactLibrary({ ...library, updatedAt: nowIso() });
    return archived;
  }

  async archiveImportedDiagramComponent(componentId: string): Promise<DiagramComponentRecord> {
    const library = await this.loadImportedArtifactLibrary();
    if (!library.diagramComponentIds.includes(componentId)) {
      throw new Error(`unknown imported DiagramComponent: ${componentId}`);
    }
    const component = await this.loadImportedDiagramComponent(componentId);
    if (component.archivedAt) return component;
    const archived = { ...component, archivedAt: nowIso() };
    await writeJsonAtomic(this.importedDiagramComponentPath(componentId), archived);
    await this.saveImportedArtifactLibrary({ ...library, updatedAt: nowIso() });
    return archived;
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

  async loadCodeEntityPromptTemplates(): Promise<CodeEntityPromptTemplateRecord[]> {
    const stored = await readJsonIfExists<{
      schemaVersion: typeof SCHEMA_VERSION;
      templates: CodeEntityPromptTemplateRecord[];
    }>(this.codeEntityPromptTemplatesPath());
    if (stored) return stored.templates;
    const templates = createBuiltInCodeEntityPromptTemplates(nowIso());
    await writeJsonAtomic(this.codeEntityPromptTemplatesPath(), {
      schemaVersion: SCHEMA_VERSION,
      templates
    });
    return templates;
  }

  async saveCodeEntityPromptTemplates(templates: CodeEntityPromptTemplateRecord[]): Promise<void> {
    await writeJsonAtomic(this.codeEntityPromptTemplatesPath(), {
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

  async loadCodeEntityPromptConfig(
    setId: string,
    promptConfigId: string
  ): Promise<CodeEntityPromptConfigRecord> {
    return readJson<CodeEntityPromptConfigRecord>(
      this.codeEntityPromptConfigPath(setId, promptConfigId)
    );
  }

  async saveCodeEntityPromptConfig(config: CodeEntityPromptConfigRecord): Promise<void> {
    const filePath = this.codeEntityPromptConfigPath(config.diagramSetId, config.id);
    const existing = await readJsonIfExists<CodeEntityPromptConfigRecord>(filePath);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(config)) {
        throw new Error(`CodeEntityPromptConfig is immutable: ${config.id}`);
      }
      return;
    }
    await writeJsonAtomic(filePath, config);
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

  async beginCodeEntityCollection(config: CodeEntityPromptConfigRecord): Promise<void> {
    const current = await this.loadCodeEntities(config.diagramSetId);
    if (current.status === "finalized") {
      throw new Error("CodeEntitiesSet is immutable after finalization");
    }
    await this.saveCodeEntityPromptConfig(config);
    await writeJsonAtomic(this.entitiesPath(config.diagramSetId), {
      ...current,
      status: "collecting",
      promptConfigId: config.id,
      error: undefined
    });
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

  private async migrateLegacyImports(
    diagramSets: DiagramSetRecord[],
    initialLibrary: ImportedArtifactLibraryRecord
  ): Promise<ImportedArtifactLibraryRecord> {
    const globalDiagrams = await Promise.all(
      initialLibrary.diagramIds.map((id) => this.loadImportedDiagram(id))
    );
    const globalComponents = await Promise.all(
      initialLibrary.diagramComponentIds.map((id) => this.loadImportedDiagramComponent(id))
    );
    const diagramHandles = new Set(globalDiagrams.map((diagram) => diagram.handle));
    const componentHandles = new Set(globalComponents.map((component) => component.handle));
    const diagramsBySet = new Map<string, DiagramRecord[]>();
    const componentsBySet = new Map<string, DiagramComponentRecord[]>();

    for (const set of diagramSets) {
      const diagrams = await Promise.all(set.diagramIds.map((id) => this.loadDiagram(set.id, id)));
      const components = await Promise.all(
        set.diagramComponentIds.map((id) => this.loadDiagramComponent(set.id, id))
      );
      diagramsBySet.set(set.id, diagrams);
      componentsBySet.set(set.id, components);
      for (const diagram of diagrams) {
        if (diagram.origin !== "imported") diagramHandles.add(diagram.handle);
      }
      for (const component of components) {
        if (component.origin !== "imported") componentHandles.add(component.handle);
      }
    }

    let library = initialLibrary;
    let changed = false;
    const migratedSets: DiagramSetRecord[] = [];
    const uniqueHandle = (requested: string, used: Set<string>): string => {
      const base = requested;
      let handle = base;
      let suffix = 2;
      while (used.has(handle)) handle = `${base}-${suffix++}`;
      used.add(handle);
      return handle;
    };

    for (const set of diagramSets) {
      const diagrams = diagramsBySet.get(set.id) ?? [];
      const components = componentsBySet.get(set.id) ?? [];
      const importedDiagrams = diagrams.filter((diagram) => diagram.origin === "imported");
      const importedComponents = components.filter((component) => component.origin === "imported");
      if (importedDiagrams.length === 0 && importedComponents.length === 0) continue;

      for (const diagram of importedDiagrams) {
        if (!library.diagramIds.includes(diagram.id)) {
          const migrated: DiagramRecord = {
            ...diagram,
            diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID,
            handle: uniqueHandle(diagram.handle, diagramHandles),
            codeEntityIds: []
          };
          await writeJsonAtomic(this.importedDiagramPath(migrated.id), migrated);
          library = { ...library, diagramIds: [...library.diagramIds, migrated.id] };
        }
      }
      for (const component of importedComponents) {
        if (!library.diagramComponentIds.includes(component.id)) {
          const migrated: DiagramComponentRecord = {
            ...component,
            diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID,
            handle: uniqueHandle(component.handle, componentHandles),
            codeEntityIds: []
          };
          await writeJsonAtomic(this.importedDiagramComponentPath(migrated.id), migrated);
          library = {
            ...library,
            diagramComponentIds: [...library.diagramComponentIds, migrated.id]
          };
        }
      }
      migratedSets.push({
        ...set,
        diagramIds: diagrams
          .filter((diagram) => diagram.origin !== "imported")
          .map((diagram) => diagram.id),
        diagramComponentIds: components
          .filter((component) => component.origin !== "imported")
          .map((component) => component.id),
        updatedAt: nowIso()
      });
      changed = true;
    }

    if (!changed) return library;
    const migrated = { ...library, updatedAt: nowIso() };
    await this.saveImportedArtifactLibrary(migrated);
    for (const set of migratedSets) await writeJsonAtomic(this.setPath(set.id), set);
    return migrated;
  }

  async loadWorkspace(): Promise<WorkspaceSnapshot> {
    const project = await this.loadProject();
    let globalImports = await this.loadImportedArtifactLibrary();
    if (!project) {
      const importedDiagrams = await Promise.all(
        globalImports.diagramIds.map((id) => this.loadImportedDiagram(id))
      );
      const importedComponents = await Promise.all(
        globalImports.diagramComponentIds.map((id) => this.loadImportedDiagramComponent(id))
      );
      return {
        project: null,
        diagramSets: [],
        globalImports,
        codeEntitySets: {},
        diagrams: Object.fromEntries(importedDiagrams.map((diagram) => [diagram.id, diagram])),
        diagramComponents: Object.fromEntries(
          importedComponents.map((component) => [component.id, component])
        ),
        codeEntityPromptConfigs: {},
        codeEntityPromptTemplates: {},
        generationPromptConfigs: {},
        systemPromptTemplates: {},
        generationBatches: {},
        agentRuns: {},
        editSessions: {},
        codeEntityMaps: {}
      };
    }
    let diagramSets = await Promise.all(project.diagramSetIds.map((id) => this.loadDiagramSet(id)));
    globalImports = await this.migrateLegacyImports(diagramSets, globalImports);
    diagramSets = await Promise.all(project.diagramSetIds.map((id) => this.loadDiagramSet(id)));
    const codeEntitySets: Record<string, CodeEntitiesSetRecord> = {};
    const diagrams: Record<string, DiagramRecord> = {};
    const diagramComponents: Record<string, DiagramComponentRecord> = {};
    const codeEntityPromptConfigs: Record<string, CodeEntityPromptConfigRecord> = {};
    const codeEntityPromptTemplates = Object.fromEntries(
      (await this.loadCodeEntityPromptTemplates()).map((template) => [template.id, template])
    );
    const generationPromptConfigs: Record<string, GenerationPromptConfigRecord> = {};
    const systemPromptTemplates = Object.fromEntries(
      (await this.loadSystemPromptTemplates()).map((template) => [template.id, template])
    );
    const generationBatches: Record<string, GenerationBatchRecord> = {};
    const agentRuns: Record<string, AgentRunRecord> = {};
    const editSessions: Record<string, EditSessionRecord> = {};
    const codeEntityMaps: Record<string, DiagramCodeEntityMapRecord> = {};
    for (const id of globalImports.diagramIds) {
      diagrams[id] = await this.loadImportedDiagram(id);
    }
    for (const id of globalImports.diagramComponentIds) {
      diagramComponents[id] = await this.loadImportedDiagramComponent(id);
    }
    for (const set of diagramSets) {
      const codeEntities = await this.loadCodeEntities(set.id);
      codeEntitySets[set.codeEntitiesSetId] = codeEntities;
      if (codeEntities.promptConfigId) {
        codeEntityPromptConfigs[codeEntities.promptConfigId] = await this.loadCodeEntityPromptConfig(
          set.id,
          codeEntities.promptConfigId
        );
      }
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
      for (const id of [...globalImports.diagramIds, ...globalImports.diagramComponentIds]) {
        const mapping = await this.loadCodeEntityMap(set.id, id);
        if (mapping) codeEntityMaps[`${set.id}:${id}`] = mapping;
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
      globalImports,
      codeEntitySets,
      diagrams,
      diagramComponents,
      codeEntityPromptConfigs,
      codeEntityPromptTemplates,
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
