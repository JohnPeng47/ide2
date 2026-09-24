import { DiagramRevisionEditor } from '../diagrams/diagramRevisionEditor';
import { CanvasHistory, documentFromHistory, validateCanvasHistory, stateKey } from '../diagrams/canvasHistory';
import { validateConnections } from '../diagrams/diagramConnection';
import { buildProjectionTree, validateProjection, type ProjectProjectionRecord } from "../diagrams/diagramProjection";
import { flattenGrid, resolveScene } from '../diagrams/lineGrid';
import { projectCanvasSnapshot, sceneFromRevision, historyFromRevision, type SaveProjectDiagramInput } from "../diagrams/projectDiagramCanvas";
import {
  SCHEMA_VERSION,
  assertSafeId,
  assertSourceRange,
  type DiagramViewKind
} from "../records/domain";
import type { SaveProjectedTreeInput } from "./catalogCommands";
import { ProjectDiagramConflict } from "./errors";
import type {
  ProjectCorpusCompactionCatalogRecord,
  ProjectFileCompactionInput,
  ProjectFileCompactionRecord,
  ProjectRepresentationCatalogRecord,
  ProjectRepresentationRecord,
  ProjectRepresentationRevisionRecord
} from "./projectCatalog";
/** Clock and identifiers are supplied by the caller; transitions perform no I/O. */
export interface CatalogEnvironment {
  timestamp: string; representationId: string; revisionId: string;
  hash(value: string): string; stableId(prefix: string, ...parts: string[]): string;
}

export function saveProjection(catalog: ProjectRepresentationCatalogRecord, projectId: string, projection: ProjectProjectionRecord, environment: CatalogEnvironment) {

  validateProjection(projection, catalog);
  const existing = catalog.projections?.[projection.id];
  if (existing && JSON.stringify(existing) !== JSON.stringify(projection)) {
    throw new Error("Projection is immutable; save a new projection for changed links");
  }
  const next = { ...catalog, projections: { ...catalog.projections, [projection.id]: projection }, updatedAt: environment.timestamp };

  return { catalog: next, projection };

}

