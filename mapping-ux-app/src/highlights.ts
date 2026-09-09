import type { DiagramHighlightRecord } from "./domain";
import {
  representationElementIdForMapping,
  treeRepresentationLineage,
  type EvidenceElementLink,
  type RepresentationRevision,
  type TreeRepresentationIndex
} from "./representationIndex";

export const HIGHLIGHT_RECORD_VERSION = 2 as const;

export interface HighlightTreeLineageNode {
  /** Revision-scoped structural identity, never a rendered line/column address. */
  representationElementId: string;
  /** Creation-time coordinate retained only as snapshot metadata. */
  line: number;
  text: string;
}

export interface HighlightDocumentExcerpt {
  path: string;
  startLine: number;
  endLine: number;
  lines: string[];
}

interface HighlightRecordBase {
  schemaVersion: typeof HIGHLIGHT_RECORD_VERSION;
  id: string;
  projectId: string;
  diagramSetId: string;
  artifactKind: string;
  artifactId: string;
  artifactName: string;
  artifactRevision: RepresentationRevision;
  representationElementId: string;
  /** Creation-time mapping identity retained for toggle compatibility. */
  mappingId?: string;
  elementText: string;
  evidence: EvidenceElementLink;
  documentExcerpt?: HighlightDocumentExcerpt;
  createdAt: string;
}

export type HighlightRecordV2 = HighlightRecordBase & (
  | {
      representationKind: "tree";
      treeLineage: HighlightTreeLineageNode[];
    }
  | {
      representationKind: "diagram";
      treeLineage?: never;
    }
);

export type PersistedHighlightRecord = DiagramHighlightRecord | HighlightRecordV2;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function fail(message: string): never {
  throw new Error(`invalid highlight record: ${message}`);
}

/** Validate persisted V2 data and return its narrowed type. */
export function validateHighlightRecordV2(value: unknown): HighlightRecordV2 {
  if (!object(value)) fail("record must be an object");
  if (value.schemaVersion !== HIGHLIGHT_RECORD_VERSION) fail("schemaVersion must be 2");
  for (const field of [
    "id", "projectId", "diagramSetId", "artifactKind", "artifactId", "artifactName",
    "representationElementId", "elementText", "createdAt"
  ] as const) {
    if (!nonEmpty(value[field])) fail(`${field} must be a non-empty string`);
  }
  if (value.mappingId !== undefined && !nonEmpty(value.mappingId)) {
    fail("mappingId must be a non-empty string when present");
  }
  if (value.representationKind !== "tree" && value.representationKind !== "diagram") {
    fail("representationKind must be tree or diagram");
  }

  if (!object(value.artifactRevision)
    || !nonEmpty(value.artifactRevision.artifactId)
    || !nonEmpty(value.artifactRevision.asciiSha256)) {
    fail("artifactRevision must include artifactId and asciiSha256");
  }
  if (value.artifactRevision.artifactId !== value.artifactId) {
    fail("artifactRevision.artifactId must match artifactId");
  }
  if (!/^[a-f\d]{64}$/i.test(value.artifactRevision.asciiSha256 as string)) {
    fail("artifactRevision.asciiSha256 must be a SHA-256 digest");
  }

  if (!object(value.evidence) || !nonEmpty(value.evidence.evidenceId)) {
    fail("evidence must include evidenceId");
  }
  if (!Number.isInteger(value.evidence.sourceRangeIndex)
    || (value.evidence.sourceRangeIndex as number) < 0) {
    fail("evidence.sourceRangeIndex must be a non-negative integer");
  }
  if (value.evidence.sourceRangeId !== undefined && !nonEmpty(value.evidence.sourceRangeId)) {
    fail("evidence.sourceRangeId must be a non-empty string when present");
  }

  if (value.representationKind === "tree") {
    if (!Array.isArray(value.treeLineage) || value.treeLineage.length === 0) {
      fail("treeLineage must contain the root-to-node snapshot for a tree highlight");
    }
    const seen = new Set<string>();
    for (const [index, entry] of value.treeLineage.entries()) {
      if (!object(entry)
        || !nonEmpty(entry.representationElementId)
        || !positiveInteger(entry.line)
        || !nonEmpty(entry.text)) {
        fail(`treeLineage[${index}] is invalid`);
      }
      if (seen.has(entry.representationElementId)) fail("treeLineage element ids must be unique");
      seen.add(entry.representationElementId);
    }
    if (value.treeLineage.at(-1)?.representationElementId !== value.representationElementId) {
      fail("treeLineage must end at representationElementId");
    }
  } else if (value.treeLineage !== undefined) {
    fail("diagram highlights cannot contain treeLineage");
  }

  if (value.documentExcerpt !== undefined) {
    const excerpt = value.documentExcerpt;
    if (!object(excerpt)
      || !nonEmpty(excerpt.path)
      || !positiveInteger(excerpt.startLine)
      || !positiveInteger(excerpt.endLine)
      || (excerpt.endLine as number) < (excerpt.startLine as number)
      || !Array.isArray(excerpt.lines)
      || !excerpt.lines.every((line) => typeof line === "string")) {
      fail("documentExcerpt is invalid");
    }
    const expectedLines = (excerpt.endLine as number) - (excerpt.startLine as number) + 1;
    if (excerpt.lines.length !== expectedLines) {
      fail("documentExcerpt lines must cover its inclusive line range");
    }
  }

  return value as unknown as HighlightRecordV2;
}

