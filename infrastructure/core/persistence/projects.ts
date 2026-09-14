import {
  mkdir,
  rename
} from "node:fs/promises";
import path from "node:path";
import type { RepositoryLocation } from "../../../application/core/corpus/location";
import {
  SCHEMA_VERSION,
  assertSafeId,
  type CodeEntitiesSetRecord,
  type DiagramSetRecord,
  type DiagramViewKind,
  type ProjectRecord
} from "../../../domain/core/records/domain";
import type { PersistenceContext } from './context';
import { entitiesPath, projectPath, setPath, setRoot } from './paths';
import { makeId, normalizedProject, nowIso, projectIdFor, readJson, readJsonIfExists, writeJsonAtomic } from './shared';

export async function ensureProject(context: PersistenceContext, location: RepositoryLocation): Promise<ProjectRecord> {
  const existing = await readJsonIfExists<ProjectRecord>(projectPath(context));
  if (existing) {
    const normalized = normalizedProject(existing);
    const requestedDomain = location.domainProfileId ?? "source-code";
    const sameDocumentRoot = normalized.domainProfileId === "document"
      && requestedDomain === "document"
      && path.resolve(normalized.corpus.root) === path.resolve(location.checkoutRoot);
    if (normalized.repositoryIdentity !== location.repositoryIdentity && !sameDocumentRoot) {
      throw new Error(".diagrams belongs to a different corpus identity");
    }
    if (normalized.domainProfileId !== requestedDomain) {
      throw new Error(`.diagrams belongs to the ${normalized.domainProfileId} domain`);
    }
    if (!existing.domainProfileId || !existing.corpus) {
      await writeJsonAtomic(projectPath(context), normalized);
    }
    return normalized;
  }
  const domainProfileId = location.domainProfileId ?? "source-code";
  const corpus = location.corpus ?? {
    kind: "git-worktree" as const,
    root: location.checkoutRoot,
    ...(location.gitRevision ? { revision: location.gitRevision } : {})
  };
  const timestamp = nowIso();
  const project: ProjectRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: projectIdFor(location.repositoryIdentity),
    name: path.basename(location.checkoutRoot),
    repositoryIdentity: location.repositoryIdentity,
    canonicalRepoRoot: location.checkoutRoot,
    domainProfileId,
    corpus,
    diagramSetIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await writeJsonAtomic(projectPath(context), project);
  return project;
}

export async function createDiagramSet(context: PersistenceContext, input: {
  project: ProjectRecord;
  name: string;
  initialPrompt: string;
  location: RepositoryLocation;
  creationMode?: "generate" | "materialized";
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
    featuredViewIds: {},
    diagramIds: [],
    diagramComponentIds: [],
    generationBatchIds: [],
    agentRunIds: [],
    editSessionIds: [],
    readiness: "collecting",
    creationMode: input.creationMode ?? "generate",
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
  await writeJsonAtomic(entitiesPath(context, setId), codeEntities);
  await writeJsonAtomic(setPath(context, setId), diagramSet);
  const project = {
    ...input.project,
    diagramSetIds: [...input.project.diagramSetIds, setId],
    updatedAt: timestamp
  };
  await writeJsonAtomic(projectPath(context), project);
  return { diagramSet, codeEntities };
}

export async function moveDiagramSetToTrash(context: PersistenceContext, setId: string): Promise<string> {
  assertSafeId(setId, "DiagramSet id");
  const project = await loadProject(context);
  if (!project || !project.diagramSetIds.includes(setId)) {
    throw new Error(`unknown DiagramSet: ${setId}`);
  }
  await loadDiagramSet(context, setId);
  const deletedAt = nowIso();
  const activeRoot = setRoot(context, setId);
  const trashRoot = path.join(
    context.storeRoot,
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
  await writeJsonAtomic(projectPath(context), updatedProject);
  try {
    await rename(activeRoot, trashRoot);
  } catch (error) {
    await writeJsonAtomic(projectPath(context), project).catch(() => undefined);
    throw error;
  }
  return trashRoot;
}

export async function loadProject(context: PersistenceContext): Promise<ProjectRecord | null> {
  const project = await readJsonIfExists<ProjectRecord>(projectPath(context));
  return project ? normalizedProject(project) : null;
}

export async function loadDiagramSet(context: PersistenceContext, setId: string): Promise<DiagramSetRecord> {
  const stored = await readJson<DiagramSetRecord & {
    diagramComponentIds?: string[];
    editSessionIds?: string[];
    featuredViewIds?: Partial<Record<DiagramViewKind, string>>;
  }>(setPath(context, setId));
  if (Array.isArray(stored.diagramComponentIds)
    && Array.isArray(stored.editSessionIds)
    && stored.featuredViewIds) {
    return stored as DiagramSetRecord;
  }
  const normalized: DiagramSetRecord = {
    ...stored,
    featuredViewIds: stored.featuredViewIds ?? {},
    diagramComponentIds: stored.diagramComponentIds ?? [],
    editSessionIds: stored.editSessionIds ?? []
  };
  await writeJsonAtomic(setPath(context, setId), normalized);
  return normalized;
}