export function saveProjectedTree(catalog: ProjectRepresentationCatalogRecord, projectId: string, input: SaveProjectedTreeInput, environment: CatalogEnvironment) {
  if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120
    || typeof input.ascii !== "string" || !input.ascii.trim() || input.ascii.length > 20000
    || !Array.isArray(input.links) || !input.links.length || input.links.length > 2000) {
    throw new Error("A named ASCII tree and projection links are required");
  }

  const source = catalog.representations[input.sourceRepresentationId];
  const sourceRevision = catalog.revisions[input.sourceRevisionId];
  if (!source || source.status !== "settled" || source.currentRevisionId !== input.sourceRevisionId
    || sourceRevision?.representationId !== source.id) {
    throw new ProjectDiagramConflict("Source diagram changed or is unavailable; regenerate its projection");
  }
  const linkedIds = new Set(input.links.flatMap(link => link.sourceEvidenceIds));
  const sourceDiagrams = Object.values(sceneFromRevision(sourceRevision).contents).filter(d =>
    Object.keys(d.sourceContext.evidence).some(id => linkedIds.has(id) || linkedIds.has(`${d.id}:${id}`)));
  const bindings = new Map(sourceDiagrams.flatMap(d => d.sourceContext.binding ? [[d.sourceContext.binding.sourceId, d.sourceContext.binding] as const] : []));
  if (bindings.size > 1) throw new Error("A projected diagram must select evidence from one source; create one diagram per source");
  const diagramSource = [...bindings.values()][0];
  const asciiSha256 = environment.hash(input.ascii);
  const mappingSignature = JSON.stringify(input.links);
  const targetId = input.targetRepresentationId ?? environment.stableId("representation", source.id, sourceRevision.id, input.name.trim(), asciiSha256, mappingSignature);
  // Mapping changes also produce a new immutable revision, even when the ASCII is unchanged.
  const revisionId = environment.stableId("representation-revision", targetId, asciiSha256, mappingSignature);
  const existingTarget = input.targetRepresentationId ? catalog.representations[input.targetRepresentationId] : undefined;
  if (input.targetRepresentationId && (!existingTarget || existingTarget.projectId !== projectId
    || existingTarget.status !== "settled" || existingTarget.representationKind !== "tree"
    || !Object.values(catalog.projections ?? {}).some((p) => p.sourceRepresentationId === source.id && p.targetRepresentationId === targetId)
    || (existingTarget.currentRevisionId !== input.expectedTargetRevisionId && existingTarget.currentRevisionId !== revisionId))) {
    throw new ProjectDiagramConflict("Call tree changed or is unavailable; regenerate against its current revision");
  }
  const timestamp = environment.timestamp;
  const revision: ProjectRepresentationRevisionRecord = {
    schemaVersion: 1, id: revisionId, projectId, representationId: targetId,
    revision: existingTarget ? (catalog.revisions[existingTarget.currentRevisionId]?.revision ?? 0) + 1 : 1,
    ascii: input.ascii, asciiSha256, representationKind: "tree", content: { kind: "ascii", ascii: input.ascii },
    ...(diagramSource ? {source: diagramSource} : {}), evidence: structuredClone(Object.fromEntries(Object.entries(sourceRevision.evidence).filter(([id]) => linkedIds.has(id)))), mappings: [], createdAt: timestamp
  };
  const tree = buildProjectionTree(revision);
  const byLine = new Map(Object.values(tree.nodes).map((node) => [node.line, node]));
  const lines = input.ascii.split("\n");
  const links = input.links.map((link, linkIndex) => {
    if (!link || !Array.isArray(link.sourceEvidenceIds) || !link.sourceEvidenceIds.length
      || !Array.isArray(link.targetLines) || !link.targetLines.length) throw new Error("Invalid projection link");
    const targetNodeIds = link.targetLines.map((line) => {
      const node = byLine.get(line);
      if (!Number.isInteger(line) || !node) throw new Error(`Projection target row ${line} is not a tree node`);
      for (const evidenceId of link.sourceEvidenceIds) {
        const evidence = sourceRevision.evidence[evidenceId];
        if (!evidence) throw new Error(`Unknown projection source evidence: ${evidenceId}`);
        for (const range of evidence.sourceRanges) {
          const startColumn = lines[line - 1].lastIndexOf(node.text) + 1;
          revision.mappings.push({
            id: `projection-map-${linkIndex}-${line}-${evidenceId}-${range.id}`,
            evidenceId, sourceRangeId: range.id, line, startColumn, endColumn: startColumn + node.text.length - 1
          });
        }
      }
      return node.id;
    });
    return { sourceEvidenceIds: [...new Set(link.sourceEvidenceIds)], targetNodeIds: [...new Set(targetNodeIds)] };
  });
  revision.content = {kind:"diagram", diagram:sceneFromRevision(revision).contents.overview};
  delete revision.source;
  const representation: ProjectRepresentationRecord = {
    schemaVersion: 1, id: targetId, projectId, handle: targetId, name: input.name.trim(),
    viewKind: "call-graph", representationKind: "tree", status: "settled", currentRevisionId: revisionId,
    revisionIds: [...new Set([...(existingTarget?.revisionIds ?? []), revisionId])],
    createdAt: existingTarget?.createdAt ?? timestamp, updatedAt: timestamp
  };
  const projection: ProjectProjectionRecord = {
    id: environment.stableId("projection", sourceRevision.id, revisionId, JSON.stringify(links),
      ...(input.compactionProjection ? [JSON.stringify(input.compactionProjection)] : [])), projectId,
    name: input.name.trim(), sourceRepresentationId: source.id, sourceRevisionId: sourceRevision.id,
    targetRepresentationId: targetId, targetRevisionId: revisionId, match: "any", links
  };
  if (input.compactionProjection) {
    const { files, links: compactionLinks } = input.compactionProjection;
    if (!Array.isArray(files) || !Array.isArray(compactionLinks)) throw new Error("Invalid compaction projection");
    for (const file of files) {
      if (typeof file.ascii !== "string" || environment.hash(file.ascii) !== file.asciiSha256) {
        throw new Error("Compaction snapshot hash mismatch");
      }
    }
    projection.compactionProjection = {
      files: structuredClone(files).map(file => ({...file, ...(diagramSource ? {sourceId: diagramSource.sourceId} : {})})), links: compactionLinks.map((link) => {
        const node = byLine.get(link.callTreeLine);
        if (!node) throw new Error(`Unknown call-tree row ${link.callTreeLine}`);
        return { callTreeNodeId: node.id, file: link.file, treeLines: link.treeLines };
      })
    };
  }
  // Exact reimports are idempotent; never reset an independently edited target.
  if (catalog.projections?.[projection.id]) return { catalog, representation: catalog.representations[targetId], projection: catalog.projections[projection.id] };
  const next: ProjectRepresentationCatalogRecord = {
    ...catalog,
    representations: { ...catalog.representations, [targetId]: existingTarget ? representation : catalog.representations[targetId] ?? representation },
    revisions: { ...catalog.revisions, [revisionId]: catalog.revisions[revisionId] ?? revision },
    projections: { ...catalog.projections, [projection.id]: projection }, updatedAt: timestamp
  };
  validateProjection(projection, next);
  projectCanvasSnapshot(sceneFromRevision(revision));

  return { catalog: next, representation: next.representations[targetId], projection };

}

