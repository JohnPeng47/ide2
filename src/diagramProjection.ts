import type {
  ProjectRepresentationCatalogRecord,
  ProjectRepresentationRevisionRecord
} from "./projectCatalog";
import { buildTreeRepresentationIndex, type TreeRepresentationIndex } from "./representationIndex";
import { validateCompactionProjection } from "./compactionProjection";

export interface ProjectProjectionRecord {
  id: string;
  projectId: string;
  name: string;
  sourceRepresentationId: string;
  sourceRevisionId: string;
  targetRepresentationId: string;
  targetRevisionId: string;
  match: "any";
  links: { sourceEvidenceIds: string[]; targetNodeIds: string[] }[];
  /** Immutable file-tree snapshots and exact row links from this call-tree revision. */
  compactionProjection?: import("./compactionProjection").CompactionProjection;
}

export interface ProjectionSelectionResult {
  ascii: string;
  matchedSourceEvidenceIds: string[];
  unmatchedSourceEvidenceIds: string[];
  targetNodeIds: string[];
  visibleNodeIds: string[];
  /** Matched subtrees only, excluding ancestors added solely for display. */
  projectedNodeIds: string[];
  /** Array index is the zero-based rendered row; sourceLine is one-based in the target revision. */
  rows: { nodeId: string; sourceLine: number }[];
}

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function id(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a nonempty string without surrounding whitespace`);
  }
  if (value === "__proto__" || value === "constructor" || value === "prototype") {
    throw new Error(`${label} contains a reserved identifier`);
  }
}

function ids(value: unknown, label: string, nonempty = true): asserts value is string[] {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) {
    throw new Error(`${label} must be ${nonempty ? "a nonempty" : "an"} array`);
  }
  for (const entry of value) id(entry, `${label} entry`);
}

function validateShape(projection: ProjectProjectionRecord): void {
  record(projection, "projection");
  for (const key of ["id", "projectId", "sourceRepresentationId", "sourceRevisionId",
    "targetRepresentationId", "targetRevisionId"] as const) id(projection[key], key);
  if (typeof projection.name !== "string" || !projection.name.trim()) {
    throw new Error("projection name must be a nonempty string");
  }
  if (projection.match !== "any") throw new Error("projection match must be any");
  if (!Array.isArray(projection.links) || projection.links.length === 0) {
    throw new Error("projection links must be a nonempty array");
  }
  for (const link of projection.links) {
    record(link, "projection link");
    ids(link.sourceEvidenceIds, "sourceEvidenceIds");
    ids(link.targetNodeIds, "targetNodeIds");
  }
}

/**
 * Structural identity is scoped to the immutable Project revision, never row coordinates.
 * Conventional trees support a plain root with |, +--, \\--, and `-- connectors;
 * legacy arrow branches remain supported. Other semantic lines are standalone
 * roots, not implicit continuation children (matching the shared index grammar).
 */
export function buildProjectionTree(revision: ProjectRepresentationRevisionRecord): TreeRepresentationIndex {
  record(revision, "target revision");
  if (revision.representationKind !== "tree") throw new Error("projection target must be a tree");
  id(revision.id, "target revision id");
  id(revision.asciiSha256, "target ASCII hash");
  if (typeof revision.ascii !== "string") throw new Error("target ASCII must be a string");
  return buildTreeRepresentationIndex({
    revision: { artifactId: revision.id, asciiSha256: revision.asciiSha256 },
    ascii: revision.ascii,
    codeEntityMap: {
      schemaVersion: 1,
      diagramSetId: revision.projectId,
      artifactKind: "diagram",
      artifactId: revision.id,
      asciiSha256: revision.asciiSha256,
      producedByRunId: revision.id,
      createdAt: revision.createdAt,
      mappings: revision.mappings.map((mapping) => ({
        id: mapping.id,
        entityId: mapping.evidenceId,
        sourceRangeId: mapping.sourceRangeId,
        sourceRangeIndex: revision.evidence[mapping.evidenceId]?.sourceRanges
          .findIndex((range) => range.id === mapping.sourceRangeId) ?? -1,
        line: mapping.line,
        startColumn: mapping.startColumn,
        endColumn: mapping.endColumn
      }))
    }
  });
}

/** Reject cross-project, stale/foreign-revision, and unresolved mappings before persistence/use. */
export function validateProjection(
  projection: ProjectProjectionRecord,
  catalog: ProjectRepresentationCatalogRecord
): void {
  validateShape(projection);
  record(catalog, "representation catalog");
  if (catalog.projectId !== projection.projectId) throw new Error("projection must belong to the same project");
  record(catalog.representations, "catalog representations");
  record(catalog.revisions, "catalog revisions");
  for (const side of ["source", "target"] as const) {
    const representationId = projection[`${side}RepresentationId`];
    const revisionId = projection[`${side}RevisionId`];
    const representation = Object.hasOwn(catalog.representations, representationId)
      ? catalog.representations[representationId] : undefined;
    const revision = Object.hasOwn(catalog.revisions, revisionId) ? catalog.revisions[revisionId] : undefined;
    record(representation, `${side} representation`);
    record(revision, `${side} revision`);
    if (representation.id !== representationId || revision.id !== revisionId
      || representation.projectId !== projection.projectId || revision.projectId !== projection.projectId) {
      throw new Error(`${side} representation and revision must belong to the same project`);
    }
    if (revision.representationId !== representationId || !Array.isArray(representation.revisionIds)
      || !representation.revisionIds.includes(revisionId)) {
      throw new Error(`${side} revision is not owned by its representation`);
    }
    if (side === "target" && representation.representationKind !== "tree") {
      throw new Error("projection target representation must be a tree");
    }
  }
  const source = catalog.revisions[projection.sourceRevisionId];
  record(source.evidence, "source evidence");
  const target = buildProjectionTree(catalog.revisions[projection.targetRevisionId]);
  if (projection.compactionProjection) validateCompactionProjection(projection.compactionProjection, new Set(Object.keys(target.nodes)));
  for (const link of projection.links) {
    for (const evidenceId of link.sourceEvidenceIds) {
      if (!Object.hasOwn(source.evidence, evidenceId) || source.evidence[evidenceId]?.id !== evidenceId) {
        throw new Error(`unknown source evidence: ${evidenceId}`);
      }
    }
    for (const nodeId of link.targetNodeIds) {
      if (!Object.hasOwn(target.nodes, nodeId)) throw new Error(`unknown target node: ${nodeId}`);
    }
  }
}

/**
 * OR-match links, then include matched subtrees and their required ancestor paths.
 * Evidence lists retain selection order; node lists retain original target pre-order.
 * Every rendered row carries its original one-based source line; connectors are regenerated.
 */
export function projectSelection(
  projection: ProjectProjectionRecord,
  targetRevision: ProjectRepresentationRevisionRecord,
  selectedEvidenceIds: readonly string[]
): ProjectionSelectionResult {
  validateShape(projection);
  ids(selectedEvidenceIds, "selectedEvidenceIds", false);
  record(targetRevision, "target revision");
  if (targetRevision.id !== projection.targetRevisionId
    || targetRevision.representationId !== projection.targetRepresentationId
    || targetRevision.projectId !== projection.projectId) {
    throw new Error("projection target revision does not match its pinned revision");
  }
  const tree = buildProjectionTree(targetRevision);
  const selected = [...new Set(selectedEvidenceIds)];
  const selectedSet = new Set(selected);
  const matched = new Set<string>();
  const targets = new Set<string>();
  for (const link of projection.links) {
    for (const nodeId of link.targetNodeIds) {
      if (!Object.hasOwn(tree.nodes, nodeId)) throw new Error(`unknown target node: ${nodeId}`);
    }
    const matches = link.sourceEvidenceIds.filter((evidenceId) => selectedSet.has(evidenceId));
    if (!matches.length) continue;
    matches.forEach((evidenceId) => matched.add(evidenceId));
    link.targetNodeIds.forEach((nodeId) => targets.add(nodeId));
  }
  const visible = new Set<string>();
  const pending = [...targets];
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (visible.has(nodeId)) continue;
    visible.add(nodeId);
    pending.push(...tree.nodes[nodeId].childIds);
  }
  const projected = new Set(visible);
  for (const nodeId of targets) {
    let parentId = tree.nodes[nodeId].parentId;
    while (parentId) {
      visible.add(parentId);
      parentId = tree.nodes[parentId].parentId;
    }
  }
  const lines: string[] = [];
  const rows: ProjectionSelectionResult["rows"] = [];
  const render = (nodeId: string, prefix: string, connector: string, childPrefix: string): void => {
    const node = tree.nodes[nodeId];
    lines.push(prefix + connector + node.text);
    rows.push({ nodeId, sourceLine: node.line });
    const children = node.childIds.filter((childId) => visible.has(childId));
    children.forEach((childId, index) => {
      const last = index === children.length - 1;
      render(childId, childPrefix, last ? "\\-- " : "+-- ", childPrefix + (last ? "    " : "|   "));
    });
  };
  tree.rootIds.filter((nodeId) => visible.has(nodeId)).forEach((nodeId) => render(nodeId, "", "", ""));
  const ordered = Object.values(tree.nodes).sort((left, right) => left.order - right.order);
  return {
    ascii: lines.join("\n"),
    matchedSourceEvidenceIds: selected.filter((evidenceId) => matched.has(evidenceId)),
    unmatchedSourceEvidenceIds: selected.filter((evidenceId) => !matched.has(evidenceId)),
    targetNodeIds: ordered.filter((node) => targets.has(node.id)).map((node) => node.id),
    visibleNodeIds: ordered.filter((node) => visible.has(node.id)).map((node) => node.id),
    projectedNodeIds: ordered.filter((node) => projected.has(node.id)).map((node) => node.id),
    rows
  };
}
