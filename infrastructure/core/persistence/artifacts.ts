import {
  SCHEMA_VERSION,
  assertSafeId,
  type CodeEntitiesSetRecord,
  type DiagramCandidateBatchRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type DiagramViewKind,
  type EditSessionRecord,
  type PromptReference
} from "../../../domain/core/records/domain";
import { assertRepresentationGraph, normalizeRepresentationGraph, type RepresentationGraphRecord } from "../../../domain/core/representations/representationGraph";
import type { PersistenceContext } from './context';
import { loadDiagramCandidateBatch } from './generation';
import { codeEntityMapPath, diagramCandidateBatchPath, diagramComponentPath, diagramPath, editSessionPath, entitiesPath, representationGraphPath, setPath } from './paths';
import { loadDiagramSet, loadProject } from './projects';
import { nowIso, readJson, readJsonIfExists, stableScopedId, writeJsonAtomic } from './shared';

export async function setFeaturedView(context: PersistenceContext, setId: string, viewKind: DiagramViewKind, diagramId?: string): Promise<DiagramSetRecord> {
  const set = await loadDiagramSet(context, setId);
  const featuredViewIds = { ...set.featuredViewIds };
  if (diagramId) featuredViewIds[viewKind] = diagramId;
  else delete featuredViewIds[viewKind];
  const updated: DiagramSetRecord = {
    ...set,
    featuredViewIds,
    updatedAt: nowIso()
  };
  await writeJsonAtomic(setPath(context, setId), updated);
  return updated;
}

export async function clearFeaturedViewReferences(context: PersistenceContext, diagramId: string): Promise<void> {
  const project = await loadProject(context);
  if (!project) return;
  for (const setId of project.diagramSetIds) {
    const set = await loadDiagramSet(context, setId);
    const match = Object.entries(set.featuredViewIds).find(([, id]) => id === diagramId);
    if (match) await setFeaturedView(context, setId, match[0] as DiagramViewKind);
  }
}

export async function loadCodeEntities(context: PersistenceContext, setId: string): Promise<CodeEntitiesSetRecord> {
  const filePath = entitiesPath(context, setId);
  const stored = await readJson<CodeEntitiesSetRecord>(filePath);
  const set = await loadDiagramSet(context, setId);
  let changed = false;
  const entities = stored.entities.map((entity) => {
    const origin = entity.origin ?? {
      projectId: set.projectId,
      diagramSetId: set.id,
      codeEntitiesSetId: stored.id
    };
    const sourceRanges = entity.sourceRanges.map((range, index) => {
      if (range.id) return range;
      changed = true;
      return {
        ...range,
        id: stableScopedId("range", set.projectId, stored.id, entity.id, String(index))
      };
    });
    if (!entity.origin) changed = true;
    return { ...entity, origin, sourceRanges };
  });
  if (!changed) return stored;
  const normalized = { ...stored, entities };
  await writeJsonAtomic(filePath, normalized);
  return normalized;
}

export async function loadDiagram(context: PersistenceContext, setId: string, diagramId: string): Promise<DiagramRecord> {
  const stored = await readJson<DiagramRecord & {
    origin?: DiagramRecord["origin"];
    viewKind?: DiagramViewKind;
    promptReferences?: PromptReference[];
  }>(
    diagramPath(context, setId, diagramId)
  );
  if (stored.origin && stored.viewKind && stored.recordOrigin && !Array.isArray(stored.promptReferences)) {
    return stored as DiagramRecord;
  }
  const { promptReferences: _promptReferences, ...artifact } = stored;
  const normalized: DiagramRecord = {
    ...artifact,
    recordOrigin: stored.recordOrigin ?? {
      projectId: (await loadDiagramSet(context, setId)).projectId,
      diagramSetId: setId
    },
    origin: stored.origin ?? "generated",
    viewKind: stored.viewKind ?? "diagram"
  };
  await writeJsonAtomic(diagramPath(context, setId, diagramId), normalized);
  return normalized;
}

export async function loadDiagramComponent(context: PersistenceContext, setId: string, componentId: string): Promise<DiagramComponentRecord> {
  const stored = await readJson<DiagramComponentRecord & {
    promptReferences?: PromptReference[];
  }>(diagramComponentPath(context, setId, componentId));
  if (!Array.isArray(stored.promptReferences) && stored.recordOrigin) return stored;
  const { promptReferences: _promptReferences, ...component } = stored;
  const normalized = {
    ...component,
    recordOrigin: component.recordOrigin ?? {
      projectId: (await loadDiagramSet(context, setId)).projectId,
      diagramSetId: setId
    }
  };
  await writeJsonAtomic(diagramComponentPath(context, setId, componentId), normalized);
  return normalized;
}

export async function saveDiagramCandidateRankings(context: PersistenceContext, setId: string, candidateBatchId: string, rankings: Array<{ diagramId: string; rank: number }>): Promise<DiagramCandidateBatchRecord> {
  const candidateBatch = await loadDiagramCandidateBatch(context, setId, candidateBatchId);
  if (candidateBatch.diagramSetId !== setId) {
    throw new Error("DiagramCandidateBatch belongs to a different DiagramSet");
  }
  if (rankings.length !== candidateBatch.diagramIds.length) {
    throw new Error("feedback must rank every diagram candidate");
  }
  const expected = new Set(candidateBatch.diagramIds);
  const normalized: Record<string, number> = {};
  for (const ranking of rankings) {
    if (!expected.has(ranking.diagramId)) {
      throw new Error(`diagram is not a member of this candidate batch: ${ranking.diagramId}`);
    }
    if (normalized[ranking.diagramId] !== undefined) {
      throw new Error(`diagram candidate was ranked more than once: ${ranking.diagramId}`);
    }
    if (!Number.isInteger(ranking.rank) || ranking.rank < 1) {
      throw new Error("diagram candidate ranks must be positive integers");
    }
    normalized[ranking.diagramId] = ranking.rank;
  }
  const missing = candidateBatch.diagramIds.find((diagramId) => normalized[diagramId] === undefined);
  if (missing) throw new Error(`diagram candidate is missing a rank: ${missing}`);
  const updated: DiagramCandidateBatchRecord = {
    ...candidateBatch,
    rankings: normalized,
    updatedAt: nowIso()
  };
  await writeJsonAtomic(diagramCandidateBatchPath(context, setId, candidateBatchId), updated);
  return updated;
}