export function saveMappingDiagram(catalog: ProjectRepresentationCatalogRecord, projectId: string, input: SaveProjectDiagramInput, environment: CatalogEnvironment) {
  if (input.projectId && input.projectId !== projectId) throw new Error("Diagram belongs to another Project");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) throw new Error("Diagram name must contain 1–120 characters");

  const current = input.representationId ? catalog.representations[input.representationId] : undefined;
  if (input.representationId && !current) throw new Error("Project diagram was not found");
  if (current?.status === 'archived') throw new ProjectDiagramConflict('Canvas is archived');
  if (current && current.currentRevisionId !== input.expectedRevisionId) {
    const baseline = input.expectedRevisionId && catalog.revisions[input.expectedRevisionId];
    const latest = catalog.revisions[current.currentRevisionId];
    if (!baseline || baseline.representationId !== current.id || !latest) throw new ProjectDiagramConflict('Unknown canvas baseline');
    // Legacy revisions have no binding table: use their complete diagram payload as identity.
    const bindings = (revision: ProjectRepresentationRevisionRecord) => {
      const history = historyFromRevision(revision);
      return history ? history.snapshots[history.headId].diagramBindings
        : Object.fromEntries(Object.entries(sceneFromRevision(revision).contents).map(([id, diagram]) => [id, stateKey(diagram)]));
    };
    try {
      new DiagramRevisionEditor({}, () => ({})).merge(bindings(baseline), bindings(latest),
        input.history?.snapshots[input.history.headId]?.diagramBindings ?? {});
    } catch (error) {
      throw new ProjectDiagramConflict(error instanceof Error ? error.message : 'MERGE_REQUIRED');
    }
    // The merge stub cannot reconcile concurrent composition/layout changes either.
    throw new ProjectDiagramConflict('CANVAS_CONFLICT: canvas advanced; reread before publishing');
  }
  const sourceId = current?.currentRevisionId ?? input.sourceRevisionId;
  const source = sourceId ? catalog.revisions[sourceId] : undefined;
  if (sourceId && !source) throw new Error("Source revision does not belong to this Project");
  if (input.history) {
    validateCanvasHistory(input.history);
    const projected = documentFromHistory(input.history);
    if (stateKey(projected.scene) !== stateKey(input.scene) || stateKey(projected.edges) !== stateKey(input.edges ?? []))
      throw new Error('Canvas history does not match save input');
    const savedHistory = source && historyFromRevision(source);
    if (savedHistory) for (const [id, revision] of Object.entries(input.history.diagramRevisions)) {
      const existing = savedHistory.diagramRevisions[id];
      if (existing && stateKey(existing) !== stateKey(revision)) throw new Error('Diagram revision is immutable');
    }
  }
  const scene = structuredClone(input.scene);
  const { ascii, mappings, evidence } = projectCanvasSnapshot(scene);
  const timestamp = environment.timestamp;
  const id = current?.id ?? environment.representationId;
  const revisionId = environment.revisionId;
  const visibleDiagrams = flattenGrid(resolveScene(scene)).filter(node => node.box.kind === 'diagram');
  const inferredKind = visibleDiagrams.length === 1 && visibleDiagrams[0].contentId
    ? scene.contents[visibleDiagrams[0].contentId].content.structure.kind : 'diagram';
  let history = input.history;
  if (!history) {
    const priorHistory = current && source ? historyFromRevision(source) : undefined;
    const document = { scene, edges: validateConnections(scene, input.edges), sections: {} };
    const working = priorHistory
      ? new CanvasHistory(documentFromHistory(priorHistory), {}, priorHistory)
      : new CanvasHistory(document, {});
    if (priorHistory) working.append(document, {});
    history = working.export();
  }
  const revision: ProjectRepresentationRevisionRecord = {
    schemaVersion: 1, id: revisionId, projectId, representationId: id,
    revision: (current?.revisionIds.length ?? 0) + 1,
    ascii, asciiSha256: environment.hash(ascii),
    content: { kind: "canvas-history", history: structuredClone(history) },
    representationKind: current?.representationKind ?? source?.representationKind ?? inferredKind,
    evidence, mappings, ...(source?.provenance ? { provenance: source.provenance } : {}), createdAt: timestamp
  };
  const representation: ProjectRepresentationRecord = {
    schemaVersion: 1, id, projectId, handle: current?.handle ?? id, name: input.name.trim(),
    viewKind: current?.viewKind ?? "diagram", representationKind: revision.representationKind,
    status: "settled", currentRevisionId: revisionId, revisionIds: [...(current?.revisionIds ?? []), revisionId],
    createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp
  };
  const next = {
    ...catalog, representations: { ...catalog.representations, [id]: representation },
    revisions: { ...catalog.revisions, [revisionId]: revision }, updatedAt: timestamp
  };

  return { catalog: next, representation };

}