export function isHighlightRecordV2(value: unknown): value is HighlightRecordV2 {
  try {
    validateHighlightRecordV2(value);
    return true;
  } catch {
    return false;
  }
}

/** A deterministic, single-line label suitable for the explorer tree. */
export function highlightTreeViewLabel(highlight: HighlightRecordV2, limit = 48): string {
  if (!Number.isInteger(limit) || limit < 2) throw new Error("highlight label limit must be at least 2");
  const normalized = highlight.elementText.replace(/\s+/g, " ").trim()
    || highlight.artifactName.replace(/\s+/g, " ").trim()
    || highlight.evidence.evidenceId;
  const characters = Array.from(normalized);
  if (characters.length <= limit) return normalized;
  return `${characters.slice(0, limit - 1).join("").trimEnd()}…`;
}

/**
 * Upgrade a legacy tree highlight against the exact indexed artifact revision.
 * Requiring the index prevents fabricated structural ids or migration onto stale ASCII.
 */
export function migrateDiagramHighlightRecord(
  legacy: DiagramHighlightRecord,
  index: TreeRepresentationIndex
): HighlightRecordV2 {
  if (index.revision.artifactId !== legacy.artifactId) {
    throw new Error(`cannot migrate highlight ${legacy.id}: artifact revision does not match`);
  }
  const representationElementId = representationElementIdForMapping(index, legacy.mappingId);
  if (!representationElementId) {
    throw new Error(`cannot migrate highlight ${legacy.id}: mapping ${legacy.mappingId} is not indexed`);
  }
  const node = index.nodes[representationElementId];
  if (!node || node.line !== legacy.graphLine) {
    throw new Error(`cannot migrate highlight ${legacy.id}: mapped tree node does not match snapshot`);
  }
  const mappingIndex = node.mappingIds.indexOf(legacy.mappingId);
  const indexedEvidence = node.evidence[mappingIndex];
  if (!indexedEvidence
    || indexedEvidence.evidenceId !== legacy.entityId
    || indexedEvidence.sourceRangeIndex !== legacy.sourceRangeIndex
    || (legacy.sourceRangeId !== undefined
      && indexedEvidence.sourceRangeId !== legacy.sourceRangeId)) {
    throw new Error(`cannot migrate highlight ${legacy.id}: evidence link does not match mapping`);
  }

  const indexedLineage = treeRepresentationLineage(index, representationElementId);
  const treeLineage = legacy.lineage.map((snapshot) => {
    const indexedNode = indexedLineage.find((candidate) => candidate.line === snapshot.graphLine);
    if (!indexedNode) {
      throw new Error(`cannot migrate highlight ${legacy.id}: lineage does not match artifact revision`);
    }
    return {
      representationElementId: indexedNode.id,
      line: snapshot.graphLine,
      text: snapshot.text
    };
  });
  if (treeLineage.at(-1)?.representationElementId !== representationElementId) {
    throw new Error(`cannot migrate highlight ${legacy.id}: lineage does not end at mapped node`);
  }

  return validateHighlightRecordV2({
    schemaVersion: HIGHLIGHT_RECORD_VERSION,
    id: legacy.id,
    projectId: legacy.projectId,
    diagramSetId: legacy.diagramSetId,
    artifactKind: legacy.artifactKind,
    artifactId: legacy.artifactId,
    artifactName: legacy.artifactName,
    artifactRevision: { ...index.revision },
    representationKind: "tree",
    representationElementId,
    mappingId: legacy.mappingId,
    elementText: legacy.nodeText,
    evidence: {
      evidenceId: legacy.entityId,
      ...(legacy.sourceRangeId !== undefined ? { sourceRangeId: legacy.sourceRangeId } : {}),
      sourceRangeIndex: legacy.sourceRangeIndex
    },
    treeLineage,
    documentExcerpt: {
      path: legacy.transcript.path,
      startLine: legacy.transcript.startLine,
      endLine: legacy.transcript.endLine,
      lines: [...legacy.transcript.lines]
    },
    createdAt: legacy.createdAt
  });
}

export function migrateDiagramHighlightRecords(
  legacyRecords: readonly DiagramHighlightRecord[],
  indexFor: (record: DiagramHighlightRecord) => TreeRepresentationIndex
): HighlightRecordV2[] {
  return legacyRecords.map((record) => migrateDiagramHighlightRecord(record, indexFor(record)));
}
