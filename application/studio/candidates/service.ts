import { createHash } from "node:crypto";
import { representationKindForArtifact } from "../../../domain/core/profiles/domainProfiles";
import {
  isDiagramArchived,
  type DiagramRecord,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import type { ProjectRepresentationEvidenceRecord, ProjectRepresentationMappingRecord, PromoteProjectRepresentationInput } from "../../../domain/core/representations/projectCatalog";
import type { StudioContext } from '../context';
import { stableProjectId } from '../shared';

export async function promoteProjectRepresentation(context: StudioContext, input: PromoteProjectRepresentationInput): Promise<WorkspaceSnapshot> {
  const project = await context.store.loadProject();
  if (!project) throw new Error("project corpus is not initialized");
  const set = await context.store.loadDiagramSet(input.diagramSetId);
  if (set.projectId !== project.id) throw new Error("generation session belongs to another Project");
  const { artifact, global } = await context.core.artifactForDiagramSet(set.id, "diagram", input.diagramId);
  const diagram = artifact as DiagramRecord;
  if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be promoted");
  const local = await context.store.loadCodeEntities(set.id);
  const library = await context.store.loadImportedArtifactLibrary();
  const imported = await Promise.all(
    (library.codeEntityIds ?? []).map((id) => context.store.loadImportedCodeEntity(id))
  );
  const available = new Map([...local.entities, ...imported].map((entity) => [entity.id, entity]));
  const compactions = await context.store.projectCatalogs.loadCompactionCatalog(project.id);
  const evidence: Record<string, ProjectRepresentationEvidenceRecord> = {};
  const evidenceIdByEntityId = new Map<string, string>();
  const rangeIdByLegacyAddress = new Map<string, string>();
  for (const entityId of diagram.codeEntityIds) {
    const entity = available.get(entityId);
    if (!entity) throw new Error(`promoted Diagram references unavailable evidence: ${entityId}`);
    const evidenceId = stableProjectId("evidence", project.id, diagram.id, entity.id);
    evidenceIdByEntityId.set(entity.id, evidenceId);
    const ranges = await Promise.all(entity.sourceRanges.map(async (range, index) => {
      let originalLines = range.originalLines;
      if (!originalLines) {
        const liveLines = await context.core.corpus.readDocumentLines(project.corpus, range.path);
        originalLines = liveLines.slice(range.startLine - 1, range.endLine);
      }
      const rangeId = stableProjectId(
        "evidence-range",
        evidenceId,
        range.id ?? String(index),
        range.path,
        String(range.startLine),
        String(range.endLine)
      );
      rangeIdByLegacyAddress.set(`${entity.id}:${range.id ?? index}`, rangeId);
      rangeIdByLegacyAddress.set(`${entity.id}:${index}`, rangeId);
      const activeCompactionId = compactions.activeByPath[range.path];
      const activeCompaction = activeCompactionId
        ? compactions.compactions[activeCompactionId]
        : undefined;
      const rangeSha256 = createHash("sha256").update(originalLines.join("\n")).digest("hex");
      const compactionId = activeCompaction
        && activeCompaction.sourceSha256 === rangeSha256
        && activeCompaction.startLine === range.startLine
        && activeCompaction.endLine === range.endLine
        ? activeCompaction.id
        : undefined;
      return {
        id: rangeId,
        path: range.path,
        startLine: range.startLine,
        endLine: range.endLine,
        ...(range.symbol ? { symbol: range.symbol } : {}),
        originalLines: [...originalLines],
        ...(compactionId ? { compactionId } : {})
      };
    }));
    evidence[evidenceId] = {
      id: evidenceId,
      handle: entity.handle,
      label: entity.label,
      category: entity.category,
      summary: entity.summary,
      sourceRanges: ranges
    };
  }
  const legacyMap = global
    ? await context.store.loadImportedCodeEntityMap(diagram.id)
    : await context.store.loadCodeEntityMap(set.id, diagram.id);
  const mappings: ProjectRepresentationMappingRecord[] = (legacyMap?.mappings ?? []).map((mapping) => {
    const sourceEntity = available.get(mapping.entityId);
    if (!sourceEntity) throw new Error(`mapping references unavailable evidence: ${mapping.entityId}`);
    const sourceRange = sourceEntity.sourceRanges[mapping.sourceRangeIndex];
    const sourceRangeId = rangeIdByLegacyAddress.get(
      `${mapping.entityId}:${mapping.sourceRangeId ?? sourceRange?.id ?? mapping.sourceRangeIndex}`
    ) ?? rangeIdByLegacyAddress.get(`${mapping.entityId}:${mapping.sourceRangeIndex}`);
    const evidenceId = evidenceIdByEntityId.get(mapping.entityId);
    if (!sourceRangeId || !evidenceId) throw new Error(`mapping evidence was not promoted: ${mapping.id}`);
    return {
      id: stableProjectId("representation-map", project.id, diagram.id, mapping.id),
      evidenceId,
      sourceRangeId,
      line: mapping.line,
      startColumn: mapping.startColumn,
      endColumn: mapping.endColumn
    };
  });
  await context.store.projectCatalogs.promoteRepresentation({
    projectId: project.id,
    ...(input.representationId ? { representationId: input.representationId } : {}),
    ...(input.expectedRevisionId ? { expectedRevisionId: input.expectedRevisionId } : {}),
    handle: diagram.handle,
    name: diagram.name,
    viewKind: diagram.viewKind,
    representationKind: representationKindForArtifact(diagram),
    ascii: diagram.ascii,
    asciiSha256: createHash("sha256").update(diagram.ascii).digest("hex"),
    evidence,
    mappings,
    provenance: { diagramSetId: set.id, artifactId: diagram.id },
    makeActive: input.makeActive !== false
  });
  return context.core.workspace();
}

export async function renameDiagram(context: StudioContext, setId: string, diagramId: string, name: string): Promise<WorkspaceSnapshot> {
  const normalized = name.trim();
  if (!normalized) throw new Error("Diagram name is required");
  if (normalized.length > 120) throw new Error("Diagram name cannot exceed 120 characters");
  const set = await context.store.loadDiagramSet(setId);
  if (!set.diagramIds.includes(diagramId)) throw new Error(`unknown Diagram: ${diagramId}`);
  const diagram = await context.store.loadDiagram(setId, diagramId);
  if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be renamed");
  await context.store.renameDiagram(setId, diagramId, normalized);
  return context.core.workspace();
}

export async function setStarredDiagram(context: StudioContext, setId: string, diagramId: string, starred: boolean): Promise<WorkspaceSnapshot> {
  await context.store.loadDiagramSet(setId);
  const { artifact } = await context.core.artifactForDiagramSet(setId, "diagram", diagramId);
  const diagram = artifact as DiagramRecord;
  const project = await context.store.loadProject();
  if (!project) throw new Error("project corpus is not initialized");
  const catalog = await context.store.projectCatalogs.loadRepresentationCatalog(project.id);
  const representation = context.store.projectCatalogs.representationForSource(
    catalog,
    setId,
    diagramId
  );
  if (starred) {
    if (isDiagramArchived(diagram)) {
      throw new Error("archived diagrams cannot be starred");
    }
    await promoteProjectRepresentation(context, {
      diagramSetId: setId,
      diagramId,
      makeActive: true
    });
  } else if (representation?.status === "settled") {
    await context.store.projectCatalogs.archiveRepresentation(project.id, representation.id);
  }
  return context.core.workspace();
}

export async function rankDiagramCandidates(context: StudioContext, setId: string, candidateBatchId: string, rankings: Array<{ diagramId: string; rank: number }>): Promise<WorkspaceSnapshot> {
  await context.store.loadDiagramSet(setId);
  await context.store.saveDiagramCandidateRankings(setId, candidateBatchId, rankings);
  return context.core.workspace();
}

export async function archiveDiagram(context: StudioContext, setId: string, diagramId: string): Promise<WorkspaceSnapshot> {
  const set = await context.store.loadDiagramSet(setId);
  if (!set.diagramIds.includes(diagramId)) throw new Error(`unknown Diagram: ${diagramId}`);
  await context.store.archiveDiagram(setId, diagramId);
  return context.core.workspace();
}

export async function archiveDiagramComponent(context: StudioContext, setId: string, componentId: string): Promise<WorkspaceSnapshot> {
  const set = await context.store.loadDiagramSet(setId);
  if (!set.diagramComponentIds.includes(componentId)) {
    throw new Error(`unknown DiagramComponent: ${componentId}`);
  }
  await context.store.archiveDiagramComponent(setId, componentId);
  return context.core.workspace();
}