export function upsertFileCompaction(catalog: ProjectCorpusCompactionCatalogRecord, projectId: string, input: ProjectFileCompactionInput, environment: CatalogEnvironment) {
  const profile = input.profile ?? { id: "multilevel-lifecycle", version: 1 };
  assertSafeId(profile.id, "compaction profile id");
  if (!Number.isInteger(profile.version) || profile.version < 1) {
    throw new Error("compaction profile version must be a positive integer");
  }
  assertSourceRange({
    path: input.path,
    startLine: input.startLine,
    endLine: input.endLine,
    originalLines: input.originalLines,
    compactedSource: input.compactedSource
  });
  const expectedLineCount = input.endLine - input.startLine + 1;
  if (input.originalLines.length !== expectedLineCount) {
    throw new Error(`compaction source snapshot length does not match ${input.path}`);
  }
  const sourceSha256 = environment.hash(input.originalLines.join("\n"));
  const id = environment.stableId(
    "compaction",
    projectId,
    input.sourceId ?? "unbound",
    input.path,
    sourceSha256,
    profile.id,
    String(profile.version)
  );

  const existing = catalog.compactions[id];
  const timestamp = environment.timestamp;
  const proposed: ProjectFileCompactionRecord = {
    schemaVersion: SCHEMA_VERSION,
    id,
    projectId,
    path: input.path, ...(input.sourceId ? {sourceId:input.sourceId} : {}),
    ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    sourceSha256,
    startLine: input.startLine,
    endLine: input.endLine,
    originalLines: [...input.originalLines],
    compactedSource: input.compactedSource,
    profile,
    ...(input.provenance ? { provenance: input.provenance } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: existing?.updatedAt ?? timestamp
  };
  if (existing) {
    const comparableExisting = { ...existing, updatedAt: undefined };
    const comparableInput = { ...proposed, updatedAt: undefined };
    if (JSON.stringify(comparableExisting) !== JSON.stringify(comparableInput)) {
      throw new Error(`conflicting Project compaction: ${id}`);
    }
  }
  const compaction = existing ?? proposed;
  const activeByPath = { ...catalog.activeByPath };
  if (input.makeActive !== false) activeByPath[JSON.stringify([input.sourceId ?? null, input.path])] = id;
  const next: ProjectCorpusCompactionCatalogRecord = {
    ...catalog,
    activeByPath,
    compactions: { ...catalog.compactions, [id]: compaction },
    updatedAt: timestamp
  };

  return { catalog: next, compaction };

}

export function archiveRepresentation(catalog: ProjectRepresentationCatalogRecord, projectId: string, representationId: string, environment: CatalogEnvironment) {

  const representation = catalog.representations[representationId];
  if (!representation) throw new Error(`unknown Project representation: ${representationId}`);
  if (representation.status === "archived") return catalog;
  const activeByKind = { ...catalog.activeByKind };
  for (const [viewKind, activeId] of Object.entries(activeByKind)) {
    if (activeId === representationId) delete activeByKind[viewKind as DiagramViewKind];
  }
  const timestamp = environment.timestamp;
  const next: ProjectRepresentationCatalogRecord = {
    ...catalog,
    activeByKind,
    representations: {
      ...catalog.representations,
      [representationId]: { ...representation, status: "archived", updatedAt: timestamp }
    },
    updatedAt: timestamp
  };

  return next;

}