export async function saveDiagramComponent(context: PersistenceContext, component: DiagramComponentRecord): Promise<void> {
  await writeJsonAtomic(
    diagramComponentPath(context, component.diagramSetId, component.id),
    component
  );
}

export async function addDiagram(context: PersistenceContext, diagram: DiagramRecord): Promise<void> {
  await writeJsonAtomic(diagramPath(context, diagram.diagramSetId, diagram.id), diagram);
  const set = await loadDiagramSet(context, diagram.diagramSetId);
  await writeJsonAtomic(setPath(context, diagram.diagramSetId), {
    ...set,
    diagramIds: [...set.diagramIds, diagram.id],
    updatedAt: nowIso()
  });
}

export async function addDiagramComponent(context: PersistenceContext, component: DiagramComponentRecord): Promise<void> {
  await saveDiagramComponent(context, component);
  const set = await loadDiagramSet(context, component.diagramSetId);
  await writeJsonAtomic(setPath(context, component.diagramSetId), {
    ...set,
    diagramComponentIds: [...set.diagramComponentIds, component.id],
    updatedAt: nowIso()
  });
}

export async function renameDiagram(context: PersistenceContext, setId: string, diagramId: string, name: string): Promise<DiagramRecord> {
  const diagram = await loadDiagram(context, setId, diagramId);
  const renamed = { ...diagram, name };
  await writeJsonAtomic(diagramPath(context, setId, diagramId), renamed);
  return renamed;
}

export async function archiveDiagram(context: PersistenceContext, setId: string, diagramId: string): Promise<DiagramRecord> {
  const diagram = await loadDiagram(context, setId, diagramId);
  if (diagram.archivedAt) return diagram;
  const archived = { ...diagram, archivedAt: nowIso() };
  await writeJsonAtomic(diagramPath(context, setId, diagramId), archived);
  const set = await loadDiagramSet(context, setId);
  if (set.featuredViewIds[diagram.viewKind] === diagramId) {
    await setFeaturedView(context, setId, diagram.viewKind);
  }
  return archived;
}

export async function archiveDiagramComponent(context: PersistenceContext, setId: string, componentId: string): Promise<DiagramComponentRecord> {
  const component = await loadDiagramComponent(context, setId, componentId);
  if (component.archivedAt) return component;
  const archived = { ...component, archivedAt: nowIso() };
  await writeJsonAtomic(diagramComponentPath(context, setId, componentId), archived);
  return archived;
}

export async function loadEditSession(context: PersistenceContext, setId: string, sessionId: string): Promise<EditSessionRecord> {
  return readJson<EditSessionRecord>(editSessionPath(context, setId, sessionId));
}

export async function saveEditSession(context: PersistenceContext, session: EditSessionRecord): Promise<void> {
  await writeJsonAtomic(editSessionPath(context, session.diagramSetId, session.id), session);
}

export async function loadCodeEntityMap(context: PersistenceContext, setId: string, artifactId: string): Promise<DiagramCodeEntityMapRecord | null> {
  return readJsonIfExists<DiagramCodeEntityMapRecord>(
    codeEntityMapPath(context, setId, artifactId)
  );
}

export async function saveCodeEntityMap(context: PersistenceContext, mapping: DiagramCodeEntityMapRecord): Promise<void> {
  await writeJsonAtomic(
    codeEntityMapPath(context, mapping.diagramSetId, mapping.artifactId),
    mapping
  );
}

export async function loadRepresentationGraph(context: PersistenceContext, setId: string): Promise<RepresentationGraphRecord | null> {
  assertSafeId(setId, "DiagramSet id");
  const graph = await readJsonIfExists<RepresentationGraphRecord>(
    representationGraphPath(context, setId)
  );
  if (!graph) return null;
  assertRepresentationGraph(graph);
  return normalizeRepresentationGraph(graph);
}

export async function saveRepresentationGraph(context: PersistenceContext, graph: RepresentationGraphRecord): Promise<void> {
  if (!graph.diagramSetId) throw new Error("representation graph must belong to a DiagramSet");
  assertSafeId(graph.diagramSetId, "DiagramSet id");
  assertRepresentationGraph(graph);
  await writeJsonAtomic(representationGraphPath(context, graph.diagramSetId), {
    schemaVersion: SCHEMA_VERSION,
    ...normalizeRepresentationGraph(graph)
  });
}

export async function addEditSession(context: PersistenceContext, session: EditSessionRecord): Promise<void> {
  await saveEditSession(context, session);
  const set = await loadDiagramSet(context, session.diagramSetId);
  await writeJsonAtomic(setPath(context, session.diagramSetId), {
    ...set,
    editSessionIds: [...set.editSessionIds, session.id],
    updatedAt: nowIso()
  });
}
